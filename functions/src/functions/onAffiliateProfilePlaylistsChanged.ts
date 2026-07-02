import * as admin from 'firebase-admin';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';

if (!admin.apps.length) admin.initializeApp();

async function fetchPlaylistThumbnails(
  db: admin.firestore.Firestore,
  playlistIds: string[]
): Promise<string[]> {
  const ids = playlistIds.slice(0, 3).filter(Boolean);
  if (ids.length === 0) return [];
  const snaps = await Promise.all(ids.map((id) => db.doc(`scannedPlaylists/${id}`).get()));
  return snaps
    .map((s) => s.data()?.thumbnail as string | undefined)
    .filter((t): t is string => !!t);
}

// When an affiliate updates the playlists in their featured profile, keep the
// thumbnail snapshot on the publicProfiles entry in sync. Regular users who
// update non-featured profiles short-circuit on the publicAffiliateId check
// and incur no additional cost.
export const onAffiliateProfilePlaylistsChanged = onDocumentUpdated(
  { document: 'profiles/{profileId}', region: 'us-central1' },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;

    const affiliateId: string | undefined = after.publicAffiliateId;
    if (!affiliateId) return;

    const beforeIds: string[] = before.playlistIds ?? [];
    const afterIds: string[] = after.playlistIds ?? [];

    if (JSON.stringify(beforeIds) === JSON.stringify(afterIds)) return;

    const profileId = event.params.profileId;
    const db = admin.firestore();

    const entrySnap = await db
      .doc(`affiliates/${affiliateId}/publicProfiles/${profileId}`)
      .get();
    if (!entrySnap.exists) return;

    const thumbnails = await fetchPlaylistThumbnails(db, afterIds);

    await db
      .doc(`affiliates/${affiliateId}/publicProfiles/${profileId}`)
      .update({ thumbnails });

    console.log(
      `[onAffiliateProfilePlaylistsChanged] profileId=${profileId} affiliateId=${affiliateId} thumbnails=${thumbnails.length}`
    );
  }
);
