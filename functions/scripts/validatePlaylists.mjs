#!/usr/bin/env node
/**
 * Migration Script: Validate scannedPlaylists video counts
 *
 * This script checks all approved playlists (isApproved: true) and:
 * 1. Verifies the playlist still exists on YouTube
 * 2. Counts the number of videos in the playlist
 * 3. Deletes playlists with less than 15 videos or that no longer exist
 * 4. Updates remaining playlists with accurate video counts
 *
 * Usage:
 *   node scripts/validateScannedPlaylists.mjs --limit 10  // Test mode (first 10 records)
 *   node scripts/validateScannedPlaylists.mjs --dryRun    // Preview without making changes
 *   node scripts/validateScannedPlaylists.mjs             // Run full migration
 */

import axios from 'axios';
import dotenv from 'dotenv';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

const CREDS_PATH = path.resolve(__dirname, '../integrations/firebase/service-account.json');

let credsJson;
try {
  const raw = fs.readFileSync(CREDS_PATH, 'utf8');
  credsJson = JSON.parse(raw);
} catch (e) {
  console.error(`❌ Unable to read credentials at ${CREDS_PATH}`);
  console.error(`Error: ${e?.message || e}`);
  process.exit(1);
}

if (!YOUTUBE_API_KEY) {
  console.error('❌ Missing YOUTUBE_API_KEY in .env');
  process.exit(1);
}

// Initialize Firebase Admin
if (!getApps().length) {
  initializeApp({
    credential: cert(credsJson),
    projectId: credsJson.project_id,
  });
}

const db = getFirestore();
const COLLECTION_NAME = 'scannedPlaylists';
const MIN_VIDEOS = 15;

/**
 * Get playlist video count from YouTube API
 */
async function getPlaylistVideoCount(playlistId) {
  try {
    const response = await axios.get('https://www.googleapis.com/youtube/v3/playlists', {
      params: {
        part: 'contentDetails',
        id: playlistId,
        key: YOUTUBE_API_KEY,
      },
    });

    if (!response.data.items || response.data.items.length === 0) {
      return null; // Playlist doesn't exist
    }

    const itemCount = response.data.items[0].contentDetails?.itemCount || 0;
    return itemCount;
  } catch (error) {
    console.error(`      ❌ API Error: ${error.message}`);
    return null;
  }
}

/**
 * Main validation function
 */
async function validatePlaylists(options = {}) {
  const { dryRun = false, limit = null, skipExisting = true } = options;

  console.log('🚀 Starting scannedPlaylists validation...');
  console.log(`📊 Minimum videos required: ${MIN_VIDEOS}`);
  if (limit) {
    console.log(`🔍 TEST MODE - Processing only ${limit} records`);
  }
  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made');
  }
  if (skipExisting) {
    console.log('⏭️  SKIP MODE - Skipping playlists with existing video counts');
  }
  console.log('');

  // Fetch approved playlists
  let query = db.collection(COLLECTION_NAME).where('isApproved', '==', true);

  if (limit) {
    query = query.limit(limit);
  }

  const snapshot = await query.get();
  const playlists = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

  console.log(`📋 Found ${playlists.length} approved playlists to check\n`);

  let kept = 0;
  let skipped = 0;
  let deletedNotFound = 0;
  let deletedTooFew = 0;
  let failed = 0;

  for (let i = 0; i < playlists.length; i++) {
    const playlist = playlists[i];
    console.log(`\n[${i + 1}/${playlists.length}] 🎬 ${playlist.title}`);
    console.log(`   ID: ${playlist.id}`);
    console.log(`   🔗 Link: https://www.youtube.com/playlist?list=${playlist.id}`);

    // Skip if already has video count and skipExisting is true
    if (skipExisting && typeof playlist.videos === 'number') {
      console.log(`   ⏭️  Already has video count: ${playlist.videos} (skipping)`);
      skipped++;
      continue;
    }

    try {
      // Get video count from YouTube
      const videoCount = await getPlaylistVideoCount(playlist.id);

      if (videoCount === null) {
        console.log(`   ❌ Playlist not found on YouTube`);
        if (!dryRun) {
          await db.collection(COLLECTION_NAME).doc(playlist.id).delete();
          console.log(`   🗑️  Deleted from database`);
        } else {
          console.log(`   🗑️  Would delete (dry run)`);
        }
        deletedNotFound++;
      } else if (videoCount < MIN_VIDEOS) {
        console.log(`   📊 Videos: ${videoCount} (below minimum of ${MIN_VIDEOS})`);
        if (!dryRun) {
          await db.collection(COLLECTION_NAME).doc(playlist.id).delete();
          console.log(`   🗑️  Deleted from database`);
        } else {
          console.log(`   🗑️  Would delete (dry run)`);
        }
        deletedTooFew++;
      } else {
        console.log(`   ✅ Videos: ${videoCount}`);
        if (!dryRun) {
          await db.collection(COLLECTION_NAME).doc(playlist.id).update({
            videos: videoCount,
            updatedAt: new Date(),
          });
          console.log(`   💾 Updated with video count`);
        } else {
          console.log(`   💾 Would update videos: ${videoCount} (dry run)`);
        }
        kept++;
      }

      // Small delay to avoid rate limits
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch (error) {
      console.error(`   ❌ Failed to process: ${error.message}`);
      failed++;
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 VALIDATION COMPLETE');
  console.log('='.repeat(60));
  console.log(`✅ Kept (${MIN_VIDEOS}+ videos): ${kept} playlists`);
  console.log(`🗑️  Deleted (not found): ${deletedNotFound} playlists`);
  console.log(`🗑️  Deleted (< ${MIN_VIDEOS} videos): ${deletedTooFew} playlists`);
  if (failed > 0) {
    console.log(`❌ Failed: ${failed} playlists`);
  }
  if (dryRun) {
    console.log('\n💡 Run without --dryRun to apply changes');
  }
  if (limit) {
    console.log(`\n💡 Remove --limit to process all approved playlists`);
  }
  console.log('='.repeat(60));
}

// CLI support
const { values } = parseArgs({
  options: {
    dryRun: { type: 'boolean', default: false },
    limit: { type: 'string' },
    skipExisting: { type: 'boolean', default: false },
  },
  strict: false,
});

const options = {
  dryRun: values.dryRun,
  limit: values.limit ? parseInt(values.limit) : null,
};

validatePlaylists(options)
  .then(() => {
    console.log('\n✨ Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Error:', error);
    process.exit(1);
  });
