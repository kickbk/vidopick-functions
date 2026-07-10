import { randomBytes } from 'crypto';

import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { Resend } from 'resend';

import { buildAccountDeletionRequestEmail } from '../utils/emailTemplates';
import { checkRateLimit } from '../utils/rateLimit';

if (!admin.apps.length) admin.initializeApp();

const CONFIRM_DELETE_URL_BASE = 'https://vpk.to/confirm-delete';
const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Starts the account-deletion flow: mints a single-use token and emails the user a
 * confirmation link. Nothing is deleted until they open the link (completeAccountDeletion).
 */
export const requestAccountDeletion = onCall(
  { region: 'us-central1', memory: '256MiB', invoker: 'public' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in');

    const { refundIfEligible } = (request.data ?? {}) as { refundIfEligible?: boolean };
    const uid = request.auth.uid;
    const email = request.auth.token.email;
    if (!email) throw new HttpsError('failed-precondition', 'No email on this account');

    // Prevent spamming the confirmation email.
    const allowed = await checkRateLimit(`accountdelete_uid_${uid}`, 3);
    if (!allowed) {
      throw new HttpsError('resource-exhausted', 'Too many attempts. Please try again later.');
    }

    const resendApiKey = process.env.RESEND_API_KEY;
    if (!resendApiKey) {
      console.error('[requestAccountDeletion] RESEND_API_KEY not configured');
      throw new HttpsError('internal', 'Email configuration missing');
    }

    const db = admin.firestore();
    const userSnap = await db.doc(`users/${uid}`).get();
    const name: string =
      (userSnap.data()?.name as string | undefined) ??
      (request.auth.token.name as string | undefined) ??
      '';

    const token = randomBytes(32).toString('hex');
    await db.doc(`accountDeletionTokens/${token}`).set({
      uid,
      email,
      refundIfEligible: refundIfEligible === true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + TOKEN_TTL_MS),
    });

    const confirmUrl = `${CONFIRM_DELETE_URL_BASE}?token=${token}`;
    const resend = new Resend(resendApiKey);
    await resend.emails.send({
      from: 'Vidopick <noreply@vidopick.com>',
      to: email,
      subject: 'Confirm your Vidopick account deletion',
      html: buildAccountDeletionRequestEmail(name, confirmUrl),
    });

    console.log(`[requestAccountDeletion] sent confirmation to ${email} for uid=${uid}`);
    return { success: true };
  }
);
