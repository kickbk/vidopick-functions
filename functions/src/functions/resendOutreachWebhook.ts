import * as admin from 'firebase-admin';
import { onRequest } from 'firebase-functions/v2/https';
import { Webhook } from 'svix';

if (!admin.apps.length) admin.initializeApp();

const RESEND_WEBHOOK_SECRET = process.env.RESEND_WEBHOOK_SECRET;

const STATUS_TRANSITIONS: Record<string, string> = {
  'email.delivered': 'delivered',
  'email.delivery_delayed': 'delayed',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
  'email.failed': 'failed',
};

// Monotonic precedence: a webhook only moves the lead forward, never backward, so
// out-of-order events (a late 'delayed' after 'delivered', a stray delivery event
// after a call was 'booked') can't clobber a more final state. Statuses not listed
// (e.g. 'approved') rank below 'sent' so any real delivery status supersedes them.
const STATUS_RANK: Record<string, number> = {
  sent: 0,
  delayed: 1,
  delivered: 2,
  bounced: 3,
  complained: 3,
  failed: 3,
  booked: 4,
};

export const resendOutreachWebhook = onRequest(
  { region: 'us-central1', timeoutSeconds: 15, memory: '256MiB', invoker: 'public' },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    if (!RESEND_WEBHOOK_SECRET) {
      console.error('[resendOutreachWebhook] RESEND_WEBHOOK_SECRET not configured');
      res.status(500).json({ error: 'Webhook not configured' });
      return;
    }

    // Verify Resend signature via svix
    try {
      const wh = new Webhook(RESEND_WEBHOOK_SECRET);
      const rawBody = (req as any).rawBody?.toString('utf8') ?? JSON.stringify(req.body);
      wh.verify(rawBody, {
        'svix-id': req.headers['svix-id'] as string,
        'svix-timestamp': req.headers['svix-timestamp'] as string,
        'svix-signature': req.headers['svix-signature'] as string,
      });
    } catch (err: any) {
      console.warn('[resendOutreachWebhook] signature verification failed:', err?.message);
      res.status(400).json({ error: 'Invalid signature' });
      return;
    }

    const event = req.body as { type: string; data: { email_id: string } };
    const newStatus = STATUS_TRANSITIONS[event.type];
    if (!newStatus) {
      res.status(200).json({ ignored: true });
      return;
    }

    const messageId = event.data?.email_id;
    if (!messageId) {
      res.status(400).json({ error: 'Missing email_id' });
      return;
    }

    const db = admin.firestore();
    const snap = await db
      .collection('affiliatesOutreach')
      .where('resendMessageId', '==', messageId)
      .limit(1)
      .get();

    if (snap.empty) {
      console.warn(`[resendOutreachWebhook] no lead found for messageId=${messageId}`);
      res.status(200).json({ notFound: true });
      return;
    }

    const docRef = snap.docs[0].ref;
    const currentStatus = snap.docs[0].data().status as string;

    // Only advance forward — never downgrade an already more-final status.
    if ((STATUS_RANK[newStatus] ?? 0) <= (STATUS_RANK[currentStatus] ?? -1)) {
      res
        .status(200)
        .json({ skipped: true, reason: `status ${currentStatus} not downgraded to ${newStatus}` });
      return;
    }

    await docRef.set({ status: newStatus }, { merge: true });
    console.log(`[resendOutreachWebhook] ${snap.docs[0].id} → ${newStatus}`);
    res.status(200).json({ updated: true });
  }
);
