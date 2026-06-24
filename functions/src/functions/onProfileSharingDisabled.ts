import * as admin from 'firebase-admin';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';

if (!admin.apps.length) admin.initializeApp();

// When a partner stops sharing a profile in the app, also disable its public profile entry
// so it no longer earns commission through the public partner page.
export const onProfileSharingDisabled = onDocumentUpdated(
  'profiles/{profileId}',
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;

    const wasShared = before.isShared === true;
    const isNowShared = after.isShared === true;
    const affiliateId: string | undefined = after.publicAffiliateId;

    if (!wasShared || isNowShared || !affiliateId) return;

    const profileId = event.params.profileId;
    const db = admin.firestore();

    const entrySnap = await db
      .doc(`affiliates/${affiliateId}/publicProfiles/${profileId}`)
      .get();
    if (!entrySnap.exists) return;

    const shortlinkId: string | undefined = entrySnap.data()?.shortlinkId;
    const writes: Promise<any>[] = [
      db.doc(`affiliates/${affiliateId}/publicProfiles/${profileId}`).delete(),
    ];
    if (shortlinkId) {
      writes.push(
        db.doc(`shortLinks/${shortlinkId}`).set({ disabled: true }, { merge: true })
      );
    }
    await Promise.all(writes);

    console.log(
      `[onProfileSharingDisabled] profileId=${profileId} affiliateId=${affiliateId} shortlinkId=${shortlinkId}`
    );
  }
);
