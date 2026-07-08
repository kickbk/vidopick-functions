import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { Resend } from 'resend';

import { buildEmailUpdateEmail } from '../utils/emailTemplates';
import { checkRateLimit, checkRateLimitDaily } from '../utils/rateLimit';

if (!admin.apps.length) admin.initializeApp();

const APP_AUTH_BASE = 'https://vpk.to/auth-redirect';
const ALLOWED_WEB_ORIGINS = ['https://vidopick.com', 'http://localhost:5173'];

export const sendEmailUpdateLink = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be logged in');
  }

  const { newEmail, webOrigin } = request.data as { newEmail?: string; webOrigin?: string };
  if (!newEmail || typeof newEmail !== 'string') {
    throw new HttpsError('invalid-argument', 'newEmail is required');
  }

  const trimmed = newEmail.trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(trimmed)) {
    throw new HttpsError('invalid-argument', 'Invalid email format');
  }

  const uid = request.auth.uid;
  const currentEmail = request.auth.token.email;
  if (!currentEmail) {
    throw new HttpsError('failed-precondition', 'No email on current account');
  }

  if (trimmed === currentEmail.toLowerCase()) {
    throw new HttpsError('invalid-argument', 'New email must differ from current email');
  }

  const [hourAllowed, dayAllowed] = await Promise.all([
    checkRateLimit(`emailupdate_uid_${uid}`, 3),
    checkRateLimitDaily(`emailupdate_uid_${uid}`, 1),
  ]);
  if (!hourAllowed || !dayAllowed) {
    throw new HttpsError(
      'resource-exhausted',
      'You can only change your email address once per day.'
    );
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    console.error('[sendEmailUpdateLink] RESEND_API_KEY not configured');
    throw new HttpsError('internal', 'Email configuration missing');
  }

  // Store both emails so completeEmailChange can send the security notification to the
  // old address (the token will already show the new email by the time the CF runs).
  await admin
    .firestore()
    .doc(`users/${uid}`)
    .set({ pendingEmailChange: { newEmail: trimmed, oldEmail: currentEmail } }, { merge: true });

  const isWebFlow = typeof webOrigin === 'string' && ALLOWED_WEB_ORIGINS.includes(webOrigin);
  let verifyLink: string;
  if (isWebFlow) {
    const continueUrl = `${webOrigin}/vp/auth/email-action/?mode=email-change`;
    verifyLink = await admin.auth().generateVerifyAndChangeEmailLink(currentEmail, trimmed, {
      url: continueUrl,
    });
  } else {
    const firebaseLink = await admin
      .auth()
      .generateVerifyAndChangeEmailLink(currentEmail, trimmed, {
        url: APP_AUTH_BASE,
        handleCodeInApp: true,
      });
    verifyLink = `${APP_AUTH_BASE}?link=${encodeURIComponent(firebaseLink)}`;
  }

  const resend = new Resend(resendApiKey);
  await resend.emails.send({
    from: 'Vidopick <noreply@vidopick.com>',
    to: trimmed,
    subject: 'Confirm your new Vidopick email address',
    html: buildEmailUpdateEmail(currentEmail, trimmed, verifyLink),
  });

  console.log(`[sendEmailUpdateLink] sent verify link to ${trimmed} for uid=${uid}`);
  return { success: true };
});
