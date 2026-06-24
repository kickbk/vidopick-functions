import * as admin from 'firebase-admin';
import Stripe from 'stripe';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';

if (!admin.apps.length) admin.initializeApp();

const stripeSecretKey = defineSecret('STRIPE_SECRET_KEY');
const stripeSecretKeyTest = defineSecret('STRIPE_SECRET_KEY_TEST');

export const updateAffiliateShortlink = onCall(
  { region: 'us-central1', memory: '256MiB', secrets: [stripeSecretKey, stripeSecretKeyTest] },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in');

    const {
      shortlinkId,
      label,
      playlistIds,
      profileId,
      platforms,
      sandboxMode: sandboxRequested,
    } = (request.data ?? {}) as {
      shortlinkId?: string;
      label?: string;
      playlistIds?: string[];
      profileId?: string | null;
      platforms?: string[];
      sandboxMode?: boolean;
    };

    if (!shortlinkId?.trim()) throw new HttpsError('invalid-argument', 'shortlinkId is required');
    if (!label?.trim()) throw new HttpsError('invalid-argument', 'label is required');

    const isAdmin = request.auth.token.role === 'admin';
    const sandboxMode = sandboxRequested === true && isAdmin;
    const db = admin.firestore();

    const linkSnap = await db.doc(`shortLinks/${shortlinkId}`).get();
    if (!linkSnap.exists) throw new HttpsError('not-found', 'Shortlink not found');
    const linkData = linkSnap.data()!;

    // Verify ownership
    if (!isAdmin) {
      let affiliateId: string | null = null;
      const uidSnap = await db
        .collection('affiliates')
        .where('authUid', '==', request.auth.uid)
        .where('type', '==', 'influencer')
        .limit(1)
        .get();
      if (!uidSnap.empty) {
        affiliateId = uidSnap.docs[0].id;
      } else if (request.auth.token.email_verified && request.auth.token.email) {
        const emailSnap = await db
          .collection('affiliates')
          .where('email', '==', (request.auth.token.email as string).toLowerCase())
          .where('type', '==', 'influencer')
          .limit(1)
          .get();
        if (!emailSnap.empty) affiliateId = emailSnap.docs[0].id;
      }
      if (!affiliateId || linkData.affiliateId !== affiliateId) {
        throw new HttpsError('permission-denied', 'You do not own this link');
      }
    }

    // Fetch affiliate name to rebuild linkTitle
    const affiliateSnap = await db.doc(`affiliates/${linkData.affiliateId}`).get();
    const affiliateName: string = affiliateSnap.exists
      ? (affiliateSnap.data()!.name ?? '')
      : '';

    // Build new params (fully replaces old params)
    const params: Record<string, any> = {};

    if (playlistIds?.length) {
      params.playlists = playlistIds.filter(Boolean);
    }

    let updatedProfileId: string | undefined;
    if (profileId) {
      const profileSnap = await db.doc(`profiles/${profileId}`).get();
      if (!profileSnap.exists) throw new HttpsError('not-found', 'Profile not found');
      const profileData = profileSnap.data()!;
      if (!isAdmin && profileData.uid !== request.auth.uid) {
        throw new HttpsError('permission-denied', 'Profile does not belong to your account');
      }
      params.profile = {
        uid: profileData.uid,
        profileId,
        displayName: profileData.name ?? affiliateName,
        color: profileData.color ?? 'blue',
        playlistIds: profileData.playlistIds ?? [],
      };
      params.name = profileData.name ?? affiliateName;
      updatedProfileId = profileId;
    }

    await linkSnap.ref.set(
      {
        label: label.trim(),
        linkTitle: affiliateName ? `${affiliateName} – ${label.trim()}` : label.trim(),
        params,
        platforms: Array.isArray(platforms) ? platforms.filter(Boolean) : [],
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    // Update Stripe coupon name if the label changed
    const stripeCouponId: string | null = linkData.stripeCouponId ?? null;
    if (stripeCouponId && linkData.label !== label.trim()) {
      const stripe = new Stripe(
        sandboxMode ? stripeSecretKeyTest.value() : stripeSecretKey.value(),
        { apiVersion: '2026-03-25.dahlia' }
      );
      await stripe.coupons
        .update(stripeCouponId, { name: label.trim() })
        .catch((e) =>
          console.warn('[updateAffiliateShortlink] stripe coupon update failed:', e.message)
        );
    }

    if (updatedProfileId) {
      await db.doc(`profiles/${updatedProfileId}`).set(
        { isShared: true, inviteId: shortlinkId, isAffiliateLinkActive: true },
        { merge: true }
      ).catch((e) => console.warn('[updateAffiliateShortlink] profile isShared update failed:', e));
    }
    // If the profile was removed from the link, clear the affiliate flag on the old profile.
    const previousProfileId: string | undefined = linkData.params?.profile?.profileId;
    if (previousProfileId && previousProfileId !== updatedProfileId) {
      await db.doc(`profiles/${previousProfileId}`).set(
        { isAffiliateLinkActive: false },
        { merge: true }
      ).catch((e) => console.warn('[updateAffiliateShortlink] clearing old profile flag failed:', e));
    }

    console.log(
      `[updateAffiliateShortlink] shortlinkId=${shortlinkId} affiliateId=${linkData.affiliateId}`
    );

    return { success: true };
  }
);
