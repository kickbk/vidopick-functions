import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

if (!admin.apps.length) {
  admin.initializeApp();
}

const DEMO_ORGANIZATION_ID = process.env.DEMO_ORGANIZATION_ID;

/**
 * Called every 2 minutes from the client while the demo account is active.
 * Updates lastDemoActivity in Firestore so the scheduled cleanup knows
 * the session is still alive.
 * Must be called by an authenticated demo user.
 */
export const demoHeartbeat = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in');
  }

  if (!DEMO_ORGANIZATION_ID) {
    throw new HttpsError('internal', 'Demo account not configured');
  }

  const db = admin.firestore();
  await db.doc(`organizations/${DEMO_ORGANIZATION_ID}`).update({
    lastDemoActivity: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { success: true };
});
