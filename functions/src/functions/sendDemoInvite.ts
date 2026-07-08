import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { Resend } from 'resend';
import { buildDemoAccessEmail } from '../utils/emailTemplates';
import { sendDemoNotification } from '../utils/sendDemoNotification';

if (!admin.apps.length) {
  admin.initializeApp();
}

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const DEMO_ORGANIZATION_ID = process.env.DEMO_ORGANIZATION_ID;
const DEMO_EMAIL = 'demo@vidopick.com';

const ALLOWED_ORIGINS = ['https://vidopick.com', 'http://localhost:5173'];

function resolveAppUrl(appOrigin?: string): string {
  if (appOrigin && ALLOWED_ORIGINS.includes(appOrigin)) return appOrigin;
  return 'https://vidopick.com';
}

/**
 * Public (no auth required): check demo session availability, then send a
 * magic sign-in link for the demo account to the requester's own email.
 *
 * The sign-in link authenticates as the demo Firebase account (demo@vidopick.com),
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

  if (!DEMO_ORGANIZATION_ID) {
    throw new HttpsError('internal', 'Demo account not configured');
  }

  if (!RESEND_API_KEY) {
    throw new HttpsError('internal', 'Email configuration missing');
  }

  // Check session availability
  const db = admin.firestore();
  const organizationSnap = await db.doc(`organizations/${DEMO_ORGANIZATION_ID}`).get();

  if (!organizationSnap.exists) {
    throw new HttpsError('not-found', 'Demo account not found');
  }

  const data = organizationSnap.data()!;

  if (data.demoSessionActive) {
    const lockedAt: admin.firestore.Timestamp | undefined = data.demoSessionLockedAt;
    const lastActivity: admin.firestore.Timestamp | undefined = data.lastDemoActivity;

    const activityTs = lastActivity ?? lockedAt;
    const isStale = activityTs && Date.now() - activityTs.toMillis() > 15 * 60 * 1000;

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

  const resend = new Resend(RESEND_API_KEY);
  await resend.emails.send({
    from: 'Vidopick <noreply@vidopick.com>',
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
