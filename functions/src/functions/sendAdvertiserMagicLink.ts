import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import * as nodemailer from 'nodemailer';
import { buildInviteEmail, buildSignInEmail } from '../utils/emailTemplates';

if (!admin.apps.length) {
  admin.initializeApp();
}

const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
const SENDER_EMAIL = 'vidopickhelp@gmail.com';

const ALLOWED_ORIGINS = ['https://vidopick.com', 'http://localhost:5173'];

function resolveAppUrl(appOrigin?: string): string {
  if (appOrigin && ALLOWED_ORIGINS.includes(appOrigin)) return appOrigin;
  return 'https://vidopick.com';
}

function createTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: SENDER_EMAIL, pass: GMAIL_APP_PASSWORD },
  });
}

/**
 * Admin-only: resend the invite email for an existing advertiser account.
 * Generates a fresh sign-in link and sends the welcome email.
 */
export const sendAdvertiserInvite = onCall(async (request) => {
  if (!request.auth || request.auth.token.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Only admins can send advertiser invites');
  }

  const { advertiserId, appOrigin } = request.data;
  const APP_URL = resolveAppUrl(appOrigin);

  if (!advertiserId) {
    throw new HttpsError('invalid-argument', 'advertiserId is required');
  }

  if (!GMAIL_APP_PASSWORD) {
    throw new HttpsError('internal', 'Email configuration missing');
  }

  const db = admin.firestore();
  const advertiserSnap = await db.doc(`advertisers/${advertiserId}`).get();

  if (!advertiserSnap.exists) {
    throw new HttpsError('not-found', 'Advertiser not found');
  }

  const data = advertiserSnap.data()!;
  const email: string = data.email;
  const name: string = data.name || 'there';

  if (!email) {
    throw new HttpsError('failed-precondition', 'Advertiser has no email address');
  }

  if (!data.authUid) {
    throw new HttpsError(
      'failed-precondition',
      'Advertiser has no account yet. Create an account first.'
    );
  }

  const continueUrl = `${APP_URL}/admin/auth/email-action/?email=${encodeURIComponent(email)}`;
  const signInLink = await admin.auth().generateSignInWithEmailLink(email, {
    url: continueUrl,
    handleCodeInApp: true,
  });

  await createTransporter().sendMail({
    from: `"Vidopick" <${SENDER_EMAIL}>`,
    to: email,
    subject: "You're invited to Vidopick",
    html: buildInviteEmail(name, signInLink),
  });

  console.log(`Sent invite email to ${email} for advertiser ${advertiserId}`);

  return { success: true, message: `Invite email sent to ${email}` };
});

/**
 * Public (no auth required): send a sign-in link to an email address.
 * Used by the login page. Always returns success to prevent account enumeration.
 */
export const sendSignInLink = onCall(async (request) => {
  const { email, appOrigin } = request.data;
  const APP_URL = resolveAppUrl(appOrigin);

  if (!email) {
    throw new HttpsError('invalid-argument', 'email is required');
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new HttpsError('invalid-argument', 'Invalid email format');
  }

  if (!GMAIL_APP_PASSWORD) {
    throw new HttpsError('internal', 'Email configuration missing');
  }

  // Verify account exists — return success silently if not (prevent enumeration)
  try {
    await admin.auth().getUserByEmail(email);
  } catch (error: any) {
    if (error.code === 'auth/user-not-found') {
      console.log(`Sign-in link requested for unknown email: ${email}`);
      return {
        success: true,
        message: 'If an account exists for this email, a sign-in link has been sent.',
      };
    }
    throw new HttpsError('internal', `Auth lookup failed: ${error.message}`);
  }

  const continueUrl = `${APP_URL}/admin/auth/email-action/?email=${encodeURIComponent(email)}`;
  const signInLink = await admin.auth().generateSignInWithEmailLink(email, {
    url: continueUrl,
    handleCodeInApp: true,
  });

  await createTransporter().sendMail({
    from: `"Vidopick" <${SENDER_EMAIL}>`,
    to: email,
    subject: 'Your Vidopick sign-in link',
    html: buildSignInEmail(signInLink),
  });

  console.log(`Sent sign-in link to ${email}`);

  return {
    success: true,
    message: 'If an account exists for this email, a sign-in link has been sent.',
  };
});
