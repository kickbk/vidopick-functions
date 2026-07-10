import * as admin from 'firebase-admin';
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { Resend } from 'resend';

import {
  buildAccountDeletedEmail,
  buildOwnerAccountDeletedEmail,
  renderAccountDeletionLoadingPage,
} from '../utils/emailTemplates';
import { AccountDeletionError, performAccountDeletion } from '../utils/performAccountDeletion';

if (!admin.apps.length) admin.initializeApp();

const stripeSecretKey = defineSecret('STRIPE_SECRET_KEY');
const stripeSecretKeyTest = defineSecret('STRIPE_SECRET_KEY_TEST');

const NOTIFICATIONS_EMAIL = 'notifications@vidopick.com';

/**
 * Confirms an account-deletion request.
 *
 * GET  ?token=xxx  — serves a loading page; the page's JS calls POST to execute deletion.
 * POST body: { token: string } — executes deletion, returns JSON { state: 'success' | 'expired' | 'error' }.
 *
 * Token-authorized (works even when signed out / on another device). Deleting users/{uid}
 * makes every signed-in app instance log itself out via the profileSync listener.
 */
export const completeAccountDeletion = onRequest(
  {
    region: 'us-central1',
    memory: '512MiB',
    invoker: 'public',
    secrets: [stripeSecretKey, stripeSecretKeyTest],
  },
  async (req, res) => {
    // ── GET: serve the loading page immediately ──────────────────────────────
    if (req.method === 'GET') {
      const token = (req.query.token as string | undefined)?.trim() ?? '';
      res
        .status(200)
        .set('Content-Type', 'text/html; charset=utf-8')
        .send(renderAccountDeletionLoadingPage(token));
      return;
    }

    // ── POST: execute the deletion, return JSON ──────────────────────────────
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const body = req.body as { token?: string } | null;
    const token = (body?.token ?? '').trim();

    if (!token) {
      res.json({ state: 'expired' });
      return;
    }

    const db = admin.firestore();
    const tokenRef = db.doc(`accountDeletionTokens/${token}`);
    const tokenSnap = await tokenRef.get();
    if (!tokenSnap.exists) {
      res.json({ state: 'expired' });
      return;
    }

    const tokenData = tokenSnap.data()!;
    const expiresAt: admin.firestore.Timestamp | undefined = tokenData.expiresAt;
    if (!expiresAt || expiresAt.toMillis() < Date.now()) {
      res.json({ state: 'expired' });
      return;
    }

    const uid: string = tokenData.uid;
    const refundIfEligible: boolean = tokenData.refundIfEligible === true;

    // Gather the summary BEFORE teardown (the data is gone afterwards).
    const summary = await gatherSummary(db, uid, tokenData.email);

    try {
      await performAccountDeletion({
        uid,
        refundIfEligible,
        stripeSecretKey: stripeSecretKey.value(),
        stripeSecretKeyTest: stripeSecretKeyTest.value(),
      });
    } catch (err) {
      if (err instanceof AccountDeletionError) {
        console.error('[completeAccountDeletion] teardown aborted:', err.message);
        res.json({ state: 'error' });
        return;
      }
      throw err;
    }

    // Single-use — remove the token now that the account is gone.
    await tokenRef.delete().catch(() => {});

    // Emails are best-effort — never fail the response over them.
    await sendEmails(summary).catch((e) =>
      console.warn('[completeAccountDeletion] email send failed:', e)
    );

    console.log(`[completeAccountDeletion] deleted uid=${uid}`);
    res.json({ state: 'success' });
  }
);

interface DeletionSummary {
  name: string;
  email: string;
  uid: string;
  proType: string;
  proStatus: string;
  profileCount: number;
  isAffiliate: boolean;
  affiliateEarningsUsd?: string;
}

async function gatherSummary(
  db: admin.firestore.Firestore,
  uid: string,
  tokenEmail: string | undefined
): Promise<DeletionSummary> {
  const [userSnap, ownedProfilesSnap, affSnap, authUser] = await Promise.all([
    db.doc(`users/${uid}`).get(),
    db.collection('profiles').where('uid', '==', uid).count().get(),
    db.collection('affiliates').where('authUid', '==', uid).limit(1).get(),
    admin
      .auth()
      .getUser(uid)
      .catch(() => null),
  ]);

  const userData = userSnap.data() ?? {};
  const isAffiliate = !affSnap.empty;
  let affiliateEarningsUsd: string | undefined;
  if (isAffiliate) {
    const stats = (affSnap.docs[0].data()?.stats ?? {}) as {
      paidEarningsCents?: number;
      pendingEarningsCents?: number;
    };
    const cents = (stats.paidEarningsCents ?? 0) + (stats.pendingEarningsCents ?? 0);
    affiliateEarningsUsd = (cents / 100).toFixed(2);
  }

  return {
    name: (userData.name as string | undefined) ?? authUser?.displayName ?? '',
    email: authUser?.email ?? tokenEmail ?? '',
    uid,
    proType: (userData.proType as string | undefined) ?? 'none',
    proStatus: (userData.proStatus as string | undefined) ?? 'none',
    profileCount: ownedProfilesSnap.data().count,
    isAffiliate,
    affiliateEarningsUsd,
  };
}

async function sendEmails(summary: DeletionSummary): Promise<void> {
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) return;
  const resend = new Resend(resendApiKey);

  await resend.emails.send({
    from: 'Vidopick <noreply@vidopick.com>',
    to: NOTIFICATIONS_EMAIL,
    subject: `Account deleted — ${summary.email || summary.uid}`,
    html: buildOwnerAccountDeletedEmail(summary),
  });

  if (summary.email) {
    await resend.emails.send({
      from: 'Vidopick <noreply@vidopick.com>',
      to: summary.email,
      subject: 'Your Vidopick account has been deleted — hope to see you back',
      html: buildAccountDeletedEmail(summary.name),
    });
  }
}
