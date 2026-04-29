import * as https from 'https';
import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import * as nodemailer from 'nodemailer';
import { buildInviteEmail, buildMemberInviteEmail, buildSignInEmail } from '../utils/emailTemplates';

if (!admin.apps.length) {
  admin.initializeApp();
}

const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
const TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY;
const SENDER_EMAIL = 'vidopickhelp@gmail.com';

function verifyTurnstile(token: string): Promise<boolean> {
  if (!TURNSTILE_SECRET_KEY) {
    console.warn('[Turnstile] Secret key not configured — skipping verification');
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const body = JSON.stringify({ secret: TURNSTILE_SECRET_KEY, response: token });
    const req = https.request(
      {
        hostname: 'challenges.cloudflare.com',
        path: '/turnstile/v1/siteverify',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          console.log(`[Turnstile] siteverify status=${res.statusCode} body=${raw}`);
          try {
            const data = JSON.parse(raw) as { success: boolean };
            resolve(data.success === true);
          } catch {
            // Cloudflare returned a non-JSON response (e.g. WAF block from cloud IP).
            // Fail open — the client-side widget already passed.
            console.warn('[Turnstile] Non-JSON response from siteverify — failing open');
            resolve(true);
          }
        });
      }
    );
    req.on('error', (e) => {
      console.warn('[Turnstile] Network error contacting siteverify — failing open:', e.message);
      resolve(true);
    });
    req.write(body);
    req.end();
  });
}

const ALLOWED_ORIGINS = ['https://vidopick.com', 'http://localhost:5173'];

function resolveAppUrl(appOrigin?: string): string {
  if (appOrigin && ALLOWED_ORIGINS.includes(appOrigin)) return appOrigin;
  return 'https://vidopick.com';
}

function createTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: SENDER_EMAIL, pass: GMAIL_APP_PASSWORD },
  });
}

/**
 * Admin-only: send or resend an invite email for an org account or a member account.
 *
 * If `memberId` is supplied: looks up the member doc, generates a sign-in link
 * whose continueUrl carries `?email=...&memberId=...` so EmailSignInAction can
 * write the authUid back to the member document after sign-in.
 *
 * If only `organizationId` is supplied (legacy): sends to the organization email.
 */
export const sendOrganizationInvite = onCall(async (request) => {
  const role = request.auth?.token.role as string | undefined;
  const callerOrgId = request.auth?.token.organizationId as string | undefined;

  if (!request.auth || (role !== 'admin' && role !== 'organization')) {
    throw new HttpsError('permission-denied', 'Only admins and organization accounts can send invites');
  }

  const { organizationId, memberId, appOrigin } = request.data;

  // Org accounts can only send invites for their own organization
  if (role === 'organization' && callerOrgId !== organizationId) {
    throw new HttpsError('permission-denied', 'You can only send invites for your own organization');
  }

  const APP_URL = resolveAppUrl(appOrigin);

  if (!organizationId) {
    throw new HttpsError('invalid-argument', 'organizationId is required');
  }

  if (!GMAIL_APP_PASSWORD) {
    throw new HttpsError('internal', 'Email configuration missing');
  }

  const db = admin.firestore();

  // ── Member invite path ────────────────────────────────────────────────────
  if (memberId) {
    const memberSnap = await db.doc(`members/${memberId}`).get();
    if (!memberSnap.exists) {
      throw new HttpsError('not-found', 'Member not found');
    }
    const memberData = memberSnap.data()!;
    const email: string = memberData.email;
    const name: string = memberData.name || 'there';

    if (!email) {
      throw new HttpsError('failed-precondition', 'Member has no email address');
    }

    const orgSnap = await db.doc(`organizations/${organizationId}`).get();
    const orgData = orgSnap.exists ? orgSnap.data()! : {};
    const orgName: string = orgData.name || 'Your organization';
    const canApprovePro: boolean = orgData.membersCanApprovePro === true;

    // Create the Firebase user if they don't exist yet (needed to generate a link)
    try {
      await admin.auth().getUserByEmail(email);
    } catch (err: any) {
      if (err.code === 'auth/user-not-found') {
        await admin.auth().createUser({ email, displayName: name });
      } else {
        throw err;
      }
    }

    const continueUrl =
      `${APP_URL}/admin/auth/email-action/?` +
      `email=${encodeURIComponent(email)}&memberId=${encodeURIComponent(memberId)}`;

    const signInLink = await admin.auth().generateSignInWithEmailLink(email, {
      url: continueUrl,
      handleCodeInApp: true,
    });

    await createTransporter().sendMail({
      from: `"Vidopick" <${SENDER_EMAIL}>`,
      to: email,
      subject: `${orgName} invites you to Vidopick`,
      html: buildMemberInviteEmail(name, orgName, canApprovePro, signInLink),
    });

    console.log(`Sent member invite to ${email} memberId=${memberId} org=${organizationId}`);
    return { success: true, message: `Invite email sent to ${email}` };
  }

  // ── Organization account invite path (legacy) ─────────────────────────────
  const organizationSnap = await db.doc(`organizations/${organizationId}`).get();

  if (!organizationSnap.exists) {
    throw new HttpsError('not-found', 'Organization not found');
  }

  const data = organizationSnap.data()!;
  const email: string = data.email;
  const name: string = data.name || 'there';

  if (!email) {
    throw new HttpsError('failed-precondition', 'Organization has no email address');
  }

  if (!data.authUid) {
    throw new HttpsError(
      'failed-precondition',
      'Organization has no account yet. Create an account first.'
    );
  }

  const continueUrl = `${APP_URL}/admin/auth/email-action/?email=${encodeURIComponent(email)}`;
  const signInLink = await admin.auth().generateSignInWithEmailLink(email, {
    url: continueUrl,
    handleCodeInApp: true,
  });

  await createTransporter().sendMail({
    from: `"Vidopick" <${SENDER_EMAIL}>`,
    to: email,
    subject: "You're invited to Vidopick",
    html: buildInviteEmail(name, signInLink),
  });

  console.log(`Sent invite email to ${email} for organization ${organizationId}`);

  return { success: true, message: `Invite email sent to ${email}` };
});

/**
 * Public (no auth required): send a sign-in link to an email address.
 * Used by the login page. Always returns success to prevent account enumeration.
 */
export const sendSignInLink = onCall({ enforceAppCheck: true }, async (request) => {
  const { email, appOrigin, turnstileToken } = request.data;
  const APP_URL = resolveAppUrl(appOrigin);

  if (!email) {
    throw new HttpsError('invalid-argument', 'email is required');
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new HttpsError('invalid-argument', 'Invalid email format');
  }

  if (!turnstileToken || !(await verifyTurnstile(turnstileToken))) {
    throw new HttpsError('permission-denied', 'Verification failed. Please try again.');
  }

  if (!GMAIL_APP_PASSWORD) {
    throw new HttpsError('internal', 'Email configuration missing');
  }

  // Verify account exists — return success silently if not (prevent enumeration)
  try {
    await admin.auth().getUserByEmail(email);
  } catch (error: any) {
    if (error.code === 'auth/user-not-found') {
      console.log(`Sign-in link requested for unknown email: ${email}`);
      return {
        success: true,
        message: 'If an account exists for this email, a sign-in link has been sent.',
      };
    }
    throw new HttpsError('internal', `Auth lookup failed: ${error.message}`);
  }

  const continueUrl = `${APP_URL}/admin/auth/email-action/?email=${encodeURIComponent(email)}`;
  const signInLink = await admin.auth().generateSignInWithEmailLink(email, {
    url: continueUrl,
    handleCodeInApp: true,
  });

  await createTransporter().sendMail({
    from: `"Vidopick" <${SENDER_EMAIL}>`,
    to: email,
    subject: 'Your Vidopick sign-in link',
    html: buildSignInEmail(signInLink),
  });

  console.log(`Sent sign-in link to ${email}`);

  return {
    success: true,
    message: 'If an account exists for this email, a sign-in link has been sent.',
  };
});
