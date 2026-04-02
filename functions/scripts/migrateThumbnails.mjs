#!/usr/bin/env node
/**
 * Migration Script: Update Playlist Thumbnails to Video Thumbnails
 *
 * This script updates existing playlists in scannedPlaylists collection
 * to use video thumbnails instead of playlist thumbnails.
 *
 * Usage:
 *   node scripts/migrateThumbnails.mjs
 *   node scripts/migrateThumbnails.mjs --dryRun  // Preview without making changes
 *   node scripts/migrateThumbnails.mjs --limit 10  // Process first 10 playlists
 *   node scripts/migrateThumbnails.mjs --playlistIds "PLxxx,PLyyy,PLzzz"  // Specific playlists
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

// Initialize Firebase Admin
if (!getApps().length) {
  initializeApp({
    credential: cert(credsJson),
    projectId: credsJson.project_id,
  });
}

const db = getFirestore();
const COLLECTION_NAME = 'scannedPlaylists';

/**
 * Fetch first video ID from playlist XML feed
 */
async function fetchFirstVideoId(playlistId) {
  try {
    const response = await axios.get(
      `https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistId}`,
      { timeout: 10000 }
    );

    // Extract first video ID for thumbnail
    const videoIdMatch = response.data.match(/<yt:videoId>([a-zA-Z0-9_-]{11})<\/yt:videoId>/);

    if (videoIdMatch && videoIdMatch[1]) {
      return videoIdMatch[1];
    }

    return null;
  } catch (error) {
    console.error(`❌ Error fetching feed for ${playlistId}:`, error.message);
    return null;
  }
}

/**
 * Main migration function
 */
async function migrateThumbnails(options = {}) {
  const { dryRun = false, limit = null, playlistIds = [] } = options;

  console.log('🚀 Starting thumbnail migration...');
  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n');
  }

  let playlists = [];

  // Handle specific playlist IDs
  if (playlistIds.length > 0) {
    console.log(`🎯 Processing specific playlists: ${playlistIds.length} IDs\n`);

    // Fetch specific playlists by ID
    for (const id of playlistIds) {
      try {
        const doc = await db.collection(COLLECTION_NAME).doc(id).get();
        if (doc.exists) {
          playlists.push({ id: doc.id, ...doc.data() });
        } else {
          console.warn(`⚠️  Playlist ${id} not found in collection`);
        }
      } catch (error) {
        console.error(`❌ Error fetching playlist ${id}:`, error.message);
      }
    }
  } else {
    // Fetch all playlists (or limited set)
    if (limit) {
      console.log(`📊 Processing limit: ${limit} playlists\n`);
    }

    let query = db.collection(COLLECTION_NAME);

    if (limit) {
      query = query.limit(limit);
    }

    const snapshot = await query.get();
    playlists = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  }

  console.log(`📊 Found ${playlists.length} playlists in collection`);

  let updated = 0;
  let skipped = 0;
  let failed = 0;
  let noVideo = 0;

  for (let i = 0; i < playlists.length; i++) {
    const playlist = playlists[i];

    console.log(`\n[${i + 1}/${playlists.length}] 📹 ${playlist.title || playlist.id}`);

    // Skip if thumbnail is already in video format
    if (playlist.thumbnail && playlist.thumbnail.includes('img.youtube.com/vi/')) {
      console.log(`   ⏭️  Already using video thumbnail - skipping`);
      skipped++;
      continue;
    }

    try {
      // Fetch first video ID from feed
      console.log(`   🔍 Fetching first video ID...`);
      const videoId = await fetchFirstVideoId(playlist.id);

      if (!videoId) {
        console.log(`   ⚠️  No video ID found - keeping original thumbnail`);
        noVideo++;
        continue;
      }

      const newThumbnail = `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
      console.log(`   🖼️  New thumbnail: ${newThumbnail}`);

      if (!dryRun) {
        // Update document
        await db.collection(COLLECTION_NAME).doc(playlist.id).update({
          thumbnail: newThumbnail,
          updatedAt: new Date(),
        });
        console.log(`   ✅ Updated in database`);
      } else {
        console.log(`   🔍 Would update (dry run)`);
      }

      updated++;

      // Rate limiting delay (avoid hitting feed too hard)
      await new Promise((resolve) => setTimeout(resolve, 300));
    } catch (error) {
      console.error(`   ❌ Failed: ${error.message}`);
      failed++;
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 MIGRATION COMPLETE');
  console.log('='.repeat(60));
  console.log(`✅ Successfully processed: ${updated} playlists`);
  console.log(`⏭️  Already using video thumbnail: ${skipped} playlists`);
  console.log(`⚠️  No video found: ${noVideo} playlists`);
  if (failed > 0) {
    console.log(`❌ Failed: ${failed} playlists`);
  }
  if (dryRun) {
    console.log('\n💡 Run without --dryRun to apply changes');
  }
  console.log('='.repeat(60));
}

// CLI support
const { values } = parseArgs({
  options: {
    dryRun: { type: 'boolean', default: false },
    limit: { type: 'string' },
    playlistIds: { type: 'string' },
  },
  strict: false,
});

const options = {
  dryRun: values.dryRun,
  limit: values.limit ? parseInt(values.limit) : null,
  playlistIds: values.playlistIds ? values.playlistIds.split(',').map((id) => id.trim()) : [],
};

migrateThumbnails(options)
  .then(() => {
    console.log('\n✨ Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Error:', error);
    process.exit(1);
  });
