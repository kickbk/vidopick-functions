// Cloud Function to create advertiser account without logging in as them

import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

if (!admin.apps.length) {
  admin.initializeApp();
}

/**
 * Create an advertiser account server-side
 * This prevents logging out the admin who's creating the account
 */
export const createAdvertiserAccount = onCall(async (request) => {
  // Verify caller is admin
  if (!request.auth || request.auth.token.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Only admins can create advertiser accounts');
  }

  const { email, advertiserId } = request.data;

  if (!email || !advertiserId) {
    throw new HttpsError('invalid-argument', 'Email and advertiserId are required');
  }

  // Basic email format validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new HttpsError('invalid-argument', 'Invalid email format');
  }

  const db = admin.firestore();

  try {
    // SECURITY FIX: Check if advertiser document exists BEFORE creating user
    // This prevents creating "orphan" users if there is a typo in advertiserId
    const advertiserRef = db.doc(`advertisers/${advertiserId}`);
    const advertiserSnap = await advertiserRef.get();

    if (!advertiserSnap.exists) {
      throw new HttpsError('not-found', `Advertiser ID '${advertiserId}' does not exist.`);
    }

    // Generate temporary password
    const tempPassword = Math.random().toString(36).slice(-12) + 'A1!';

    // Create Firebase Auth account (server-side, doesn't affect current session)
    const userRecord = await admin.auth().createUser({
      email: email,
      password: tempPassword,
      emailVerified: false,
    });

    console.log(`Created user ${userRecord.uid} for ${email}`);

    // Set custom claims immediately
    await admin.auth().setCustomUserClaims(userRecord.uid, {
      role: 'advertiser',
      advertiserId: advertiserId,
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

    // Generate password reset link
    const resetLink = await admin.auth().generatePasswordResetLink(email);

    console.log(`Generated password reset link for ${email}`);

    return {
      success: true,
      message: `Account created for ${email}. Password reset link generated.`,
      uid: userRecord.uid,
      passwordResetLink: resetLink,
    };
  } catch (error: any) {
    console.error('Error creating advertiser account:', error);

    if (error.code === 'auth/email-already-exists') {
      throw new HttpsError('already-exists', 'An account with this email already exists');
    }

    // Pass through HttpsErrors directly
    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError('internal', `Failed to create account: ${error.message}`);
  }
});
