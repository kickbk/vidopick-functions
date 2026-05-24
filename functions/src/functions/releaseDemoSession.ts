import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { resetDemoSession } from '../utils/demoReset';

if (!admin.apps.length) {
  admin.initializeApp();
}

const DEMO_ORGANIZATION_ID = process.env.DEMO_ORGANIZATION_ID;

/**
 * Called on sign-out for the demo account, or by an admin to force-release a stuck session.
 * Resets stats, releases the session lock, and revokes the demo user's refresh tokens.
 */
export const releaseDemoSession = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in');
  }

  if (!DEMO_ORGANIZATION_ID) {
    throw new HttpsError('internal', 'Demo account not configured');
  }

  const isAdmin = request.auth.token.role === 'admin';
  const isDemo =
    request.auth.token.organizationId === DEMO_ORGANIZATION_ID ||
    request.auth.token.email?.toLowerCase() === 'demo@vidopick.com';

  if (!isAdmin && !isDemo) {
    throw new HttpsError('permission-denied', 'Not authorized to release demo session');
  }

  // Reset stats and clear the session lock
  await resetDemoSession();

  // Revoke the demo Firebase Auth user's refresh tokens
  try {
    const db = admin.firestore();
    const snap = await db.doc(`organizations/${DEMO_ORGANIZATION_ID}`).get();
    const authUid: string | undefined = snap.data()?.authUid;
    if (authUid && !isAdmin) {
      // Only revoke when the demo user themselves sign out (admin doesn't need this)
      await admin.auth().revokeRefreshTokens(authUid);
    }
    console.log(
      `Demo session released by ${isAdmin ? 'admin' : 'demo user'} (${request.auth.uid})`
    );
  } catch (error: any) {
    console.warn('Failed to revoke demo tokens:', error.message);
  }

  return { success: true };
});
