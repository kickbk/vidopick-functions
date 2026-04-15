import * as nodemailer from "nodemailer";

const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
const SENDER_EMAIL = "vidopickhelp@gmail.com";
const NOTIFY_EMAIL = "vidopick@gmail.com";

/**
 * Sends a demo session notification to vidopick@gmail.com via Gmail SMTP.
 * Fire-and-forget — errors are logged but never thrown.
 */
export async function sendDemoNotification(
  recipientEmail: string | null,
  event: "requested" | "started" = "started",
): Promise<void> {
  if (!GMAIL_APP_PASSWORD) {
    console.warn("sendDemoNotification: GMAIL_APP_PASSWORD not set, skipping");
    return;
  }

  const who = recipientEmail || "(unknown)";
  const when = new Date().toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    dateStyle: "medium",
    timeStyle: "short",
  });

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: SENDER_EMAIL,
      pass: GMAIL_APP_PASSWORD,
    },
  });

  try {
    await transporter.sendMail({
      from: `"Vidopick Notifications" <${SENDER_EMAIL}>`,
      to: NOTIFY_EMAIL,
      subject: `Demo ${event === "requested" ? "invite requested" : "session started"} — ${who}`,
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
    console.log(
      `sendDemoNotification: notified ${NOTIFY_EMAIL} (demo user: ${who})`,
    );
  } catch (err: any) {
    console.error("sendDemoNotification: failed to send email:", err.message);
  }
}
