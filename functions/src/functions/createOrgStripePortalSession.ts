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
 * Create a Stripe Billing Portal session for an organization.
 * Lets org admins update their payment method and view invoices.
 * Returns { portalUrl }.
 */
export const createOrgStripePortalSession = onCall(
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
      throw new HttpsError(
        'permission-denied',
        'Only admins and organization accounts can access billing'
      );
    }

    const { organizationId } = request.data as { organizationId?: string };
    const orgId = organizationId ?? callerOrgId;
    if (!orgId) throw new HttpsError('invalid-argument', 'organizationId required');

    if (callerRole === 'organization' && orgId !== callerOrgId) {
      throw new HttpsError(
        'permission-denied',
        'You can only manage billing for your own organization'
      );
    }

    const db = admin.firestore();
    const orgSnap = await db.doc(`organizations/${orgId}`).get();
    if (!orgSnap.exists) throw new HttpsError('not-found', 'Organization not found');

    const customerId: string | undefined = orgSnap.data()!.stripeCustomerId;
    if (!customerId)
      throw new HttpsError('failed-precondition', 'No Stripe account set up for this organization');

    const stripe = new Stripe(stripeSecretKey.value(), { apiVersion: '2026-03-25.dahlia' });

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${ADMIN_BASE_URL}/admin/organizations/${orgId}/billing/`,
    });

    return { portalUrl: session.url };
  }
);
