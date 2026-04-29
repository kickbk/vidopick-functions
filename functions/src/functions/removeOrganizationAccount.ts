import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

if (!admin.apps.length) {
  admin.initializeApp();
}

/**
 * Removes an organization's login access:
 * - Deletes the Firebase Auth user
 * - Nulls authUid in Firestore
 * The organization record itself is preserved.
 */
export const removeOrganizationAccount = onCall(async (request) => {
  if (!request.auth || request.auth.token.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Only admins can remove account access');
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

  const { authUid } = organizationSnap.data()!;

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

  await organizationRef.update({
    authUid: null,
    claimsSet: false,
    claimsSetAt: null,
    accountCreatedAt: null,
  });

  console.log(`Removed account access for organization ${organizationId}`);

  return { success: true, message: 'Account access removed and Firebase Auth user deleted' };
});
