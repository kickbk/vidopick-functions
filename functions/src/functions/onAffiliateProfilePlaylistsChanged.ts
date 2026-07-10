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

// When an affiliate updates a featured profile, keep the snapshot fields on the
// publicProfiles entry (thumbnails, name, color) in sync — these are copied at
// add time (see addPublicProfile) and would otherwise go stale on rename/recolor.
// The write cascades to onVpPublicProfileWrite, which regenerates the profile HTML.
// Regular users who update non-featured profiles short-circuit on the
// publicAffiliateId check and incur no additional cost.
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
    const playlistsChanged = JSON.stringify(beforeIds) !== JSON.stringify(afterIds);
    const nameChanged = (before.name ?? '') !== (after.name ?? '');
    const colorChanged = (before.color ?? '') !== (after.color ?? '');

    if (!playlistsChanged && !nameChanged && !colorChanged) return;

    const profileId = event.params.profileId;
    const db = admin.firestore();

    const entryRef = db.doc(`affiliates/${affiliateId}/publicProfiles/${profileId}`);
    const entrySnap = await entryRef.get();
    if (!entrySnap.exists) return;

    // Mirror the same fields/defaults addPublicProfile snapshots at add time.
    const update: Record<string, unknown> = {};
    if (playlistsChanged) update.thumbnails = await fetchPlaylistThumbnails(db, afterIds);
    if (nameChanged) update.profileName = after.name ?? 'Profile';
    if (colorChanged) update.profileColor = after.color ?? '#3b82f6';

    await entryRef.update(update);

    console.log(
      `[onAffiliateProfilePlaylistsChanged] profileId=${profileId} affiliateId=${affiliateId} ` +
        `playlists=${playlistsChanged} name=${nameChanged} color=${colorChanged}`
    );
  }
);
