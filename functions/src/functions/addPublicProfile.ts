import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

if (!admin.apps.length) admin.initializeApp();

async function resolveAffiliate(
  db: admin.firestore.Firestore,
  authUid: string,
  email: string | undefined,
  emailVerified: boolean
): Promise<{ affiliateId: string; affiliateData: admin.firestore.DocumentData }> {
  const uidSnap = await db
    .collection('affiliates')
    .where('authUid', '==', authUid)
    .where('type', '==', 'influencer')
    .limit(1)
    .get();

  if (!uidSnap.empty) {
    return { affiliateId: uidSnap.docs[0].id, affiliateData: uidSnap.docs[0].data() };
  }

  if (emailVerified && email) {
    const emailSnap = await db
      .collection('affiliates')
      .where('email', '==', email.toLowerCase())
      .where('type', '==', 'influencer')
      .limit(1)
      .get();
    if (!emailSnap.empty) {
      const affiliateId = emailSnap.docs[0].id;
      emailSnap.docs[0].ref
        .set({ authUid }, { merge: true })
        .catch((e) => console.warn('[addPublicProfile] authUid backfill failed:', e));
      return { affiliateId, affiliateData: emailSnap.docs[0].data() };
    }
  }

  throw new HttpsError('permission-denied', 'Not a registered affiliate');
}

export const addPublicProfile = onCall(
  { region: 'us-central1', memory: '256MiB' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in');

    const { profileId, description } = (request.data ?? {}) as {
      profileId?: string;
      description?: string;
    };

    if (!profileId) throw new HttpsError('invalid-argument', 'profileId is required');
    if (!description?.trim()) throw new HttpsError('invalid-argument', 'description is required');

    const db = admin.firestore();
    const { affiliateId, affiliateData } = await resolveAffiliate(
      db,
      request.auth.uid,
      request.auth.token.email,
      request.auth.token.email_verified ?? false
    );

    const profileSnap = await db.doc(`profiles/${profileId}`).get();
    if (!profileSnap.exists) throw new HttpsError('not-found', 'Profile not found');
    const profileData = profileSnap.data()!;
    if (profileData.uid !== request.auth.uid) {
      throw new HttpsError('permission-denied', 'Profile does not belong to your account');
    }

    const existingEntry = await db.doc(`affiliates/${affiliateId}/publicProfiles/${profileId}`).get();
    if (existingEntry.exists) {
      throw new HttpsError('already-exists', 'This profile is already featured publicly');
    }

    // Get or create the profile's shortlink
    let shortlinkId: string = profileData.inviteId;

    if (!shortlinkId) {
      const slRef = db.collection('shortLinks').doc();
      shortlinkId = slRef.id;
      await slRef.set({
        linkTitle: `${affiliateData.name} invites you to try Vidopick`,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdBy: request.auth.uid,
        affiliateId,
        linkType: 'profile',
        disabled: false,
        redirect: {
          ios: 'https://apps.apple.com/us/app/vidopick/id6749210639',
          android: 'https://play.google.com/store/apps/details?id=com.vidopick.app',
          desktop: 'https://vidopick.com/get/',
          webOnly: false,
        },
        params: {
          name: affiliateData.name,
          profile: {
            uid: profileData.uid,
            profileId,
            displayName: profileData.name ?? affiliateData.name,
            color: profileData.color ?? 'blue',
            playlistIds: profileData.playlistIds ?? [],
          },
        },
        analytics: {},
        meta: { template: 'invite' },
      });
      await db.doc(`profiles/${profileId}`).set(
        { isShared: true, publicAffiliateId: affiliateId },
        { merge: true }
      );
    } else {
      // Always create a fresh shortlink for the public profile page (linkType: 'profile').
      // Never reuse or mutate a referral/app link — different commission rate (10% vs 25%).
      const slRef = db.collection('shortLinks').doc();
      shortlinkId = slRef.id;
      await slRef.set({
        linkTitle: `${affiliateData.name} invites you to try Vidopick`,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdBy: request.auth.uid,
        affiliateId,
        linkType: 'profile',
        disabled: false,
        redirect: {
          ios: 'https://apps.apple.com/us/app/vidopick/id6749210639',
          android: 'https://play.google.com/store/apps/details?id=com.vidopick.app',
          desktop: 'https://vidopick.com/get/',
          webOnly: false,
        },
        params: {
          name: affiliateData.name,
          profile: {
            uid: profileData.uid,
            profileId,
            displayName: profileData.name ?? affiliateData.name,
            color: profileData.color ?? 'blue',
            playlistIds: profileData.playlistIds ?? [],
          },
        },
        analytics: {},
        meta: { template: 'invite' },
      });
      await db.doc(`profiles/${profileId}`).set(
        { publicAffiliateId: affiliateId },
        { merge: true }
      );
    }

    await db.doc(`affiliates/${affiliateId}/publicProfiles/${profileId}`).set({
      profileId,
      shortlinkId,
      description: description.trim(),
      profileName: profileData.name ?? 'Profile',
      profileColor: profileData.color ?? '#3b82f6',
      addedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(
      `[addPublicProfile] affiliateId=${affiliateId} profileId=${profileId} shortlinkId=${shortlinkId}`
    );

    return { success: true, shortlinkId };
  }
);
