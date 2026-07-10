import * as admin from 'firebase-admin';
import Stripe from 'stripe';

import { buildOwnerRefundEmail } from './emailTemplates';

const OWNER_EMAIL = 'support@vidopick.com';

/** Instance type of the Stripe client (the `Stripe` name is a namespace in type position). */
type StripeClient = InstanceType<typeof Stripe>;

/**
 * Distinguishable failures thrown by {@link refundAndCancelSubscription} so callers
 * can map them to context-appropriate user-facing errors.
 *   - 'refund_failed'  → the Stripe refund could not be created (nothing was charged back)
 *   - 'cancel_failed'  → the refund succeeded but the subscription could not be cancelled
 */
export class RefundError extends Error {
  constructor(public readonly reason: 'refund_failed' | 'cancel_failed', message?: string) {
    super(message ?? reason);
    this.name = 'RefundError';
  }
}

/**
 * Cancels a Stripe subscription, treating an already-cancelled / missing subscription
 * as success (idempotent). Rethrows any other error.
 */
export async function cancelSubscriptionTolerant(
  stripe: StripeClient,
  subscriptionId: string
): Promise<void> {
  try {
    await stripe.subscriptions.cancel(subscriptionId);
  } catch (err: any) {
    const alreadyCancelled =
      err?.statusCode === 404 ||
      err?.code === 'resource_missing' ||
      (err?.message as string | undefined)?.includes('No such subscription');
    if (!alreadyCancelled) throw err;
    console.log(
      `[refundSubscription] subscription ${subscriptionId} already cancelled — continuing`
    );
  }
}

/**
 * Issues a full refund on the subscription's latest invoice, cancels the subscription,
 * marks the `subscriptions/{id}` doc refunded, removes the affiliate commission and
 * decrements the affiliate/shortlink counters, then (best-effort) emails the owner.
 *
 * Does NOT mutate `users/{uid}` — the caller owns that (requestProRefund updates proStatus;
 * deleteUserAccount deletes the doc entirely).
 *
 * @throws {RefundError} with reason 'refund_failed' or 'cancel_failed'.
 */
export async function refundAndCancelSubscription(params: {
  db: admin.firestore.Firestore;
  stripe: StripeClient;
  uid: string;
  subscriptionId: string;
  userData: admin.firestore.DocumentData;
  isTestMode: boolean;
}): Promise<{ refundIssued: boolean; refundAmountCents: number }> {
  const { db, stripe, uid, subscriptionId, userData, isTestMode } = params;

  // Issue refund on the latest invoice
  let refundIssued = false;
  let refundAmountCents = 0;
  try {
    const invoices = await stripe.invoices.list({ subscription: subscriptionId, limit: 1 });
    const latestInvoice = invoices.data[0] as any;
    const paymentIntentId = latestInvoice?.payment_intent as string | null;
    refundAmountCents = latestInvoice?.amount_paid ?? 0;
    if (paymentIntentId) {
      await stripe.refunds.create({ payment_intent: paymentIntentId });
      refundIssued = true;
    }
  } catch (err: any) {
    console.error('[refundSubscription] refund failed:', err?.message);
    throw new RefundError('refund_failed');
  }

  // Cancel the subscription. If it was already cancelled that's fine.
  try {
    await cancelSubscriptionTolerant(stripe, subscriptionId);
  } catch (err: any) {
    console.error('[refundSubscription] subscription cancel failed after refund:', err?.message);
    throw new RefundError('cancel_failed');
  }

  // Mark the subscription doc refunded
  await db.doc(`subscriptions/${subscriptionId}`).set(
    { status: 'refunded', refundedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );

  // Remove affiliate commission and decrement counters
  const affiliateId: string | undefined = userData.referredByAffiliateId;
  if (affiliateId) {
    const commissionsSnap = await db
      .collection(`affiliates/${affiliateId}/commissions`)
      .where('subscriptionId', '==', subscriptionId)
      .get();
    let totalPendingCents = 0;
    const deletes: Promise<any>[] = commissionsSnap.docs.map((d) => {
      totalPendingCents += d.data().commissionCents ?? 0;
      return d.ref.delete();
    });
    if (deletes.length > 0) {
      await Promise.all([
        ...deletes,
        db.doc(`affiliates/${affiliateId}`).set(
          {
            stats: {
              pendingEarningsCents: admin.firestore.FieldValue.increment(-totalPendingCents),
              payingCustomers: admin.firestore.FieldValue.increment(-1),
              activeSubscribers: admin.firestore.FieldValue.increment(-1),
            },
          },
          { merge: true }
        ),
      ]);
    }
    const shortlinkId: string | undefined = userData.referredByShortlinkId;
    if (shortlinkId) {
      await db
        .doc(`shortLinks/${shortlinkId}`)
        .set(
          { analytics: { payingConversions: admin.firestore.FieldValue.increment(-1) } },
          { merge: true }
        );
    }
  }

  // Owner notification email (non-fatal)
  try {
    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    if (RESEND_API_KEY && refundIssued) {
      const { Resend } = await import('resend');
      const resend = new Resend(RESEND_API_KEY);

      // Look up customer display name and email from Firebase Auth
      let customerName = 'Unknown';
      let customerEmail = 'Unknown';
      try {
        const authUser = await admin.auth().getUser(uid);
        customerName = authUser.displayName ?? authUser.email ?? 'Unknown';
        customerEmail = authUser.email ?? 'Unknown';
      } catch {}

      // Estimate Stripe fee: 2.9% + $0.30
      const stripeFeeEstimateCents = Math.round(refundAmountCents * 0.029) + 30;
      const refundDollars = (refundAmountCents / 100).toFixed(2);
      const feeDollars = (stripeFeeEstimateCents / 100).toFixed(2);
      const subscriptionType: string = userData.subscriptionInterval ?? 'month';

      await resend.emails.send({
        from: 'Vidopick <noreply@vidopick.com>',
        to: OWNER_EMAIL,
        subject: `${isTestMode ? '[TEST] ' : ''}Refund issued — $${refundDollars} (Pro ${subscriptionType === 'year' ? 'Annual' : 'Monthly'})`,
        html: buildOwnerRefundEmail(
          customerName,
          customerEmail,
          uid,
          refundDollars,
          feeDollars,
          subscriptionType,
          isTestMode
        ),
      });
      console.log(`[refundSubscription] owner email sent uid=${uid}`);
    }
  } catch (emailErr) {
    console.warn('[refundSubscription] owner email failed:', emailErr);
  }

  return { refundIssued, refundAmountCents };
}
