#!/usr/bin/env node
/**
 * Backfill Script: Add type: "playlist" to all scannedPlaylists records
 *
 * Skips any document that already has a `type` field (idempotent).
 * Uses Firestore batched writes (500 per batch).
 *
 * Usage:
 *   node scripts/addTypeToPlaylists.mjs
 *   node scripts/addTypeToPlaylists.mjs --dryRun
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
  console.error(`❌ Unable to read credentials at ${CREDS_PATH}`);
  process.exit(1);
}

if (!getApps().length) {
  initializeApp({ credential: cert(credsJson), projectId: credsJson.project_id });
}

const db = getFirestore();
const COLLECTION = 'scannedPlaylists';
const BATCH_SIZE = 500;

async function run({ dryRun }) {
  console.log(`🚀 Backfilling type: "playlist" on ${COLLECTION}...`);
  if (dryRun) console.log('🔍 DRY RUN — no changes will be written\n');

  const snapshot = await db.collection(COLLECTION).get();
  const docs = snapshot.docs;
  console.log(`📊 Total documents: ${docs.length}`);

  const needsUpdate = docs.filter((doc) => doc.data().type === undefined);
  console.log(`🔧 Missing type field: ${needsUpdate.length}`);
  console.log(`⏭  Already have type:  ${docs.length - needsUpdate.length}\n`);

  if (needsUpdate.length === 0) {
    console.log('✅ Nothing to update!');
    return;
  }

  if (dryRun) {
    console.log('💡 Would set type: "playlist" on the above records.');
    return;
  }

  let written = 0;
  let failed = 0;

  for (let i = 0; i < needsUpdate.length; i += BATCH_SIZE) {
    const chunk = needsUpdate.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const doc of chunk) {
      batch.update(doc.ref, { type: 'playlist' });
    }
    try {
      await batch.commit();
      written += chunk.length;
      console.log(`  ✓ Batch ${Math.floor(i / BATCH_SIZE) + 1}: wrote ${chunk.length} records (total: ${written})`);
    } catch (err) {
      console.error(`  ❌ Batch failed: ${err.message}`);
      failed += chunk.length;
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log('📊 COMPLETE');
  console.log('='.repeat(50));
  console.log(`✅ Updated: ${written}`);
  if (failed > 0) console.log(`❌ Failed:  ${failed}`);
  console.log('='.repeat(50));
}

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    dryRun: { type: 'boolean', default: false },
  },
  strict: false,
});

run({ dryRun: values.dryRun })
  .then(() => { console.log('\n✨ Done!'); process.exit(0); })
  .catch((err) => { console.error('\n💥 Error:', err); process.exit(1); });
