import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

if (!admin.apps.length) {
  admin.initializeApp();
}

export const deleteAdvertiser = onCall(async (request) => {
  if (!request.auth || request.auth.token.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Only admins can delete advertisers');
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

  const data = advertiserSnap.data()!;
  const advertiserName = data.name || advertiserId;

  // Delete Firebase Auth user if one exists
  if (data.authUid) {
    try {
      await admin.auth().deleteUser(data.authUid);
      console.log(`Deleted Firebase Auth user ${data.authUid}`);
    } catch (error: any) {
      if (error.code !== 'auth/user-not-found') {
        throw new HttpsError('internal', `Failed to delete auth user: ${error.message}`);
      }
      console.log(`Auth user ${data.authUid} was already deleted`);
    }
  }

  // Recursively delete the Firestore document and all sub-collections (ads, etc.)
  await db.recursiveDelete(advertiserRef);
  console.log(`Deleted advertiser ${advertiserId} (${advertiserName}) from Firestore`);

  return {
    success: true,
    message: `Advertiser "${advertiserName}" has been permanently deleted`,
  };
});
