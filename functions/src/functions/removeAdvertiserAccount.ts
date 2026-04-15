import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

if (!admin.apps.length) {
  admin.initializeApp();
}

/**
 * Removes an advertiser's login access:
 * - Deletes the Firebase Auth user
 * - Nulls authUid in Firestore
 * The advertiser record itself is preserved.
 */
export const removeAdvertiserAccount = onCall(async (request) => {
  if (!request.auth || request.auth.token.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Only admins can remove account access');
  }

  const { advertiserId } = request.data;

  if (!advertiserId) {
    throw new HttpsError('invalid-argument', 'advertiserId is required');
  }

  const db = admin.firestore();
  const advertiserRef = db.doc(`advertisers/${advertiserId}`);
  const advertiserSnap = await advertiserRef.get();

  if (!advertiserSnap.exists) {
    throw new HttpsError('not-found', 'Advertiser not found');
  }

  const { authUid } = advertiserSnap.data()!;

  if (authUid) {
    try {
      await admin.auth().deleteUser(authUid);
      console.log(`Deleted Firebase Auth user ${authUid}`);
    } catch (error: any) {
      if (error.code !== 'auth/user-not-found') {
        throw new HttpsError('internal', `Failed to delete auth user: ${error.message}`);
      }
      console.log(`Auth user ${authUid} was already deleted`);
    }
  }

  await advertiserRef.update({
    authUid: null,
    claimsSet: false,
    claimsSetAt: null,
    accountCreatedAt: null,
  });

  console.log(`Removed account access for advertiser ${advertiserId}`);

  return { success: true, message: 'Account access removed and Firebase Auth user deleted' };
});
