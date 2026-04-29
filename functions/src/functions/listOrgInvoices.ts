import * as admin from 'firebase-admin';
import Stripe from 'stripe';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';

if (!admin.apps.length) admin.initializeApp();

const stripeSecretKey = defineSecret('STRIPE_SECRET_KEY');

export interface OrgInvoice {
  id: string;
  number: string | null;
  status: string;
  amountDue: number;
  amountPaid: number;
  created: number; // unix seconds
  description: string | null;
  hostedUrl: string | null;
  pdfUrl: string | null;
}

/**
 * Returns the last 24 invoices for an organization's Stripe customer.
 */
export const listOrgInvoices = onCall(
  {
    region: 'us-central1',
    memory: '256MiB',
    secrets: [stripeSecretKey],
  },
  async (request): Promise<{ invoices: OrgInvoice[] }> => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Not authenticated');

    const callerRole = request.auth.token.role as string | undefined;
    const callerOrgId = request.auth.token.organizationId as string | undefined;

    if (callerRole !== 'admin' && callerRole !== 'organization') {
      throw new HttpsError('permission-denied', 'Access denied');
    }

    const { organizationId } = request.data as { organizationId?: string };
    const orgId = organizationId ?? callerOrgId;
    if (!orgId) throw new HttpsError('invalid-argument', 'organizationId required');

    if (callerRole === 'organization' && orgId !== callerOrgId) {
      throw new HttpsError('permission-denied', 'You can only view your own organization invoices');
    }

    const db = admin.firestore();
    const orgSnap = await db.doc(`organizations/${orgId}`).get();
    const customerId: string | undefined = orgSnap.data()?.stripeCustomerId;

    if (!customerId) return { invoices: [] };

    const stripe = new Stripe(stripeSecretKey.value(), { apiVersion: '2026-03-25.dahlia' });

    const list = await stripe.invoices.list({
      customer: customerId,
      limit: 24,
    });

    const invoices: OrgInvoice[] = list.data.map((inv) => ({
      id: inv.id,
      number: inv.number ?? null,
      status: inv.status ?? 'unknown',
      amountDue: inv.amount_due,
      amountPaid: inv.amount_paid,
      created: inv.created,
      description: inv.description ?? null,
      hostedUrl: inv.hosted_invoice_url ?? null,
      pdfUrl: inv.invoice_pdf ?? null,
    }));

    return { invoices };
  }
);
