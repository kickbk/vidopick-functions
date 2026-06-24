import * as admin from 'firebase-admin';
import Stripe from 'stripe';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';

if (!admin.apps.length) admin.initializeApp();

const stripeSecretKey = defineSecret('STRIPE_SECRET_KEY');
const stripeSecretKeyTest = defineSecret('STRIPE_SECRET_KEY_TEST');

export const enableAffiliateShortlink = onCall(
  { region: 'us-central1', memory: '256MiB', secrets: [stripeSecretKey, stripeSecretKeyTest] },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in');

    const isAdmin = request.auth.token.role === 'admin';
    const { shortlinkId, sandboxMode: sandboxRequested } = (request.data ?? {}) as {
      shortlinkId?: string;
      sandboxMode?: boolean;
    };
    const sandboxMode = sandboxRequested === true && isAdmin;

    if (!shortlinkId) throw new HttpsError('invalid-argument', 'shortlinkId required');

    const db = admin.firestore();
    const slSnap = await db.doc(`shortLinks/${shortlinkId}`).get();
    if (!slSnap.exists) throw new HttpsError('not-found', 'Shortlink not found');

    const slData = slSnap.data()!;

    if (!isAdmin) {
      let affiliateDocId: string | null = null;
      const uidSnap = await db
        .collection('affiliates')
        .where('authUid', '==', request.auth.uid)
        .where('type', '==', 'influencer')
        .limit(1)
        .get();
      if (!uidSnap.empty) {
        affiliateDocId = uidSnap.docs[0].id;
      } else if (request.auth.token.email_verified && request.auth.token.email) {
        const emailSnap = await db
          .collection('affiliates')
          .where('email', '==', (request.auth.token.email as string).toLowerCase())
          .where('type', '==', 'influencer')
          .limit(1)
          .get();
        if (!emailSnap.empty) {
          affiliateDocId = emailSnap.docs[0].id;
          emailSnap.docs[0].ref
            .set({ authUid: request.auth.uid }, { merge: true })
            .catch((e) => console.warn('[enableAffiliateShortlink] authUid backfill failed:', e));
        }
      }
      if (!affiliateDocId) throw new HttpsError('permission-denied', 'Not a registered affiliate');
      if (slData.affiliateId !== affiliateDocId) {
        throw new HttpsError('permission-denied', 'This link does not belong to your account');
      }
    }

    // If the link had a discount coupon, make sure it still exists in Stripe.
    // If it was deleted (no subscribers used it), recreate it.
    let stripeCouponId: string | null = slData.stripeCouponId ?? null;
    const affiliateId: string = slData.affiliateId;

    if (stripeCouponId) {
      const stripe = new Stripe(
        sandboxMode ? stripeSecretKeyTest.value() : stripeSecretKey.value(),
        { apiVersion: '2026-03-25.dahlia' }
      );

      const couponExists = await stripe.coupons.retrieve(stripeCouponId).then(() => true).catch(() => false);

      if (!couponExists) {
        // Recreate coupon with same settings from the affiliate record
        const affiliateSnap = await db.doc(`affiliates/${affiliateId}`).get();
        const discountPercent: number = affiliateSnap.data()?.discountPercent ?? 0;

        if (discountPercent > 0) {
          const label: string = slData.label ?? shortlinkId;

          // First 12 months only — keep in sync with createAffiliateShortlink
          const newCoupon = await stripe.coupons.create({
            percent_off: discountPercent,
            duration: 'repeating',
            duration_in_months: 12,
            name: label,
            metadata: { affiliateId, label },
          });
          stripeCouponId = newCoupon.id;
        } else {
          stripeCouponId = null;
        }
      }
    }

    const enableWrites: Promise<any>[] = [
      db.doc(`shortLinks/${shortlinkId}`).set(
        { disabled: false, ...(stripeCouponId !== slData.stripeCouponId ? { stripeCouponId } : {}) },
        { merge: true }
      ),
    ];
    const reactivatedProfileId: string | undefined = slData.params?.profile?.profileId;
    if (reactivatedProfileId) {
      enableWrites.push(
        db.doc(`profiles/${reactivatedProfileId}`).set(
          { isShared: true, isAffiliateLinkActive: true },
          { merge: true }
        )
      );
    }
    await Promise.all(enableWrites);

    console.log(`[enableAffiliateShortlink] enabled shortlinkId=${shortlinkId} couponId=${stripeCouponId ?? 'none'}`);
    return { success: true };
  }
);
