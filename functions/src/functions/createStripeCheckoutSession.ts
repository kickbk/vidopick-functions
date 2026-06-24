import * as admin from 'firebase-admin';
import Stripe from 'stripe';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';

if (!admin.apps.length) admin.initializeApp();

const stripeSecretKey = defineSecret('STRIPE_SECRET_KEY');
const stripeSecretKeyTest = defineSecret('STRIPE_SECRET_KEY_TEST');

const MONTHLY_PRICE_ID = process.env.STRIPE_MONTHLY_PRICE_ID ?? '';
const YEARLY_PRICE_ID = process.env.STRIPE_YEARLY_PRICE_ID ?? '';
const MONTHLY_PRICE_ID_TEST = process.env.STRIPE_MONTHLY_PRICE_ID_TEST ?? '';
const YEARLY_PRICE_ID_TEST = process.env.STRIPE_YEARLY_PRICE_ID_TEST ?? '';

/**
 * Create a Stripe Checkout Session for a Pro subscription.
 * Called by the web checkout page after the user authenticates via custom token.
 *
 * Returns { sessionUrl } — the web page redirects to this URL.
 */
export const createStripeCheckoutSession = onCall(
  {
    region: 'us-central1',
    memory: '256MiB',
    secrets: [stripeSecretKey, stripeSecretKeyTest],
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in');
    }

    const uid = request.auth.uid;
    const {
      successUrl,
      cancelUrl,
      interval = 'month',
    } = (request.data ?? {}) as {
      successUrl?: string;
      cancelUrl?: string;
      interval?: 'month' | 'year';
    };

    // sandboxMode authorization lives in the token claim (set by getCustomTokenForCheckout
    // only for admin or allowSandbox users). Ignoring the request body value prevents
    // callers from self-granting sandbox by crafting the request.
    const sandboxMode = request.auth.token.sandboxMode === true;

    if (!successUrl || !cancelUrl) {
      throw new HttpsError('invalid-argument', 'successUrl and cancelUrl are required');
    }

    const priceId = sandboxMode
      ? (interval === 'year' ? YEARLY_PRICE_ID_TEST : MONTHLY_PRICE_ID_TEST)
      : (interval === 'year' ? YEARLY_PRICE_ID : MONTHLY_PRICE_ID);
    if (!priceId) {
      throw new HttpsError('internal', 'Stripe price ID not configured');
    }

    const stripe = new Stripe(
      sandboxMode ? stripeSecretKeyTest.value() : stripeSecretKey.value(),
      { apiVersion: '2026-03-25.dahlia' }
    );

    const db = admin.firestore();
    const userSnap = await db.doc(`users/${uid}`).get();
    const userData = userSnap.data() ?? {};

    // In sandbox mode, skip customer reuse — the stored ID is a live customer
    // and won't exist in the test Stripe account. Just pass the email instead.
    let customerId: string | undefined;
    if (!sandboxMode) {
      customerId = userData.stripeCustomerId;
      if (!customerId) {
        const email = request.auth.token.email as string | undefined;
        const customer = await stripe.customers.create({
          email,
          metadata: { firebaseUid: uid },
        });
        customerId = customer.id;
        await db.doc(`users/${uid}`).set({ stripeCustomerId: customerId }, { merge: true });
      }
    }

    // Apply affiliate discount coupon if the user arrived via a referral shortlink
    let discounts: { coupon: string }[] | undefined;
    const referredByShortlinkId: string | undefined = userData.referredByShortlinkId;
    if (referredByShortlinkId) {
      const slSnap = await db.doc(`shortLinks/${referredByShortlinkId}`).get();
      const slData = slSnap.data();
      if (slData?.affiliateId && !slData?.disabled) {
        const discountPercent: number = slData.discountPercent ?? 0;
        let stripeCouponId: string | null = slData.stripeCouponId ?? null;

        if (discountPercent > 0) {
          // Check if the existing coupon is still valid in the current Stripe mode.
          let couponValid = false;
          if (stripeCouponId) {
            couponValid = await stripe.coupons.retrieve(stripeCouponId)
              .then(() => true)
              .catch(() => false);
          }

          // If the coupon is missing or was deleted, create a new one and persist it.
          if (!couponValid) {
            try {
              const label: string = slData.label ?? referredByShortlinkId;
              const newCoupon = await stripe.coupons.create({
                percent_off: discountPercent,
                duration: 'repeating',
                duration_in_months: 12,
                name: label,
                metadata: { affiliateId: slData.affiliateId, shortlinkId: referredByShortlinkId },
              });
              stripeCouponId = newCoupon.id;
              await db.doc(`shortLinks/${referredByShortlinkId}`).set(
                { stripeCouponId },
                { merge: true }
              );
              couponValid = true;
              console.log(`[createStripeCheckoutSession] recreated coupon ${stripeCouponId} for shortlinkId=${referredByShortlinkId}`);
            } catch (e) {
              console.warn(`[createStripeCheckoutSession] failed to recreate coupon for shortlinkId=${referredByShortlinkId}:`, e);
            }
          }

          if (couponValid && stripeCouponId) {
            discounts = [{ coupon: stripeCouponId }];
          }
        }
      }
    }

    const customerEmail = request.auth.token.email as string | undefined;
    const couponId: string | undefined = discounts?.[0]?.coupon;

    // First-time buyer = never had a subscription activated on this account.
    // Give them a 7-day free trial so they can cancel without being charged.
    const isFirstTimeBuyer = !userData.stripeActivatedAt;

    const session = await stripe.checkout.sessions.create({
      ...(customerId ? { customer: customerId } : { customer_email: customerEmail }),
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        firebaseUid: uid,
        interval,
        ...(couponId ? { couponId } : {}),
        ...(referredByShortlinkId ? { shortlinkId: referredByShortlinkId } : {}),
      },
      subscription_data: {
        metadata: { firebaseUid: uid, interval },
        ...(isFirstTimeBuyer ? { trial_period_days: 14 } : {}),
      },
      ...(discounts ? { discounts } : {}),
    });

    return { sessionUrl: session.url };
  }
);
