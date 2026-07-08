import * as https from 'https';
import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { Resend } from 'resend';
import {
  buildInviteEmail,
  buildMemberInviteEmail,
  buildSignInEmail,
} from '../utils/emailTemplates';

if (!admin.apps.length) {
  admin.initializeApp();
}

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY;

// Fail-closed Turnstile verification. A failed or missing verification rejects
// the request; transient errors reaching Cloudflare surface as 'unavailable' so
// the client retries instead of silently bypassing the CAPTCHA.
function verifyTurnstile(token: string): Promise<boolean> {
  if (!TURNSTILE_SECRET_KEY) {
    console.error('[Turnstile] Secret key not configured — rejecting (set TURNSTILE_SECRET_KEY)');
    throw new HttpsError('internal', 'Verification service misconfigured');
  }
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ secret: TURNSTILE_SECRET_KEY, response: token });
    const req = https.request(
      {
        hostname: 'challenges.cloudflare.com',
        path: '/turnstile/v0/siteverify',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          console.log(`[Turnstile] siteverify status=${res.statusCode} body=${raw}`);
          try {
            const data = JSON.parse(raw) as { success: boolean };
            resolve(data.success === true);
          } catch {
            // Non-JSON response (e.g. WAF block from cloud IP) — treat as a
            // service problem the client can retry, not a free pass.
            console.error('[Turnstile] Non-JSON response from siteverify');
            reject(
              new HttpsError('unavailable', 'Verification service unavailable. Please try again.')
            );
          }
        });
      }
    );
    req.on('error', (e) => {
      console.error('[Turnstile] Network error contacting siteverify:', e.message);
      reject(new HttpsError('unavailable', 'Verification service unavailable. Please try again.'));
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
    throw new HttpsError(
      'permission-denied',
      'Only admins and organization accounts can send invites'
    );
  }

  const { organizationId, memberId, appOrigin } = request.data;

  // Org accounts can only send invites for their own organization
  if (role === 'organization' && callerOrgId !== organizationId) {
    throw new HttpsError(
      'permission-denied',
      'You can only send invites for your own organization'
    );
  }

  const APP_URL = resolveAppUrl(appOrigin);

  if (!organizationId) {
    throw new HttpsError('invalid-argument', 'organizationId is required');
  }

  if (!RESEND_API_KEY) {
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

    const resend = new Resend(RESEND_API_KEY);
    await resend.emails.send({
      from: 'Vidopick <noreply@vidopick.com>',
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

  const resend = new Resend(RESEND_API_KEY);
  await resend.emails.send({
    from: 'Vidopick <noreply@vidopick.com>',
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

  if (!RESEND_API_KEY) {
    throw new HttpsError('internal', 'Email configuration missing');
  }

  const ALLOWED_ROLES = ['admin', 'organization', 'member'];

  let userRecord: admin.auth.UserRecord;
  try {
    userRecord = await admin.auth().getUserByEmail(email);
  } catch (error: any) {
    if (error.code === 'auth/user-not-found') {
      console.log(`Sign-in link requested for unknown email: ${email}`);
      throw new HttpsError(
        'permission-denied',
        'You do not have access to the Vidopick dashboard.'
      );
    }
    throw new HttpsError('internal', `Auth lookup failed: ${error.message}`);
  }

  const role = userRecord.customClaims?.['role'] as string | undefined;
  if (!role || !ALLOWED_ROLES.includes(role)) {
    console.log(`Sign-in link requested for unauthorized user: ${email} (role: ${role ?? 'none'})`);
    throw new HttpsError('permission-denied', 'You do not have access to the Vidopick dashboard.');
  }

  const continueUrl = `${APP_URL}/admin/auth/email-action/?email=${encodeURIComponent(email)}`;
  const signInLink = await admin.auth().generateSignInWithEmailLink(email, {
    url: continueUrl,
    handleCodeInApp: true,
  });

  const resend = new Resend(RESEND_API_KEY);
  await resend.emails.send({
    from: 'Vidopick <noreply@vidopick.com>',
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
