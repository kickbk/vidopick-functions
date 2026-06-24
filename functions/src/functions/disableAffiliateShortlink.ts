import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

if (!admin.apps.length) admin.initializeApp();

export const disableAffiliateShortlink = onCall(
  { region: 'us-central1', memory: '256MiB', invoker: 'public' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in');

    const isAdmin = request.auth.token.role === 'admin';
    const { shortlinkId } = (request.data ?? {}) as { shortlinkId?: string };
    if (!shortlinkId) throw new HttpsError('invalid-argument', 'shortlinkId required');

    const db = admin.firestore();
    const slSnap = await db.doc(`shortLinks/${shortlinkId}`).get();
    if (!slSnap.exists) throw new HttpsError('not-found', 'Shortlink not found');

    const slData = slSnap.data()!;

    if (!isAdmin) {
      let affiliateDocId: string | null = null;

      const uidSnap = await db
        .collection('affiliates')
        .where('authUid', '==', request.auth.uid)
        .where('type', '==', 'influencer')
        .limit(1)
        .get();

      if (!uidSnap.empty) {
        affiliateDocId = uidSnap.docs[0].id;
      } else if (request.auth.token.email_verified && request.auth.token.email) {
        const emailSnap = await db
          .collection('affiliates')
          .where('email', '==', (request.auth.token.email as string).toLowerCase())
          .where('type', '==', 'influencer')
          .limit(1)
          .get();
        if (!emailSnap.empty) {
          affiliateDocId = emailSnap.docs[0].id;
          emailSnap.docs[0].ref
            .set({ authUid: request.auth.uid }, { merge: true })
            .catch((e) => console.warn('[disableAffiliateShortlink] authUid backfill failed:', e));
        }
      }

      if (!affiliateDocId) throw new HttpsError('permission-denied', 'Not a registered affiliate');
      if (slData.affiliateId !== affiliateDocId) {
        throw new HttpsError('permission-denied', 'This link does not belong to your account');
      }
    }

    // Mark shortlink disabled — coupon is left in Stripe to preserve usage history
    const writes: Promise<any>[] = [
      db.doc(`shortLinks/${shortlinkId}`).set({ disabled: true }, { merge: true }),
    ];
    const attachedProfileId: string | undefined = slData.params?.profile?.profileId;
    if (attachedProfileId) {
      writes.push(
        db.doc(`profiles/${attachedProfileId}`).set(
          { isAffiliateLinkActive: false },
          { merge: true }
        )
      );
    }
    await Promise.all(writes);

    console.log(`[disableAffiliateShortlink] disabled shortlinkId=${shortlinkId}`);
    return { success: true };
  }
);
