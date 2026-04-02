import * as admin from 'firebase-admin';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

// Initialize admin if not already initialized
if (!admin.apps.length) {
  admin.initializeApp();
}

/**
 * Cloud Function that sets custom claims for advertiser users
 * Triggered when authUid field is added to an advertiser document
 */
export const setAdvertiserClaims = onDocumentUpdated(
  'advertisers/{advertiserId}',
  async (event) => {
    const advertiserId = event.params.advertiserId;
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
          role: 'advertiser',
          advertiserId: advertiserId,
        });

        console.log(`Custom claims set for advertiser ${advertiserId} (uid: ${authUid})`);

        // Optionally update the advertiser document to confirm claims were set
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
 * Alternative: HTTP Callable Function (if you prefer manual triggering)
 * Call from admin UI after creating account
 */
export const setAdvertiserClaimsManual = onCall(async (request) => {
  // Verify caller is admin
  if (!request.auth || request.auth.token.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Only admins can set advertiser claims');
  }

  const { authUid, advertiserId } = request.data;

  if (!authUid || !advertiserId) {
    throw new HttpsError('invalid-argument', 'authUid and advertiserId are required');
  }

  try {
    await admin.auth().setCustomUserClaims(authUid, {
      role: 'advertiser',
      advertiserId: advertiserId,
    });

    return { success: true, message: 'Custom claims set successfully' };
  } catch (error) {
    console.error('Error setting custom claims:', error);
    throw new HttpsError('internal', 'Failed to set custom claims');
  }
});
