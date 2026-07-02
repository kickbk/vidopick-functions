import * as admin from 'firebase-admin';
import Stripe from 'stripe';
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import {
  buildAffiliateSaleEmail,
  buildAffiliateTrialEmail,
  buildOwnerSaleEmail,
  buildOwnerDirectSaleEmail,
  buildOwnerCancellationEmail,
  buildOwnerUncancellationEmail,
  buildOwnerTrialStartEmail,
} from '../utils/emailTemplates';
import { notifyUser } from '../utils/notifyUser';

if (!admin.apps.length) admin.initializeApp();

const stripeSecretKey = defineSecret('STRIPE_SECRET_KEY');
const stripeSecretKeyTest = defineSecret('STRIPE_SECRET_KEY_TEST');
const stripeWebhookSecret = defineSecret('STRIPE_WEBHOOK_SECRET');
const stripeWebhookSecretTest = defineSecret('STRIPE_WEBHOOK_SECRET_TEST');

const OWNER_EMAIL = 'support@vidopick.com';
const PARTNER_DASHBOARD_URL = 'https://vidopick.com/vp/dashboard/';

// ── Affiliate commission helpers ──────────────────────────────────────────────

interface CommissionMeta {
  subscriptionType?: string;
  couponName?: string;
  testMode?: boolean;
}

// Default commission rates live in config/affiliates (commissionRate,
// publicProfileCommissionRate). Cached per instance; commissions are skipped
// (with an error log) if no rate can be resolved, never silently defaulted.
let cachedRateConfig: Record<string, unknown> | null = null;
let rateConfigFetchedAt = 0;

async function getAffiliateRateConfig(
  db: admin.firestore.Firestore
): Promise<Record<string, unknown>> {
  if (cachedRateConfig && Date.now() - rateConfigFetchedAt < 10 * 60_000) {
    return cachedRateConfig;
  }
  const snap = await db.doc('config/affiliates').get();
  cachedRateConfig = (snap.data() as Record<string, unknown> | undefined) ?? {};
  rateConfigFetchedAt = Date.now();
  return cachedRateConfig;
}

async function createAffiliateCommission(
  db: admin.firestore.Firestore,
  uid: string,
  amountPaidCents: number,
  subscriptionId: string,
  meta: CommissionMeta = {}
): Promise<void> {
  const userSnap = await db.doc(`users/${uid}`).get();
  const userData = userSnap.data() ?? {};

  const affiliateId: string | undefined = userData.referredByAffiliateId;
  if (!affiliateId) return;

  // Lock the referral on first payment so future links don't change attribution.
  // Transactional so concurrent webhook deliveries can't both observe "first
  // payment" and double-increment the affiliate's payingCustomers stats.
  const isFirstPayment = await db.runTransaction(async (tx) => {
    const userRef = db.doc(`users/${uid}`);
    const snap = await tx.get(userRef);
    const isFirst = !snap.data()?.referralLockedAt;
    if (isFirst) {
      tx.set(
        userRef,
        { referralLockedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
    }
    return isFirst;
  });

  // Check commission window: referredAt must be within commissionMonthsLimit
  const referredAt: admin.firestore.Timestamp | undefined = userData.referredAt;
  const affiliateSnap = await db.doc(`affiliates/${affiliateId}`).get();
  if (!affiliateSnap.exists) return;
  const affiliateData = affiliateSnap.data()!;

  const commissionMonthsLimit: number = affiliateData.commissionMonthsLimit ?? 24;
  if (referredAt) {
    const monthsElapsed = (Date.now() - referredAt.toMillis()) / (1000 * 60 * 60 * 24 * 30.44);
    if (monthsElapsed > commissionMonthsLimit) {
      console.log(
        `[affiliate] commission window expired for uid=${uid} affiliateId=${affiliateId}`
      );
      return;
    }
  }

  const shortlinkId: string | undefined = userData.referredByShortlinkId;

  // Profile-page shortlinks earn the affiliate's configured passive rate.
  // Active marketing shortlinks earn the affiliate's configured rate.
  // Defaults come from config/affiliates — never hardcoded here.
  // Non-affiliate users are already excluded above (no affiliateId → early return).
  const rateConfig = await getAffiliateRateConfig(db);
  let commissionRate: unknown = affiliateData.commissionRate ?? rateConfig.commissionRate;
  let isPublicProfileCommission = false;
  if (shortlinkId) {
    const linkSnap = await db.doc(`shortLinks/${shortlinkId}`).get();
    const lData = linkSnap.data();
    if (
      linkSnap.exists &&
      (lData?.linkType === 'profile' || lData?.isPublicProfileShortlink === true)
    ) {
      commissionRate =
        affiliateData.publicProfileCommissionRate ?? rateConfig.publicProfileCommissionRate;
      isPublicProfileCommission = true;
    }
  }

  if (typeof commissionRate !== 'number' || commissionRate < 0 || commissionRate > 1) {
    console.error(
      `[affiliate] no valid commission rate for affiliateId=${affiliateId} ` +
        `(source=${isPublicProfileCommission ? 'profile_page' : 'active_link'}) — ` +
        `set it on the affiliate doc or in config/affiliates. Skipping commission for uid=${uid}.`
    );
    return;
  }

  const commissionCents = Math.floor(amountPaidCents * commissionRate);
  const purchasedAt = admin.firestore.Timestamp.now();
  // Commissions are approved 30 days after purchase
  const approvableAt = admin.firestore.Timestamp.fromMillis(
    purchasedAt.toMillis() + 30 * 24 * 60 * 60 * 1000
  );
  const date = new Date().toISOString().slice(0, 10);

  const commissionRef = db.collection(`affiliates/${affiliateId}/commissions`).doc();
  await commissionRef.set({
    userId: uid,
    subscriptionId,
    amountPaidCents,
    commissionCents,
    commissionRate,
    status: 'pending',
    purchasedAt,
    approvableAt,
    approvedAt: null,
    paidAt: null,
    ...(shortlinkId ? { shortlinkId } : {}),
    ...(isPublicProfileCommission ? { isPublicProfileCommission: true } : {}),
    ...(meta.subscriptionType ? { subscriptionType: meta.subscriptionType } : {}),
    ...(meta.couponName ? { couponName: meta.couponName } : {}),
    ...(meta.testMode ? { testMode: true } : {}),
  });

  await db.doc(`affiliates/${affiliateId}`).set(
    {
      stats: {
        ...(isFirstPayment
          ? {
              payingCustomers: admin.firestore.FieldValue.increment(1),
              activeSubscribers: admin.firestore.FieldValue.increment(1),
            }
          : {}),
        pendingEarningsCents: admin.firestore.FieldValue.increment(commissionCents),
      },
    },
    { merge: true }
  );

  const extras: Promise<any>[] = [
    db
      .collection(`affiliates/${affiliateId}/dailyStats`)
      .doc(date)
      .set({ conversions: admin.firestore.FieldValue.increment(1) }, { merge: true }),
  ];
  if (isFirstPayment && shortlinkId) {
    extras.push(
      db
        .doc(`shortLinks/${shortlinkId}`)
        .set(
          { analytics: { payingConversions: admin.firestore.FieldValue.increment(1) } },
          { merge: true }
        )
    );
  }
  await Promise.all(extras);

  console.log(
    `[affiliate] commission created affiliateId=${affiliateId} uid=${uid} commissionCents=${commissionCents} rate=${commissionRate} source=${isPublicProfileCommission ? 'profile_page' : 'active_link'} shortlinkId=${shortlinkId ?? 'none'} approvableAt=${approvableAt.toDate().toISOString()}`
  );

  // Send sale notification emails (non-fatal)
  try {
    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    const sendTestEmails = process.env.SEND_TEST_EMAILS === 'true';
    if (RESEND_API_KEY && isFirstPayment && (!meta.testMode || sendTestEmails)) {
      const { Resend } = await import('resend');
      const resend = new Resend(RESEND_API_KEY);
      const affiliateEmail: string = affiliateData.email ?? '';
      const affiliateName: string = affiliateData.name ?? 'Affiliate';
      const amountDollars = (amountPaidCents / 100).toFixed(2);
      const commissionDollarsStr = (commissionCents / 100).toFixed(2);
      const subType: string = meta.subscriptionType ?? 'month';
      const couponName: string | null = meta.couponName ?? null;

      const sends: Promise<any>[] = [];

      if (affiliateEmail) {
        sends.push(
          resend.emails.send({
            from: 'Vidopick Partners <hello@vidopick.com>',
            to: affiliateEmail,
            subject: `🎉 You made a sale — $${commissionDollarsStr} commission earned`,
            html: buildAffiliateSaleEmail(
              affiliateName,
              amountDollars,
              commissionDollarsStr,
              subType,
              couponName,
              PARTNER_DASHBOARD_URL
            ),
          })
        );
      }

      sends.push(
        resend.emails.send({
          from: 'Vidopick <hello@vidopick.com>',
          to: OWNER_EMAIL,
          subject: `💰 New Vidopick sale — $${amountDollars} (${subType === 'year' ? 'Annual' : 'Monthly'})`,
          html: buildOwnerSaleEmail(
            affiliateName,
            affiliateEmail,
            amountDollars,
            commissionDollarsStr,
            subType,
            couponName,
            uid
          ),
        })
      );

      await Promise.all(sends);
      console.log(`[affiliate] sale emails sent affiliateId=${affiliateId}`);
    }
  } catch (emailErr) {
    console.warn('[affiliate] sale email failed:', emailErr);
  }
}

/**
 * Moves the user's UID between followerUids and deactivatedFollowerUids on all personal-follow
 * profiles when their Pro status changes. This keeps notifications and follower counts accurate
 * without destroying the follow relationship — reactivation restores the UID to followerUids.
 *
 * Only personal (non-org) follows are affected; org-sponsored follows are managed separately.
 */
async function syncFollowerUidsForProChange(
  db: admin.firestore.Firestore,
  uid: string,
  direction: 'deactivate' | 'reactivate'
): Promise<void> {
  const userSnap = await db.doc(`users/${uid}`).get();
  const profilesMap: Record<string, any> = userSnap.data()?.profiles ?? {};

  const personalFollowedProfileIds = Object.entries(profilesMap)
    .filter(([, entry]) => entry?.isFollowed === true && !entry?.organizationId)
    .map(([profileId]) => profileId);

  if (personalFollowedProfileIds.length === 0) return;

  if (direction === 'deactivate') {
    const batch = db.batch();
    for (const profileId of personalFollowedProfileIds) {
      batch.update(db.doc(`profiles/${profileId}`), {
        followerUids: admin.firestore.FieldValue.arrayRemove(uid),
        deactivatedFollowerUids: admin.firestore.FieldValue.arrayUnion(uid),
      });
    }
    await batch.commit();
    console.log(
      `[syncFollowerUids] uid=${uid} deactivated profiles=${personalFollowedProfileIds.length}`
    );
    return;
  }

  // Reactivate: verify each profile still exists and is still shared before
  // moving the UID back to followerUids. Profiles that are gone or no longer
  // shared have their follow connection cleaned up instead.
  const profileSnaps = await db.getAll(
    ...personalFollowedProfileIds.map((id) => db.doc(`profiles/${id}`))
  );

  const toReactivate: string[] = [];
  const toCleanUp: string[] = [];

  for (const snap of profileSnaps) {
    if (!snap.exists || snap.data()?.isShared !== true) {
      toCleanUp.push(snap.id);
    } else {
      toReactivate.push(snap.id);
    }
  }

  const batch = db.batch();

  for (const profileId of toReactivate) {
    batch.update(db.doc(`profiles/${profileId}`), {
      deactivatedFollowerUids: admin.firestore.FieldValue.arrayRemove(uid),
      followerUids: admin.firestore.FieldValue.arrayUnion(uid),
    });
  }

  const userUpdates: Record<string, admin.firestore.FieldValue> = {};
  for (const profileId of toCleanUp) {
    const snap = profileSnaps.find((s) => s.id === profileId);
    if (snap?.exists) {
      // Profile still exists but is no longer shared — remove from deactivated array
      batch.update(db.doc(`profiles/${profileId}`), {
        deactivatedFollowerUids: admin.firestore.FieldValue.arrayRemove(uid),
      });
    }
    // Either way, clean up the stale follow entry on the user doc
    userUpdates[`profiles.${profileId}`] = admin.firestore.FieldValue.delete();
  }

  if (Object.keys(userUpdates).length > 0) {
    batch.update(db.doc(`users/${uid}`), userUpdates);
  }

  await batch.commit();
  console.log(
    `[syncFollowerUids] uid=${uid} reactivated=${toReactivate.length} cleaned=${toCleanUp.length}`
  );
}

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
    secrets: [stripeSecretKey, stripeSecretKeyTest, stripeWebhookSecret, stripeWebhookSecretTest],
  },
  async (req, res) => {
    const sig = req.headers['stripe-signature'];
    if (!sig) {
      res.status(400).send('Missing stripe-signature header');
      return;
    }

    const stripe = new Stripe(stripeSecretKey.value(), { apiVersion: '2026-03-25.dahlia' });

    let event!: ReturnType<typeof stripe.webhooks.constructEvent>;
    try {
      // req.rawBody is populated by Firebase Functions runtime automatically.
      // Parse livemode from the raw body (untrusted, only used to select the
      // correct signing secret) so we verify exactly once with the right key.
      const rawBody = (req as any).rawBody as Buffer;
      let livemode = true;
      try {
        livemode = JSON.parse(rawBody.toString()).livemode !== false;
      } catch {}
      const secret = livemode ? stripeWebhookSecret.value() : stripeWebhookSecretTest.value();
      event = stripe.webhooks.constructEvent(rawBody, sig, secret);
    } catch (err: any) {
      console.error('[stripeWebhook] signature verification failed:', err.message);
      res.status(400).send(`Webhook Error: ${err.message}`);
      return;
    }

    // Test-mode events are processed normally so sandbox dev flows complete
    // end-to-end. All Firestore writes from test events carry testMode:true so
    // test data stays distinguishable from real subscriptions.
    // Security relies on STRIPE_WEBHOOK_SECRET_TEST remaining private in
    // Secret Manager — without it no one can forge a valid test event.
    const isTestMode = !event.livemode;
    if (isTestMode) {
      console.log('[stripeWebhook] test-mode event — processing with testMode flag');
    }

    const db = admin.firestore();

    // Idempotency: Stripe retries deliveries (timeouts, non-2xx), and commission
    // creation is not naturally idempotent — a redelivered event would double-pay.
    // create() fails atomically if the event was already recorded.
    const eventRef = db.doc(`stripeEvents/${event.id}`);
    try {
      await eventRef.create({
        type: event.type,
        livemode: event.livemode,
        receivedAt: admin.firestore.FieldValue.serverTimestamp(),
        // Enable a Firestore TTL policy on stripeEvents.expireAt to auto-clean these
        expireAt: admin.firestore.Timestamp.fromMillis(Date.now() + 60 * 24 * 60 * 60 * 1000),
      });
    } catch (e: any) {
      if (e?.code === 6 || e?.code === 'already-exists') {
        console.log(`[stripeWebhook] duplicate delivery ignored event=${event.id}`);
        res.json({ received: true, duplicate: true });
        return;
      }
      throw e;
    }

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
            await db.doc(`organizations/${orgId}`).set(
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
            const interval: string = session.metadata?.interval ?? 'month';
            const couponId: string | undefined = session.metadata?.couponId;

            // Read the pre-update user doc. referralLockedAt being set means the user
            // already paid at least once — this checkout is a re-subscription.
            const prevUserSnap = await db.doc(`users/${uid}`).get();
            const prevUserData = prevUserSnap.data() ?? {};
            const isResubscription = !!prevUserData.referralLockedAt;

            await db.doc(`users/${uid}`).set(
              {
                proStatus: 'active',
                proType: 'self',
                stripeCustomerId: customer,
                stripeSubscriptionId: subscription,
                subscriptionInterval: interval,
                stripeActivatedAt: admin.firestore.FieldValue.serverTimestamp(),
                // Clear stale cancel marker from any prior subscription
                proCancelOn: null,
                // Remove testMode flag for live subscriptions so requestProRefund uses the correct key
                testMode: isTestMode ? true : admin.firestore.FieldValue.delete(),
              },
              { merge: true }
            );

            // Store subscription record
            if (subscription) {
              await db.doc(`subscriptions/${subscription}`).set(
                {
                  uid,
                  stripeCustomerId: customer,
                  subscriptionId: subscription,
                  subscriptionType: interval,
                  amountPaidCents: session.amount_total ?? 0,
                  status: 'active',
                  couponId: couponId ?? null,
                  createdAt: admin.firestore.FieldValue.serverTimestamp(),
                  ...(isTestMode ? { testMode: true } : {}),
                },
                { merge: true }
              );
            }

            // Reactivate any followers that were deactivated while this user's Pro was lapsed
            await syncFollowerUidsForProChange(db, uid, 'reactivate').catch((e) =>
              console.warn('[stripeWebhook] reactivate followerUids failed:', e)
            );

            console.log(
              `[stripeWebhook] checkout.session.completed uid=${uid} interval=${interval}`
            );

            // For trial checkouts amount_total is 0 — skip commission (referralLockedAt
            // must not be set until actual payment) and skip the sale email.
            // Instead notify the owner that a trial started.
            const amountTotal: number = session.amount_total ?? 0;

            // Always create an in-app notification record so the user sees "You got Pro"
            // even if they hadn't granted notification permissions when checkout completed.
            await db.collection(`users/${uid}/notifications`).add({
              title: 'Welcome to Vidopick Pro! 🎉',
              body:
                amountTotal === 0
                  ? 'Your free trial is now active. Enjoy Pro features for 14 days.'
                  : 'Your Pro subscription is active. Enjoy all Pro features.',
              sentAt: admin.firestore.FieldValue.serverTimestamp(),
              viewedAt: null,
              type: 'pro_activated',
            });
            if (amountTotal === 0) {
              try {
                const RESEND_API_KEY = process.env.RESEND_API_KEY;
                const sendTestEmails = process.env.SEND_TEST_EMAILS === 'true';
                if (RESEND_API_KEY && (!isTestMode || sendTestEmails)) {
                  const { Resend } = await import('resend');
                  const resend = new Resend(RESEND_API_KEY);
                  let customerName = 'Unknown';
                  let customerEmail = 'Unknown';
                  try {
                    const authUser = await admin.auth().getUser(uid);
                    customerName = authUser.displayName ?? authUser.email ?? 'Unknown';
                    customerEmail = authUser.email ?? 'Unknown';
                  } catch {}
                  // Compute trial end date from the subscription object if available
                  let trialEndDate = 'in 7 days';
                  try {
                    if (subscription) {
                      const sub = await stripe.subscriptions.retrieve(subscription);
                      if ((sub as any).trial_end) {
                        trialEndDate = new Date((sub as any).trial_end * 1000).toLocaleDateString(
                          'en-US',
                          {
                            month: 'long',
                            day: 'numeric',
                            year: 'numeric',
                          }
                        );
                      }
                    }
                  } catch {}
                  await resend.emails.send({
                    from: 'Vidopick <hello@vidopick.com>',
                    to: OWNER_EMAIL,
                    subject: `${isTestMode ? '[TEST] ' : ''}🆕 New free trial — ${customerEmail} (${interval === 'year' ? 'Annual' : 'Monthly'})`,
                    html: buildOwnerTrialStartEmail(
                      customerName,
                      customerEmail,
                      uid,
                      interval,
                      trialEndDate,
                      isTestMode
                    ),
                  });
                  console.log(`[stripeWebhook] owner trial-start email sent uid=${uid}`);
                }
              } catch (emailErr) {
                console.warn('[stripeWebhook] owner trial-start email failed:', emailErr);
              }

              // Notify the referring affiliate (if any) that a trial started via their link.
              // Guard: only fire for genuine first trials — prevUserData.stripeActivatedAt is
              // unset for first-time buyers (read before the update above sets it).
              const trialAffiliateId: string | undefined =
                !prevUserData.stripeActivatedAt ? prevUserData.referredByAffiliateId : undefined;
              if (trialAffiliateId) {
                try {
                  const date = new Date().toISOString().slice(0, 10);
                  const affiliateSnap = await db.doc(`affiliates/${trialAffiliateId}`).get();
                  const affiliateData = affiliateSnap.data() ?? {};
                  const affiliateEmail: string = affiliateData.email ?? '';
                  const affiliateName: string = affiliateData.name ?? 'Affiliate';
                  await Promise.all([
                    db
                      .collection(`affiliates/${trialAffiliateId}/dailyStats`)
                      .doc(date)
                      .set({ trials: admin.firestore.FieldValue.increment(1) }, { merge: true }),
                    db
                      .doc(`affiliates/${trialAffiliateId}`)
                      .set(
                        { stats: { trialStarts: admin.firestore.FieldValue.increment(1) } },
                        { merge: true }
                      ),
                    ...(prevUserData.referredByShortlinkId
                      ? [
                          db
                            .doc(`shortLinks/${prevUserData.referredByShortlinkId}`)
                            .set(
                              { analytics: { trialConversions: admin.firestore.FieldValue.increment(1) } },
                              { merge: true }
                            ),
                        ]
                      : []),
                  ]);
                  const RESEND_API_KEY = process.env.RESEND_API_KEY;
                  const sendTestEmails = process.env.SEND_TEST_EMAILS === 'true';
                  if (RESEND_API_KEY && affiliateEmail && (!isTestMode || sendTestEmails)) {
                    const { Resend } = await import('resend');
                    const resend = new Resend(RESEND_API_KEY);
                    await resend.emails.send({
                      from: 'Vidopick <hello@vidopick.com>',
                      to: affiliateEmail,
                      subject: `${isTestMode ? '[TEST] ' : ''}🌱 New free trial via your link`,
                      html: buildAffiliateTrialEmail(
                        affiliateName,
                        interval,
                        'https://vidopick.com/vp/dashboard'
                      ),
                    });
                    console.log(`[stripeWebhook] affiliate trial email sent affiliateId=${trialAffiliateId} uid=${uid}`);
                  }
                } catch (e) {
                  console.warn('[stripeWebhook] affiliate trial notification failed:', e);
                }
              }
            } else {
              // Affiliate commission: attribute first payment if referral not yet locked
              if (isResubscription) {
                // Re-subscription after cancellation: no new commission — the affiliate
                // was already paid on original conversion. Just restore their active count.
                if (prevUserData.referredByAffiliateId) {
                  await db
                    .doc(`affiliates/${prevUserData.referredByAffiliateId}`)
                    .set(
                      { stats: { activeSubscribers: admin.firestore.FieldValue.increment(1) } },
                      { merge: true }
                    );
                  console.log(
                    `[stripeWebhook] re-subscription: activeSubscribers +1 affiliateId=${prevUserData.referredByAffiliateId} uid=${uid}`
                  );
                }
              } else {
                await createAffiliateCommission(db, uid, amountTotal, subscription ?? '', {
                  subscriptionType: interval,
                  couponName: couponId ?? undefined,
                  testMode: isTestMode,
                });
              }

              // Owner notification for direct (non-affiliate) sales — affiliate sales
              // already notify the owner inside createAffiliateCommission.
              const referredBy: string | undefined = prevUserData.referredByAffiliateId;
              if (!referredBy) {
                try {
                  const RESEND_API_KEY = process.env.RESEND_API_KEY;
                  const sendTestEmails = process.env.SEND_TEST_EMAILS === 'true';
                  if (RESEND_API_KEY && (!isTestMode || sendTestEmails)) {
                    const { Resend } = await import('resend');
                    const resend = new Resend(RESEND_API_KEY);
                    let customerName = 'Unknown';
                    let customerEmail = 'Unknown';
                    try {
                      const authUser = await admin.auth().getUser(uid);
                      customerName = authUser.displayName ?? authUser.email ?? 'Unknown';
                      customerEmail = authUser.email ?? 'Unknown';
                    } catch {}
                    const amountDollars = (amountTotal / 100).toFixed(2);
                    await resend.emails.send({
                      from: 'Vidopick <hello@vidopick.com>',
                      to: OWNER_EMAIL,
                      subject: `${isTestMode ? '[TEST] ' : ''}💰 New Vidopick sale — $${amountDollars} (${interval === 'year' ? 'Annual' : 'Monthly'})`,
                      html: buildOwnerDirectSaleEmail(
                        customerName,
                        customerEmail,
                        uid,
                        amountDollars,
                        interval,
                        isTestMode
                      ),
                    });
                    console.log(`[stripeWebhook] owner sale email sent uid=${uid}`);
                  }
                } catch (emailErr) {
                  console.warn('[stripeWebhook] owner sale email failed:', emailErr);
                }
              }
            }
          }
          break;
        }

        case 'customer.subscription.updated': {
          const subscription = event.data.object as any;
          const uid2 = subscription.metadata?.firebaseUid;
          if (!uid2) break;

          const prevAttrs = (event.data as any).previous_attributes ?? {};

          // Stripe cancels subscriptions in two ways:
          // 1. cancel_at_period_end: true  — cancels at natural billing cycle end
          // 2. cancel_at: <timestamp>      — cancels at a hard date (what the portal uses
          //                                  when "cancel at end of billing period" is selected)
          // Both must be detected. The portal sends cancel_at, NOT cancel_at_period_end.
          const justCancelled =
            (subscription.cancel_at_period_end === true &&
              prevAttrs.cancel_at_period_end === false) ||
            (subscription.cancel_at != null && prevAttrs.cancel_at === null);
          const justUncancelled =
            (subscription.cancel_at_period_end === false &&
              prevAttrs.cancel_at_period_end === true) ||
            (subscription.cancel_at == null && prevAttrs.cancel_at != null);

          // The effective period end for refund/access purposes
          const cancelEndTimestamp: number =
            subscription.cancel_at ?? subscription.current_period_end ?? 0;

          if (justUncancelled) {
            const uncancelledUserSnap = await db.doc(`users/${uid2}`).get();
            const uncancelledDeviceTokens: string[] =
              uncancelledUserSnap.data()?.deviceTokens ?? [];
            await Promise.all([
              db.doc(`users/${uid2}`).set(
                {
                  proStatus: 'active',
                  proType: 'self',
                  proCancelOn: null,
                },
                { merge: true }
              ),
              db.doc(`subscriptions/${subscription.id}`).set(
                {
                  status: 'active',
                  proCancelOn: null,
                  updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                },
                { merge: true }
              ),
            ]);
            // Reactivate followers — a trial cancellation immediately revokes Pro and
            // deactivates followers; uncancelling must restore them.
            await syncFollowerUidsForProChange(db, uid2, 'reactivate').catch((e) =>
              console.warn('[stripeWebhook] reactivate followerUids (uncancelled) failed:', e)
            );
            if (uncancelledDeviceTokens.length > 0) {
              await notifyUser(
                db,
                uid2,
                uncancelledDeviceTokens,
                'Subscription reactivated',
                'Your Vidopick Pro subscription will continue with no change to your billing.',
                { type: 'pro_uncancelled' }
              );
            }
            console.log(`[stripeWebhook] uncancelled uid=${uid2}`);

            try {
              const RESEND_API_KEY = process.env.RESEND_API_KEY;
              const sendTestEmails = process.env.SEND_TEST_EMAILS === 'true';
              if (RESEND_API_KEY && (!isTestMode || sendTestEmails)) {
                const { Resend } = await import('resend');
                const resend = new Resend(RESEND_API_KEY);
                let customerName = 'Unknown';
                let customerEmail = 'Unknown';
                try {
                  const u = await admin.auth().getUser(uid2);
                  customerName = u.displayName ?? u.email ?? 'Unknown';
                  customerEmail = u.email ?? 'Unknown';
                } catch {}
                const subType: string =
                  (await db.doc(`users/${uid2}`).get()).data()?.subscriptionInterval ?? 'month';
                await resend.emails.send({
                  from: 'Vidopick <hello@vidopick.com>',
                  to: OWNER_EMAIL,
                  subject: `${isTestMode ? '[TEST] ' : ''}↩️ Subscription reactivated — ${customerEmail}`,
                  html: buildOwnerUncancellationEmail(
                    customerName,
                    customerEmail,
                    uid2,
                    subType,
                    isTestMode
                  ),
                });
              }
            } catch (emailErr) {
              console.warn('[stripeWebhook] uncancellation email failed:', emailErr);
            }
          } else if (justCancelled) {
            const isTrial = subscription.status === 'trialing';

            const periodEnd: number = cancelEndTimestamp;
            const proCancelOn = admin.firestore.Timestamp.fromMillis(periodEnd * 1000);

            const userSnap2 = await db.doc(`users/${uid2}`).get();
            const userData2 = userSnap2.data() ?? {};
            const deviceTokens2: string[] = userData2.deviceTokens ?? [];

            if (isTrial) {
              // Free trial cancelled — revoke Pro access immediately (no paid period to honour).
              // Keep the profile relationship intact so a resubscription restores access.
              await Promise.all([
                db
                  .doc(`users/${uid2}`)
                  .set({ proStatus: 'none', proType: null, proCancelOn: null }, { merge: true }),
                db.doc(`subscriptions/${subscription.id}`).set(
                  {
                    status: 'cancelled',
                    proCancelOn: null,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                  },
                  { merge: true }
                ),
              ]);
              await syncFollowerUidsForProChange(db, uid2, 'deactivate').catch((e) =>
                console.warn('[stripeWebhook] deactivate followerUids (trial cancel) failed:', e)
              );
            } else {
              await Promise.all([
                db.doc(`users/${uid2}`).set({ proCancelOn }, { merge: true }),
                db.doc(`subscriptions/${subscription.id}`).set(
                  {
                    status: 'cancelling',
                    proCancelOn,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                  },
                  { merge: true }
                ),
              ]);
            }

            const endDate = new Date(periodEnd * 1000).toLocaleDateString('en-US', {
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            });

            const notifBody = isTrial
              ? `Your free trial has been cancelled. Your card won't be charged.`
              : `Your Pro access continues until ${endDate}. After that your subscription will not renew.`;

            if (deviceTokens2.length > 0) {
              await notifyUser(db, uid2, deviceTokens2, 'Subscription Cancelled', notifBody, {
                type: 'subscription_cancelled_access_until',
                proCancelOn: String(periodEnd),
              });
            }

            console.log(
              `[stripeWebhook] cancel uid=${uid2} isTrial=${isTrial}${isTrial ? ' (immediate revoke)' : ` proCancelOn=${proCancelOn.toDate().toISOString()}`}`
            );

            try {
              const RESEND_API_KEY = process.env.RESEND_API_KEY;
              const sendTestEmails = process.env.SEND_TEST_EMAILS === 'true';
              if (RESEND_API_KEY && (!isTestMode || sendTestEmails)) {
                const { Resend } = await import('resend');
                const resend = new Resend(RESEND_API_KEY);
                let customerName = 'Unknown';
                let customerEmail = 'Unknown';
                try {
                  const u = await admin.auth().getUser(uid2);
                  customerName = u.displayName ?? u.email ?? 'Unknown';
                  customerEmail = u.email ?? 'Unknown';
                } catch {}
                const subType: string = userData2.subscriptionInterval ?? 'month';
                await resend.emails.send({
                  from: 'Vidopick <hello@vidopick.com>',
                  to: OWNER_EMAIL,
                  subject: `${isTestMode ? '[TEST] ' : ''}❌ Subscription cancelled — ${customerEmail}${isTrial ? ' (trial)' : ''}`,
                  html: buildOwnerCancellationEmail(
                    customerName,
                    customerEmail,
                    uid2,
                    endDate,
                    false,
                    subType,
                    isTestMode
                  ),
                });
              }
            } catch (emailErr) {
              console.warn('[stripeWebhook] cancellation email failed:', emailErr);
            }
          } else {
            // Regular subscription update (not a cancellation event).
            // Guard: if cancel_at_period_end is already true but proCancelOn was never
            // written (e.g. the justCancelled event was a retry/redelivery where
            // previous_attributes didn't include the field), write it now.
            const stripeStatus2: string = subscription.status ?? '';
            // A trialing subscription with cancel_at set is a cancelled trial — treat as 'none'.
            const isCancellingTrial =
              stripeStatus2 === 'trialing' &&
              (subscription.cancel_at != null || subscription.cancel_at_period_end === true);
            let proStatus2: string;
            if (isCancellingTrial) proStatus2 = 'none';
            else if (stripeStatus2 === 'active' || stripeStatus2 === 'trialing')
              proStatus2 = 'active';
            else if (stripeStatus2 === 'past_due') proStatus2 = 'grace';
            else proStatus2 = 'none';

            const userUpdates2: Record<string, unknown> = {
              proStatus: proStatus2,
              stripeSubscriptionId: subscription.id,
              ...(isCancellingTrial ? { proCancelOn: null, proType: null } : {}),
            };
            let fallbackCancelNotify = false;
            let fallbackPeriodEnd = 0;
            let fallbackDeviceTokens: string[] = [];
            let fallbackUserData: Record<string, any> = {};

            if (
              !isCancellingTrial &&
              (subscription.cancel_at_period_end === true || subscription.cancel_at != null)
            ) {
              const userSnap2 = await db.doc(`users/${uid2}`).get();
              fallbackUserData = userSnap2.data() ?? {};
              if (!fallbackUserData.proCancelOn) {
                fallbackPeriodEnd = cancelEndTimestamp;
                userUpdates2.proCancelOn = admin.firestore.Timestamp.fromMillis(
                  fallbackPeriodEnd * 1000
                );
                fallbackDeviceTokens = fallbackUserData.deviceTokens ?? [];
                fallbackCancelNotify = true;
                console.log(`[stripeWebhook] fallback proCancelOn set for uid=${uid2}`);
              }
            }

            await Promise.all([
              db.doc(`users/${uid2}`).set(userUpdates2, { merge: true }),
              db
                .doc(`subscriptions/${subscription.id}`)
                .set(
                  { status: proStatus2, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
                  { merge: true }
                ),
            ]);
            if (isCancellingTrial) {
              await syncFollowerUidsForProChange(db, uid2, 'deactivate').catch((e) =>
                console.warn(
                  '[stripeWebhook] deactivate followerUids (cancelling trial) failed:',
                  e
                )
              );
            } else if (
              proStatus2 === 'active' &&
              prevAttrs.status &&
              prevAttrs.status !== 'active'
            ) {
              // Status just changed to active from something else (e.g. incomplete → active after
              // payment confirmation). Reactivate followers that were paused during a prior lapse.
              await syncFollowerUidsForProChange(db, uid2, 'reactivate').catch((e) =>
                console.warn('[stripeWebhook] reactivate followerUids (status → active) failed:', e)
              );
            }
            console.log(
              `[stripeWebhook] subscription updated uid=${uid2} → proStatus=${proStatus2}${isCancellingTrial ? ' (cancelling trial — immediate revoke)' : ''}`
            );

            // Send cancellation notifications (mirrors justCancelled branch).
            if (fallbackCancelNotify) {
              const isTrial = subscription.status === 'trialing';
              const endDate = new Date(fallbackPeriodEnd * 1000).toLocaleDateString('en-US', {
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              });
              const notifBody = isTrial
                ? `Your free trial has been cancelled. Your card won't be charged.`
                : `Your Pro access continues until ${endDate}. After that your subscription will not renew.`;
              if (fallbackDeviceTokens.length > 0) {
                await notifyUser(
                  db,
                  uid2,
                  fallbackDeviceTokens,
                  'Subscription Cancelled',
                  notifBody,
                  {
                    type: 'subscription_cancelled_access_until',
                    proCancelOn: String(fallbackPeriodEnd),
                  }
                );
              }
              try {
                const RESEND_API_KEY = process.env.RESEND_API_KEY;
                const sendTestEmails = process.env.SEND_TEST_EMAILS === 'true';
                if (RESEND_API_KEY && (!isTestMode || sendTestEmails)) {
                  const { Resend } = await import('resend');
                  const resend = new Resend(RESEND_API_KEY);
                  let customerName = 'Unknown';
                  let customerEmail = 'Unknown';
                  try {
                    const u = await admin.auth().getUser(uid2);
                    customerName = u.displayName ?? u.email ?? 'Unknown';
                    customerEmail = u.email ?? 'Unknown';
                  } catch {}
                  const subType: string = fallbackUserData.subscriptionInterval ?? 'month';
                  await resend.emails.send({
                    from: 'Vidopick <hello@vidopick.com>',
                    to: OWNER_EMAIL,
                    subject: `${isTestMode ? '[TEST] ' : ''}❌ Subscription cancelled — ${customerEmail}${isTrial ? ' (trial)' : ''}`,
                    html: buildOwnerCancellationEmail(
                      customerName,
                      customerEmail,
                      uid2,
                      endDate,
                      false,
                      subType,
                      isTestMode
                    ),
                  });
                }
              } catch (emailErr) {
                console.warn('[stripeWebhook] fallback cancellation email failed:', emailErr);
              }
            }
          }
          break;
        }

        case 'customer.subscription.created': {
          // Handles portal re-subscriptions for users whose subscription previously expired.
          // The initial checkout flow uses checkout.session.completed instead, but that
          // event does NOT fire for portal-initiated re-subscriptions — only this one does.
          const newSub = event.data.object as any;
          if (newSub.metadata?.organizationId) break; // org billing uses a different flow

          // Prefer firebaseUid from subscription metadata (set during checkout).
          // Fall back to stripeCustomerId lookup for portal re-subscriptions where
          // metadata may not carry over.
          let newSubUid: string | undefined = newSub.metadata?.firebaseUid;
          if (!newSubUid) {
            const newSubCustomer = newSub.customer as string | null;
            if (!newSubCustomer) break;
            const newSubUserQuery = await db
              .collection('users')
              .where('stripeCustomerId', '==', newSubCustomer)
              .limit(1)
              .get();
            if (!newSubUserQuery.empty) newSubUid = newSubUserQuery.docs[0].id;
          }
          if (!newSubUid) break;

          const newSubSnap = await db.doc(`users/${newSubUid}`).get();
          const newSubData = newSubSnap.data() ?? {};

          // If checkout.session.completed already activated this subscription, skip.
          if (newSubData.proStatus === 'active') break;

          const newSubStripeStatus: string = newSub.status ?? '';
          if (newSubStripeStatus !== 'active' && newSubStripeStatus !== 'trialing') break;

          const newSubInterval: string =
            newSub.metadata?.interval ?? newSubData.subscriptionInterval ?? 'month';
          const newSubCustomerId =
            (newSub.customer as string | null) ?? newSubData.stripeCustomerId;

          await Promise.all([
            db.doc(`users/${newSubUid}`).set(
              {
                proStatus: 'active',
                proType: 'self',
                stripeCustomerId: newSubCustomerId,
                stripeSubscriptionId: newSub.id,
                subscriptionInterval: newSubInterval,
                proCancelOn: null,
                ...(newSubData.stripeActivatedAt
                  ? {}
                  : { stripeActivatedAt: admin.firestore.FieldValue.serverTimestamp() }),
                testMode: isTestMode ? true : admin.firestore.FieldValue.delete(),
              },
              { merge: true }
            ),
            db.doc(`subscriptions/${newSub.id}`).set(
              {
                uid: newSubUid,
                stripeCustomerId: newSubCustomerId,
                subscriptionId: newSub.id,
                subscriptionType: newSubInterval,
                status: newSubStripeStatus === 'trialing' ? 'trialing' : 'active',
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                ...(isTestMode ? { testMode: true } : {}),
              },
              { merge: true }
            ),
            db.collection(`users/${newSubUid}/notifications`).add({
              title: 'Welcome back to Vidopick Pro! 🎉',
              body: 'Your Pro subscription is active again. Enjoy all Pro features.',
              sentAt: admin.firestore.FieldValue.serverTimestamp(),
              viewedAt: null,
              type: 'pro_activated',
            }),
          ]);

          // Re-subscription: restore affiliate's active subscriber count.
          // No new commission — the affiliate was already paid on original conversion.
          if (newSubData.referredByAffiliateId && newSubData.referralLockedAt) {
            await db
              .doc(`affiliates/${newSubData.referredByAffiliateId}`)
              .set(
                { stats: { activeSubscribers: admin.firestore.FieldValue.increment(1) } },
                { merge: true }
              );
            console.log(
              `[stripeWebhook] portal re-subscription: activeSubscribers +1 affiliateId=${newSubData.referredByAffiliateId} uid=${newSubUid}`
            );
          }

          const newSubDeviceTokens: string[] = newSubData.deviceTokens ?? [];
          if (newSubDeviceTokens.length > 0) {
            await notifyUser(
              db,
              newSubUid,
              newSubDeviceTokens,
              'Pro reactivated! 🎉',
              'Your Vidopick Pro subscription is active again.',
              { type: 'pro_activated' }
            );
          }

          await syncFollowerUidsForProChange(db, newSubUid, 'reactivate').catch((e) =>
            console.warn(
              '[stripeWebhook] reactivate followerUids (portal re-subscription) failed:',
              e
            )
          );
          console.log(
            `[stripeWebhook] customer.subscription.created (portal re-subscription) uid=${newSubUid} status=${newSubStripeStatus}`
          );
          break;
        }

        case 'customer.subscription.deleted': {
          // Only handles user self-pay subscriptions (orgs use invoice-based billing)
          const subscription = event.data.object as any;
          const uid = subscription.metadata?.firebaseUid;
          if (!uid) break;

          const cancelledUserSnap = await db.doc(`users/${uid}`).get();
          const cancelledUserData = cancelledUserSnap.data() ?? {};

          const cancelledAt = admin.firestore.FieldValue.serverTimestamp();

          await Promise.all([
            db.doc(`users/${uid}`).set(
              {
                proStatus: 'none',
                proType: null,
                stripeSubscriptionId: null,
                stripeCancelledAt: cancelledAt,
                proCancelOn: null,
              },
              { merge: true }
            ),
            db
              .doc(`subscriptions/${subscription.id}`)
              .set({ status: 'cancelled', cancelledAt }, { merge: true }),
          ]);
          await syncFollowerUidsForProChange(db, uid, 'deactivate').catch((e) =>
            console.warn(
              '[stripeWebhook] deactivate followerUids (subscription deleted) failed:',
              e
            )
          );
          console.log(`[stripeWebhook] subscription deleted uid=${uid}`);

          // Decrement affiliate counters if this user was a referred paying subscriber.
          // referralLockedAt is only set on first payment — a referred user who cancels
          // a trial before paying never incremented these counters, so don't decrement.
          const cancelledAffiliateId: string | undefined = cancelledUserData.referredByAffiliateId;
          const cancelledShortlinkId: string | undefined = cancelledUserData.referredByShortlinkId;
          if (cancelledAffiliateId && cancelledUserData.referralLockedAt) {
            const decrements: Promise<any>[] = [
              db
                .doc(`affiliates/${cancelledAffiliateId}`)
                .set(
                  { stats: { activeSubscribers: admin.firestore.FieldValue.increment(-1) } },
                  { merge: true }
                ),
            ];
            if (cancelledShortlinkId) {
              decrements.push(
                db
                  .doc(`shortLinks/${cancelledShortlinkId}`)
                  .set(
                    { analytics: { payingConversions: admin.firestore.FieldValue.increment(-1) } },
                    { merge: true }
                  )
              );
            }
            await Promise.all(decrements);
            console.log(
              `[stripeWebhook] affiliate counters decremented affiliateId=${cancelledAffiliateId} shortlinkId=${cancelledShortlinkId ?? 'none'}`
            );
          }

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
            await db.doc(`organizations/${orgId}`).set(
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
              const failedUid = snap.docs[0].id;
              const failedSubId: string | undefined = snap.docs[0].data()?.stripeSubscriptionId;
              const updates: Promise<any>[] = [
                snap.docs[0].ref.set({ proStatus: 'grace' }, { merge: true }),
              ];
              if (failedSubId) {
                updates.push(
                  db
                    .doc(`subscriptions/${failedSubId}`)
                    .set(
                      { status: 'grace', updatedAt: admin.firestore.FieldValue.serverTimestamp() },
                      { merge: true }
                    )
                );
              }
              await Promise.all(updates);
              console.log(`[stripeWebhook] payment_failed → grace uid=${failedUid}`);
            }
          }
          break;
        }

        case 'invoice.payment_succeeded': {
          const invoice = event.data.object as any;
          // Only handle subscription renewal cycles for user self-pay
          if (invoice.billing_reason !== 'subscription_cycle') break;
          const subId: string | null = invoice.subscription ?? null;
          if (!subId) break;

          const userQuery = await db
            .collection('users')
            .where('stripeSubscriptionId', '==', subId)
            .limit(1)
            .get();
          if (userQuery.empty) break;

          const renewalUid = userQuery.docs[0].id;
          const renewalUserData = userQuery.docs[0].data() ?? {};
          const renewalInterval: string = renewalUserData.subscriptionInterval ?? 'month';
          await createAffiliateCommission(db, renewalUid, invoice.amount_paid ?? 0, subId, {
            subscriptionType: renewalInterval,
            testMode: isTestMode,
          });
          console.log(`[stripeWebhook] renewal commission attempted uid=${renewalUid}`);
          break;
        }

        case 'customer.subscription.trial_will_end': {
          const subscription = event.data.object as any;
          const uid: string | undefined = subscription.metadata?.firebaseUid;
          if (!uid) break;
          // If the trial was shortened to "now", payment may have already been
          // collected and the subscription is already active — skip the notification.
          if (subscription.status !== 'trialing') break;
          // If the user already cancelled during the trial, don't tell them their card will be charged.
          if (subscription.cancel_at_period_end) break;

          const trialEndSeconds: number = subscription.trial_end ?? 0;
          const trialEndDate = new Date(trialEndSeconds * 1000).toLocaleDateString('en-US', {
            month: 'long',
            day: 'numeric',
            year: 'numeric',
          });

          const userSnap = await db.doc(`users/${uid}`).get();
          const userData = userSnap.data() ?? {};
          const deviceTokens: string[] = userData.deviceTokens ?? [];
          const interval: string = userData.subscriptionInterval ?? 'month';
          const price = interval === 'year' ? '$79.99/year' : '$7.99/month';

          if (deviceTokens.length > 0) {
            await notifyUser(
              db,
              uid,
              deviceTokens,
              'Your free trial ends in 3 days',
              `We hope you're enjoying Vidopick Pro! Your card will be charged ${price} on ${trialEndDate} unless you cancel before then.`,
              { type: 'trial_will_end', trialEnd: String(trialEndSeconds) }
            );
          }

          console.log(`[stripeWebhook] trial_will_end uid=${uid} trialEnd=${trialEndDate}`);
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
      // Release the idempotency marker so Stripe's retry isn't treated as a duplicate.
      // If this delete fails the retry will be skipped as a duplicate — log loudly.
      await eventRef
        .delete()
        .catch((e) =>
          console.error(
            `[stripeWebhook] marker release failed event=${event.id} — retry will be skipped:`,
            e
          )
        );
      res.status(500).send('Internal error');
      return;
    }

    res.json({ received: true });
  }
);
