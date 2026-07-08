import * as crypto from 'crypto';
import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { Resend } from 'resend';

import {
  buildAffiliateEmailUpdatedEmail,
  buildAffiliateInviteEmail,
  buildEmailChangeNotificationEmail,
} from '../utils/emailTemplates';
import { getAffiliateDisplayFields } from '../utils/affiliateDisplay';

if (!admin.apps.length) admin.initializeApp();

const REVERT_BASE = 'https://us-central1-vidopick-c725d.cloudfunctions.net/revertEmailChange';
const REVERT_TTL_DAYS = 7;

export const adminUpdateAffiliateEmail = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in.');
  const token = request.auth.token as Record<string, unknown>;
  if (token.role !== 'admin') throw new HttpsError('permission-denied', 'Admin only.');

  const { affiliateId, newEmail: rawEmail } = request.data as {
    affiliateId?: string;
    newEmail?: string;
  };
  if (!affiliateId?.trim() || !rawEmail?.trim()) {
    throw new HttpsError('invalid-argument', 'affiliateId and newEmail are required.');
  }

  const newEmail = rawEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
    throw new HttpsError('invalid-argument', 'Invalid email format.');
  }

  const db = admin.firestore();
  const affiliateSnap = await db.doc(`affiliates/${affiliateId}`).get();
  if (!affiliateSnap.exists) throw new HttpsError('not-found', 'Affiliate not found.');

  const data = affiliateSnap.data()!;
  const oldEmail: string = data.email ?? '';
  const isClaimed = Boolean(data.claimedAt);
  const storedUid: string | undefined = data.authUid;
  const affiliateName: string = (await getAffiliateDisplayFields(db, affiliateId)).name ?? 'there';

  if (!oldEmail) throw new HttpsError('failed-precondition', 'Affiliate has no email address.');
  if (newEmail === oldEmail.toLowerCase()) {
    throw new HttpsError('invalid-argument', 'New email is the same as the current email.');
  }

  // Resolve Auth user
  let uid: string;
  try {
    if (storedUid) {
      await admin.auth().getUser(storedUid);
      uid = storedUid;
    } else {
      const user = await admin.auth().getUserByEmail(oldEmail);
      uid = user.uid;
    }
  } catch (err: any) {
    if (err.code === 'auth/user-not-found') {
      throw new HttpsError('not-found', `No Firebase Auth user found for ${oldEmail}.`);
    }
    throw err;
  }

  // Update Auth email
  await admin.auth().updateUser(uid, { email: newEmail });

  // Update Firestore
  const firestoreUpdates: Promise<unknown>[] = [
    affiliateSnap.ref.update({ email: newEmail }),
    db.doc(`users/${uid}`).set({ email: newEmail }, { merge: true }),
  ];
  if (isClaimed) {
    firestoreUpdates.push(admin.auth().revokeRefreshTokens(uid));
  }
  await Promise.all(firestoreUpdates);

  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    console.warn('[adminUpdateAffiliateEmail] RESEND_API_KEY not set, skipping emails');
    return { updated: true };
  }
  const resend = new Resend(resendApiKey);

  if (isClaimed) {
    const revertToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + REVERT_TTL_DAYS);
    await db
      .collection('emailRevertTokens')
      .doc(revertToken)
      .set({
        uid,
        originalEmail: oldEmail,
        newEmail,
        expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
      });
    const revertLink = `${REVERT_BASE}?token=${revertToken}`;

    await Promise.all([
      resend.emails.send({
        from: 'Vidopick <noreply@vidopick.com>',
        to: oldEmail,
        subject: 'Your Vidopick email address was changed',
        html: buildEmailChangeNotificationEmail(oldEmail, newEmail, revertLink),
      }),
      resend.emails.send({
        from: 'Vidopick <noreply@vidopick.com>',
        to: newEmail,
        subject: 'Your Vidopick affiliate email has been updated',
        html: buildAffiliateEmailUpdatedEmail(affiliateName, oldEmail, newEmail),
      }),
    ]).catch((e) => console.error('[adminUpdateAffiliateEmail] email error:', e));
  } else {
    const continueUrl = `https://vidopick.com/vp/auth/email-action/?email=${encodeURIComponent(newEmail)}`;
    const magicLink = await admin.auth().generateSignInWithEmailLink(newEmail, {
      url: continueUrl,
      handleCodeInApp: true,
    });
    await resend.emails
      .send({
        from: 'Vidopick <noreply@vidopick.com>',
        to: newEmail,
        subject: "You're invited to Vidopick affiliates",
        html: buildAffiliateInviteEmail(affiliateName, newEmail, magicLink),
      })
      .catch((e) => console.error('[adminUpdateAffiliateEmail] invite email error:', e));
    await affiliateSnap.ref.set(
      { inviteSentAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );
  }

  console.log(
    `[adminUpdateAffiliateEmail] ${oldEmail} → ${newEmail} (uid=${uid}, claimed=${isClaimed})`
  );
  return { updated: true };
});
