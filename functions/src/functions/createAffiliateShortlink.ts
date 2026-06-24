import * as admin from 'firebase-admin';
import Stripe from 'stripe';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';

if (!admin.apps.length) admin.initializeApp();

const stripeSecretKey = defineSecret('STRIPE_SECRET_KEY');
const stripeSecretKeyTest = defineSecret('STRIPE_SECRET_KEY_TEST');

const RESERVED_SLUGS = new Set(['auth-redirect', 'device-auth']);

export const createAffiliateShortlink = onCall(
  { region: 'us-central1', memory: '256MiB', secrets: [stripeSecretKey, stripeSecretKeyTest] },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in');

    const isAdmin = request.auth.token.role === 'admin';

    const {
      affiliateId: providedAffiliateId,
      label,
      slug,
      playlistIds,
      profileId,
      platforms,
      sandboxMode: sandboxRequested,
    } = (request.data ?? {}) as {
      affiliateId?: string;
      label?: string;
      slug?: string;
      playlistIds?: string[];
      profileId?: string;
      platforms?: string[];
      sandboxMode?: boolean;
    };

    const sandboxMode = sandboxRequested === true && isAdmin;

    if (!label?.trim()) throw new HttpsError('invalid-argument', 'label is required');
    if (slug && RESERVED_SLUGS.has(slug)) {
      throw new HttpsError('invalid-argument', 'That slug is reserved');
    }

    const db = admin.firestore();
    let affiliateId: string;
    let affiliateData: admin.firestore.DocumentData;

    if (isAdmin) {
      if (!providedAffiliateId)
        throw new HttpsError('invalid-argument', 'affiliateId required for admin');
      const snap = await db.doc(`affiliates/${providedAffiliateId}`).get();
      if (!snap.exists) throw new HttpsError('not-found', 'Affiliate not found');
      affiliateId = providedAffiliateId;
      affiliateData = snap.data()!;
    } else {
      // Affiliate self-service: look up by authUid first, fall back to verified email
      const uidSnap = await db
        .collection('affiliates')
        .where('authUid', '==', request.auth.uid)
        .where('type', '==', 'influencer')
        .limit(1)
        .get();

      if (!uidSnap.empty) {
        affiliateId = uidSnap.docs[0].id;
        affiliateData = uidSnap.docs[0].data();
      } else if (request.auth.token.email_verified && request.auth.token.email) {
        const emailSnap = await db
          .collection('affiliates')
          .where('email', '==', (request.auth.token.email as string).toLowerCase())
          .where('type', '==', 'influencer')
          .limit(1)
          .get();
        if (emailSnap.empty)
          throw new HttpsError('permission-denied', 'Not a registered affiliate');
        affiliateId = emailSnap.docs[0].id;
        affiliateData = emailSnap.docs[0].data();
        // Write authUid so future lookups hit the fast path
        emailSnap.docs[0].ref
          .set({ authUid: request.auth.uid }, { merge: true })
          .catch((e) => console.warn('[createAffiliateShortlink] authUid backfill failed:', e));
      } else {
        throw new HttpsError('permission-denied', 'Not a registered affiliate');
      }
    }

    const discountPercent: number = affiliateData.discountPercent ?? 0;
    const stripe = new Stripe(sandboxMode ? stripeSecretKeyTest.value() : stripeSecretKey.value(), {
      apiVersion: '2026-03-25.dahlia',
    });

    // Create Stripe coupon if a discount is configured.
    // Discount applies to the subscriber's first 12 months only (first annual invoice,
    // or first 12 monthly invoices) — not forever.
    let stripeCouponId: string | null = null;
    if (discountPercent > 0) {
      const coupon = await stripe.coupons.create({
        percent_off: discountPercent,
        duration: 'repeating',
        duration_in_months: 12,
        name: label.trim(),
        metadata: { affiliateId, label: label.trim() },
      });
      stripeCouponId = coupon.id;
    }

    // Build shortlink params
    const params: Record<string, any> = {};

    if (playlistIds?.length) {
      params.playlists = playlistIds.filter(Boolean);
    }

    let resolvedProfileId: string | undefined;
    if (profileId) {
      const profileSnap = await db.doc(`profiles/${profileId}`).get();
      if (profileSnap.exists) {
        const profileData = profileSnap.data()!;
        // Verify the profile belongs to the affiliate (by authUid) or the caller is admin
        const ownerUid: string | undefined = profileData.uid;
        if (!isAdmin && ownerUid !== request.auth.uid) {
          throw new HttpsError('permission-denied', 'Profile does not belong to your account');
        }
        params.profile = {
          uid: ownerUid,
          profileId,
          displayName: profileData.name ?? affiliateData.name,
          color: profileData.color ?? 'blue',
          playlistIds: profileData.playlistIds ?? [],
        };
        params.name = affiliateData.name;
        resolvedProfileId = profileId;
      }
    }

    // Create shortlink — use supplied slug or auto-generate
    const shortlinkRef = slug
      ? db.collection('shortLinks').doc(slug)
      : db.collection('shortLinks').doc();

    const docData = {
      linkTitle: `${affiliateData.name} – ${label.trim()}`,
      label: label.trim(),
      linkType: 'referral',
      affiliateId,
      stripeCouponId,
      discountPercent,
      disabled: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      redirect: {
        ios: null,
        android: null,
        desktop: 'https://vidopick.com/get/',
        webOnly: false,
      },
      params,
      analytics: {},
      meta: {},
      platforms: Array.isArray(platforms) ? platforms.filter(Boolean) : [],
    };

    if (slug) {
      try {
        await (shortlinkRef as admin.firestore.DocumentReference).create(docData);
      } catch (e: any) {
        if (stripeCouponId) await stripe.coupons.del(stripeCouponId).catch(() => {});
        if (e?.code === 6 || e?.code === 'already-exists') {
          throw new HttpsError('already-exists', 'That slug is already taken');
        }
        throw e;
      }
    } else {
      await shortlinkRef.set(docData);
    }

    // Mark the attached profile as shared so requestProfileFollow can approve follows.
    // Only write if not already shared — don't overwrite an existing canonical inviteId.
    if (resolvedProfileId) {
      await db
        .doc(`profiles/${resolvedProfileId}`)
        .set({ isShared: true, isAffiliateLinkActive: true }, { merge: true })
        .catch((e) =>
          console.warn('[createAffiliateShortlink] profile isShared update failed:', e)
        );
    }

    console.log(
      `[createAffiliateShortlink] created shortlinkId=${shortlinkRef.id} affiliateId=${affiliateId} couponId=${stripeCouponId}`
    );

    return {
      shortlinkId: shortlinkRef.id,
      shortUrl: `https://vpk.to/${shortlinkRef.id}`,
      stripeCouponId,
    };
  }
);
