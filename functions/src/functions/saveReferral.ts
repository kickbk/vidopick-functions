import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';

if (!admin.apps.length) admin.initializeApp();

export const saveReferral = onCall(
  { region: 'us-central1' },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Must be signed in.');

    const shortlinkId = (request.data?.shortlinkId ?? '').toString().trim();
    if (!shortlinkId) throw new HttpsError('invalid-argument', 'shortlinkId is required.');
    // Interpolated into a Firestore doc path below — reject anything but a plain id
    // so a crafted value can't reach arbitrary shortLinks/** sub-paths.
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(shortlinkId)) {
      throw new HttpsError('invalid-argument', 'Invalid shortlinkId.');
    }

    const db = admin.firestore();

    const [linkSnap, userSnap] = await Promise.all([
      db.doc(`shortLinks/${shortlinkId}`).get(),
      db.doc(`users/${uid}`).get(),
    ]);

    if (!linkSnap.exists) throw new HttpsError('not-found', 'Shortlink not found.');

    const linkData = linkSnap.data()!;
    const affiliateId: string | undefined = linkData.affiliateId;
    if (!affiliateId) return { saved: false, reason: 'not_an_affiliate_link' };
    if (linkData.disabled === true) return { saved: false, reason: 'link_disabled' };

    // Profile-page links carry affiliateId for commission but don't lock in referral attribution —
    // the user found the affiliate passively, not through a personal share.
    const linkType: string = linkData.linkType ?? (linkData.label ? 'referral' : 'app');
    if (linkType === 'profile') return { saved: false, reason: 'profile_links_not_eligible' };

    const userData = userSnap.data() ?? {};
    if (userData.referralLockedAt) return { saved: false, reason: 'referral_locked' };

    const date = new Date().toISOString().slice(0, 10);
    await Promise.all([
      db.doc(`users/${uid}`).set(
        {
          referredByShortlinkId: shortlinkId,
          referredByAffiliateId: affiliateId,
          referredAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      ),
      db.doc(`shortLinks/${shortlinkId}`).set(
        { analytics: { signups: admin.firestore.FieldValue.increment(1) } },
        { merge: true }
      ),
      db.collection(`affiliates/${affiliateId}/dailyStats`).doc(date).set(
        { signups: admin.firestore.FieldValue.increment(1) },
        { merge: true }
      ),
    ]);

    console.log(`[saveReferral] uid=${uid} referredByAffiliateId=${affiliateId} shortlinkId=${shortlinkId}`);
    return { saved: true };
  }
);
