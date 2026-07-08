import * as admin from 'firebase-admin';
import { onRequest } from 'firebase-functions/v2/https';
import { Resend } from 'resend';

if (!admin.apps.length) admin.initializeApp();

const RESEND_API_KEY = process.env.RESEND_API_KEY;

const ALLOWED_ORIGINS = ['https://vidopick.com', 'http://localhost:5173'];

function resolveAppUrl(origin?: string): string {
  if (origin && ALLOWED_ORIGINS.includes(origin)) return origin;
  return 'https://vidopick.com';
}

/**
 * Self-service sign-in link for affiliate partners.
 * Only sends if the email belongs to a registered influencer affiliate.
 * Always returns 200 to prevent enumeration.
 */
export const sendAffiliateSignInLink = onRequest(
  { region: 'us-central1', timeoutSeconds: 15, memory: '256MiB', invoker: 'public', cors: true },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const { email } = (req.body ?? {}) as { email?: string };
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: 'Valid email required.' });
      return;
    }

    try {
      const db = admin.firestore();
      const snap = await db
        .collection('affiliates')
        .where('email', '==', email.toLowerCase())
        .where('type', '==', 'influencer')
        .limit(1)
        .get();

      if (!snap.empty && RESEND_API_KEY) {
        const affiliateName: string = snap.docs[0].data().name ?? 'there';
        const base = resolveAppUrl(req.headers.origin);
        const continueUrl = `${base}/vp/auth/email-action/?email=${encodeURIComponent(email)}`;
        const magicLink = await admin.auth().generateSignInWithEmailLink(email, {
          url: continueUrl,
          handleCodeInApp: false,
        });

        const resend = new Resend(RESEND_API_KEY);
        await resend.emails.send({
          from: 'Vidopick <noreply@vidopick.com>',
          to: email,
          subject: 'Your Vidopick sign-in link',
          html: buildSignInEmail(affiliateName, magicLink),
        });
        console.log(`[sendAffiliateSignInLink] sent to ${email}`);
      }
    } catch (e: any) {
      console.error('[sendAffiliateSignInLink] error:', e?.message ?? e);
    }

    // Always 200 — never reveal whether the email exists
    res.json({ success: true });
  }
);

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildSignInEmail(name: string, link: string): string {
  const safeName = esc(name);
  const safeLink = esc(link);
  return `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1e293b">
      <h2 style="font-size:20px;margin-bottom:8px">Hi ${safeName},</h2>
      <p style="font-size:15px;line-height:1.6">
        Here's your sign-in link for your affiliate dashboard.
        It expires in 24 hours and can only be used once.
      </p>
      <div style="margin:28px 0">
        <a href="${safeLink}"
           style="background:#2563eb;color:#fff;text-decoration:none;padding:13px 26px;border-radius:8px;font-size:15px;font-weight:600;display:inline-block">
          Sign in to dashboard →
        </a>
      </div>
      <p style="font-size:13px;color:#64748b">
        If you didn't request this, you can safely ignore it.
      </p>
    </div>
  `;
}
