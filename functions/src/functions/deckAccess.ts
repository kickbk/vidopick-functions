import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { onCall, HttpsError, onRequest } from 'firebase-functions/v2/https';
import { Resend } from 'resend';
import { randomUUID } from 'crypto';

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const DECK_URL = 'https://vidopick.com/investor/';
const FUNCTIONS_BASE = 'https://us-central1-vidopick-c725d.cloudfunctions.net';
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

const ALLOWED_ORIGINS = new Set([
  'https://vidopick.com',
  'http://localhost:5173',
  'http://localhost:4173',
]);

function sanitizeOrigin(raw: string | undefined): string {
  if (raw && ALLOWED_ORIGINS.has(raw)) return raw;
  return 'https://vidopick.com';
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function createDeckToken(email: string, name?: string): Promise<string> {
  const token = randomUUID();
  await getFirestore()
    .doc(`deckTokens/${token}`)
    .set({
      email: email.toLowerCase(),
      ...(name ? { name } : {}),
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: Timestamp.fromDate(new Date(Date.now() + TOKEN_TTL_MS)),
      used: false,
    });
  return token;
}

// ─── submitDeckRequest ────────────────────────────────────────────────────────
// Public form submission. Saves the request, notifies ben@ with an Approve button.
export const submitDeckRequest = onCall(
  { region: 'us-central1', invoker: 'public' },
  async (request) => {
    const name = ((request.data?.name as string) ?? '').trim();
    const email = ((request.data?.email as string) ?? '').trim().toLowerCase();
    const message = ((request.data?.message as string) ?? '').trim();

    if (!name) throw new HttpsError('invalid-argument', 'Name required.');
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new HttpsError('invalid-argument', 'Valid email required.');
    }
    if (!message) throw new HttpsError('invalid-argument', 'Message required.');
    if (!RESEND_API_KEY) throw new HttpsError('internal', 'Email not configured.');

    const approvalToken = randomUUID();
    const origin = sanitizeOrigin(request.rawRequest.headers.origin as string | undefined);

    const ref = await getFirestore().collection('deckAccessRequests').add({
      name,
      email,
      message,
      origin,
      requestedAt: FieldValue.serverTimestamp(),
      status: 'pending',
      approvalToken,
    });

    const approveUrl = `${FUNCTIONS_BASE}/approveDeckRequest?id=${ref.id}&token=${approvalToken}`;

    const resend = new Resend(RESEND_API_KEY);
    await resend.emails.send({
      from: 'Vidopick <ben@vidopick.com>',
      to: 'ben@vidopick.com',
      replyTo: email,
      subject: `Deck access request from ${esc(name)} (${esc(email)})`,
      html: buildAdminNotificationEmail(name, email, message, approveUrl),
    });

    return { ok: true };
  }
);

// ─── approveDeckRequest ───────────────────────────────────────────────────────
// You click the Approve button in the notification email.
// Generates a one-time deck token and emails it to the investor.
export const approveDeckRequest = onRequest(
  { region: 'us-central1', invoker: 'public' },
  async (req, res) => {
    const id = (req.query.id as string) ?? '';
    const token = (req.query.token as string) ?? '';

    if (!id || !token) {
      res.status(400).send(htmlPage('Bad request', 'Missing id or token.'));
      return;
    }

    const ref = getFirestore().doc(`deckAccessRequests/${id}`);
    const snap = await ref.get();

    if (!snap.exists) {
      res.status(404).send(htmlPage('Not found', 'This request does not exist.'));
      return;
    }

    const data = snap.data()!;

    if (data.approvalToken !== token) {
      res.status(403).send(htmlPage('Forbidden', 'Invalid approval token.'));
      return;
    }

    if (data.status === 'approved') {
      res.send(htmlPage('Already approved', `A link was already sent to ${esc(data.email)}.`));
      return;
    }

    if (!RESEND_API_KEY) {
      res.status(500).send(htmlPage('Error', 'Email not configured.'));
      return;
    }

    try {
      const deckToken = await createDeckToken(data.email);
      const baseUrl = data.origin ? `${data.origin}/investor/` : DECK_URL;
      const link = `${baseUrl}?token=${deckToken}`;

      const resend = new Resend(RESEND_API_KEY);
      await resend.emails.send({
        from: 'Vidopick <noreply@vidopick.com>',
        to: data.email,
        subject: 'Your link to the Vidopick investor deck',
        html: buildDeckLinkEmail(link, data.name as string | undefined),
      });

      await ref.update({
        status: 'approved',
        approvedAt: FieldValue.serverTimestamp(),
      });

      res.send(htmlPage('Done', `Link sent to ${esc(data.email)}.`));
    } catch (e: any) {
      res.status(500).send(htmlPage('Error', e?.message ?? 'Something went wrong.'));
    }
  }
);

// ─── validateDeckToken ────────────────────────────────────────────────────────
// Called when the investor page loads with ?token= in the URL.
export const validateDeckToken = onCall(
  { region: 'us-central1', invoker: 'public' },
  async (request) => {
    const token = ((request.data?.token as string) ?? '').trim();
    if (!token) throw new HttpsError('invalid-argument', 'Token required.');

    const ref = getFirestore().doc(`deckTokens/${token}`);
    const snap = await ref.get();

    if (!snap.exists) throw new HttpsError('not-found', 'Invalid link.');

    const data = snap.data()!;
    if (data.used) throw new HttpsError('failed-precondition', 'This link has already been used.');

    const expiresAt = (data.expiresAt as Timestamp).toDate();
    if (expiresAt < new Date()) throw new HttpsError('deadline-exceeded', 'This link has expired.');

    await ref.update({ used: true, usedAt: FieldValue.serverTimestamp() });

    return { ok: true, email: data.email as string };
  }
);

// ─── generateDeckLink (admin CLI) ─────────────────────────────────────────────
export const generateDeckLink = onRequest(
  { region: 'us-central1', invoker: 'public' },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).send('Method not allowed');
      return;
    }

    const adminSecret = process.env.DECK_ADMIN_SECRET;
    if (!adminSecret || req.headers.authorization !== `Bearer ${adminSecret}`) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const name = ((req.body?.name as string) ?? '').trim();
    const email = ((req.body?.email as string) ?? '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: 'Valid email required.' });
      return;
    }

    const token = await createDeckToken(email, name || undefined);
    const link = `${DECK_URL}?token=${token}`;

    if (name && RESEND_API_KEY) {
      const resend = new Resend(RESEND_API_KEY);
      await resend.emails.send({
        from: 'Vidopick <noreply@vidopick.com>',
        to: email,
        subject: 'Your link to the Vidopick investor deck',
        html: buildDeckLinkEmail(link, name),
      });
      res.json({ sent: true, email });
    } else {
      res.json({ url: link });
    }
  }
);

// ─── Email templates ──────────────────────────────────────────────────────────

function buildAdminNotificationEmail(
  name: string,
  email: string,
  message: string,
  approveUrl: string
): string {
  return `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1e293b;max-width:520px">
  <p style="font-size:15px;margin:0 0 4px">
    <strong>From:</strong> ${esc(name)}
  </p>
  <p style="font-size:15px;margin:0 0 6px;color:#64748b">${esc(email)}</p>
  <p style="font-size:15px;line-height:1.6;background:#f8fafc;border-left:3px solid #1565c0;
            padding:12px 16px;border-radius:4px;margin:0 0 28px">${esc(message)}</p>
  <a href="${esc(approveUrl)}"
     style="display:inline-block;background:#062f4b;color:#ffffff;text-decoration:none;
            padding:13px 26px;border-radius:9px;font-size:15px;font-weight:600">
    Approve and send link &rarr;
  </a>
  <p style="font-size:12px;color:#94a3b8;margin-top:24px">
    Clicking this button will immediately email a one-time access investor resources link to ${esc(email)}.
  </p>
</div>`;
}

function buildDeckLinkEmail(link: string, name?: string): string {
  const greeting = name ? `Hi ${esc(name)},` : 'Hi,';
  return `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1e293b;max-width:520px">
  <p style="font-size:15px;line-height:1.7;margin:0 0 16px">${greeting}</p>
  <p style="font-size:15px;line-height:1.7;margin:0 0 24px">
    Here is your link to the Vidopick investor pitch deck and business plan. It works once and expires in 24 hours.
  </p>
  <p style="margin:0 0 32px">
    <a href="${esc(link)}"
       style="display:inline-block;background:#062f4b;color:#ffffff;text-decoration:none;
              padding:13px 26px;border-radius:9px;font-size:15px;font-weight:600">
      View resources &rarr;
    </a>
  </p>
  <p style="font-size:13px;color:#64748b;margin:0">
    If you did not request this, you can safely ignore it.
  </p>
</div>`;
}

function htmlPage(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="UTF-8">
<title>${esc(title)}</title>
<style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;
min-height:100vh;margin:0;background:#f8fafc;color:#1e293b}
.box{text-align:center;max-width:360px;padding:40px}</style>
</head><body><div class="box">
<p style="font-size:32px;margin:0 0 16px">✓</p>
<h1 style="font-size:20px;margin:0 0 10px">${esc(title)}</h1>
<p style="color:#64748b;margin:0">${esc(body)}</p>
</div></body></html>`;
}
