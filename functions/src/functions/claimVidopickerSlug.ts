import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

if (!admin.apps.length) admin.initializeApp();

const RESERVED = new Set([
  'login', 'dashboard', 'auth', 'admin', 'vp', 'app', 'api',
  'help', 'support', 'about', 'terms', 'privacy', 'contact',
  'business', 'pro', 'get', 'home', 'index',
  'vidopick', 'youtube', 'kids', 'school', 'preschool',
  'church', 'synagogue', 'playground', 'class',
]);

// 5–15 chars, lowercase alphanumeric + hyphens, must start and end with alphanumeric
const SLUG_RE = /^[a-z0-9][a-z0-9-]{3,13}[a-z0-9]$/;

export const claimVidopickerSlug = onCall(
  { region: 'us-central1', memory: '256MiB' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in');

    const { slug } = (request.data ?? {}) as { slug?: string };
    if (!slug) throw new HttpsError('invalid-argument', 'slug is required');

    const clean = slug.trim().toLowerCase();

    if (!SLUG_RE.test(clean)) {
      throw new HttpsError(
        'invalid-argument',
        'Slug must be 5–15 characters: lowercase letters, numbers, and hyphens only. Cannot start or end with a hyphen.'
      );
    }
    if (RESERVED.has(clean)) {
      throw new HttpsError('invalid-argument', 'That slug is reserved and cannot be used.');
    }

    const db = admin.firestore();

    // Resolve affiliate
    const uidSnap = await db
      .collection('affiliates')
      .where('authUid', '==', request.auth.uid)
      .where('type', '==', 'influencer')
      .limit(1)
      .get();

    let affiliateId: string;
    if (!uidSnap.empty) {
      affiliateId = uidSnap.docs[0].id;
    } else if (request.auth.token.email_verified && request.auth.token.email) {
      const emailSnap = await db
        .collection('affiliates')
        .where('email', '==', (request.auth.token.email as string).toLowerCase())
        .where('type', '==', 'influencer')
        .limit(1)
        .get();
      if (emailSnap.empty) throw new HttpsError('permission-denied', 'Not a registered affiliate');
      affiliateId = emailSnap.docs[0].id;
      emailSnap.docs[0].ref
        .set({ authUid: request.auth.uid }, { merge: true })
        .catch((e) => console.warn('[claimVidopickerSlug] authUid backfill failed:', e));
    } else {
      throw new HttpsError('permission-denied', 'Not a registered affiliate');
    }

    await db.runTransaction(async (tx) => {
      const slugRef = db.doc(`affiliates/${clean}`);
      const affiliateRef = db.doc(`affiliates/${affiliateId}`);

      const [slugSnap, affiliateSnap] = await Promise.all([tx.get(slugRef), tx.get(affiliateRef)]);

      if (slugSnap.exists) {
        throw new HttpsError('already-exists', 'That slug is already taken.');
      }
      if (affiliateSnap.data()?.slug) {
        throw new HttpsError('failed-precondition', 'You already have a personal link.');
      }

      tx.set(slugRef, {
        affiliateId,
        type: 'slug',
        claimedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      tx.update(affiliateRef, { slug: clean });
    });

    console.log(`[claimVidopickerSlug] affiliateId=${affiliateId} slug=${clean}`);
    return { slug: clean };
  }
);
