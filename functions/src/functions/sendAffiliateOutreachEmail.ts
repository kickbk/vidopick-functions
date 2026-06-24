import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { Resend } from 'resend';

if (!admin.apps.length) admin.initializeApp();

const RESEND_API_KEY = process.env.RESEND_API_KEY;

export const sendAffiliateOutreachEmail = onCall({ region: 'us-central1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in.');
  const token = request.auth.token as Record<string, unknown>;
  if (token.role !== 'admin') throw new HttpsError('permission-denied', 'Admin only.');

  const leadId = (request.data?.leadId ?? '').toString().trim();
  if (!leadId) throw new HttpsError('invalid-argument', 'leadId is required.');
  if (!RESEND_API_KEY) throw new HttpsError('internal', 'Email not configured.');

  const db = admin.firestore();
  const ref = db.doc(`outreach_affiliates/${leadId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Lead not found.');

  const lead = snap.data()!;
  if (lead.status !== 'approved') {
    throw new HttpsError(
      'failed-precondition',
      `Lead status is "${lead.status}", expected "approved".`
    );
  }
  if (!lead.email) {
    throw new HttpsError('failed-precondition', 'Lead has no email address.');
  }

  // Auto-generate activationToken if missing (old leads imported before this field was added)
  let activationToken = lead.activationToken as string | null;
  if (!activationToken) {
    const { randomUUID } = await import('crypto');
    activationToken = randomUUID();
    await ref.set({ activationToken }, { merge: true });
  }

  const activationLink = `https://vidopick.com/join/?t=${activationToken}`;
  const opening = (lead.openingLine as string | null) ?? null;

  const resend = new Resend(RESEND_API_KEY);
  let messageId: string | null = null;

  try {
    const result = await resend.emails.send({
      from: 'Ben Kass <affiliates@vidopick.com>',
      to: lead.email as string,
      subject: 'Partnering with you on Vidopick',
      html: buildOutreachEmail(lead.displayName as string, opening, activationLink),
    });

    if (result.error) throw new Error(result.error.message);
    messageId = result.data?.id ?? null;

    await ref.set(
      {
        status: 'sent',
        emailedAt: admin.firestore.FieldValue.serverTimestamp(),
        resendMessageId: messageId,
        lastError: null,
      },
      { merge: true }
    );
  } catch (err: any) {
    await ref.set(
      {
        status: 'send_failed',
        lastError: err?.message ?? 'Unknown error',
      },
      { merge: true }
    );
    throw new HttpsError('internal', `Send failed: ${err?.message}`);
  }

  return { sent: true, messageId };
});

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildOutreachEmail(displayName: string, opening: string | null, activationLink: string): string {
  const name = esc(displayName);
  const safeLink = esc(activationLink);
  const openingHtml = opening
    ? `<p style="font-size:15px;line-height:1.7;margin:0 0 16px">${esc(opening)}</p>`
    : '';

  return `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1e293b;background:#ffffff">

  <p style="font-size:15px;line-height:1.7;margin:0 0 16px">Hi ${name},</p>

  ${openingHtml}

  <p style="font-size:15px;line-height:1.7;margin:0 0 16px">I'm Ben, a dad of two and a software engineer. I got tired of YouTube's algorithm steering my kids into autoplay and random recommendations, so I built a video player where parents handpick exactly which playlists their kids can watch. Tapping into individual videos is disabled, so there's no rabbit hole. There's a library of 5,000+ vetted playlists across 50+ languages to choose from.</p>

  <p style="font-size:15px;line-height:1.7;margin:0 0 16px">The Pro tier is where it gets powerful for parents. It's a paid subscription with daily viewing-time limits, per-profile viewing stats, and the ability to share curated profiles with other parents.</p>

  <p style="font-size:15px;line-height:1.7;margin:0 0 16px">Everything you share tells me your followers would get Vidopick, which is why I'm inviting you to the affiliate program:</p>

  <ul style="font-size:15px;line-height:1.8;margin:0 0 16px;padding-left:20px">
    <li>Your followers get 20% off their first year</li>
    <li>You earn 25% recurring for 24 months on every signup</li>
    <li>Your own Vidopick page that earns you 10% on anyone who subscribes through it, passively</li>
    <li>Pro access the moment you're set up, so you can build the playlist profiles you'll actually share. Your recommendations, your invite.</li>
  </ul>

  <p style="font-size:15px;line-height:1.7;margin:0 0 16px">The recurring share is well beyond the one-time payouts most parenting brands offer, and the discount means you're handing your people a real deal, not a sales pitch.</p>

  <p style="font-size:15px;line-height:1.7;margin:0 0 8px">Your activation link is personal to you. Use it to set up your affiliate account, then log into Vidopick with the same email and Pro is already on, ready for you to build your first profile:</p>

  <p style="margin:0 0 32px">
    <a href="${safeLink}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:13px 24px;border-radius:9px;font-size:15px;font-weight:600">Set up your affiliate account →</a>
  </p>

  <p style="font-size:15px;line-height:1.7;margin:0 0 24px">Best,</p>

  <table cellpadding="0" cellspacing="0" border="0" style="font-family:Georgia,serif">
    <tr>
      <td style="padding-right:16px;vertical-align:middle">
        <a href="https://vidopick.com" style="display:block;text-decoration:none">
          <img src="https://vidopick.com/images/pro-xs.png" width="60" height="60" alt="Vidopick" style="display:block;border-radius:8px">
        </a>
      </td>
      <td style="border-left:2px solid #71b5da;padding-left:16px;vertical-align:middle">
        <div style="font-size:15px;font-weight:bold;color:#111111;margin-bottom:6px">Ben Kass</div>
        <div style="font-size:13px;margin-bottom:4px">
          <a href="https://vidopick.com/affiliates" style="color:#71b5da;text-decoration:none">Affiliate program details</a>
        </div>
        <div style="font-size:13px">
          <a href="https://calendly.com/vidopick/30min" style="color:#71b5da;text-decoration:none">Quick talk first? Grab 30 min</a>
        </div>
      </td>
    </tr>
  </table>

</div>
`;
}
