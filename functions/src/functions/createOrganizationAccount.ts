import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { Resend } from 'resend';
import { buildInviteEmail } from '../utils/emailTemplates';

if (!admin.apps.length) {
  admin.initializeApp();
}

const RESEND_API_KEY = process.env.RESEND_API_KEY;

const ALLOWED_ORIGINS = ['https://vidopick.com', 'http://localhost:5173'];

function resolveAppUrl(appOrigin?: string): string {
  if (appOrigin && ALLOWED_ORIGINS.includes(appOrigin)) return appOrigin;
  return 'https://vidopick.com';
}

/**
 * Create an organization account server-side, then automatically send an invite email
 * with a magic sign-in link. No passwords involved — org user clicks the link to access
 * their account, and requests new links from the login page for future sign-ins.
 */
export const createOrganizationAccount = onCall(async (request) => {
  if (!request.auth || request.auth.token.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Only admins can create organization accounts');
  }

  const { email, organizationId, appOrigin } = request.data;
  const APP_URL = resolveAppUrl(appOrigin);

  if (!email || !organizationId) {
    throw new HttpsError('invalid-argument', 'Email and organizationId are required');
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new HttpsError('invalid-argument', 'Invalid email format');
  }

  const db = admin.firestore();

  // Check organization exists BEFORE creating the Auth user (prevents orphan accounts)
  const organizationRef = db.doc(`organizations/${organizationId}`);
  const organizationSnap = await organizationRef.get();

  if (!organizationSnap.exists) {
    throw new HttpsError('not-found', `Organization ID '${organizationId}' does not exist.`);
  }

  const organizationName: string = organizationSnap.data()!.name || 'there';

  try {
    // Create Firebase Auth account, or reuse an existing one if the email is
    // already registered (e.g. a Pro app-user who is also an org admin).
    let userRecord: admin.auth.UserRecord;
    try {
      const tempPassword = Math.random().toString(36).slice(-12) + 'A1!';
      userRecord = await admin.auth().createUser({
        email,
        password: tempPassword,
        emailVerified: false,
      });
      console.log(`Created user ${userRecord.uid} for ${email}`);
    } catch (createErr: any) {
      if (createErr.code !== 'auth/email-already-exists') throw createErr;
      userRecord = await admin.auth().getUserByEmail(email);
      console.log(`Reusing existing user ${userRecord.uid} for ${email}`);
    }

    // Set custom claims immediately
    await admin.auth().setCustomUserClaims(userRecord.uid, {
      role: 'organization',
      organizationId,
    });

    console.log(`Set organization claims for ${userRecord.uid}`);

    // Update Firestore
    await organizationRef.update({
      authUid: userRecord.uid,
      accountCreatedAt: admin.firestore.FieldValue.serverTimestamp(),
      claimsSet: true,
      claimsSetAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`Updated Firestore for organization ${organizationId}`);

    // Generate magic sign-in link and send invite email
    const continueUrl = `${APP_URL}/admin/auth/email-action/?email=${encodeURIComponent(email)}`;
    const signInLink = await admin.auth().generateSignInWithEmailLink(email, {
      url: continueUrl,
      handleCodeInApp: true,
    });

    if (RESEND_API_KEY) {
      const resend = new Resend(RESEND_API_KEY);
      await resend.emails.send({
        from: 'Vidopick <noreply@vidopick.com>',
        to: email,
        subject: "You're invited to Vidopick",
        html: buildInviteEmail(organizationName, signInLink),
      });
      console.log(`Sent invite email to ${email}`);
    } else {
      console.warn('RESEND_API_KEY not configured — invite email not sent');
    }

    return {
      success: true,
      message: `Account created and invite email sent to ${email}`,
      uid: userRecord.uid,
    };
  } catch (error: any) {
    console.error('Error creating organization account:', error);

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError('internal', `Failed to create account: ${error.message}`);
  }
});
