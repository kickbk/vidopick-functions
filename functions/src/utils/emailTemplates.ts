function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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
  signInLink: string
): string {
  const year = new Date().getFullYear();
  const proLine = canApprovePro
    ? ' You can also review and approve Pro account requests from families who want to subscribe to your invites.'
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(orgName)} invites you to Vidopick</title>
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
            <h1 style="margin:0 0 16px;font-size:26px;font-weight:700;color:#0f172a;line-height:1.3;">${esc(orgName)} invites you to Vidopick</h1>
            <p style="margin:0 0 8px;font-size:15px;color:#64748b;line-height:1.6;">Hi ${esc(memberName)},</p>
            <p style="margin:0 0 20px;font-size:15px;color:#334155;line-height:1.7;">
              Vidopick is a child-safe video player with parental controls. Parents use it to select safe, curated playlists for their children, free from unwanted and unapproved content. Organizations like <strong>${esc(orgName)}</strong> can share their own recommended playlists directly through the app.
            </p>
            <p style="margin:0 0 36px;font-size:15px;color:#334155;line-height:1.7;">
              As a staff member for <strong>${esc(orgName)}</strong>, you'll have access to the dashboard where you can create invite links with optionally embedded video playlists to share with families in your community.${proLine}
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
              For questions about your role, reach out to <strong>${esc(orgName)}</strong> directly. For help with Vidopick, visit
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
export function buildInviteEmail(organizationName: string, signInLink: string): string {
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
            <p style="margin:0 0 8px;font-size:15px;color:#64748b;line-height:1.6;">Hi ${esc(organizationName)},</p>
            <p style="margin:0 0 36px;font-size:15px;color:#334155;line-height:1.7;">
              Your organization account on Vidopick is ready. Click the button below to access your dashboard and start managing your campaigns.
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
              Here's your one-click link to explore the Vidopick organization dashboard. You'll see a live demo account with real data.
            </p>
            <p style="margin:0 0 36px;font-size:14px;color:#64748b;line-height:1.6;">
              The demo session lasts 15 minutes and is exclusive. Only one person can use it at a time.
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
              This link expires in 1 hour. Sent to ${esc(recipientEmail)} at your request.
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

export function buildEmailChangeNotificationEmail(
  oldEmail: string,
  newEmail: string,
  revertLink: string
): string {
  const year = new Date().getFullYear();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Your Vidopick email address was changed</title>
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
            <h1 style="margin:0 0 16px;font-size:26px;font-weight:700;color:#0f172a;line-height:1.3;">Your email address was changed</h1>
            <p style="margin:0 0 20px;font-size:15px;color:#334155;line-height:1.7;">
              The email address on your Vidopick account was updated from
              <strong>${esc(oldEmail)}</strong> to <strong>${esc(newEmail)}</strong>.
            </p>
            <p style="margin:0 0 32px;font-size:15px;color:#334155;line-height:1.7;">
              If you made this change, you don't need to do anything. If you didn't, tap the button
              below to revert to <strong>${esc(oldEmail)}</strong> immediately.
            </p>

            <table cellpadding="0" cellspacing="0" role="presentation" style="margin:0 auto 32px;">
              <tr>
                <td style="background-color:#dc2626;border-radius:10px;">
                  <a href="${revertLink}"
                     style="display:inline-block;padding:15px 36px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;letter-spacing:0.01em;white-space:nowrap;">
                    Revert email change &rarr;
                  </a>
                </td>
              </tr>
            </table>

            <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 20px;" />

            <p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.6;">
              This revert link expires in 7 days. After that, contact us at
              <a href="mailto:support@vidopick.com" style="color:#94a3b8;">support@vidopick.com</a>
              if you need help recovering your account.
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

export function buildEmailUpdateEmail(
  currentEmail: string,
  newEmail: string,
  verifyLink: string
): string {
  const year = new Date().getFullYear();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Confirm your new Vidopick email address</title>
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
            <h1 style="margin:0 0 16px;font-size:26px;font-weight:700;color:#0f172a;line-height:1.3;">Confirm your new email address</h1>
            <p style="margin:0 0 20px;font-size:15px;color:#334155;line-height:1.7;">
              You asked to change your Vidopick email from
              <strong>${esc(currentEmail)}</strong> to
              <strong>${esc(newEmail)}</strong>.
              Tap the button below to confirm — your address won't change until you do.
            </p>

            <table cellpadding="0" cellspacing="0" role="presentation" style="margin:0 auto 32px;">
              <tr>
                <td style="background-color:#1d4ed8;border-radius:10px;">
                  <a href="${verifyLink}"
                     style="display:inline-block;padding:15px 36px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;letter-spacing:0.01em;white-space:nowrap;">
                    Confirm new email &rarr;
                  </a>
                </td>
              </tr>
            </table>

            <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 20px;" />

            <p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.6;">
              This link expires in 1 hour. If you didn't request this change, you can safely ignore this email — your address will stay as <strong>${esc(currentEmail)}</strong>.
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
  dashboardUrl: string
): string {
  const year = new Date().getFullYear();
  const emailLine = subscriberEmail
    ? `<p style="margin:0 0 36px;font-size:14px;color:#64748b;line-height:1.6;">Their email: <strong>${esc(subscriberEmail)}</strong></p>`
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>New Pro request for ${esc(organizationName)}</title>
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
            <p style="margin:0 0 8px;font-size:15px;color:#64748b;line-height:1.6;">Hi ${esc(memberName)},</p>
            <p style="margin:0 0 8px;font-size:15px;color:#334155;line-height:1.7;">
              <strong>${esc(subscriberName)}</strong> has requested a Pro account sponsored by ${esc(organizationName)}. Visit your dashboard to approve or decline their request.
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
              You received this email because you manage an invite for ${esc(organizationName)} on Vidopick.
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
  dashboardUrl: string
): string {
  const year = new Date().getFullYear();
  const emailLine = subscriberEmail
    ? `<p style="margin:0 0 36px;font-size:14px;color:#64748b;line-height:1.6;">Their email: <strong>${esc(subscriberEmail)}</strong></p>`
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>New Pro request for ${esc(orgName)}</title>
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
              <strong>${esc(subscriberName)}</strong> has requested a sponsored Pro account from ${esc(orgName)} on Vidopick. Visit your dashboard to approve or decline.
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

export function buildProApprovalEmail(displayName: string, orgName: string): string {
  const year = new Date().getFullYear();

  const benefits = [
    { icon: '👨‍👩‍👧', text: 'Multiple profiles, one for each family member' },
    { icon: '🔄', text: 'Playlists sync across all your devices' },
    {
      icon: '✅',
      text: 'Always up to date when an profile you follow to is updated',
    },
    {
      icon: '⏱️',
      text: 'Limit daily viewing time per profile across all devices',
    },
    {
      icon: '📊',
      text: '30-day history with detailed viewing stats for each profile',
    },
    { icon: '🤝', text: 'Follow profiles and share your own with friends' },
  ];

  const benefitRows = benefits
    .map(
      ({ icon, text }) => `
    <tr>
      <td style="padding:6px 0;">
        <table cellpadding="0" cellspacing="0" role="presentation" style="width:100%;">
          <tr>
            <td style="width:32px;vertical-align:top;padding-top:1px;font-size:17px;">${icon}</td>
            <td style="font-size:14px;color:#334155;line-height:1.6;">${text}</td>
          </tr>
        </table>
      </td>
    </tr>`
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>You're a Vidopick Pro!</title>
  <style>${FONT_FACE}</style>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#f1f5f9;padding:48px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:560px;width:100%;">

        <!-- ── Hero (dark navy with stars) ── -->
        <tr>
          <td style="background-color:#0b172a;border-radius:20px 20px 0 0;padding:48px 32px 40px;text-align:center;overflow:hidden;position:relative;">

            <!-- Vidopick wordmark -->
            <p style="margin:0 0 32px;"><span style="${LOGO_STYLE}color:#ffffff;">Vidopick</span></p>

            <!-- Pro character image -->
            <img src="https://vidopick.com/images/pro.png"
                 alt="Vidopick Pro"
                 width="160" height="160"
                 style="display:block;margin:0 auto 28px;border-radius:24px;width:160px;height:160px;object-fit:cover;" />

            <!-- Star row -->
            <p style="margin:0 0 12px;font-size:22px;letter-spacing:8px;line-height:1;">
              <span style="color:#ffc179;">&#9733;</span>
              <span style="color:#fe9e32;">&#10022;</span>
              <span style="color:#ffd93d;">&#9733;</span>
              <span style="color:#fe9e32;">&#10022;</span>
              <span style="color:#ffc179;">&#9733;</span>
            </p>

            <!-- Main title -->
            <h1 style="margin:0 0 10px;font-size:38px;font-weight:800;color:#ffffff;line-height:1.1;letter-spacing:-0.5px;">
              You're a Pro!
            </h1>

            <!-- Subtitle -->
            <p style="margin:0;font-size:15px;font-weight:600;color:#fe9e32;letter-spacing:0.5px;">
              &#10022;&nbsp; Sponsored by ${esc(orgName)} &nbsp;&#10022;
            </p>

          </td>
        </tr>

        <!-- ── White body card ── -->
        <tr>
          <td style="background:#ffffff;border-radius:0 0 20px 20px;padding:36px 40px 40px;box-shadow:0 8px 24px -4px rgba(0,0,0,0.10);">

            <p style="margin:0 0 6px;font-size:15px;color:#64748b;line-height:1.6;">Hi ${esc(displayName)},</p>
            <p style="margin:0 0 28px;font-size:15px;color:#334155;line-height:1.7;">
              Welcome to Vidopick Pro! Here's everything you can now do:
            </p>

            <!-- Benefits -->
            <table cellpadding="0" cellspacing="0" role="presentation" style="width:100%;background:#f8fafc;border-radius:14px;padding:16px 20px;margin-bottom:32px;">
              <tbody>
                ${benefitRows}
              </tbody>
            </table>

            <!-- CTA button -->
            <table cellpadding="0" cellspacing="0" role="presentation" style="margin:0 auto 32px;">
              <tr>
                <td style="background-color:#f08d07;border-radius:12px;box-shadow:0 4px 14px rgba(240,141,7,0.40);">
                  <a href="https://vidopick.com"
                     style="display:inline-block;padding:15px 40px;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;letter-spacing:0.02em;white-space:nowrap;">
                    Open Vidopick &nbsp;&#8594;
                  </a>
                </td>
              </tr>
            </table>

            <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 24px;" />

            <p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.6;">
              You received this email because you requested a sponsored Pro account on Vidopick.
              Need help? Visit <a href="https://vidopick.com/contact/" style="color:#94a3b8;">vidopick.com/contact</a>.
            </p>
          </td>
        </tr>

        <!-- ── Footer ── -->
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

export function buildProDeclinedEmail(displayName: string, orgName: string): string {
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
            <p style="margin:0 0 8px;font-size:15px;color:#64748b;line-height:1.6;">Hi ${esc(displayName)},</p>
            <p style="margin:0 0 36px;font-size:15px;color:#334155;line-height:1.7;">
              <strong>${esc(orgName)}</strong> wasn't able to approve your Vidopick Pro request at this time. You can scan their invite link again to re-apply, or get Pro directly from the app.
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
 * @param displayName   - user's display name from Firebase Auth
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
  dashboardUrl: string
): string {
  const year = new Date().getFullYear();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Pro request cancelled — ${esc(orgName)}</title>
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
            <p style="margin:0 0 8px;font-size:15px;color:#64748b;line-height:1.6;">Hi ${esc(recipientName)},</p>
            <p style="margin:0 0 36px;font-size:15px;color:#334155;line-height:1.7;">
              <strong>${esc(subscriberName)}</strong> has withdrawn their request for a Pro account sponsored by ${esc(orgName)}.
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
              You received this email because you manage Pro sponsorships for ${esc(orgName)} on Vidopick.
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
  remainingOrgNames: string[]
): string {
  const year = new Date().getFullYear();

  const stillCovered = remainingOrgNames.length > 0;
  const remainingList =
    remainingOrgNames.length === 1
      ? `<strong>${esc(remainingOrgNames[0])}</strong>`
      : remainingOrgNames
          .map((n, i) =>
            i < remainingOrgNames.length - 1
              ? `<strong>${esc(n)}</strong>`
              : `and <strong>${esc(n)}</strong>`
          )
          .join(', ');

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
              ${stillCovered ? 'A change to your Pro membership' : 'Your Pro membership has ended'}
            </h1>
            <p style="margin:0 0 8px;font-size:15px;color:#64748b;line-height:1.6;">Hi ${esc(displayName)},</p>
            <p style="margin:0 0 16px;font-size:15px;color:#334155;line-height:1.7;">
              <strong>${esc(revokedOrgName)}</strong> no longer sponsors your Vidopick Pro membership.
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

export function buildOwnerRefundEmail(
  customerName: string,
  customerEmail: string,
  uid: string,
  refundAmountDollars: string,
  estimatedFeeDollars: string,
  subscriptionType: string,
  isTestMode: boolean
): string {
  const year = new Date().getFullYear();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Refund processed${isTestMode ? ' [TEST]' : ''}</title>
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
          <td style="background:#ffffff;border-radius:16px;padding:40px;box-shadow:0 4px 6px -1px rgba(0,0,0,0.07);">
            <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0f172a;">
              ${isTestMode ? '[TEST] ' : ''}Refund processed
            </h1>
            <p style="margin:0 0 24px;font-size:14px;color:#64748b;">A customer requested and received a full refund within the 7-day window.</p>

            <table cellpadding="0" cellspacing="0" role="presentation" style="width:100%;background:#f8fafc;border-radius:12px;padding:18px 20px;margin-bottom:24px;">
              <tr>
                <td style="padding:5px 0;font-size:13px;color:#64748b;">Customer name</td>
                <td style="padding:5px 0;font-size:13px;color:#0f172a;font-weight:600;text-align:right;">${esc(customerName)}</td>
              </tr>
              <tr>
                <td style="padding:5px 0;font-size:13px;color:#64748b;">Customer email</td>
                <td style="padding:5px 0;font-size:13px;color:#0f172a;font-weight:600;text-align:right;">${esc(customerEmail)}</td>
              </tr>
              <tr>
                <td style="padding:5px 0;font-size:13px;color:#64748b;">Firebase UID</td>
                <td style="padding:5px 0;font-size:12px;font-family:monospace;color:#64748b;text-align:right;">${uid}</td>
              </tr>
              <tr>
                <td style="padding:5px 0;font-size:13px;color:#64748b;">Plan</td>
                <td style="padding:5px 0;font-size:13px;color:#0f172a;font-weight:600;text-align:right;">Pro ${subscriptionType === 'year' ? 'Annual' : 'Monthly'}</td>
              </tr>
              <tr>
                <td style="padding:5px 0;font-size:13px;color:#64748b;">Amount refunded</td>
                <td style="padding:5px 0;font-size:13px;color:#0f172a;font-weight:600;text-align:right;">$${refundAmountDollars}</td>
              </tr>
              <tr>
                <td style="padding:5px 0;font-size:13px;color:#64748b;">Stripe fee (not returned)</td>
                <td style="padding:5px 0;font-size:13px;color:#ef4444;font-weight:700;text-align:right;">-$${estimatedFeeDollars}</td>
              </tr>
            </table>

            <p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.6;">
              Stripe's processing fee (~2.9% + $0.30) is not returned on refunds.
              The estimated fee shown is approximate.
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

export function buildAffiliateSaleEmail(
  affiliateName: string,
  customerAmountDollars: string,
  commissionDollars: string,
  subscriptionType: string,
  couponName: string | null,
  dashboardUrl: string
): string {
  const year = new Date().getFullYear();
  const couponLine = couponName
    ? `<p style="margin:0 0 8px;font-size:14px;color:#64748b;line-height:1.6;">Coupon used: <strong>${esc(couponName!)}</strong></p>`
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>You made a sale!</title>
  <style>${FONT_FACE}</style>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#f1f5f9;padding:48px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:560px;width:100%;">

        <tr>
          <td style="background-color:#0b172a;border-radius:20px 20px 0 0;padding:40px 32px 32px;text-align:center;">
            <p style="margin:0 0 16px;"><span style="${LOGO_STYLE}color:#ffffff;">Vidopick</span></p>
            <p style="margin:0;font-size:40px;">🎉</p>
            <h1 style="margin:12px 0 0;font-size:28px;font-weight:800;color:#ffffff;line-height:1.2;">You made a sale!</h1>
          </td>
        </tr>

        <tr>
          <td style="background:#ffffff;border-radius:0 0 20px 20px;padding:32px 40px 40px;box-shadow:0 8px 24px -4px rgba(0,0,0,0.10);">
            <p style="margin:0 0 8px;font-size:15px;color:#64748b;line-height:1.6;">Hi ${esc(affiliateName)},</p>
            <p style="margin:0 0 24px;font-size:15px;color:#334155;line-height:1.7;">
              A new subscriber just signed up through your referral link. Here's a summary:
            </p>

            <table cellpadding="0" cellspacing="0" role="presentation" style="width:100%;background:#f8fafc;border-radius:14px;padding:20px 24px;margin-bottom:28px;">
              <tr>
                <td style="padding:6px 0;font-size:14px;color:#64748b;">Plan</td>
                <td style="padding:6px 0;font-size:14px;color:#0f172a;font-weight:600;text-align:right;">Vidopick Pro ${subscriptionType === 'year' ? 'Annual' : 'Monthly'}</td>
              </tr>
              <tr>
                <td style="padding:6px 0;font-size:14px;color:#64748b;">Customer paid</td>
                <td style="padding:6px 0;font-size:14px;color:#0f172a;font-weight:600;text-align:right;">$${customerAmountDollars}</td>
              </tr>
              <tr>
                <td style="padding:6px 0;font-size:14px;color:#64748b;">Your commission</td>
                <td style="padding:6px 0;font-size:20px;color:#10b981;font-weight:800;text-align:right;">$${commissionDollars}</td>
              </tr>
              ${couponLine ? `<tr><td style="padding:6px 0;font-size:14px;color:#64748b;">Coupon</td><td style="padding:6px 0;font-size:14px;color:#0f172a;font-weight:600;text-align:right;">${esc(couponName!)}</td></tr>` : ''}
            </table>

            <table cellpadding="0" cellspacing="0" role="presentation" style="margin:0 auto 32px;">
              <tr>
                <td style="background-color:#1d4ed8;border-radius:10px;">
                  <a href="${dashboardUrl}"
                     style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;letter-spacing:0.01em;white-space:nowrap;">
                    View Dashboard &rarr;
                  </a>
                </td>
              </tr>
            </table>

            <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 20px;" />
            <p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.6;">
              Commissions are held for 30 days before approval. Approved amounts over $25 are paid monthly via PayPal.
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
 * Sent to an affiliate when they finish onboarding in the partner dashboard.
 */
export function buildAffiliateWelcomeEmail(
  affiliateName: string,
  commissionPercent: number,
  publicProfilePercent: number,
  publicPageUrl: string | null,
  dashboardUrl: string
): string {
  const year = new Date().getFullYear();
  const firstName = affiliateName.split(' ')[0] || affiliateName;
  const pageRow = publicPageUrl
    ? `<tr>
        <td style="padding:6px 0;font-size:14px;color:#64748b;">Your public page</td>
        <td style="padding:6px 0;font-size:14px;text-align:right;"><a href="${esc(publicPageUrl)}" style="color:#1d4ed8;font-weight:600;text-decoration:none;">${esc(publicPageUrl.replace(/^https?:\/\//, ''))}</a></td>
      </tr>`
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Welcome to Vidopick Affiliates</title>
  <style>${FONT_FACE}</style>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#f1f5f9;padding:48px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:560px;width:100%;">

        <tr>
          <td style="background-color:#0b172a;border-radius:20px 20px 0 0;padding:40px 32px 32px;text-align:center;">
            <p style="margin:0 0 16px;"><span style="${LOGO_STYLE}color:#ffffff;">Vidopick</span></p>
            <p style="margin:0;font-size:40px;">🤝</p>
            <h1 style="margin:12px 0 0;font-size:28px;font-weight:800;color:#ffffff;line-height:1.2;">Welcome to Vidopick Affiliates!</h1>
          </td>
        </tr>

        <tr>
          <td style="background:#ffffff;border-radius:0 0 20px 20px;padding:32px 40px 40px;box-shadow:0 8px 24px -4px rgba(0,0,0,0.10);">
            <p style="margin:0 0 8px;font-size:15px;color:#64748b;line-height:1.6;">Hi ${esc(firstName)},</p>
            <p style="margin:0 0 24px;font-size:15px;color:#334155;line-height:1.7;">
              Your affiliate account is fully set up. You're ready to start sharing and earning.
              Here's a quick recap:
            </p>

            <table cellpadding="0" cellspacing="0" role="presentation" style="width:100%;background:#f8fafc;border-radius:14px;padding:20px 24px;margin-bottom:28px;">
              <tr>
                <td style="padding:6px 0;font-size:14px;color:#64748b;">Referral commission</td>
                <td style="padding:6px 0;font-size:14px;color:#0f172a;font-weight:600;text-align:right;">${commissionPercent}% of every payment</td>
              </tr>
              <tr>
                <td style="padding:6px 0;font-size:14px;color:#64748b;">Public page sales</td>
                <td style="padding:6px 0;font-size:14px;color:#0f172a;font-weight:600;text-align:right;">${publicProfilePercent}% passive commission</td>
              </tr>
              ${pageRow}
              <tr>
                <td style="padding:6px 0;font-size:14px;color:#64748b;">Payouts</td>
                <td style="padding:6px 0;font-size:14px;color:#0f172a;font-weight:600;text-align:right;">Monthly, once you reach $25</td>
              </tr>
            </table>

            <table cellpadding="0" cellspacing="0" role="presentation" style="margin:0 auto 32px;">
              <tr>
                <td style="background-color:#1d4ed8;border-radius:10px;">
                  <a href="${esc(dashboardUrl)}"
                     style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;letter-spacing:0.01em;white-space:nowrap;">
                    Open Your Dashboard &rarr;
                  </a>
                </td>
              </tr>
            </table>

            <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 20px;" />
            <p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.6;">
              Questions? <a href="mailto:support@vidopick.com" style="color:#4470ad;text-decoration:underline;">Reach out to us</a>
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

export function buildOwnerSaleEmail(
  affiliateName: string,
  affiliateEmail: string,
  customerAmountDollars: string,
  commissionDollars: string,
  subscriptionType: string,
  couponName: string | null,
  uid: string
): string {
  const year = new Date().getFullYear();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>New Vidopick sale</title>
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
          <td style="background:#ffffff;border-radius:16px;padding:40px;box-shadow:0 4px 6px -1px rgba(0,0,0,0.07);">
            <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#0f172a;">💰 New sale!</h1>
            <p style="margin:0 0 24px;font-size:14px;color:#64748b;">A Vidopick Pro subscription was just purchased.</p>

            <table cellpadding="0" cellspacing="0" role="presentation" style="width:100%;background:#f8fafc;border-radius:12px;padding:18px 20px;margin-bottom:24px;">
              <tr>
                <td style="padding:5px 0;font-size:13px;color:#64748b;">Plan</td>
                <td style="padding:5px 0;font-size:13px;color:#0f172a;font-weight:600;text-align:right;">Pro ${subscriptionType === 'year' ? 'Annual' : 'Monthly'}</td>
              </tr>
              <tr>
                <td style="padding:5px 0;font-size:13px;color:#64748b;">Amount</td>
                <td style="padding:5px 0;font-size:13px;color:#0f172a;font-weight:600;text-align:right;">$${customerAmountDollars}</td>
              </tr>
              <tr>
                <td style="padding:5px 0;font-size:13px;color:#64748b;">Affiliate</td>
                <td style="padding:5px 0;font-size:13px;color:#0f172a;font-weight:600;text-align:right;">${esc(affiliateName)} (${esc(affiliateEmail)})</td>
              </tr>
              <tr>
                <td style="padding:5px 0;font-size:13px;color:#64748b;">Commission owed</td>
                <td style="padding:5px 0;font-size:13px;color:#ef4444;font-weight:700;text-align:right;">$${commissionDollars}</td>
              </tr>
              ${couponName ? `<tr><td style="padding:5px 0;font-size:13px;color:#64748b;">Coupon</td><td style="padding:5px 0;font-size:13px;color:#0f172a;font-weight:600;text-align:right;">${esc(couponName)}</td></tr>` : ''}
              <tr>
                <td style="padding:5px 0;font-size:13px;color:#64748b;">User UID</td>
                <td style="padding:5px 0;font-size:12px;font-family:monospace;color:#64748b;text-align:right;">${uid}</td>
              </tr>
            </table>
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

export function buildOwnerDirectSaleEmail(
  customerName: string,
  customerEmail: string,
  uid: string,
  amountDollars: string,
  subscriptionType: string,
  isTestMode: boolean
): string {
  const year = new Date().getFullYear();
  const planLabel = subscriptionType === 'year' ? 'Pro Annual' : 'Pro Monthly';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${isTestMode ? '[TEST] ' : ''}New sale</title>
  <style>${FONT_FACE}</style>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#f1f5f9;padding:48px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:560px;width:100%;">
        <tr><td style="padding-bottom:32px;text-align:center;"><span style="${LOGO_STYLE}">Vidopick</span></td></tr>
        <tr>
          <td style="background:#ffffff;border-radius:16px;padding:40px;box-shadow:0 4px 6px -1px rgba(0,0,0,0.07);">
            <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0f172a;">${isTestMode ? '[TEST] ' : ''}💰 New sale!</h1>
            <p style="margin:0 0 24px;font-size:14px;color:#64748b;">A Vidopick Pro subscription was just purchased.</p>
            <table cellpadding="0" cellspacing="0" role="presentation" style="width:100%;background:#f8fafc;border-radius:12px;padding:18px 20px;margin-bottom:24px;">
              <tr><td style="padding:5px 0;font-size:13px;color:#64748b;">Customer</td><td style="padding:5px 0;font-size:13px;color:#0f172a;font-weight:600;text-align:right;">${esc(customerName)}</td></tr>
              <tr><td style="padding:5px 0;font-size:13px;color:#64748b;">Email</td><td style="padding:5px 0;font-size:13px;color:#0f172a;font-weight:600;text-align:right;">${esc(customerEmail)}</td></tr>
              <tr><td style="padding:5px 0;font-size:13px;color:#64748b;">Plan</td><td style="padding:5px 0;font-size:13px;color:#0f172a;font-weight:600;text-align:right;">${planLabel}</td></tr>
              <tr><td style="padding:5px 0;font-size:13px;color:#64748b;">Amount</td><td style="padding:5px 0;font-size:13px;color:#16a34a;font-weight:700;text-align:right;">$${amountDollars}</td></tr>
              <tr><td style="padding:5px 0;font-size:13px;color:#64748b;">UID</td><td style="padding:5px 0;font-size:12px;font-family:monospace;color:#64748b;text-align:right;">${uid}</td></tr>
            </table>
          </td>
        </tr>
        <tr><td style="padding-top:24px;text-align:center;"><p style="margin:0;font-size:12px;color:#94a3b8;">&copy; ${year} Vidopick &middot; <a href="https://vidopick.com" style="color:#94a3b8;text-decoration:underline;">vidopick.com</a></p></td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function buildOwnerTrialStartEmail(
  customerName: string,
  customerEmail: string,
  uid: string,
  subscriptionType: string,
  trialEndDate: string,
  isTestMode: boolean
): string {
  const year = new Date().getFullYear();
  const planLabel = subscriptionType === 'year' ? 'Pro Annual' : 'Pro Monthly';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${isTestMode ? '[TEST] ' : ''}New free trial</title>
  <style>${FONT_FACE}</style>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#f1f5f9;padding:48px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:560px;width:100%;">
        <tr><td style="padding-bottom:32px;text-align:center;"><span style="${LOGO_STYLE}">Vidopick</span></td></tr>
        <tr>
          <td style="background:#ffffff;border-radius:16px;padding:40px;box-shadow:0 4px 6px -1px rgba(0,0,0,0.07);">
            <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0f172a;">${isTestMode ? '[TEST] ' : ''}🆕 New free trial started</h1>
            <p style="margin:0 0 24px;font-size:14px;color:#64748b;">A new subscriber just started their 14-day free trial.</p>
            <table cellpadding="0" cellspacing="0" role="presentation" style="width:100%;background:#f8fafc;border-radius:12px;padding:18px 20px;margin-bottom:24px;">
              <tr><td style="padding:5px 0;font-size:13px;color:#64748b;">Customer</td><td style="padding:5px 0;font-size:13px;color:#0f172a;font-weight:600;text-align:right;">${esc(customerName)}</td></tr>
              <tr><td style="padding:5px 0;font-size:13px;color:#64748b;">Email</td><td style="padding:5px 0;font-size:13px;color:#0f172a;font-weight:600;text-align:right;">${esc(customerEmail)}</td></tr>
              <tr><td style="padding:5px 0;font-size:13px;color:#64748b;">Plan</td><td style="padding:5px 0;font-size:13px;color:#0f172a;font-weight:600;text-align:right;">${planLabel}</td></tr>
              <tr><td style="padding:5px 0;font-size:13px;color:#64748b;">Trial ends</td><td style="padding:5px 0;font-size:13px;color:#0f172a;font-weight:600;text-align:right;">${trialEndDate}</td></tr>
              <tr><td style="padding:5px 0;font-size:13px;color:#64748b;">UID</td><td style="padding:5px 0;font-size:12px;font-family:monospace;color:#64748b;text-align:right;">${uid}</td></tr>
            </table>
          </td>
        </tr>
        <tr><td style="padding-top:24px;text-align:center;"><p style="margin:0;font-size:12px;color:#94a3b8;">&copy; ${year} Vidopick &middot; <a href="https://vidopick.com" style="color:#94a3b8;text-decoration:underline;">vidopick.com</a></p></td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function buildAffiliateTrialEmail(
  affiliateName: string,
  subscriptionType: string,
  dashboardUrl: string
): string {
  const year = new Date().getFullYear();
  const planLabel = subscriptionType === 'year' ? 'Pro Annual' : 'Pro Monthly';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>New free trial via your link!</title>
  <style>${FONT_FACE}</style>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#f1f5f9;padding:48px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:560px;width:100%;">

        <tr>
          <td style="background-color:#0b172a;border-radius:20px 20px 0 0;padding:40px 32px 32px;text-align:center;">
            <p style="margin:0 0 16px;"><span style="${LOGO_STYLE}color:#ffffff;">Vidopick</span></p>
            <p style="margin:0;font-size:40px;">🌱</p>
            <h1 style="margin:12px 0 0;font-size:28px;font-weight:800;color:#ffffff;line-height:1.2;">New trial via your link!</h1>
          </td>
        </tr>

        <tr>
          <td style="background:#ffffff;border-radius:0 0 20px 20px;padding:32px 40px 40px;box-shadow:0 8px 24px -4px rgba(0,0,0,0.10);">
            <p style="margin:0 0 8px;font-size:15px;color:#64748b;line-height:1.6;">Hi ${esc(affiliateName)},</p>
            <p style="margin:0 0 24px;font-size:15px;color:#334155;line-height:1.7;">
              Someone just signed up for a <strong>14-day free trial</strong> of Vidopick Pro through your referral link.
            </p>

            <table cellpadding="0" cellspacing="0" role="presentation" style="width:100%;background:#f8fafc;border-radius:14px;padding:20px 24px;margin-bottom:28px;">
              <tr>
                <td style="padding:6px 0;font-size:14px;color:#64748b;">Plan</td>
                <td style="padding:6px 0;font-size:14px;color:#0f172a;font-weight:600;text-align:right;">Vidopick ${planLabel}</td>
              </tr>
              <tr>
                <td style="padding:6px 0;font-size:14px;color:#64748b;">Trial length</td>
                <td style="padding:6px 0;font-size:14px;color:#0f172a;font-weight:600;text-align:right;">14 days</td>
              </tr>
              <tr>
                <td style="padding:6px 0;font-size:14px;color:#64748b;">Your commission</td>
                <td style="padding:6px 0;font-size:14px;color:#f59e0b;font-weight:700;text-align:right;">Pending — paid if they stay</td>
              </tr>
            </table>

            <p style="margin:0 0 28px;font-size:14px;color:#64748b;line-height:1.7;">
              Once their trial converts to a paid subscription, your commission will be credited to your account. You'll get another email when that happens.
            </p>

            <table cellpadding="0" cellspacing="0" role="presentation" style="margin:0 auto 32px;">
              <tr>
                <td style="background-color:#1d4ed8;border-radius:10px;">
                  <a href="${dashboardUrl}"
                     style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;letter-spacing:0.01em;white-space:nowrap;">
                    View Dashboard &rarr;
                  </a>
                </td>
              </tr>
            </table>

            <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 20px;" />
            <p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.6;">
              Commissions are held for 30 days before approval. Approved amounts over $25 are paid monthly via PayPal.
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

export function buildOwnerCancellationEmail(
  customerName: string,
  customerEmail: string,
  uid: string,
  accessUntil: string,
  withinRefundWindow: boolean,
  subscriptionType: string,
  isTestMode: boolean
): string {
  const year = new Date().getFullYear();
  const planLabel = subscriptionType === 'year' ? 'Pro Annual' : 'Pro Monthly';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${isTestMode ? '[TEST] ' : ''}Subscription cancelled</title>
  <style>${FONT_FACE}</style>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#f1f5f9;padding:48px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:560px;width:100%;">
        <tr><td style="padding-bottom:32px;text-align:center;"><span style="${LOGO_STYLE}">Vidopick</span></td></tr>
        <tr>
          <td style="background:#ffffff;border-radius:16px;padding:40px;box-shadow:0 4px 6px -1px rgba(0,0,0,0.07);">
            <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0f172a;">${isTestMode ? '[TEST] ' : ''}❌ Subscription cancelled</h1>
            <p style="margin:0 0 24px;font-size:14px;color:#64748b;">A customer scheduled their subscription to cancel at period end.</p>
            <table cellpadding="0" cellspacing="0" role="presentation" style="width:100%;background:#f8fafc;border-radius:12px;padding:18px 20px;margin-bottom:24px;">
              <tr><td style="padding:5px 0;font-size:13px;color:#64748b;">Customer</td><td style="padding:5px 0;font-size:13px;color:#0f172a;font-weight:600;text-align:right;">${esc(customerName)}</td></tr>
              <tr><td style="padding:5px 0;font-size:13px;color:#64748b;">Email</td><td style="padding:5px 0;font-size:13px;color:#0f172a;font-weight:600;text-align:right;">${esc(customerEmail)}</td></tr>
              <tr><td style="padding:5px 0;font-size:13px;color:#64748b;">Plan</td><td style="padding:5px 0;font-size:13px;color:#0f172a;font-weight:600;text-align:right;">${planLabel}</td></tr>
              <tr><td style="padding:5px 0;font-size:13px;color:#64748b;">Access until</td><td style="padding:5px 0;font-size:13px;color:#0f172a;font-weight:600;text-align:right;">${accessUntil}</td></tr>
              <tr><td style="padding:5px 0;font-size:13px;color:#64748b;">Refund eligible</td><td style="padding:5px 0;font-size:13px;font-weight:700;text-align:right;color:${withinRefundWindow ? '#f59e0b' : '#64748b'};">${withinRefundWindow ? '⚠️ Yes — within 7 days' : 'No'}</td></tr>
              <tr><td style="padding:5px 0;font-size:13px;color:#64748b;">UID</td><td style="padding:5px 0;font-size:12px;font-family:monospace;color:#64748b;text-align:right;">${uid}</td></tr>
            </table>
          </td>
        </tr>
        <tr><td style="padding-top:24px;text-align:center;"><p style="margin:0;font-size:12px;color:#94a3b8;">&copy; ${year} Vidopick &middot; <a href="https://vidopick.com" style="color:#94a3b8;text-decoration:underline;">vidopick.com</a></p></td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function buildOwnerUncancellationEmail(
  customerName: string,
  customerEmail: string,
  uid: string,
  subscriptionType: string,
  isTestMode: boolean
): string {
  const year = new Date().getFullYear();
  const planLabel = subscriptionType === 'year' ? 'Pro Annual' : 'Pro Monthly';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${isTestMode ? '[TEST] ' : ''}Subscription reactivated</title>
  <style>${FONT_FACE}</style>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#f1f5f9;padding:48px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:560px;width:100%;">
        <tr><td style="padding-bottom:32px;text-align:center;"><span style="${LOGO_STYLE}">Vidopick</span></td></tr>
        <tr>
          <td style="background:#ffffff;border-radius:16px;padding:40px;box-shadow:0 4px 6px -1px rgba(0,0,0,0.07);">
            <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0f172a;">${isTestMode ? '[TEST] ' : ''}↩️ Subscription reactivated</h1>
            <p style="margin:0 0 24px;font-size:14px;color:#64748b;">A customer clicked "Don't cancel subscription" and reversed their cancellation.</p>
            <table cellpadding="0" cellspacing="0" role="presentation" style="width:100%;background:#f8fafc;border-radius:12px;padding:18px 20px;margin-bottom:24px;">
              <tr><td style="padding:5px 0;font-size:13px;color:#64748b;">Customer</td><td style="padding:5px 0;font-size:13px;color:#0f172a;font-weight:600;text-align:right;">${esc(customerName)}</td></tr>
              <tr><td style="padding:5px 0;font-size:13px;color:#64748b;">Email</td><td style="padding:5px 0;font-size:13px;color:#0f172a;font-weight:600;text-align:right;">${esc(customerEmail)}</td></tr>
              <tr><td style="padding:5px 0;font-size:13px;color:#64748b;">Plan</td><td style="padding:5px 0;font-size:13px;color:#0f172a;font-weight:600;text-align:right;">${planLabel}</td></tr>
              <tr><td style="padding:5px 0;font-size:13px;color:#64748b;">UID</td><td style="padding:5px 0;font-size:12px;font-family:monospace;color:#64748b;text-align:right;">${uid}</td></tr>
            </table>
          </td>
        </tr>
        <tr><td style="padding-top:24px;text-align:center;"><p style="margin:0;font-size:12px;color:#94a3b8;">&copy; ${year} Vidopick &middot; <a href="https://vidopick.com" style="color:#94a3b8;text-decoration:underline;">vidopick.com</a></p></td></tr>
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

export function buildAffiliateInviteEmail(name: string, email: string, magicLink: string): string {
  const year = new Date().getFullYear();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>You're invited to Vidopick affiliates</title>
  <style>${FONT_FACE}</style>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:48px auto;padding:0 16px;color:#1e293b;background:#f1f5f9">

    <!-- Logo -->
    <div style="padding:0 0 32px;text-align:center;">
      <span style="${LOGO_STYLE}">Vidopick</span>
    </div>

    <!-- Card -->
    <div style="background:#ffffff;border-radius:16px;padding:40px;box-shadow:0 4px 6px -1px rgba(0,0,0,0.07),0 2px 4px -1px rgba(0,0,0,0.04);">
      <h1 style="font-size:24px;font-weight:700;margin:0 0 8px;color:#0f172a">Hi ${esc(name)}!</h1>
      <p style="font-size:15px;line-height:1.65;color:#475569;margin:0 0 32px">
        You've been invited to join the <strong style="color:#1e293b">Vidopick Affiliate Program</strong>.
        Here's how to get started. We'll guide you through each step once you're in.
      </p>

      <!-- Step 1 -->
      <div style="display:flex;align-items:flex-start;gap:14px;margin-bottom:20px">
        <div style="background:#dbeafe;color:#1d4ed8;width:28px;height:28px;border-radius:50%;font-weight:700;font-size:13px;flex-shrink:0;line-height:28px;text-align:center">1</div>
        <div>
          <p style="font-weight:600;font-size:15px;color:#1e293b;margin:0 0 6px">Download Vidopick</p>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <a href="https://apps.apple.com/us/app/vidopick/id6749210639" style="display:inline-flex;align-items:center;gap:8px;background:#000;border:1px solid #334155;color:#fff;text-decoration:none;padding:8px 14px;border-radius:10px">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>
              <span style="text-align:left;line-height:1.2"><span style="display:block;font-size:10px;color:#94a3b8">Download on the</span><span style="display:block;font-size:13px;font-weight:600">App Store</span></span>
            </a>
            <a href="https://play.google.com/store/apps/details?id=com.vidopick.app" style="display:inline-flex;align-items:center;gap:8px;background:#000;border:1px solid #334155;color:#fff;text-decoration:none;padding:8px 14px;border-radius:10px">
              <svg width="18" height="18" viewBox="0 0 24 24"><path d="M3.18 23.76A2 2 0 0 1 2 22V2a2 2 0 0 1 1.18-1.76l11.31 11.75L3.18 23.76z" fill="#00C6FB"/><path d="M20.09 10.53l-2.5-1.45L14.49 12l3.1 2.92 2.5-1.45a2 2 0 0 0 0-2.94z" fill="#FFD200"/><path d="M3.18 23.76L14.49 12 17.59 14.92 5.5 21.9a2 2 0 0 1-2.32 1.86z" fill="#FF5C78"/><path d="M3.18.24A2 2 0 0 1 5.5 2.1l12.09 6.98L14.49 12 3.18.24z" fill="#00E87C"/></svg>
              <span style="text-align:left;line-height:1.2"><span style="display:block;font-size:10px;color:#94a3b8">Get it on</span><span style="display:block;font-size:13px;font-weight:600">Google Play</span></span>
            </a>
          </div>
        </div>
      </div>

      <!-- Step 2 -->
      <div style="display:flex;align-items:flex-start;gap:14px;margin-bottom:20px">
        <div style="background:#dbeafe;color:#1d4ed8;width:28px;height:28px;border-radius:50%;font-weight:700;font-size:13px;flex-shrink:0;line-height:28px;text-align:center">2</div>
        <div style="flex:1">
          <p style="font-weight:600;font-size:15px;color:#1e293b;margin:0 0 8px">Sign into Vidopick with your email address</p>
          <div style="background:#eff6ff;border:2px solid #bfdbfe;border-radius:10px;padding:12px 16px;font-family:monospace;font-size:15px;color:#1d4ed8;font-weight:600;text-align:center;letter-spacing:0.02em">
            ${esc(email)}
          </div>
          <p style="font-size:13px;color:#64748b;margin:8px 0 0;line-height:1.5">
            You'll be approved as <strong>Pro</strong> automatically for free.
          </p>
        </div>
      </div>

      <!-- Step 3 -->
      <div style="display:flex;align-items:flex-start;gap:14px;margin-bottom:32px">
        <div style="background:#dbeafe;color:#1d4ed8;width:28px;height:28px;border-radius:50%;font-weight:700;font-size:13px;flex-shrink:0;line-height:28px;text-align:center">3</div>
        <div>
          <p style="font-weight:600;font-size:15px;color:#1e293b;margin:0 0 10px">Access your Affiliate Dashboard</p>
          <table cellpadding="0" cellspacing="0" role="presentation">
            <tr>
              <td style="background-color:#1d4ed8;border-radius:9px;">
                <a href="${esc(magicLink)}" style="display:inline-block;padding:13px 24px;font-size:15px;font-weight:600;color:#fff;text-decoration:none;">
                  Open your Dashboard &rarr;
                </a>
              </td>
            </tr>
          </table>
          <p style="font-size:12px;color:#94a3b8;margin:10px 0 0">Link expires in 24 hours.</p>
        </div>
      </div>

      <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 20px;" />

      <p style="font-size:12px;color:#94a3b8;margin:0;line-height:1.6">
        The Vidopick Team &middot; If you weren't expecting this email, you can ignore it.<br/>
        If the button doesn't work: <a href="${esc(magicLink)}" style="color:#3b82f6;word-break:break-all">${esc(magicLink)}</a>
      </p>
    </div>

    <!-- Footer -->
    <div style="padding-top:24px;text-align:center;">
      <p style="margin:0;font-size:12px;color:#94a3b8;">
        &copy; ${year} Vidopick &middot;
        <a href="https://vidopick.com" style="color:#94a3b8;text-decoration:underline;">vidopick.com</a>
      </p>
    </div>

  </div>
</body>
</html>`;
}

export function buildAffiliateEmailUpdatedEmail(
  name: string,
  oldEmail: string,
  newEmail: string
): string {
  const year = new Date().getFullYear();
  const firstName = name.split(' ')[0] || name;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Your Vidopick affiliate email has been updated</title>
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
            <h1 style="margin:0 0 16px;font-size:26px;font-weight:700;color:#0f172a;line-height:1.3;">Email address updated</h1>
            <p style="margin:0 0 8px;font-size:15px;color:#64748b;line-height:1.6;">Hi ${esc(firstName)},</p>
            <p style="margin:0 0 20px;font-size:15px;color:#334155;line-height:1.7;">
              Your Vidopick affiliate account email has been updated from
              <strong>${esc(oldEmail)}</strong> to <strong>${esc(newEmail)}</strong>.
            </p>
            <p style="margin:0 0 32px;font-size:15px;color:#334155;line-height:1.7;">
              Use this address to sign in to your affiliate dashboard going forward.
              Any active sessions have been signed out for your security.
            </p>

            <table cellpadding="0" cellspacing="0" role="presentation" style="margin:0 auto 32px;">
              <tr>
                <td style="background-color:#1d4ed8;border-radius:10px;">
                  <a href="https://vidopick.com/vp/login/"
                     style="display:inline-block;padding:15px 36px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;letter-spacing:0.01em;white-space:nowrap;">
                    Sign in to Dashboard &rarr;
                  </a>
                </td>
              </tr>
            </table>

            <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 20px;" />

            <p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.6;">
              If you didn't request this change, contact us immediately at
              <a href="mailto:support@vidopick.com" style="color:#94a3b8;">support@vidopick.com</a>.
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
 * Sent to a staff member when an org invites them via the app-only flow.
 * The link opens Vidopick (or the App Store) — no dashboard visit needed.
 */
export function buildMemberAppInviteEmail(
  memberName: string,
  orgName: string,
  inviteLink: string
): string {
  const year = new Date().getFullYear();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(orgName)} invites you to Vidopick</title>
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
            <h1 style="margin:0 0 16px;font-size:26px;font-weight:700;color:#0f172a;line-height:1.3;">${esc(orgName)} invites you to Vidopick</h1>
            <p style="margin:0 0 8px;font-size:15px;color:#64748b;line-height:1.6;">Hi ${esc(memberName)},</p>
            <p style="margin:0 0 32px;font-size:15px;color:#334155;line-height:1.7;">
              You've been added as a staff member for <strong>${esc(orgName)}</strong> on Vidopick.
              Tap the button below to get the app and accept your invite — it only takes a minute.
            </p>

            <table cellpadding="0" cellspacing="0" role="presentation" style="margin:0 auto 32px;">
              <tr>
                <td style="background-color:#1d4ed8;border-radius:10px;">
                  <a href="${inviteLink}"
                     style="display:inline-block;padding:15px 36px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;letter-spacing:0.01em;white-space:nowrap;">
                    Get Vidopick &rarr;
                  </a>
                </td>
              </tr>
            </table>

            <p style="margin:0 0 8px;font-size:13px;color:#64748b;line-height:1.6;text-align:center;">
              Already have Vidopick? Open the app and paste this link:
            </p>
            <p style="margin:0 0 32px;font-size:13px;font-weight:600;color:#1d4ed8;line-height:1.6;text-align:center;word-break:break-all;">
              ${inviteLink}
            </p>

            <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 24px;" />

            <p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.6;">
              This link expires in 14 days. If you weren't expecting this, you can safely ignore this email.
              For help, visit <a href="https://vidopick.com/contact/" style="color:#94a3b8;">vidopick.com/contact</a>.
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
