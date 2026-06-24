import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

if (!admin.apps.length) admin.initializeApp();

/**
 * Fallback Pro grant for affiliates whose account missed the automatic paths.
 *
 * onUserCreated only grants Pro when emailVerified is true at creation time, and
 * sendAffiliateInvite pre-provisions the auth user — but an affiliate who signed up
 * in the app with email+password before the invite was sent has neither. After they
 * verify their email, this callable grants Pro and links the affiliate record.
 * Requires email_verified so an unverified account can't claim someone's Pro.
 */
export const claimAffiliatePro = onCall(
  { region: 'us-central1', memory: '256MiB' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in');
    if (!request.auth.token.email_verified) {
      throw new HttpsError('failed-precondition', 'Email must be verified first');
    }
    const email = request.auth.token.email;
    if (!email) throw new HttpsError('failed-precondition', 'No email on account');

    const uid = request.auth.uid;
    const db = admin.firestore();

    // Idempotent: already granted
    const userSnap = await db.doc(`users/${uid}`).get();
    if (userSnap.data()?.proType === 'affiliate') {
      return { granted: false, reason: 'already_granted' };
    }

    const affiliateSnap = await db
      .collection('affiliates')
      .where('email', '==', email.toLowerCase())
      .where('type', '==', 'influencer')
      .limit(1)
      .get();

    if (affiliateSnap.empty) {
      return { granted: false, reason: 'not_an_affiliate' };
    }

    const affiliateDoc = affiliateSnap.docs[0];
    const affiliateName: string = affiliateDoc.data().name ?? 'My Profile';

    await Promise.all([
      db.doc(`users/${uid}`).set(
        {
          proStatus: 'active',
          proType: 'affiliate',
          affiliateGrantedAt: admin.firestore.FieldValue.serverTimestamp(),
          name: affiliateName,
        },
        { merge: true }
      ),
      affiliateDoc.ref.set({ authUid: uid }, { merge: true }),
    ]);

    console.log(`[claimAffiliatePro] granted uid=${uid} affiliateId=${affiliateDoc.id}`);
    return { granted: true };
  }
);
