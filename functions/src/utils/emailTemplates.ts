const FONT_FACE = `
  @font-face {
    font-family: 'Vidopick';
    src: url('https://vidopick.com/fonts/Vidopick-Bold.ttf') format('truetype');
    font-weight: 700;
  }
`;

const LOGO_STYLE =
  "font-family:'Vidopick',Arial Black,sans-serif;font-size:36px;font-weight:700;color:#1d4ed8;letter-spacing:-0.5px;text-decoration:none;";

/**
 * Sent to a staff member when an admin invites them to manage their org on Vidopick.
 */
export function buildMemberInviteEmail(
  memberName: string,
  orgName: string,
  canApprovePro: boolean,
  signInLink: string,
): string {
  const year = new Date().getFullYear();
  const proLine = canApprovePro
    ? " You can also review and approve Pro account requests from families who want to subscribe to your invites."
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${orgName} invites you to Vidopick</title>
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
            <h1 style="margin:0 0 16px;font-size:26px;font-weight:700;color:#0f172a;line-height:1.3;">${orgName} invites you to Vidopick</h1>
            <p style="margin:0 0 8px;font-size:15px;color:#64748b;line-height:1.6;">Hi ${memberName},</p>
            <p style="margin:0 0 20px;font-size:15px;color:#334155;line-height:1.7;">
              Vidopick is a child-safe video player with parental controls. Parents use it to select safe, curated playlists for their children, free from unwanted and unapproved content. Organizations like <strong>${orgName}</strong> can share their own recommended playlists directly through the app.
            </p>
            <p style="margin:0 0 36px;font-size:15px;color:#334155;line-height:1.7;">
              As a staff member for <strong>${orgName}</strong>, you'll have access to the dashboard where you can create invite links with optionally embedded video playlists to share with families in your community.${proLine}
            </p>

            <table cellpadding="0" cellspacing="0" role="presentation" style="margin:0 auto 36px;">
              <tr>
                <td style="background-color:#1d4ed8;border-radius:10px;">
                  <a href="${signInLink}"
                     style="display:inline-block;padding:15px 36px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;letter-spacing:0.01em;white-space:nowrap;">
                    Open My Dashboard &rarr;
                  </a>
                </td>
              </tr>
            </table>

            <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 24px;" />

            <p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.6;">
              This link expires in 24 hours. If you weren't expecting this, you can safely ignore this email.
              For questions about your role, reach out to <strong>${orgName}</strong> directly. For help with Vidopick, visit
              <a href="https://vidopick.com/contact/" style="color:#94a3b8;">vidopick.com/contact</a>.
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

/**
 * Sent to an organization account when an admin invites them to Vidopick.
 */
export function buildInviteEmail(
  organizationName: string,
  signInLink: string,
): string {
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
            <p style="margin:0 0 8px;font-size:15px;color:#64748b;line-height:1.6;">Hi ${organizationName},</p>
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

export function buildDemoAccessEmail(
  recipientEmail: string,
  signInLink: string,
): string {
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
              Here's your one-click link to explore the Vidopick organization dashboard. You'll see a live demo account with real data.
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

export function buildAppMagicLinkEmail(signInLink: string): string {
  const year = new Date().getFullYear();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Sign in to Vidopick</title>
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
            <h1 style="margin:0 0 16px;font-size:26px;font-weight:700;color:#0f172a;line-height:1.3;">Your sign-in link</h1>
            <p style="margin:0 0 32px;font-size:15px;color:#334155;line-height:1.7;">
              Tap the button below to sign in to your Vidopick account. The link will open the Vidopick app directly.
            </p>

            <table cellpadding="0" cellspacing="0" role="presentation" style="margin:0 auto 32px;">
              <tr>
                <td style="background-color:#1d4ed8;border-radius:10px;">
                  <a href="${signInLink}"
                     style="display:inline-block;padding:15px 36px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;letter-spacing:0.01em;white-space:nowrap;">
                    Sign In to Vidopick &rarr;
                  </a>
                </td>
              </tr>
            </table>

            <p style="margin:0 0 20px;font-size:13px;color:#64748b;line-height:1.6;text-align:center;">
              Check your junk folder if you don't see it.
            </p>

            <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 20px;" />

            <p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.6;">
              This link expires in 1 hour and can only be used once. If you didn't request this, you can safely ignore this email.
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

export function buildMemberSubscriberNotificationEmail(
  memberName: string,
  subscriberName: string,
  subscriberEmail: string | undefined,
  organizationName: string,
  dashboardUrl: string,
): string {
  const year = new Date().getFullYear();
  const emailLine = subscriberEmail
    ? `<p style="margin:0 0 36px;font-size:14px;color:#64748b;line-height:1.6;">Their email: <strong>${subscriberEmail}</strong></p>`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>New Pro request for ${organizationName}</title>
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
            <h1 style="margin:0 0 16px;font-size:26px;font-weight:700;color:#0f172a;line-height:1.3;">New Pro request</h1>
            <p style="margin:0 0 8px;font-size:15px;color:#64748b;line-height:1.6;">Hi ${memberName},</p>
            <p style="margin:0 0 8px;font-size:15px;color:#334155;line-height:1.7;">
              <strong>${subscriberName}</strong> has requested a Pro account sponsored by ${organizationName}. Visit your dashboard to approve or decline their request.
            </p>
            ${emailLine}

            <table cellpadding="0" cellspacing="0" role="presentation" style="margin:0 auto 36px;">
              <tr>
                <td style="background-color:#1d4ed8;border-radius:10px;">
                  <a href="${dashboardUrl}"
                     style="display:inline-block;padding:15px 36px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;letter-spacing:0.01em;white-space:nowrap;">
                    Review Request &rarr;
                  </a>
                </td>
              </tr>
            </table>

            <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 24px;" />

            <p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.6;">
              You received this email because you manage an invite for ${organizationName} on Vidopick.
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

export function buildOrgSubscriberNotificationEmail(
  orgName: string,
  subscriberName: string,
  subscriberEmail: string | undefined,
  dashboardUrl: string,
): string {
  const year = new Date().getFullYear();
  const emailLine = subscriberEmail
    ? `<p style="margin:0 0 36px;font-size:14px;color:#64748b;line-height:1.6;">Their email: <strong>${subscriberEmail}</strong></p>`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>New Pro request for ${orgName}</title>
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
            <h1 style="margin:0 0 16px;font-size:26px;font-weight:700;color:#0f172a;line-height:1.3;">New Pro request</h1>
            <p style="margin:0 0 8px;font-size:15px;color:#334155;line-height:1.7;">
              <strong>${subscriberName}</strong> has requested a sponsored Pro account from ${orgName} on Vidopick. Visit your dashboard to approve or decline.
            </p>
            ${emailLine}

            <table cellpadding="0" cellspacing="0" role="presentation" style="margin:0 auto 36px;">
              <tr>
                <td style="background-color:#1d4ed8;border-radius:10px;">
                  <a href="${dashboardUrl}"
                     style="display:inline-block;padding:15px 36px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;letter-spacing:0.01em;white-space:nowrap;">
                    Review Request &rarr;
                  </a>
                </td>
              </tr>
            </table>

            <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 24px;" />

            <p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.6;">
              You received this email because your organization sponsors Pro accounts on Vidopick.
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

export function buildProApprovalEmail(
  displayName: string,
  orgName: string,
): string {
  const year = new Date().getFullYear();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Your Vidopick Pro account is ready</title>
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
            <h1 style="margin:0 0 16px;font-size:26px;font-weight:700;color:#0f172a;line-height:1.3;">You have Vidopick Pro!</h1>
            <p style="margin:0 0 8px;font-size:15px;color:#64748b;line-height:1.6;">Hi ${displayName},</p>
            <p style="margin:0 0 36px;font-size:15px;color:#334155;line-height:1.7;">
              <strong>${orgName}</strong> has approved your request. Your Vidopick Pro account is now active. Open the app to enjoy it.
            </p>

            <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 24px;" />

            <p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.6;">
              You received this email because you requested a sponsored Pro account on Vidopick.
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

export function buildProDeclinedEmail(
  displayName: string,
  orgName: string,
): string {
  const year = new Date().getFullYear();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Your Vidopick Pro request</title>
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
            <h1 style="margin:0 0 16px;font-size:26px;font-weight:700;color:#0f172a;line-height:1.3;">Request not approved</h1>
            <p style="margin:0 0 8px;font-size:15px;color:#64748b;line-height:1.6;">Hi ${displayName},</p>
            <p style="margin:0 0 36px;font-size:15px;color:#334155;line-height:1.7;">
              <strong>${orgName}</strong> wasn't able to approve your Vidopick Pro request at this time. You can scan their invite link again to re-apply, or get Pro directly from the app.
            </p>

            <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 24px;" />

            <p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.6;">
              You received this email because you requested a sponsored Pro account on Vidopick.
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

/**
 * Sent when an organization revokes a user's sponsored Pro membership.
 *
 * @param displayName   - user's name as stored in the revoking org's identities
 * @param revokedOrgName - the org that removed them
 * @param remainingOrgNames - names of orgs that still sponsor them (empty = fully lost Pro)
 */
/**
 * Sent to the org admin and/or member when a user withdraws their own pending Pro request.
 */
export function buildSponsorshipCancelledEmail(
  recipientName: string,
  subscriberName: string,
  orgName: string,
  dashboardUrl: string,
): string {
  const year = new Date().getFullYear();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Pro request cancelled — ${orgName}</title>
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
            <h1 style="margin:0 0 16px;font-size:26px;font-weight:700;color:#0f172a;line-height:1.3;">Pro request cancelled</h1>
            <p style="margin:0 0 8px;font-size:15px;color:#64748b;line-height:1.6;">Hi ${recipientName},</p>
            <p style="margin:0 0 36px;font-size:15px;color:#334155;line-height:1.7;">
              <strong>${subscriberName}</strong> has withdrawn their request for a Pro account sponsored by ${orgName}.
              No action is needed. Their request has been removed from your queue.
            </p>

            <table cellpadding="0" cellspacing="0" role="presentation" style="margin:0 auto 36px;">
              <tr>
                <td style="background-color:#1d4ed8;border-radius:10px;">
                  <a href="${dashboardUrl}"
                     style="display:inline-block;padding:15px 36px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;letter-spacing:0.01em;white-space:nowrap;">
                    View Dashboard →
                  </a>
                </td>
              </tr>
            </table>

            <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 24px;" />

            <p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.6;">
              You received this email because you manage Pro sponsorships for ${orgName} on Vidopick.
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

export function buildProRevokedEmail(
  displayName: string,
  revokedOrgName: string,
  remainingOrgNames: string[],
): string {
  const year = new Date().getFullYear();

  const stillCovered = remainingOrgNames.length > 0;
  const remainingList =
    remainingOrgNames.length === 1
      ? `<strong>${remainingOrgNames[0]}</strong>`
      : remainingOrgNames
          .map((n, i) =>
            i < remainingOrgNames.length - 1
              ? `<strong>${n}</strong>`
              : `and <strong>${n}</strong>`,
          )
          .join(", ");

  const bodyParagraph = stillCovered
    ? `However, your Pro membership is still covered by ${remainingList}. You can keep enjoying all Pro features in the app.`
    : `You can continue enjoying Vidopick Pro with your own subscription — open the app and tap <strong>Account</strong> to get started.`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Update on your Vidopick Pro membership</title>
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
            <h1 style="margin:0 0 16px;font-size:26px;font-weight:700;color:#0f172a;line-height:1.3;">
              ${stillCovered ? "A change to your Pro membership" : "Your Pro membership has ended"}
            </h1>
            <p style="margin:0 0 8px;font-size:15px;color:#64748b;line-height:1.6;">Hi ${displayName},</p>
            <p style="margin:0 0 16px;font-size:15px;color:#334155;line-height:1.7;">
              <strong>${revokedOrgName}</strong> no longer sponsors your Vidopick Pro membership.
            </p>
            <p style="margin:0 0 36px;font-size:15px;color:#334155;line-height:1.7;">
              ${bodyParagraph}
            </p>

            <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 24px;" />

            <p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.6;">
              You received this email because you had a sponsored Pro account on Vidopick.
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
