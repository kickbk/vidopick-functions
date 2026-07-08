import * as admin from 'firebase-admin';
import { onRequest } from 'firebase-functions/v2/https';
import { Resend } from 'resend';

import { buildAppMagicLinkEmail } from '../utils/emailTemplates';
import { checkRateLimit, requestIp } from '../utils/rateLimit';

if (!admin.apps.length) {
  admin.initializeApp();
}

const RESEND_API_KEY = process.env.RESEND_API_KEY;

// The Firebase auth link uses this as its continueUrl (required by Firebase).
// We don't actually send this URL in the email — instead we wrap the whole
// Firebase link inside vpk.to/auth-redirect?link=... so that iOS/Android
// universal links intercept it and open the app directly without a browser step.
const CONTINUE_URL = 'https://vpk.to/auth-redirect';
const APP_AUTH_BASE = 'https://vpk.to/auth-redirect';

/**
 * Public endpoint: send a magic sign-in link for the Vidopick mobile app.
 * Any email can be used — Firebase creates the account on first sign-in.
 * Always returns 200 to prevent account enumeration.
 */
export const sendAppMagicLink = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 15,
    memory: '256MiB',
    invoker: 'public',
    cors: true,
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const { email } = (req.body ?? {}) as { email?: string };

    if (!email) {
      res.status(400).json({ error: 'email is required' });
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      res.status(400).json({ error: 'Invalid email format' });
      return;
    }

    if (!RESEND_API_KEY) {
      console.error('RESEND_API_KEY not configured');
      res.status(500).json({ error: 'Email configuration missing' });
      return;
    }

    // Public endpoint that emails arbitrary addresses — cap volume per IP
    // and per target address.
    const ip = requestIp(req);
    const [ipAllowed, emailAllowed] = await Promise.all([
      checkRateLimit(`magiclink_ip_${ip}`, 10),
      checkRateLimit(`magiclink_email_${email.toLowerCase()}`, 5),
    ]);
    if (!ipAllowed || !emailAllowed) {
      res.status(429).json({ error: 'Too many requests. Please try again later.' });
      return;
    }

    try {
      const firebaseLink = await admin.auth().generateSignInWithEmailLink(email, {
        url: CONTINUE_URL,
        handleCodeInApp: true,
      });

      // Wrap the Firebase auth URL inside a vpk.to universal link so the email
      // recipient taps one link and the app opens directly — no browser page.
      const appLink = `${APP_AUTH_BASE}?link=${encodeURIComponent(firebaseLink)}`;

      const resend = new Resend(RESEND_API_KEY);
      await resend.emails.send({
        from: 'Vidopick <noreply@vidopick.com>',
        to: email,
        subject: 'Your Vidopick sign-in link',
        html: buildAppMagicLinkEmail(appLink),
      });

      console.log(`[sendAppMagicLink] sent to ${email}`);
      res.json({ success: true });
    } catch (e: any) {
      // Log the real error so it appears in Cloud Logging — this is the first place to look
      // if emails are not arriving. Check: Firebase Console > Functions > Logs > sendAppMagicLink
      console.error('[sendAppMagicLink] FAILED:', e?.message ?? e);
      // Still return 200 to avoid account enumeration on the client side
      res.json({ success: true });
    }
  }
);
