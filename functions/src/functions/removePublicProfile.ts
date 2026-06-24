import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

if (!admin.apps.length) admin.initializeApp();

export const removePublicProfile = onCall(
  { region: 'us-central1', memory: '256MiB' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in');

    const { profileId } = (request.data ?? {}) as { profileId?: string };
    if (!profileId) throw new HttpsError('invalid-argument', 'profileId is required');

    const db = admin.firestore();

    // Resolve affiliate
    const uidSnap = await db
      .collection('affiliates')
      .where('authUid', '==', request.auth.uid)
      .where('type', '==', 'influencer')
      .limit(1)
      .get();

    let affiliateId: string;
    if (!uidSnap.empty) {
      affiliateId = uidSnap.docs[0].id;
    } else if (request.auth.token.email_verified && request.auth.token.email) {
      const emailSnap = await db
        .collection('affiliates')
        .where('email', '==', (request.auth.token.email as string).toLowerCase())
        .where('type', '==', 'influencer')
        .limit(1)
        .get();
      if (emailSnap.empty) throw new HttpsError('permission-denied', 'Not a registered affiliate');
      affiliateId = emailSnap.docs[0].id;
      emailSnap.docs[0].ref
        .set({ authUid: request.auth.uid }, { merge: true })
        .catch((e) => console.warn('[removePublicProfile] authUid backfill failed:', e));
    } else {
      throw new HttpsError('permission-denied', 'Not a registered affiliate');
    }

    // Verify the public profile entry belongs to this affiliate
    const entrySnap = await db.doc(`affiliates/${affiliateId}/publicProfiles/${profileId}`).get();
    if (!entrySnap.exists) throw new HttpsError('not-found', 'Public profile entry not found');

    const { shortlinkId } = entrySnap.data() as { shortlinkId: string };

    // Remove affiliateId from the shortlink (don't disable — partner may still use it personally)
    // Also clear publicAffiliateId from the profile so the Firestore trigger won't double-fire
    await Promise.all([
      db.doc(`shortLinks/${shortlinkId}`).update({
        affiliateId: admin.firestore.FieldValue.delete(),
      }),
      db.doc(`profiles/${profileId}`).update({
        publicAffiliateId: admin.firestore.FieldValue.delete(),
      }),
      db.doc(`affiliates/${affiliateId}/publicProfiles/${profileId}`).delete(),
    ]);

    console.log(
      `[removePublicProfile] affiliateId=${affiliateId} profileId=${profileId} shortlinkId=${shortlinkId}`
    );

    return { success: true };
  }
);
