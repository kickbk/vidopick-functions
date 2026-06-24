import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import Stripe from 'stripe';

if (!admin.apps.length) admin.initializeApp();

const stripeSecretKey = defineSecret('STRIPE_SECRET_KEY');
const stripeSecretKeyTest = defineSecret('STRIPE_SECRET_KEY_TEST');

/**
 * Backfill affiliateId, discountPercent, stripeCouponId, and linkType onto all
 * existing shortlinks belonging to a user who has just become an affiliate.
 *
 * Called by admin after creating/updating an affiliate record.
 * Profile-page links (linkType === 'profile' or isPublicProfileShortlink) get
 * affiliateId only — no coupon, no discount.
 */
export const backfillAffiliateShortlinks = onCall(
  { region: 'us-central1', memory: '512MiB', secrets: [stripeSecretKey, stripeSecretKeyTest] },
  async (request) => {
    if (request.auth?.token.role !== 'admin') {
      throw new HttpsError('permission-denied', 'Admin only');
    }

    const { affiliateId, sandboxMode: sandboxRequested } = (request.data ?? {}) as {
      affiliateId?: string;
      sandboxMode?: boolean;
    };
    if (!affiliateId) throw new HttpsError('invalid-argument', 'affiliateId required');

    const db = admin.firestore();
    const affiliateSnap = await db.doc(`affiliates/${affiliateId}`).get();
    if (!affiliateSnap.exists) throw new HttpsError('not-found', 'Affiliate not found');

    const affiliateData = affiliateSnap.data()!;
    const authUid: string | undefined = affiliateData.authUid;
    if (!authUid) throw new HttpsError('failed-precondition', 'Affiliate has no authUid — user must sign in first');

    const discountPercent: number = affiliateData.discountPercent ?? 0;
    const sandboxMode = sandboxRequested === true;
    const stripe = new Stripe(
      sandboxMode ? stripeSecretKeyTest.value() : stripeSecretKey.value(),
      { apiVersion: '2026-03-25.dahlia' }
    );

    // Find all shortlinks created by this user that don't yet have affiliateId set
    const snap = await db.collection('shortLinks').where('createdBy', '==', authUid).get();

    let updated = 0;
    const batch = db.batch();

    for (const doc of snap.docs) {
      const data = doc.data();

      // Skip if already attributed to this affiliate
      if (data.affiliateId === affiliateId) continue;

      const isProfileLink = data.linkType === 'profile' || data.isPublicProfileShortlink === true;

      if (isProfileLink) {
        // Profile-page links: set affiliateId and correct linkType, no coupon
        batch.update(doc.ref, {
          affiliateId,
          linkType: 'profile',
        });
      } else {
        // App and referral links: set full attribution + create coupon
        let stripeCouponId: string | null = data.stripeCouponId ?? null;

        if (discountPercent > 0 && !stripeCouponId) {
          try {
            const coupon = await stripe.coupons.create({
              percent_off: discountPercent,
              duration: 'forever',
              name: data.label ?? affiliateData.name ?? affiliateId,
              metadata: { affiliateId, shortlinkId: doc.id },
            });
            stripeCouponId = coupon.id;
          } catch (e) {
            console.warn(`[backfillAffiliateShortlinks] coupon creation failed for ${doc.id}:`, e);
          }
        }

        const linkType = data.linkType ?? (data.label ? 'referral' : 'app');
        batch.update(doc.ref, {
          affiliateId,
          discountPercent,
          stripeCouponId,
          linkType,
        });
      }

      updated++;
    }

    await batch.commit();

    console.log(`[backfillAffiliateShortlinks] affiliateId=${affiliateId} updated=${updated}`);
    return { success: true, updated };
  }
);
