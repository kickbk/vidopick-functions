import * as crypto from 'crypto';
import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { Resend } from 'resend';

import { buildEmailChangeNotificationEmail } from '../utils/emailTemplates';

if (!admin.apps.length) admin.initializeApp();

const REVERT_BASE = 'https://us-central1-vidopick-c725d.cloudfunctions.net/revertEmailChange';
const REVERT_TTL_DAYS = 7;

/**
 * Completes an email address change initiated by sendEmailUpdateLink.
 *
 * SECURITY: the client SDK must call applyActionCode(oobCode) and then
 * getIdToken(true) BEFORE invoking this function. That is the proof of
 * ownership — after applyActionCode Firebase Auth already reflects the new
 * email, so request.auth.token.email will equal the pending address. If the
 * token still shows the old email, the user has not clicked the link and
 * the call is rejected.
 *
 * We do NOT call updateUser() here — the email was already updated in
 * Firebase Auth by applyActionCode on the client. We only handle server-side
 * cleanup: Firestore sync, affiliate email mirror, custom token, and
 * security notifications to both old and new addresses.
 */
export const completeEmailChange = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be logged in');
  }

  const uid = request.auth.uid;
  const db = admin.firestore();

  const userDoc = await db.doc(`users/${uid}`).get();
  const pending = userDoc.data()?.pendingEmailChange;

  if (!pending) {
    throw new HttpsError('not-found', 'No pending email change found. The link may have already been used.');
  }

  // Support both new object format { newEmail, oldEmail } and legacy string format.
  let newEmail: string;
  let oldEmail: string | undefined;
  if (typeof pending === 'string') {
    newEmail = pending;
  } else if (typeof pending === 'object' && typeof pending.newEmail === 'string') {
    newEmail = pending.newEmail;
    oldEmail = typeof pending.oldEmail === 'string' ? pending.oldEmail : undefined;
  } else {
    throw new HttpsError('internal', 'Corrupt pending email change record.');
  }

  // Proof that the user actually clicked the verification link: the Firebase Auth
  // ID token (which can only reflect the new email after the client SDK called
  // applyActionCode and then forced a token refresh) must already show newEmail.
  const tokenEmail = request.auth.token.email?.toLowerCase();
  if (tokenEmail !== newEmail.toLowerCase()) {
    throw new HttpsError(
      'failed-precondition',
      'Email verification not yet completed. Please click the verification link sent to your new address first.'
    );
  }

  await db.doc(`users/${uid}`).update({ pendingEmailChange: admin.firestore.FieldValue.delete() });

  // Sync affiliate record if this user is an affiliate
  if (userDoc.data()?.proType === 'affiliate') {
    const affiliateSnap = await db
      .collection('affiliates')
      .where('authUid', '==', uid)
      .limit(1)
      .get();
    if (!affiliateSnap.empty) {
      await affiliateSnap.docs[0].ref.update({ email: newEmail });
    }
  }

  const customToken = await admin.auth().createCustomToken(uid);

  // Generate a revert token valid for REVERT_TTL_DAYS days
  const revertToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REVERT_TTL_DAYS);
  await db.collection('emailRevertTokens').doc(revertToken).set({
    uid,
    originalEmail: oldEmail ?? null,
    newEmail,
    expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
  });

  // Send security notifications — best-effort, don't fail the change if this errors.
  const resendApiKey = process.env.RESEND_API_KEY;
  if (resendApiKey) {
    try {
      const revertLink = `${REVERT_BASE}?token=${revertToken}`;
      const resend = new Resend(resendApiKey);

      const sends: Promise<unknown>[] = [];

      if (oldEmail) {
        // Notify old address so the account owner can revert if this was unauthorised.
        sends.push(
          resend.emails.send({
            from: 'Vidopick <hello@vidopick.com>',
            to: oldEmail,
            subject: 'Your Vidopick email address was changed',
            html: buildEmailChangeNotificationEmail(oldEmail, newEmail, revertLink),
          })
        );
      }

      // Confirm to the new address that the change completed successfully.
      sends.push(
        resend.emails.send({
          from: 'Vidopick <hello@vidopick.com>',
          to: newEmail,
          subject: 'Your Vidopick email address has been updated',
          html: buildEmailChangeNotificationEmail(oldEmail ?? '(previous address)', newEmail, revertLink),
        })
      );

      await Promise.all(sends);
    } catch (e) {
      console.error('[completeEmailChange] failed to send notification email(s):', e);
    }
  }

  console.log(`[completeEmailChange] email confirmed ${oldEmail ?? '?'} → ${newEmail} for uid=${uid}`);
  return { customToken, newEmail };
});
