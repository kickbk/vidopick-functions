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
 * Create an advertiser account server-side, then automatically send an invite email
 * with a magic sign-in link. No passwords involved — advertiser clicks the link to access
 * their account, and requests new links from the login page for future sign-ins.
 */
export const createAdvertiserAccount = onCall(async (request) => {
  if (!request.auth || request.auth.token.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Only admins can create advertiser accounts');
  }

  const { email, advertiserId, appOrigin } = request.data;
  const APP_URL = resolveAppUrl(appOrigin);

  if (!email || !advertiserId) {
    throw new HttpsError('invalid-argument', 'Email and advertiserId are required');
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new HttpsError('invalid-argument', 'Invalid email format');
  }

  const db = admin.firestore();

  // Check advertiser exists BEFORE creating the Auth user (prevents orphan accounts)
  const advertiserRef = db.doc(`advertisers/${advertiserId}`);
  const advertiserSnap = await advertiserRef.get();

  if (!advertiserSnap.exists) {
    throw new HttpsError('not-found', `Advertiser ID '${advertiserId}' does not exist.`);
  }

  const advertiserName: string = advertiserSnap.data()!.name || 'there';

  try {
    // Create Firebase Auth account with a random temp password the advertiser never uses
    const tempPassword = Math.random().toString(36).slice(-12) + 'A1!';
    const userRecord = await admin.auth().createUser({
      email,
      password: tempPassword,
      emailVerified: false,
    });

    console.log(`Created user ${userRecord.uid} for ${email}`);

    // Set custom claims immediately
    await admin.auth().setCustomUserClaims(userRecord.uid, {
      role: 'advertiser',
      advertiserId,
    });

    console.log(`Set advertiser claims for ${userRecord.uid}`);

    // Update Firestore
    await advertiserRef.update({
      authUid: userRecord.uid,
      accountCreatedAt: admin.firestore.FieldValue.serverTimestamp(),
      claimsSet: true,
      claimsSetAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`Updated Firestore for advertiser ${advertiserId}`);

    // Generate magic sign-in link and send invite email
    const continueUrl = `${APP_URL}/admin/auth/email-action/?email=${encodeURIComponent(email)}`;
    const signInLink = await admin.auth().generateSignInWithEmailLink(email, {
      url: continueUrl,
      handleCodeInApp: true,
    });

    if (RESEND_API_KEY) {
      const resend = new Resend(RESEND_API_KEY);
      await resend.emails.send({
        from: 'Vidopick <hello@vidopick.com>',
        to: email,
        subject: "You're invited to Vidopick",
        html: buildInviteEmail(advertiserName, signInLink),
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
    console.error('Error creating advertiser account:', error);

    if (error.code === 'auth/email-already-exists') {
      throw new HttpsError('already-exists', 'An account with this email already exists');
    }

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError('internal', `Failed to create account: ${error.message}`);
  }
});
