import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { Resend } from 'resend';

if (!admin.apps.length) admin.initializeApp();

const RESEND_API_KEY = process.env.RESEND_API_KEY;

const ALLOWED_ORIGINS = ['https://vidopick.com', 'http://localhost:5173'];

function resolveAppUrl(appOrigin?: string): string {
  if (appOrigin && ALLOWED_ORIGINS.includes(appOrigin)) return appOrigin;
  return 'https://vidopick.com';
}

export const sendAffiliateInvite = onCall({ region: 'us-central1' }, async (request) => {
  // Must be called by an authenticated admin
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in.');
  const token = request.auth.token as Record<string, unknown>;
  if (token.role !== 'admin') throw new HttpsError('permission-denied', 'Admin only.');

  const affiliateId = (request.data?.affiliateId ?? '').toString().trim();
  const appOrigin = (request.data?.appOrigin ?? '') as string;
  if (!affiliateId) throw new HttpsError('invalid-argument', 'affiliateId is required.');

  if (!RESEND_API_KEY) throw new HttpsError('internal', 'Email not configured.');

  const db = admin.firestore();
  const snap = await db.doc(`affiliates/${affiliateId}`).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Affiliate not found.');

  const affiliate = snap.data()!;
  const email: string = affiliate.email;
  const name: string = affiliate.name ?? 'there';

  if (!email) throw new HttpsError('failed-precondition', 'Affiliate has no email address.');

  // Pre-create (or update) the Firebase Auth user so their displayName is set
  // before they ever open the app. This eliminates the race condition where the
  // app shows "What's your name?" while the onUserCreated trigger is still running.
  let uid: string;
  try {
    const existing = await admin.auth().getUserByEmail(email);
    uid = existing.uid;
    if (!existing.displayName) {
      await admin.auth().updateUser(uid, { displayName: name });
    }
  } catch (err: any) {
    if (err.code === 'auth/user-not-found') {
      const created = await admin.auth().createUser({ email, displayName: name });
      uid = created.uid;
    } else {
      throw err;
    }
  }

  // Grant Pro and write all affiliate fields to the user doc now, without waiting
  // for onUserCreated (which requires emailVerified and runs asynchronously).
  await Promise.all([
    db.doc(`users/${uid}`).set(
      {
        email: email.toLowerCase(),
        proStatus: 'active',
        proType: 'affiliate',
        affiliateGrantedAt: admin.firestore.FieldValue.serverTimestamp(),
        name: name,
      },
      { merge: true }
    ),
    db.doc(`affiliates/${affiliateId}`).set({ authUid: uid }, { merge: true }),
  ]);

  console.log(`[sendAffiliateInvite] affiliate provisioned uid=${uid}`);

  const base = resolveAppUrl(appOrigin);
  const continueUrl = `${base}/vp/auth/email-action/?email=${encodeURIComponent(email)}`;
  const magicLink = await admin.auth().generateSignInWithEmailLink(email, {
    url: continueUrl,
    handleCodeInApp: true,
  });

  const resend = new Resend(RESEND_API_KEY);
  await resend.emails.send({
    from: 'Vidopick <hello@vidopick.com>',
    to: email,
    subject: "You're invited to Vidopick affiliates",
    html: buildInviteEmail(name, email, magicLink),
  });

  // Mark invite as sent
  await db
    .doc(`affiliates/${affiliateId}`)
    .set({ inviteSentAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

  console.log(`[sendAffiliateInvite] invite sent to ${email} (affiliateId=${affiliateId})`);
  return { sent: true };
});

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildInviteEmail(name: string, email: string, link: string): string {
  const safeName = esc(name);
  const safeEmail = esc(email);
  const safeLink = esc(link);
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;color:#1e293b;background:#ffffff">

      <!-- Header -->
      <div style="padding:32px 32px 0">
        <img src="https://vidopick.com/images/business.png" alt="Vidopick" width="44" height="44" style="display:block;margin-bottom:24px" />
        <h1 style="font-size:24px;font-weight:700;margin:0 0 8px;color:#0f172a">Hi ${safeName}!</h1>
        <p style="font-size:15px;line-height:1.65;color:#475569;margin:0 0 32px">
          You've been invited to join the <strong style="color:#1e293b">Vidopick Affiliate Program</strong>.
          Here's how to get started. We'll guide you through each step once you're in.
        </p>
      </div>

      <!-- Steps -->
      <div style="padding:0 32px">

        <!-- Step 1 -->
        <div style="margin-bottom:20px">
          <div style="display:flex;align-items:flex-start;gap:14px">
            <div style="background:#dbeafe;color:#1d4ed8;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;flex-shrink:0;line-height:28px;text-align:center">1</div>
            <div>
              <p style="font-weight:600;font-size:15px;color:#1e293b;margin:0 0 6px">Download Vidopick</p>
              <div style="display:flex;gap:10px;flex-wrap:wrap">
                <a href="https://apps.apple.com/us/app/vidopick/id6749210639" style="display:inline-flex;align-items:center;gap:8px;background:#000;border:1px solid #334155;color:#fff;text-decoration:none;padding:8px 14px;border-radius:10px">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>
                  <span style="text-align:left;line-height:1.2"><span style="display:block;font-size:10px;color:#94a3b8">Download on the</span><span style="display:block;font-size:13px;font-weight:600">App Store</span></span>
                </a>
                <a href="https://play.google.com/store/apps/details?id=com.vidopick.app" style="display:inline-flex;align-items:center;gap:8px;background:#000;border:1px solid #334155;color:#fff;text-decoration:none;padding:8px 14px;border-radius:10px">
                  <svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M3.18 23.76A2 2 0 0 1 2 22V2a2 2 0 0 1 1.18-1.76l11.31 11.75L3.18 23.76z" fill="#00C6FB"/><path d="M20.09 10.53l-2.5-1.45L14.49 12l3.1 2.92 2.5-1.45a2 2 0 0 0 0-2.94z" fill="#FFD200"/><path d="M3.18 23.76L14.49 12 17.59 14.92 5.5 21.9a2 2 0 0 1-2.32 1.86z" fill="#FF5C78"/><path d="M3.18.24A2 2 0 0 1 5.5 2.1l12.09 6.98L14.49 12 3.18.24z" fill="#00E87C"/></svg>
                  <span style="text-align:left;line-height:1.2"><span style="display:block;font-size:10px;color:#94a3b8">Get it on</span><span style="display:block;font-size:13px;font-weight:600">Google Play</span></span>
                </a>
              </div>
            </div>
          </div>
        </div>

        <!-- Step 2 -->
        <div style="margin-bottom:20px">
          <div style="display:flex;align-items:flex-start;gap:14px">
            <div style="background:#dbeafe;color:#1d4ed8;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;flex-shrink:0;line-height:28px;text-align:center">2</div>
            <div style="flex:1">
              <p style="font-weight:600;font-size:15px;color:#1e293b;margin:0 0 8px">Sign into Vidopick with your email address</p>
              <div style="background:#eff6ff;border:2px solid #bfdbfe;border-radius:10px;padding:12px 16px;font-family:monospace;font-size:15px;color:#1d4ed8;font-weight:600;text-align:center;letter-spacing:0.02em">
                ${safeEmail}
              </div>
              <p style="font-size:13px;color:#64748b;margin:8px 0 0;line-height:1.5">
                You'll be approved as <strong>Pro</strong> automatically for free.
              </p>
            </div>
          </div>
        </div>

        <!-- Step 3 -->
        <div style="margin-bottom:32px">
          <div style="display:flex;align-items:flex-start;gap:14px">
            <div style="background:#dbeafe;color:#1d4ed8;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;flex-shrink:0;line-height:28px;text-align:center">3</div>
            <div>
              <p style="font-weight:600;font-size:15px;color:#1e293b;margin:0 0 10px">Access your Affiliate Dashboard</p>
              <a href="${safeLink}"
                 style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:13px 24px;border-radius:9px;font-size:15px;font-weight:600">
                Open your Dashboard →
              </a>
              <p style="font-size:12px;color:#94a3b8;margin:10px 0 0">Link expires in 24 hours.</p>
            </div>
          </div>
        </div>

      </div>

      <!-- Footer -->
      <div style="border-top:1px solid #e2e8f0;padding:20px 32px">
        <p style="font-size:12px;color:#94a3b8;margin:0;line-height:1.6">
          The Vidopick Team · If you weren't expecting this email, you can ignore it.<br/>
          If the button doesn't work: <a href="${safeLink}" style="color:#3b82f6;word-break:break-all">${safeLink}</a>
        </p>
      </div>

    </div>
  `;
}
