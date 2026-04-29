import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

if (!admin.apps.length) {
  admin.initializeApp();
}

export const deleteOrganization = onCall(async (request) => {
  if (!request.auth || request.auth.token.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Only admins can delete organizations');
  }

  const { organizationId } = request.data;

  if (!organizationId) {
    throw new HttpsError('invalid-argument', 'organizationId is required');
  }

  const db = admin.firestore();
  const organizationRef = db.doc(`organizations/${organizationId}`);
  const organizationSnap = await organizationRef.get();

  if (!organizationSnap.exists) {
    throw new HttpsError('not-found', 'Organization not found');
  }

  const data = organizationSnap.data()!;
  const organizationName = data.name || organizationId;

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
  await db.recursiveDelete(organizationRef);
  console.log(`Deleted organization ${organizationId} (${organizationName}) from Firestore`);

  return {
    success: true,
    message: `Organization "${organizationName}" has been permanently deleted`,
  };
});
