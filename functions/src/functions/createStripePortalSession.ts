import * as admin from 'firebase-admin';
import Stripe from 'stripe';
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';

if (!admin.apps.length) admin.initializeApp();

const stripeSecretKey = defineSecret('STRIPE_SECRET_KEY');
const stripeSecretKeyTest = defineSecret('STRIPE_SECRET_KEY_TEST');

/**
 * Create a Stripe Billing Portal session for the authenticated user.
 * The portal lets them update their payment method, view invoices, and cancel.
 *
 * Auth: Firebase ID token in Authorization: Bearer header.
 * Body: { returnUrl: string }
 * Returns: { portalUrl: string }
 */
export const createStripePortalSession = onRequest(
  {
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 15,
    invoker: 'public',
    cors: true,
    secrets: [stripeSecretKey, stripeSecretKeyTest],
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const authHeader = req.headers.authorization ?? '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!idToken) {
      res.status(401).json({ error: 'Missing auth token' });
      return;
    }

    let uid: string;
    try {
      const decoded = await admin.auth().verifyIdToken(idToken);
      uid = decoded.uid;
    } catch {
      res.status(401).json({ error: 'Invalid auth token' });
      return;
    }

    const { returnUrl } = (req.body ?? {}) as { returnUrl?: string };
    if (!returnUrl) {
      res.status(400).json({ error: 'returnUrl is required' });
      return;
    }

    const userSnap = await admin.firestore().doc(`users/${uid}`).get();
    const userData = userSnap.data() ?? {};
    const customerId: string | undefined = userData.stripeCustomerId;

    if (!customerId) {
      res.status(400).json({ error: 'No Stripe customer found for this account' });
      return;
    }

    // Use the test key if this subscription was created in sandbox mode
    const isTestMode = userData.testMode === true;
    const stripe = new Stripe(
      isTestMode ? stripeSecretKeyTest.value() : stripeSecretKey.value(),
      { apiVersion: '2026-03-25.dahlia' }
    );

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });

    res.json({ portalUrl: session.url });
  }
);
