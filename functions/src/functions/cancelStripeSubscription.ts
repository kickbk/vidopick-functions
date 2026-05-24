import * as admin from 'firebase-admin';
import Stripe from 'stripe';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';

if (!admin.apps.length) admin.initializeApp();

const stripeSecretKey = defineSecret('STRIPE_SECRET_KEY');

/**
 * Cancels the caller's Stripe subscription at period end.
 * Sets proStatus to 'none' immediately in Firestore (optimistic update);
 * the webhook will confirm when the subscription is actually deleted.
 */
export const cancelStripeSubscription = onCall(
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
    const db = admin.firestore();

    const userSnap = await db.doc(`users/${uid}`).get();
    if (!userSnap.exists) {
      throw new HttpsError('not-found', 'User record not found');
    }

    const userData = userSnap.data()!;
    const subscriptionId: string | null = userData.stripeSubscriptionId ?? null;

    if (!subscriptionId) {
      throw new HttpsError('failed-precondition', 'No active subscription found');
    }

    const stripe = new Stripe(stripeSecretKey.value(), { apiVersion: '2026-03-25.dahlia' });

    // Cancel at period end so the user keeps access until their billing cycle ends
    await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true });

    // Optimistic local update — webhook will fire the definitive status change
    await db
      .doc(`users/${uid}`)
      .set(
        { proStatus: 'none', stripeCancelledAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );

    console.log(
      `[cancelStripeSubscription] uid=${uid} sub=${subscriptionId} cancel_at_period_end=true`
    );

    return { success: true };
  }
);
