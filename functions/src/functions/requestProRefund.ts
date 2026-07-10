import * as admin from 'firebase-admin';
import Stripe from 'stripe';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { notifyUser } from '../utils/notifyUser';
import { RefundError, refundAndCancelSubscription } from '../utils/refundSubscription';

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

    // Refund the latest invoice, cancel the subscription, mark the subscription doc
    // refunded, and reverse the affiliate commission. Map the shared helper's failures
    // back to the original user-facing messages.
    let refundIssued = false;
    try {
      ({ refundIssued } = await refundAndCancelSubscription({
        db,
        stripe,
        uid,
        subscriptionId,
        userData,
        isTestMode,
      }));
    } catch (err) {
      if (err instanceof RefundError && err.reason === 'cancel_failed') {
        throw new HttpsError(
          'internal',
          'Refund was issued but the subscription could not be cancelled. Please contact support to confirm cancellation.'
        );
      }
      throw new HttpsError('internal', 'Refund could not be processed. Please contact support.');
    }

    // Remove Pro from the user record (helper leaves users/{uid} to the caller)
    await db.doc(`users/${uid}`).set(
      {
        proStatus: 'none',
        proType: null,
        stripeSubscriptionId: null,
        stripeCancelledAt: admin.firestore.FieldValue.serverTimestamp(),
        proCancelOn: null,
        refundedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

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

    console.log(
      `[requestProRefund] uid=${uid} subscriptionId=${subscriptionId} refundIssued=${refundIssued} testMode=${isTestMode}`
    );
    return { success: true, refundIssued };
  }
);
