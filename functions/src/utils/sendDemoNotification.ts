import { Resend } from 'resend';

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const NOTIFY_EMAIL = 'support@vidopick.com';

/**
 * Sends a demo session notification to noreply@vidopick.com via Resend.
 * Fire-and-forget — errors are logged but never thrown.
 */
export async function sendDemoNotification(
  recipientEmail: string | null,
  event: 'requested' | 'started' = 'started'
): Promise<void> {
  if (!RESEND_API_KEY) {
    console.warn('[email] RESEND_API_KEY not set, skipping');
    return;
  }

  const who = recipientEmail || '(unknown)';
  const when = new Date().toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const resend = new Resend(RESEND_API_KEY);
  try {
    await resend.emails.send({
      from: 'Vidopick <noreply@vidopick.com>',
      to: NOTIFY_EMAIL,
      subject: `Demo ${event === 'requested' ? 'invite requested' : 'session started'} — ${who}`,
      html: `
        <p style="font-family:sans-serif;font-size:15px;color:#111;">${event === 'requested' ? 'Someone requested demo access.' : 'A demo session was just started.'}</p>
        <table style="font-family:sans-serif;font-size:14px;border-collapse:collapse;">
          <tr>
            <td style="padding:4px 16px 4px 0;color:#6b7280;">Email</td>
            <td><strong>${who}</strong></td>
          </tr>
          <tr>
            <td style="padding:4px 16px 4px 0;color:#6b7280;">Time</td>
            <td>${when} PT</td>
          </tr>
        </table>
      `,
    });
    console.log(`sendDemoNotification: notified ${NOTIFY_EMAIL} (demo user: ${who})`);
  } catch (err: any) {
    console.error('sendDemoNotification: failed to send email:', err.message);
  }
}
