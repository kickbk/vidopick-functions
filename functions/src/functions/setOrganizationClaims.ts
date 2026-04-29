import * as admin from 'firebase-admin';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

// Initialize admin if not already initialized
if (!admin.apps.length) {
  admin.initializeApp();
}

/**
 * Cloud Function that sets custom claims for organization users.
 * Triggered when authUid field is added to an organization document.
 */
export const setOrganizationClaims = onDocumentUpdated(
  'organizations/{organizationId}',
  async (event) => {
    const organizationId = event.params.organizationId;
    const beforeData = event.data?.before.data();
    const afterData = event.data?.after.data();

    if (!beforeData || !afterData) {
      console.log('No data available');
      return;
    }

    // Check if authUid was just added (account was created)
    if (!beforeData.authUid && afterData.authUid) {
      const authUid = afterData.authUid;

      try {
        // Set custom claims
        await admin.auth().setCustomUserClaims(authUid, {
          role: 'organization',
          organizationId,
        });

        console.log(`Custom claims set for organization ${organizationId} (uid: ${authUid})`);

        // Update the organization document to confirm claims were set
        await event.data?.after.ref.update({
          claimsSet: true,
          claimsSetAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        return { success: true };
      } catch (error) {
        console.error('Error setting custom claims:', error);
        throw new HttpsError('internal', 'Failed to set custom claims');
      }
    }

    return { success: false, message: 'No authUid change detected' };
  }
);

/**
 * HTTP Callable: manually set organization claims (admin only)
 */
export const setOrganizationClaimsManual = onCall(async (request) => {
  if (!request.auth || request.auth.token.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Only admins can set organization claims');
  }

  const { authUid, organizationId } = request.data;

  if (!authUid || !organizationId) {
    throw new HttpsError('invalid-argument', 'authUid and organizationId are required');
  }

  try {
    await admin.auth().setCustomUserClaims(authUid, {
      role: 'organization',
      organizationId,
    });

    return { success: true, message: 'Custom claims set successfully' };
  } catch (error) {
    console.error('Error setting custom claims:', error);
    throw new HttpsError('internal', 'Failed to set custom claims');
  }
});
