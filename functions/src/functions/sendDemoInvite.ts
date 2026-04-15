import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import * as nodemailer from 'nodemailer';
import { buildDemoAccessEmail } from '../utils/emailTemplates';
import { sendDemoNotification } from '../utils/sendDemoNotification';

if (!admin.apps.length) {
  admin.initializeApp();
}

const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
const SENDER_EMAIL = 'vidopickhelp@gmail.com';
const DEMO_ADVERTISER_ID = process.env.DEMO_ADVERTISER_ID;
const DEMO_EMAIL = 'vidopick@gmail.com';

const ALLOWED_ORIGINS = ['https://vidopick.com', 'http://localhost:5173'];

function resolveAppUrl(appOrigin?: string): string {
  if (appOrigin && ALLOWED_ORIGINS.includes(appOrigin)) return appOrigin;
  return 'https://vidopick.com';
}

/**
 * Public (no auth required): check demo session availability, then send a
 * magic sign-in link for the demo account to the requester's own email.
 *
 * The sign-in link authenticates as the demo Firebase account (vidopick@gmail.com),
 * but is emailed to the recipient so it never goes to the demo inbox.
 */
export const sendDemoInvite = onCall(async (request) => {
  const { recipientEmail, appOrigin } = request.data;
  const APP_URL = resolveAppUrl(appOrigin);

  if (!recipientEmail) {
    throw new HttpsError('invalid-argument', 'recipientEmail is required');
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(recipientEmail)) {
    throw new HttpsError('invalid-argument', 'Invalid email format');
  }

  if (!DEMO_ADVERTISER_ID) {
    throw new HttpsError('internal', 'Demo account not configured');
  }

  if (!GMAIL_APP_PASSWORD) {
    throw new HttpsError('internal', 'Email configuration missing');
  }

  // Check session availability
  const db = admin.firestore();
  const advertiserSnap = await db.doc(`advertisers/${DEMO_ADVERTISER_ID}`).get();

  if (!advertiserSnap.exists) {
    throw new HttpsError('not-found', 'Demo account not found');
  }

  const data = advertiserSnap.data()!;

  if (data.demoSessionActive) {
    const lockedAt: admin.firestore.Timestamp | undefined = data.demoSessionLockedAt;
    const lastActivity: admin.firestore.Timestamp | undefined = data.lastDemoActivity;

    const activityTs = lastActivity ?? lockedAt;
    const isStale =
      activityTs && Date.now() - activityTs.toMillis() > 15 * 60 * 1000;

    if (!isStale) {
      throw new HttpsError(
        'resource-exhausted',
        'Demo account is currently in use. Please try again in a few minutes.'
      );
    }
    // Stale session — will be overwritten by acquireDemoSession after sign-in
  }

  // Generate a sign-in link for the demo Firebase account, sent to the recipient
  const continueUrl = `${APP_URL}/admin/auth/email-action/?email=${encodeURIComponent(DEMO_EMAIL)}&demo=1&recipient=${encodeURIComponent(recipientEmail)}`;
  const signInLink = await admin.auth().generateSignInWithEmailLink(DEMO_EMAIL, {
    url: continueUrl,
    handleCodeInApp: true,
  });

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: SENDER_EMAIL, pass: GMAIL_APP_PASSWORD },
  });

  await transporter.sendMail({
    from: `"Vidopick" <${SENDER_EMAIL}>`,
    to: recipientEmail,
    subject: 'Your Vidopick demo access link',
    html: buildDemoAccessEmail(recipientEmail, signInLink),
  });

  console.log(`Sent demo invite to ${recipientEmail} (demo account: ${DEMO_EMAIL})`);
  await sendDemoNotification(recipientEmail, 'requested');

  return {
    success: true,
    message: 'Demo access link sent! Check your inbox.',
  };
});
