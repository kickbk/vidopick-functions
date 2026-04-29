import * as admin from 'firebase-admin';
import Stripe from 'stripe';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';

if (!admin.apps.length) admin.initializeApp();

const stripeSecretKey = defineSecret('STRIPE_SECRET_KEY');

const ADMIN_BASE_URL = process.env.FUNCTIONS_EMULATOR
  ? 'http://localhost:5173'
  : 'https://vidopick.com';

/**
 * Create a Stripe Checkout Session in "setup" mode for an organization.
 * This saves a payment method without charging anything upfront.
 * Billing happens automatically on the 1st of each month via monthlyOrgBilling.
 * Returns { sessionUrl }.
 */
export const createOrgStripeCheckout = onCall(
  {
    region: 'us-central1',
    memory: '256MiB',
    secrets: [stripeSecretKey],
  },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Not authenticated');

    const callerRole = request.auth.token.role as string | undefined;
    const callerOrgId = request.auth.token.organizationId as string | undefined;

    if (callerRole !== 'admin' && callerRole !== 'organization') {
      throw new HttpsError('permission-denied', 'Only admins and organization accounts can set up billing');
    }

    const { organizationId } = request.data as { organizationId?: string };
    const orgId = organizationId ?? callerOrgId;
    if (!orgId) throw new HttpsError('invalid-argument', 'organizationId required');

    if (callerRole === 'organization' && orgId !== callerOrgId) {
      throw new HttpsError('permission-denied', 'You can only set up billing for your own organization');
    }

    const db = admin.firestore();
    const orgSnap = await db.doc(`organizations/${orgId}`).get();
    if (!orgSnap.exists) throw new HttpsError('not-found', 'Organization not found');

    const orgData = orgSnap.data()!;
    const orgName: string = orgData.name ?? orgId;

    const stripe = new Stripe(stripeSecretKey.value(), { apiVersion: '2026-03-25.dahlia' });

    // Reuse existing Stripe customer or create one
    let customerId: string | undefined = orgData.stripeCustomerId;
    if (!customerId) {
      const authUid: string | undefined = orgData.authUid;
      let email: string | undefined;
      if (authUid) {
        const orgUser = await admin.auth().getUser(authUid).catch(() => null);
        email = orgUser?.email;
      }
      const customer = await stripe.customers.create({
        name: orgName,
        email,
        metadata: { organizationId: orgId },
      });
      customerId = customer.id;
      await db.doc(`organizations/${orgId}`).update({ stripeCustomerId: customerId });
    }

    const billingUrl = `${ADMIN_BASE_URL}/admin/organizations/${orgId}/billing/`;

    // Setup mode: saves payment method without charging.
    // Actual billing happens via monthlyOrgBilling on the 1st.
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'setup',
      currency: 'usd',
      success_url: `${billingUrl}?setup=success`,
      cancel_url: billingUrl,
      metadata: { organizationId: orgId },
      setup_intent_data: {
        metadata: { organizationId: orgId },
      },
      custom_text: {
        submit: {
          message: 'Your card will be charged monthly for your management fee and active sponsored users.',
        },
      },
    });

    return { sessionUrl: session.url };
  }
);
