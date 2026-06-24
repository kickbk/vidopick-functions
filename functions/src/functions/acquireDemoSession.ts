import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { sendDemoNotification } from '../utils/sendDemoNotification';

if (!admin.apps.length) {
  admin.initializeApp();
}

const DEMO_ORGANIZATION_ID = process.env.DEMO_ORGANIZATION_ID;
const DEMO_AUTH_UID = process.env.DEMO_AUTH_UID;
const SESSION_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Called immediately after sign-in on the EmailSignInAction page (demo flow only).
 * Atomically acquires the demo session lock, or rejects if already taken.
 * Must be called by an authenticated demo user.
 */
export const acquireDemoSession = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in');
  }

  if (!DEMO_ORGANIZATION_ID) {
    throw new HttpsError('internal', 'Demo account not configured');
  }

  const { recipientEmail } = request.data;

  const db = admin.firestore();
  const organizationRef = db.doc(`organizations/${DEMO_ORGANIZATION_ID}`);

  // Use a transaction to atomically check-and-set the session lock
  const acquired = await db.runTransaction(async (tx) => {
    const snap = await tx.get(organizationRef);
    if (!snap.exists) throw new HttpsError('not-found', 'Demo organization not found');

    const data = snap.data()!;

    if (data.demoSessionActive) {
      const lockedAt: admin.firestore.Timestamp | undefined = data.demoSessionLockedAt;
      const lastActivity: admin.firestore.Timestamp | undefined = data.lastDemoActivity;
      const activityTs = lastActivity ?? lockedAt;
      const isStale = activityTs && Date.now() - activityTs.toMillis() > SESSION_TIMEOUT_MS;

      if (!isStale) {
        return false; // Session is legitimately in use
      }
    }

    tx.update(organizationRef, {
      demoSessionActive: true,
      demoSessionLockedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastDemoActivity: admin.firestore.FieldValue.serverTimestamp(),
      demoSessionRecipientEmail: recipientEmail || null,
    });

    return true;
  });

  if (!acquired) {
    throw new HttpsError(
      'resource-exhausted',
      'Demo account is currently in use. Please try again in a few minutes.'
    );
  }

  // Self-heal: if the demo auth account has lost its role claims (e.g. after being reset),
  // restore them now so the front-end token refresh picks them up immediately.
  // Only allowed for the designated demo auth account — prevents any authenticated
  // caller from acquiring permanent org-level claims via this function.
  const uid = request.auth.uid;
  if (DEMO_AUTH_UID && uid === DEMO_AUTH_UID) {
    const userRecord = await admin.auth().getUser(uid);
    const existingClaims = (userRecord.customClaims ?? {}) as Record<string, unknown>;
    if (!existingClaims.role) {
      await admin.auth().setCustomUserClaims(uid, {
        ...existingClaims,
        role: 'organization',
        organizationId: DEMO_ORGANIZATION_ID,
      });
      console.log(`acquireDemoSession: restored missing claims for demo user ${uid}`);
    }
  }

  console.log(`Demo session acquired by ${recipientEmail ?? uid}`);
  await sendDemoNotification(recipientEmail ?? null);
  return { success: true };
});
