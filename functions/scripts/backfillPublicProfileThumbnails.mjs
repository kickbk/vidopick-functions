#!/usr/bin/env node
/**
 * One-time backfill: fetches playlist thumbnails for every existing
 * affiliates/{id}/publicProfiles/{profileId} entry that has no `thumbnails` field yet.
 *
 * For each entry it reads the profile's playlistIds from profiles/{profileId},
 * fetches up to 3 thumbnails from scannedPlaylists, then writes them back.
 *
 * Usage (from firebase/functions/):
 *   node scripts/backfillPublicProfileThumbnails.mjs
 *   node scripts/backfillPublicProfileThumbnails.mjs --dryRun
 *   node scripts/backfillPublicProfileThumbnails.mjs --force   # overwrite existing thumbnails too
 */

import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CREDS_PATH = path.resolve(__dirname, '../integrations/firebase/service-account.json');

let credsJson;
try {
  const raw = fs.readFileSync(CREDS_PATH, 'utf8');
  credsJson = JSON.parse(raw);
} catch {
  console.error(`Service account not found at: ${CREDS_PATH}`);
  process.exit(1);
}

if (!getApps().length) {
  initializeApp({ credential: cert(credsJson) });
}

const { values: flags } = parseArgs({
  options: {
    dryRun: { type: 'boolean', default: false },
    force:  { type: 'boolean', default: false },
  },
});

const db = getFirestore();

async function fetchPlaylistThumbnails(playlistIds) {
  const ids = playlistIds.slice(0, 3).filter(Boolean);
  if (ids.length === 0) return [];
  const snaps = await Promise.all(ids.map((id) => db.doc(`scannedPlaylists/${id}`).get()));
  return snaps.map((s) => s.data()?.thumbnail).filter(Boolean);
}

async function main() {
  console.log(`Mode: ${flags.dryRun ? 'DRY RUN' : 'LIVE'}${flags.force ? ' + force (overwrite existing)' : ''}\n`);

  const affiliatesSnap = await db
    .collection('affiliates')
    .where('type', '==', 'influencer')
    .get();

  console.log(`Found ${affiliatesSnap.size} influencer affiliate(s)\n`);

  let totalEntries = 0;
  let skipped = 0;
  let updated = 0;
  let noProfile = 0;
  let noThumbnails = 0;

  for (const affiliateDoc of affiliatesSnap.docs) {
    const affiliateId = affiliateDoc.id;
    const publicProfilesSnap = await db
      .collection('affiliates')
      .doc(affiliateId)
      .collection('publicProfiles')
      .get();

    if (publicProfilesSnap.empty) continue;

    for (const entryDoc of publicProfilesSnap.docs) {
      totalEntries++;
      const profileId = entryDoc.id;
      const entryData = entryDoc.data();

      if (!flags.force && Array.isArray(entryData.thumbnails) && entryData.thumbnails.length > 0) {
        skipped++;
        console.log(`  [skip]    affiliateId=${affiliateId} profileId=${profileId} — already has ${entryData.thumbnails.length} thumbnail(s)`);
        continue;
      }

      const profileSnap = await db.doc(`profiles/${profileId}`).get();
      if (!profileSnap.exists) {
        noProfile++;
        console.log(`  [missing] affiliateId=${affiliateId} profileId=${profileId} — profiles doc not found`);
        continue;
      }

      const playlistIds = profileSnap.data()?.playlistIds ?? [];
      const thumbnails = await fetchPlaylistThumbnails(playlistIds);

      if (thumbnails.length === 0) {
        noThumbnails++;
        console.log(`  [empty]   affiliateId=${affiliateId} profileId=${profileId} — ${playlistIds.length} playlist(s), none in scannedPlaylists`);
        continue;
      }

      console.log(`  [update]  affiliateId=${affiliateId} profileId=${profileId} — ${thumbnails.length} thumbnail(s) from ${playlistIds.length} playlist(s)`);

      if (!flags.dryRun) {
        await db
          .doc(`affiliates/${affiliateId}/publicProfiles/${profileId}`)
          .update({ thumbnails });
      }
      updated++;
    }
  }

  console.log(`
Done.
  Total entries : ${totalEntries}
  Updated       : ${updated}${flags.dryRun ? ' (dry run — no writes)' : ''}
  Skipped       : ${skipped} (already had thumbnails)
  No profile doc: ${noProfile}
  No thumbnails : ${noThumbnails}
`);
}

main().catch((e) => { console.error(e); process.exit(1); });
