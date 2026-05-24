import * as admin from 'firebase-admin';
import Stripe from 'stripe';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';

if (!admin.apps.length) admin.initializeApp();

const stripeSecretKey = defineSecret('STRIPE_SECRET_KEY');

const MONTHLY_PRICE_ID = process.env.STRIPE_MONTHLY_PRICE_ID ?? '';
const YEARLY_PRICE_ID = process.env.STRIPE_YEARLY_PRICE_ID ?? '';

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
    secrets: [stripeSecretKey],
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

    if (!successUrl || !cancelUrl) {
      throw new HttpsError('invalid-argument', 'successUrl and cancelUrl are required');
    }

    const priceId = interval === 'year' ? YEARLY_PRICE_ID : MONTHLY_PRICE_ID;
    if (!priceId) {
      throw new HttpsError('internal', 'Stripe price ID not configured');
    }

    const stripe = new Stripe(stripeSecretKey.value(), { apiVersion: '2026-03-25.dahlia' });

    const db = admin.firestore();

    // Reuse existing Stripe customer if we have one
    let customerId: string | undefined;
    const userSnap = await db.doc(`users/${uid}`).get();
    if (userSnap.exists) {
      customerId = userSnap.data()?.stripeCustomerId;
    }

    if (!customerId) {
      const email = request.auth.token.email as string | undefined;
      const customer = await stripe.customers.create({
        email,
        metadata: { firebaseUid: uid },
      });
      customerId = customer.id;
      // Persist for future sessions
      await db.doc(`users/${uid}`).set({ stripeCustomerId: customerId }, { merge: true });
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { firebaseUid: uid },
      subscription_data: {
        metadata: { firebaseUid: uid },
      },
    });

    return { sessionUrl: session.url };
  }
);
