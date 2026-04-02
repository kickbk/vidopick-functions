#!/usr/bin/env node
/**
 * Migration Script: Convert shortLinks playlists from objects to string arrays
 *
 * This script updates existing shortLinks documents where params.playlists
 * contains objects with {id, title} and converts them to simple arrays of playlist IDs.
 *
 * Usage:
 *   node scripts/migrateShortLinksPlaylists.mjs
 *   node scripts/migrateShortLinksPlaylists.mjs --dryRun  // Preview without making changes
 */

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
const COLLECTION_NAME = 'shortLinks';

/**
 * Check if playlists needs migration (contains objects instead of strings)
 */
function needsMigration(playlists) {
  if (!playlists) return false;
  if (!Array.isArray(playlists)) return false;
  if (playlists.length === 0) return false;

  // Check if any item is an object (not a string)
  return playlists.some((item) => typeof item === 'object' && item !== null);
}

/**
 * Convert playlists from objects to array of IDs
 */
function convertPlaylists(playlists) {
  return playlists
    .map((item) => {
      if (typeof item === 'string') {
        return item; // Already a string ID
      } else if (typeof item === 'object' && item !== null && item.id) {
        return item.id; // Extract ID from object
      } else {
        console.warn(`   ⚠️  Unexpected playlist format:`, item);
        return null;
      }
    })
    .filter(Boolean); // Remove any null values
}

/**
 * Main migration function
 */
async function migratePlaylists(options = {}) {
  const { dryRun = false } = options;

  console.log('🚀 Starting shortLinks playlists migration...');
  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n');
  }

  // Fetch all shortLinks
  const snapshot = await db.collection(COLLECTION_NAME).get();
  const shortLinks = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

  console.log(`📊 Found ${shortLinks.length} shortLinks in collection`);

  // Filter shortLinks that have playlists in params
  const withPlaylists = shortLinks.filter((link) => link.params?.playlists);
  console.log(`🎬 ${withPlaylists.length} shortLinks have playlists`);

  // Filter those that need migration
  const needsMigrationList = withPlaylists.filter((link) => needsMigration(link.params.playlists));
  console.log(`🔧 ${needsMigrationList.length} shortLinks need migration\n`);

  if (needsMigrationList.length === 0) {
    console.log('✅ All shortLinks already have the correct playlist format!');
    return;
  }

  let updated = 0;
  let failed = 0;

  for (const link of needsMigrationList) {
    console.log(`\n🔗 Processing: ${link.id}`);
    console.log(`   Title: ${link.linkTitle || 'Untitled'}`);

    try {
      const oldPlaylists = link.params.playlists;
      const newPlaylists = convertPlaylists(oldPlaylists);

      console.log(`   📝 Old format (${oldPlaylists.length} items):`);
      oldPlaylists.forEach((item, i) => {
        if (typeof item === 'object') {
          console.log(`      ${i + 1}. {id: "${item.id}", title: "${item.title || ''}"}`);
        } else {
          console.log(`      ${i + 1}. "${item}"`);
        }
      });

      console.log(`   ✨ New format (${newPlaylists.length} items):`);
      newPlaylists.forEach((id, i) => {
        console.log(`      ${i + 1}. "${id}"`);
      });

      if (!dryRun) {
        // Update document
        await db.collection(COLLECTION_NAME).doc(link.id).update({
          'params.playlists': newPlaylists,
        });
        console.log(`   ✅ Updated in database`);
      } else {
        console.log(`   🔍 Would update (dry run)`);
      }

      updated++;
    } catch (error) {
      console.error(`   ❌ Failed: ${error.message}`);
      failed++;
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 MIGRATION COMPLETE');
  console.log('='.repeat(60));
  console.log(`✅ Successfully processed: ${updated} shortLinks`);
  if (failed > 0) {
    console.log(`❌ Failed: ${failed} shortLinks`);
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
  },
  strict: false,
});

migratePlaylists({ dryRun: values.dryRun })
  .then(() => {
    console.log('\n✨ Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Error:', error);
    process.exit(1);
  });
