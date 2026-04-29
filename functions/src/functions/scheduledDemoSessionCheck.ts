import * as admin from 'firebase-admin';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { resetDemoSession } from '../utils/demoReset';

if (!admin.apps.length) {
  admin.initializeApp();
}

const DEMO_ORGANIZATION_ID = process.env.DEMO_ORGANIZATION_ID;
const SESSION_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Runs every 5 minutes. Auto-releases expired demo sessions — handles the case
 * where the user closed the tab without explicitly signing out.
 */
export const scheduledDemoSessionCheck = onSchedule('every 5 minutes', async () => {
  if (!DEMO_ORGANIZATION_ID) {
    console.log('scheduledDemoSessionCheck: DEMO_ORGANIZATION_ID not configured, skipping');
    return;
  }

  const db = admin.firestore();
  const snap = await db.doc(`organizations/${DEMO_ORGANIZATION_ID}`).get();

  if (!snap.exists) return;

  const data = snap.data()!;

  if (!data.demoSessionActive) return;

  const lockedAt: admin.firestore.Timestamp | undefined = data.demoSessionLockedAt;
  const lastActivity: admin.firestore.Timestamp | undefined = data.lastDemoActivity;
  const activityTs = lastActivity ?? lockedAt;

  if (!activityTs) {
    // Malformed session — release it
    console.warn('scheduledDemoSessionCheck: session active but no timestamp, releasing');
    await resetDemoSession();
    return;
  }

  const idleMs = Date.now() - activityTs.toMillis();
  if (idleMs > SESSION_TIMEOUT_MS) {
    console.log(
      `scheduledDemoSessionCheck: session idle for ${Math.round(idleMs / 1000)}s, releasing`
    );

    // Revoke tokens for the demo Firebase Auth user so the session is invalidated server-side
    try {
      const demoSnap = await db.doc(`organizations/${DEMO_ORGANIZATION_ID}`).get();
      const authUid: string | undefined = demoSnap.data()?.authUid;
      if (authUid) {
        await admin.auth().revokeRefreshTokens(authUid);
      }
    } catch (err: any) {
      console.warn('scheduledDemoSessionCheck: failed to revoke tokens:', err.message);
    }

    await resetDemoSession();
  } else {
    console.log(
      `scheduledDemoSessionCheck: session active, idle for ${Math.round(idleMs / 1000)}s — OK`
    );
  }
});
