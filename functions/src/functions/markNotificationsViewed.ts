import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

if (!admin.apps.length) admin.initializeApp();

export const markNotificationsViewed = onCall(
  { region: 'us-central1', memory: '256MiB' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Not authenticated');

    const uid = request.auth.uid;
    const db = admin.firestore();

    const unviewedSnap = await db
      .collection('users')
      .doc(uid)
      .collection('notifications')
      .where('viewedAt', '==', null)
      .get();

    if (unviewedSnap.empty) return { updated: 0 };

    const now = admin.firestore.Timestamp.now();
    let batch = db.batch();
    let opCount = 0;
    let totalUpdated = 0;

    for (const docSnap of unviewedSnap.docs) {
      batch.update(docSnap.ref, { viewedAt: now });
      opCount++;
      totalUpdated++;
      if (opCount >= 499) {
        await batch.commit();
        batch = db.batch();
        opCount = 0;
      }
    }
    if (opCount > 0) await batch.commit();

    return { updated: totalUpdated };
  }
);
