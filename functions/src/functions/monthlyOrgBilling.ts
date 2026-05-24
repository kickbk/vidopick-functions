import * as admin from 'firebase-admin';
import Stripe from 'stripe';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';
import { notifyUser } from '../utils/notifyUser.js';

if (!admin.apps.length) admin.initializeApp();

const stripeSecretKey = defineSecret('STRIPE_SECRET_KEY');

const MIN_BILLABLE_SECONDS = 24 * 60 * 60; // 24 hours

/**
 * Runs on the 1st of each month (UTC).
 *
 * For each active (or cancelling) org:
 *  1. Counts users active for ≥24h in the previous month.
 *  2. Creates one Stripe invoice with two line items:
 *       - Management fee
 *       - Per sponsored user
 *  3. Finalizes the invoice (Stripe auto-charges the saved card).
 *
 * For orgs with cancelAtPeriodEnd = true and cancelAt <= now:
 *  - Bills the final month as above.
 *  - Then suspends all sponsored users and sends push notifications.
 *  - Marks org isSponsoring: false, billingActive: false.
 */
export const monthlyOrgBilling = onSchedule(
  {
    schedule: '0 0 1 * *',
    timeZone: 'UTC',
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 540,
    secrets: [stripeSecretKey],
  },
  async () => {
    const db = admin.firestore();
    const stripe = new Stripe(stripeSecretKey.value(), { apiVersion: '2026-03-25.dahlia' });

    // Previous month window (the 1st runs at 00:00 UTC — now IS the monthEnd)
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)); // = now
    const monthLabel = monthStart.toLocaleString('default', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });

    console.log(
      `[monthlyOrgBilling] billing period: ${monthStart.toISOString()} → ${monthEnd.toISOString()}`
    );

    // Collect orgs to process: active sponsors + those whose cancellation is due today
    const [sponsoringSnap, cancellingSnap] = await Promise.all([
      db.collection('organizations').where('isSponsoring', '==', true).get(),
      db.collection('organizations').where('cancelAtPeriodEnd', '==', true).get(),
    ]);

    const orgDocsMap = new Map<string, admin.firestore.QueryDocumentSnapshot>();
    for (const doc of [...sponsoringSnap.docs, ...cancellingSnap.docs]) {
      orgDocsMap.set(doc.id, doc);
    }

    for (const [orgId, orgDoc] of orgDocsMap) {
      const orgData = orgDoc.data();
      const stripeCustomerId: string | undefined = orgData.stripeCustomerId;
      const costs = orgData.costs ?? {};
      const sponsoredProInCents: number = costs.sponsoredProInCents ?? 299;
      const managementInCents: number = costs.managementInCents ?? 15000;
      const orgName: string = orgData.name ?? orgId;

      // Check if this is the final billing run for a cancelling org
      const cancelAt: admin.firestore.Timestamp | undefined = orgData.cancelAt;
      const isFinalRun = !!orgData.cancelAtPeriodEnd && !!cancelAt && cancelAt.toDate() <= monthEnd;

      // Skip pilot orgs (no Stripe needed)
      const isPilot = sponsoredProInCents === 0 && managementInCents === 0;
      if (isPilot) {
        console.log(`[monthlyOrgBilling] org=${orgId} skipped — pilot`);
        if (isFinalRun) await suspendOrg(db, orgId, orgDoc, orgName);
        continue;
      }

      if (!stripeCustomerId) {
        console.log(`[monthlyOrgBilling] org=${orgId} skipped — no stripeCustomerId`);
        if (isFinalRun) await suspendOrg(db, orgId, orgDoc, orgName);
        continue;
      }

      // Count billable users
      const usersSnap = await db.collection(`orgSponsors/${orgId}/users`).get();
      let billableCount = 0;

      for (const userDoc of usersSnap.docs) {
        const periods: Array<{
          startedAt: admin.firestore.Timestamp;
          endedAt: admin.firestore.Timestamp | null;
        }> = userDoc.data().periods ?? [];

        let totalSeconds = 0;
        for (const period of periods) {
          const start = period.startedAt.toDate();
          const end = period.endedAt ? period.endedAt.toDate() : monthEnd;
          const effectiveStart = start < monthStart ? monthStart : start;
          const effectiveEnd = end > monthEnd ? monthEnd : end;
          if (effectiveEnd > effectiveStart) {
            totalSeconds += (effectiveEnd.getTime() - effectiveStart.getTime()) / 1000;
          }
        }
        if (totalSeconds >= MIN_BILLABLE_SECONDS) billableCount++;
      }

      // Skip management fee for the partial first month (waived until billingStartDate)
      const billingStartDate: admin.firestore.Timestamp | undefined = orgData.billingStartDate;
      const managementFeeActive =
        managementInCents > 0 && (!billingStartDate || billingStartDate.toDate() <= monthStart);

      const hasManagementFee = managementFeeActive;
      const hasUserCharges = billableCount > 0 && sponsoredProInCents > 0;

      if (!hasManagementFee && !hasUserCharges) {
        console.log(`[monthlyOrgBilling] org=${orgId} — nothing to bill`);
        if (isFinalRun) await suspendOrg(db, orgId, orgDoc, orgName);
        continue;
      }

      console.log(
        `[monthlyOrgBilling] org=${orgId} (${orgName}) — management=${managementInCents}¢, ${billableCount} users × ${sponsoredProInCents}¢${isFinalRun ? ' [FINAL]' : ''}`
      );

      try {
        // Create invoice items
        if (hasManagementFee) {
          await stripe.invoiceItems.create({
            customer: stripeCustomerId,
            amount: managementInCents,
            currency: 'usd',
            description: `Vidopick Pro Management (${monthLabel})`,
            metadata: {
              organizationId: orgId,
              type: 'management',
              billingMonth: monthStart.toISOString().slice(0, 7),
            },
          });
        }

        if (hasUserCharges) {
          await stripe.invoiceItems.create({
            customer: stripeCustomerId,
            amount: billableCount * sponsoredProInCents,
            currency: 'usd',
            description: `Sponsored Pro users — ${billableCount} user${billableCount !== 1 ? 's' : ''} × $${(sponsoredProInCents / 100).toFixed(2)} (${monthLabel})`,
            metadata: {
              organizationId: orgId,
              type: 'sponsorship',
              billingMonth: monthStart.toISOString().slice(0, 7),
              subscriberCount: String(billableCount),
            },
          });
        }

        const invoice = await stripe.invoices.create({
          customer: stripeCustomerId,
          auto_advance: true,
          collection_method: 'charge_automatically',
          description: `Vidopick Pro${isFinalRun ? ' (final invoice)' : ''} — ${monthLabel}`,
          metadata: {
            organizationId: orgId,
            billingMonth: monthStart.toISOString().slice(0, 7),
            ...(isFinalRun ? { finalInvoice: 'true' } : {}),
          },
        });

        await stripe.invoices.finalizeInvoice(invoice.id);

        await orgDoc.ref.update({
          lastBilledAt: admin.firestore.FieldValue.serverTimestamp(),
          lastBilledCount: billableCount,
          lastBilledMonth: monthStart.toISOString().slice(0, 7),
          lastStripeInvoiceId: invoice.id,
          billingStatus: 'ok',
        });

        console.log(`[monthlyOrgBilling] org=${orgId} invoice=${invoice.id} finalized`);
      } catch (e) {
        console.error(`[monthlyOrgBilling] org=${orgId} Stripe error:`, e);
        // Still suspend if this is the final run, even if billing failed
      }

      if (isFinalRun) {
        await suspendOrg(db, orgId, orgDoc, orgName);
      }
    }

    console.log('[monthlyOrgBilling] done');
  }
);

/**
 * Suspend all sponsored users for an org, send push notifications, mark org cancelled.
 */
async function suspendOrg(
  db: admin.firestore.Firestore,
  orgId: string,
  orgDoc: admin.firestore.QueryDocumentSnapshot,
  orgName: string
): Promise<void> {
  const now = admin.firestore.Timestamp.now();
  const orgUsersSnap = await db.collection(`orgSponsors/${orgId}/users`).get();

  for (const orgUserDoc of orgUsersSnap.docs) {
    const uid = orgUserDoc.id;
    const periods: any[] = orgUserDoc.data().periods ?? [];
    const hasOpenPeriod = periods.some((p: any) => p.endedAt === null);
    if (!hasOpenPeriod) continue;

    const closedPeriods = periods.map((p: any) =>
      p.endedAt === null ? { ...p, endedAt: now } : p
    );
    await orgUserDoc.ref.update({ periods: closedPeriods, revokedAt: now, updatedAt: now });

    const userSnap = await db.doc(`users/${uid}`).get();
    if (!userSnap.exists) continue;
    const userData = userSnap.data()!;
    const remainingSponsors: string[] = (userData.sponsoredBy ?? []).filter(
      (id: string) => id !== orgId
    );

    await db.doc(`users/${uid}`).update({
      sponsoredBy: admin.firestore.FieldValue.arrayRemove(orgId),
      ...(remainingSponsors.length === 0 ? { proStatus: 'none', proType: null } : {}),
    });

    if (remainingSponsors.length === 0) {
      const deviceTokens: string[] = userData.deviceTokens ?? [];
      const notifTitle = 'Your Vidopick Pro access has ended';
      const notifBody = `${orgName} has stopped sponsoring Pro accounts. You can purchase your own Pro subscription to continue.`;
      await notifyUser(db, uid, deviceTokens, notifTitle, notifBody, {
        type: 'pro_suspended',
        organizationId: orgId,
      }).catch(() => {});
    }
  }

  await orgDoc.ref.update({
    isSponsoring: false,
    billingActive: false,
    cancelAtPeriodEnd: false,
    cancelAt: null,
    canceledAt: now,
  });

  console.log(`[monthlyOrgBilling] org=${orgId} suspended`);
}
