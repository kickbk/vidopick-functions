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
      isProfileShareLink,
    } = (request.data ?? {}) as {
      affiliateId?: string;
      label?: string;
      slug?: string;
      playlistIds?: string[];
      profileId?: string;
      platforms?: string[];
      sandboxMode?: boolean;
      isProfileShareLink?: boolean;
    };

    const sandboxMode = sandboxRequested === true && isAdmin;

    if (!isProfileShareLink && !label?.trim()) throw new HttpsError('invalid-argument', 'label is required');
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

    // Name lives in public/profile (the single source of truth for display fields).
    const pubProfileSnap = await db.doc(`affiliates/${affiliateId}/public/profile`).get();
    const affiliateName: string = (pubProfileSnap.data()?.name as string | undefined) ?? '';

    // Profile share link: one per affiliate, idempotent
    if (isProfileShareLink) {
      const existingId = affiliateData.profileShareShortlinkId as string | undefined;
      if (existingId) {
        const existing = await db.doc(`shortLinks/${existingId}`).get();
        if (existing.exists) {
          return {
            shortlinkId: existingId,
            shortUrl: `https://vpk.to/${existingId}`,
            stripeCouponId: existing.data()?.stripeCouponId ?? null,
          };
        }
      }
    }

    const discountPercent: number = affiliateData.discountPercent ?? 0;
    const stripe = new Stripe(sandboxMode ? stripeSecretKeyTest.value() : stripeSecretKey.value(), {
      apiVersion: '2026-03-25.dahlia',
    });

    const effectiveLabel = isProfileShareLink ? 'Profile Page' : label!.trim();

    // Create Stripe coupon if a discount is configured.
    // Discount applies to the subscriber's first 12 months only (first annual invoice,
    // or first 12 monthly invoices) — not forever.
    let stripeCouponId: string | null = null;
    if (discountPercent > 0) {
      const coupon = await stripe.coupons.create({
        percent_off: discountPercent,
        duration: 'repeating',
        duration_in_months: 12,
        name: effectiveLabel,
        metadata: { affiliateId, label: effectiveLabel },
      });
      stripeCouponId = coupon.id;
    }

    // Build shortlink params
    const params: Record<string, any> = {};

    if (!isProfileShareLink && playlistIds?.length) {
      params.playlists = playlistIds.filter(Boolean);
    }

    let resolvedProfileId: string | undefined;
    if (isProfileShareLink) {
      // Attach the affiliate's primary public profile so the mobile app can show a follow invite
      const pubProfilesSnap = await db
        .collection(`affiliates/${affiliateId}/publicProfiles`)
        .limit(1)
        .get();
      if (!pubProfilesSnap.empty) {
        const pubEntry = pubProfilesSnap.docs[0].data();
        const pId = pubEntry.profileId as string | undefined;
        if (pId) {
          const profileSnap = await db.doc(`profiles/${pId}`).get();
          if (profileSnap.exists) {
            const pd = profileSnap.data()!;
            params.profile = {
              uid: pd.uid,
              profileId: pId,
              displayName: pd.name ?? affiliateName,
              color: pd.color ?? 'blue',
              playlistIds: pd.playlistIds ?? [],
            };
            params.name = affiliateName;
            resolvedProfileId = pId;
          }
        }
      }
    } else if (profileId) {
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
          displayName: profileData.name ?? affiliateName,
          color: profileData.color ?? 'blue',
          playlistIds: profileData.playlistIds ?? [],
        };
        params.name = affiliateName;
        resolvedProfileId = profileId;
      }
    }

    // Create shortlink
    let shortlinkRef: admin.firestore.DocumentReference;
    if (isProfileShareLink) {
      if (!affiliateData.slug) {
        throw new HttpsError(
          'failed-precondition',
          'Claim your public URL before generating a profile share link.'
        );
      }
      shortlinkRef = db.collection('shortLinks').doc(`a_${affiliateData.slug}`);
    } else if (slug) {
      shortlinkRef = db.collection('shortLinks').doc(slug);
    } else {
      shortlinkRef = db.collection('shortLinks').doc();
    }

    const docData: Record<string, any> = {
      linkTitle: `${affiliateName} – ${effectiveLabel}`,
      label: effectiveLabel,
      linkType: 'referral',
      affiliateId,
      stripeCouponId,
      discountPercent,
      disabled: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      redirect: {
        ios: null,
        android: null,
        // For profile share links the desktop redirect is set after creation (needs the doc ID).
        // For regular links, send to /get/ and let handleDeeplink append params.
        desktop: isProfileShareLink ? 'https://vidopick.com/get/' : 'https://vidopick.com/get/',
        webOnly: false,
      },
      params,
      analytics: {},
      meta: {},
      platforms: Array.isArray(platforms) ? platforms.filter(Boolean) : [],
      ...(isProfileShareLink && { isProfileShareLink: true }),
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

    // For profile share links, update redirect.desktop to include ?ref={shortlinkId}
    // so the profile page receives attribution when visited via this link.
    if (isProfileShareLink) {
      await shortlinkRef.update({
        'redirect.desktop': `https://vidopick.com/vp/${affiliateId}?ref=${shortlinkRef.id}`,
      });
      await db
        .doc(`affiliates/${affiliateId}`)
        .set({ profileShareShortlinkId: shortlinkRef.id }, { merge: true })
        .catch((e) =>
          console.warn('[createAffiliateShortlink] profileShareShortlinkId write failed:', e)
        );
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
      `[createAffiliateShortlink] created shortlinkId=${shortlinkRef.id} affiliateId=${affiliateId} couponId=${stripeCouponId} isProfileShareLink=${!!isProfileShareLink}`
    );

    return {
      shortlinkId: shortlinkRef.id,
      shortUrl: `https://vpk.to/${shortlinkRef.id}`,
      stripeCouponId,
    };
  }
);
