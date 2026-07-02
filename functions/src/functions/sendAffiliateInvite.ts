import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { Resend } from 'resend';
import { buildAffiliateInviteEmail } from '../utils/emailTemplates';

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
    html: buildAffiliateInviteEmail(name, email, magicLink),
  });

  // Mark invite as sent
  await db
    .doc(`affiliates/${affiliateId}`)
    .set({ inviteSentAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

  console.log(`[sendAffiliateInvite] invite sent to ${email} (affiliateId=${affiliateId})`);
  return { sent: true };
});

