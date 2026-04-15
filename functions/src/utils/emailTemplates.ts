const FONT_FACE = `
  @font-face {
    font-family: 'Vidopick';
    src: url('https://vidopick.com/fonts/Vidopick-Bold.ttf') format('truetype');
    font-weight: 700;
  }
`;

const LOGO_STYLE =
  "font-family:'Vidopick',Arial Black,sans-serif;font-size:36px;font-weight:700;color:#1d4ed8;letter-spacing:-0.5px;text-decoration:none;";

export function buildInviteEmail(advertiserName: string, signInLink: string): string {
  const year = new Date().getFullYear();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Welcome to Vidopick</title>
  <style>${FONT_FACE}</style>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#f1f5f9;padding:48px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:560px;width:100%;">

        <tr>
          <td style="padding-bottom:32px;text-align:center;">
            <span style="${LOGO_STYLE}">Vidopick</span>
          </td>
        </tr>

        <tr>
          <td style="background:#ffffff;border-radius:16px;padding:48px 40px;box-shadow:0 4px 6px -1px rgba(0,0,0,0.07),0 2px 4px -1px rgba(0,0,0,0.04);">
            <h1 style="margin:0 0 16px;font-size:26px;font-weight:700;color:#0f172a;line-height:1.3;">Welcome to Vidopick</h1>
            <p style="margin:0 0 8px;font-size:15px;color:#64748b;line-height:1.6;">Hi ${advertiserName},</p>
            <p style="margin:0 0 36px;font-size:15px;color:#334155;line-height:1.7;">
              Your advertising account on Vidopick is ready. Click the button below to access your dashboard and start managing your campaigns.
            </p>

            <table cellpadding="0" cellspacing="0" role="presentation" style="margin:0 auto 36px;">
              <tr>
                <td style="background-color:#1d4ed8;border-radius:10px;">
                  <a href="${signInLink}"
                     style="display:inline-block;padding:15px 36px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;letter-spacing:0.01em;white-space:nowrap;">
                    Access My Account &rarr;
                  </a>
                </td>
              </tr>
            </table>

            <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 24px;" />

            <p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.6;">
              This link expires in 24 hours. If you weren't expecting this invitation, you can safely ignore this email.
              Need help? Reply to this email and we'll get back to you.
            </p>
          </td>
        </tr>

        <tr>
          <td style="padding-top:24px;text-align:center;">
            <p style="margin:0;font-size:12px;color:#94a3b8;">
              &copy; ${year} Vidopick &middot;
              <a href="https://vidopick.com" style="color:#94a3b8;text-decoration:underline;">vidopick.com</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function buildDemoAccessEmail(recipientEmail: string, signInLink: string): string {
  const year = new Date().getFullYear();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Your Vidopick Demo Access</title>
  <style>${FONT_FACE}</style>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#f1f5f9;padding:48px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:560px;width:100%;">

        <tr>
          <td style="padding-bottom:32px;text-align:center;">
            <span style="${LOGO_STYLE}">Vidopick</span>
          </td>
        </tr>

        <tr>
          <td style="background:#ffffff;border-radius:16px;padding:48px 40px;box-shadow:0 4px 6px -1px rgba(0,0,0,0.07),0 2px 4px -1px rgba(0,0,0,0.04);">
            <h1 style="margin:0 0 24px;font-size:26px;font-weight:700;color:#0f172a;line-height:1.3;">Your demo access link</h1>
            <p style="margin:0 0 16px;font-size:15px;color:#334155;line-height:1.7;">
              Here's your one-click link to explore the Vidopick advertiser dashboard. You'll see a live demo account with real data.
            </p>
            <p style="margin:0 0 36px;font-size:14px;color:#64748b;line-height:1.6;">
              The demo session lasts 15 minutes and is exclusive — only one person can use it at a time.
            </p>

            <table cellpadding="0" cellspacing="0" role="presentation" style="margin:0 auto 36px;">
              <tr>
                <td style="background-color:#1d4ed8;border-radius:10px;">
                  <a href="${signInLink}"
                     style="display:inline-block;padding:15px 36px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;letter-spacing:0.01em;white-space:nowrap;">
                    Open Demo Dashboard &rarr;
                  </a>
                </td>
              </tr>
            </table>

            <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 24px;" />

            <p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.6;">
              This link expires in 1 hour. Sent to ${recipientEmail} at your request.
              If you didn't request this, you can safely ignore this email.
            </p>
          </td>
        </tr>

        <tr>
          <td style="padding-top:24px;text-align:center;">
            <p style="margin:0;font-size:12px;color:#94a3b8;">
              &copy; ${year} Vidopick &middot;
              <a href="https://vidopick.com" style="color:#94a3b8;text-decoration:underline;">vidopick.com</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function buildSignInEmail(signInLink: string): string {
  const year = new Date().getFullYear();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Your Vidopick sign-in link</title>
  <style>${FONT_FACE}</style>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#f1f5f9;padding:48px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:560px;width:100%;">

        <tr>
          <td style="padding-bottom:32px;text-align:center;">
            <span style="${LOGO_STYLE}">Vidopick</span>
          </td>
        </tr>

        <tr>
          <td style="background:#ffffff;border-radius:16px;padding:48px 40px;box-shadow:0 4px 6px -1px rgba(0,0,0,0.07),0 2px 4px -1px rgba(0,0,0,0.04);">
            <h1 style="margin:0 0 24px;font-size:26px;font-weight:700;color:#0f172a;line-height:1.3;">Your sign-in link</h1>
            <p style="margin:0 0 36px;font-size:15px;color:#334155;line-height:1.7;">
              Click the button below to sign in to your Vidopick account. This link can only be used once.
            </p>

            <table cellpadding="0" cellspacing="0" role="presentation" style="margin:0 auto 36px;">
              <tr>
                <td style="background-color:#1d4ed8;border-radius:10px;">
                  <a href="${signInLink}"
                     style="display:inline-block;padding:15px 36px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;letter-spacing:0.01em;white-space:nowrap;">
                    Sign In to Vidopick &rarr;
                  </a>
                </td>
              </tr>
            </table>

            <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 24px;" />

            <p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.6;">
              This link expires in 1 hour. If you didn't request this, you can safely ignore this email.
            </p>
          </td>
        </tr>

        <tr>
          <td style="padding-top:24px;text-align:center;">
            <p style="margin:0;font-size:12px;color:#94a3b8;">
              &copy; ${year} Vidopick &middot;
              <a href="https://vidopick.com" style="color:#94a3b8;text-decoration:underline;">vidopick.com</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
