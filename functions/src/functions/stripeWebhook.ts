import * as admin from 'firebase-admin';
import Stripe from 'stripe';
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';

if (!admin.apps.length) admin.initializeApp();

const stripeSecretKey = defineSecret('STRIPE_SECRET_KEY');
const stripeWebhookSecret = defineSecret('STRIPE_WEBHOOK_SECRET');

/**
 * Stripe webhook handler.
 * Receives events from Stripe and updates Firestore user documents accordingly.
 *
 * Handled events:
 *  - checkout.session.completed   → set proStatus='active', proType='self', store subscription IDs
 *  - customer.subscription.deleted → set proStatus='none', clear subscription fields
 *  - invoice.payment_failed        → set proStatus='grace'
 */
export const stripeWebhook = onRequest(
  {
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 30,
    invoker: 'public',
    cors: false,
    secrets: [stripeSecretKey, stripeWebhookSecret],
  },
  async (req, res) => {
    const sig = req.headers['stripe-signature'];
    if (!sig) {
      res.status(400).send('Missing stripe-signature header');
      return;
    }

    const stripe = new Stripe(stripeSecretKey.value(), { apiVersion: '2026-03-25.dahlia' });

    let event: ReturnType<typeof stripe.webhooks.constructEvent>;
    try {
      // req.rawBody is populated by Firebase Functions runtime automatically
      event = stripe.webhooks.constructEvent(
        (req as any).rawBody,
        sig,
        stripeWebhookSecret.value()
      );
    } catch (err: any) {
      console.error('[stripeWebhook] signature verification failed:', err.message);
      res.status(400).send(`Webhook Error: ${err.message}`);
      return;
    }

    const db = admin.firestore();

    try {
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object as any;
          const orgId: string | undefined = session.metadata?.organizationId;
          const uid: string | undefined = session.metadata?.firebaseUid;

          if (orgId) {
            // Org setup-mode checkout: save payment method as default, mark billing active
            const customer = session.customer as string | null;
            const setupIntentId = session.setup_intent as string | null;
            if (customer && setupIntentId) {
              const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);
              const paymentMethod = setupIntent.payment_method as string | null;
              if (paymentMethod) {
                await stripe.customers.update(customer, {
                  invoice_settings: { default_payment_method: paymentMethod },
                });
              }
            }
            // billingStartDate = 1st of next month: management fee is waived for the partial first month.
            // Per-user arrears charges for the partial month still apply.
            const setupDate = new Date();
            const billingStartDate = admin.firestore.Timestamp.fromDate(
              new Date(Date.UTC(setupDate.getUTCFullYear(), setupDate.getUTCMonth() + 1, 1))
            );
            await db
              .doc(`organizations/${orgId}`)
              .set(
                {
                  stripeCustomerId: customer,
                  billingActive: true,
                  billingStatus: 'ok',
                  billingStartDate,
                },
                { merge: true }
              );
            console.log(
              `[stripeWebhook] org setup completed orgId=${orgId} billingStartDate=${billingStartDate.toDate().toISOString()}`
            );
          } else if (uid) {
            // User self-pay checkout
            const subscription = session.subscription as string | null;
            const customer = session.customer as string | null;
            await db.doc(`users/${uid}`).set(
              {
                proStatus: 'active',
                proType: 'self',
                stripeCustomerId: customer,
                stripeSubscriptionId: subscription,
                stripeActivatedAt: admin.firestore.FieldValue.serverTimestamp(),
              },
              { merge: true }
            );
            console.log(`[stripeWebhook] checkout.session.completed uid=${uid}`);
          }
          break;
        }

        case 'customer.subscription.updated': {
          // Only handles user self-pay subscriptions (orgs use invoice-based billing, no subscription)
          const subscription = event.data.object as any;
          const uid2 = subscription.metadata?.firebaseUid;
          if (!uid2) break;
          const stripeStatus2: string = subscription.status ?? '';
          let proStatus2: string;
          if (stripeStatus2 === 'active' || stripeStatus2 === 'trialing') proStatus2 = 'active';
          else if (stripeStatus2 === 'past_due') proStatus2 = 'grace';
          else proStatus2 = 'none';
          await db
            .doc(`users/${uid2}`)
            .set({ proStatus: proStatus2, stripeSubscriptionId: subscription.id }, { merge: true });
          console.log(
            `[stripeWebhook] user subscription updated uid=${uid2} → proStatus=${proStatus2}`
          );
          break;
        }

        case 'customer.subscription.deleted': {
          // Only handles user self-pay subscriptions (orgs use invoice-based billing)
          const subscription = event.data.object as any;
          const uid = subscription.metadata?.firebaseUid;
          if (!uid) break;

          await db.doc(`users/${uid}`).set(
            {
              proStatus: 'none',
              proType: null,
              stripeSubscriptionId: null,
              stripeCancelledAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );

          console.log(`[stripeWebhook] user subscription deleted uid=${uid}`);
          break;
        }

        case 'invoice.payment_failed': {
          const invoice = event.data.object as any;
          const customer = invoice.customer as string | null;
          if (!customer) break;

          const orgId: string | undefined = invoice.metadata?.organizationId;

          if (orgId) {
            // Org invoice failure — mark billing status and notify admin
            await db
              .doc(`organizations/${orgId}`)
              .set(
                {
                  billingStatus: 'past_due',
                  billingFailedAt: admin.firestore.FieldValue.serverTimestamp(),
                },
                { merge: true }
              );
            console.log(
              `[stripeWebhook] org invoice payment_failed orgId=${orgId} attempt=${invoice.attempt_count}`
            );

            // Only email on the first attempt — Stripe Smart Retries handle the rest silently
            if ((invoice.attempt_count ?? 1) !== 1) break;

            // Email org admin (non-fatal)
            try {
              const RESEND_API_KEY = process.env.RESEND_API_KEY;
              if (RESEND_API_KEY) {
                const orgSnap = await db.doc(`organizations/${orgId}`).get();
                const orgData = orgSnap.data();
                const authUid: string | undefined = orgData?.authUid;
                if (authUid) {
                  const orgAuthUser = await admin
                    .auth()
                    .getUser(authUid)
                    .catch(() => null);
                  if (orgAuthUser?.email) {
                    const { Resend } = await import('resend');
                    const orgName: string = orgData?.name ?? 'your organization';
                    const amountDue: number = invoice.amount_due ?? 0;
                    const dollars = (amountDue / 100).toFixed(2);
                    const resend = new Resend(RESEND_API_KEY);
                    await resend.emails.send({
                      from: 'Vidopick <hello@vidopick.com>',
                      to: orgAuthUser.email,
                      subject: `Action required: Payment failed for ${orgName}`,
                      html: `
                        <p>Hi,</p>
                        <p>A payment of <strong>$${dollars}</strong> for ${orgName}'s Vidopick Pro sponsorship failed to process.</p>
                        <p>Please update your payment method to keep your subscribers' Pro access active.</p>
                        <p>If you have any questions, reply to this email.</p>
                        <p>— The Vidopick Team</p>
                      `,
                    });
                    console.log(
                      `[stripeWebhook] org payment failure email sent to ${orgAuthUser.email}`
                    );
                  }
                }
              }
            } catch (emailErr) {
              console.warn('[stripeWebhook] org payment failure email failed:', emailErr);
            }
          } else {
            // User self-pay invoice failure — set grace period
            const snap = await db
              .collection('users')
              .where('stripeCustomerId', '==', customer)
              .limit(1)
              .get();

            if (!snap.empty) {
              await snap.docs[0].ref.set({ proStatus: 'grace' }, { merge: true });
              console.log(`[stripeWebhook] payment_failed → grace uid=${snap.docs[0].id}`);
            }
          }
          break;
        }

        case 'invoice.paid': {
          const invoice = event.data.object as any;
          const orgId: string | undefined = invoice.metadata?.organizationId;
          if (orgId) {
            // Clear past_due status when org pays successfully
            await db
              .doc(`organizations/${orgId}`)
              .set({ billingStatus: 'ok', billingFailedAt: null }, { merge: true });
            console.log(`[stripeWebhook] org invoice paid orgId=${orgId}`);
          }
          break;
        }

        default:
          // Unhandled event type — ignore silently
          break;
      }
    } catch (err) {
      console.error('[stripeWebhook] handler error:', err);
      res.status(500).send('Internal error');
      return;
    }

    res.json({ received: true });
  }
);
