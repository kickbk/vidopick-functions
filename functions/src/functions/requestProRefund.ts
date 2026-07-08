import * as admin from 'firebase-admin';
import Stripe from 'stripe';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { notifyUser } from '../utils/notifyUser';
import { buildOwnerRefundEmail } from '../utils/emailTemplates';

const OWNER_EMAIL = 'support@vidopick.com';

if (!admin.apps.length) admin.initializeApp();

const stripeSecretKey = defineSecret('STRIPE_SECRET_KEY');
const stripeSecretKeyTest = defineSecret('STRIPE_SECRET_KEY_TEST');

const REFUND_WINDOW_DAYS = 7;

export const requestProRefund = onCall(
  { region: 'us-central1', memory: '256MiB', secrets: [stripeSecretKey, stripeSecretKeyTest] },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in');

    const uid = request.auth.uid;
    const db = admin.firestore();

    const userSnap = await db.doc(`users/${uid}`).get();
    if (!userSnap.exists) throw new HttpsError('not-found', 'User record not found');

    const userData = userSnap.data()!;

    // One refund per account, ever — prevent abuse.
    if (userData.refundedAt) {
      throw new HttpsError(
        'failed-precondition',
        'A refund has already been issued for this account.'
      );
    }

    // Must have cancelled (proCancelOn set) but still have a subscription
    if (!userData.proCancelOn) {
      throw new HttpsError('failed-precondition', 'No pending cancellation found on this account');
    }

    const subscriptionId: string | null = userData.stripeSubscriptionId ?? null;
    if (!subscriptionId) {
      throw new HttpsError('failed-precondition', 'No active subscription found');
    }

    // Check refund window: stripeActivatedAt + 7 days must be in the future
    const activatedAt: admin.firestore.Timestamp | undefined = userData.stripeActivatedAt;
    if (!activatedAt) {
      throw new HttpsError('failed-precondition', 'Subscription activation date not found');
    }
    const windowMs = REFUND_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const refundDeadline = activatedAt.toMillis() + windowMs;
    if (Date.now() > refundDeadline) {
      throw new HttpsError(
        'failed-precondition',
        `The 7-day refund window has expired. Your Pro access continues until the end of your billing period.`
      );
    }

    const isTestMode = userData.testMode === true;
    const stripe = new Stripe(isTestMode ? stripeSecretKeyTest.value() : stripeSecretKey.value(), {
      apiVersion: '2026-03-25.dahlia',
    });

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
      console.error('[requestProRefund] refund failed:', err?.message);
      throw new HttpsError('internal', 'Refund could not be processed. Please contact support.');
    }

    // Cancel the subscription in Stripe. If it was already cancelled (immediate
    // portal cancellation), that's fine — treat it as success.
    try {
      await stripe.subscriptions.cancel(subscriptionId);
    } catch (err: any) {
      const alreadyCancelled =
        err?.statusCode === 404 ||
        err?.code === 'resource_missing' ||
        (err?.message as string | undefined)?.includes('No such subscription');
      if (!alreadyCancelled) {
        console.error('[requestProRefund] subscription cancel failed after refund:', err?.message);
        throw new HttpsError(
          'internal',
          'Refund was issued but the subscription could not be cancelled. Please contact support to confirm cancellation.'
        );
      }
      console.log(
        '[requestProRefund] subscription already cancelled — proceeding with Firestore cleanup'
      );
    }

    // Update user + subscription records
    await Promise.all([
      db.doc(`users/${uid}`).set(
        {
          proStatus: 'none',
          proType: null,
          stripeSubscriptionId: null,
          stripeCancelledAt: admin.firestore.FieldValue.serverTimestamp(),
          proCancelOn: null,
          refundedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      ),
      db.doc(`subscriptions/${subscriptionId}`).set(
        {
          status: 'refunded',
          refundedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      ),
    ]);

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

    // Push notification
    const deviceTokens: string[] = userData.deviceTokens ?? [];
    if (deviceTokens.length > 0) {
      await notifyUser(
        db,
        uid,
        deviceTokens,
        'Refund Processed',
        'Your full refund is on the way. Your Pro access has been removed. You can restart a Pro subscription anytime.',
        { type: 'subscription_refunded' }
      );
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
        console.log(`[requestProRefund] owner email sent uid=${uid}`);
      }
    } catch (emailErr) {
      console.warn('[requestProRefund] owner email failed:', emailErr);
    }

    console.log(
      `[requestProRefund] uid=${uid} subscriptionId=${subscriptionId} refundIssued=${refundIssued} testMode=${isTestMode}`
    );
    return { success: true, refundIssued };
  }
);
