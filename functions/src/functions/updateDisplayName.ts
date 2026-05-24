import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

if (!admin.apps.length) admin.initializeApp();

/**
 * Updates the caller's Firebase Auth displayName and propagates the new name
 * to all shortLinks they own (params.name + linkTitle).
 */
export const updateDisplayName = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be logged in');
  }

  const { name } = request.data as { name: string };
  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new HttpsError('invalid-argument', 'name is required');
  }

  const trimmed = name.trim();
  const uid = request.auth.uid;
  const db = admin.firestore();

  await db.doc(`users/${uid}`).set({ displayName: trimmed }, { merge: true });

  const shortLinksSnap = await db.collection('shortLinks').where('createdBy', '==', uid).get();

  if (!shortLinksSnap.empty) {
    const BATCH_SIZE = 500;
    const docs = shortLinksSnap.docs;
    for (let i = 0; i < docs.length; i += BATCH_SIZE) {
      const batch = db.batch();
      docs.slice(i, i + BATCH_SIZE).forEach((doc) => {
        batch.update(doc.ref, {
          'params.name': trimmed,
          linkTitle: `${trimmed} invites you to try Vidopick`,
        });
      });
      await batch.commit();
    }
    console.log(`[updateDisplayName] propagated name to ${docs.length} shortLinks for uid=${uid}`);
  }

  return { success: true };
});
