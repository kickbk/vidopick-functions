import * as admin from 'firebase-admin';
import { auth } from 'firebase-functions/v1';

if (!admin.apps.length) admin.initializeApp();

export const onUserCreated = auth.user().onCreate(async (user) => {
  const db = admin.firestore();
  await db.doc(`users/${user.uid}`).set(
    {
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      ...(user.email ? { email: user.email } : {}),
      ...(user.displayName ? { displayName: user.displayName } : {}),
    },
    { merge: true }
  );
});
