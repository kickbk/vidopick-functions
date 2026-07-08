#!/usr/bin/env node
/**
 * One-time migration: fixes `params.name` and `linkTitle` on affiliate shortlinks
 * where the name was incorrectly set to the profile/child name instead of the
 * affiliate's real name.
 *
 * Finds all shortLinks with an `affiliateId`, looks up the affiliate's name,
 * and updates the doc if `params.name` differs from `affiliates.name`.
 *
 * SAFETY: Only updates docs where the name actually needs changing. Dry-run
 * mode prints what would change without writing anything.
 *
 * Usage (from firebase/functions/):
 *   node scripts/migrateAffiliateShortlinkNames.mjs
 *   node scripts/migrateAffiliateShortlinkNames.mjs --dryRun
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

const db = getFirestore();

const { values: args } = parseArgs({
  options: { dryRun: { type: 'boolean', default: false } },
});
const DRY_RUN = args.dryRun;

if (DRY_RUN) console.log('🔍 DRY RUN — no writes will be made\n');

const BATCH_SIZE = 500;

async function migrate() {
  console.log('Fetching affiliate shortLinks…');
  const snapshot = await db.collection('shortLinks').where('affiliateId', '!=', null).get();
  console.log(`Affiliate shortLinks found: ${snapshot.size}`);

  // Cache affiliate names so we don't fetch the same affiliate doc repeatedly
  const affiliateNameCache = new Map();

  const getAffiliateName = async (affiliateId) => {
    if (affiliateNameCache.has(affiliateId)) return affiliateNameCache.get(affiliateId);
    // name lives in public/profile since the root-doc strip migration
    const profileSnap = await db.doc(`affiliates/${affiliateId}/public/profile`).get();
    const name = profileSnap.data()?.name ?? null;
    affiliateNameCache.set(affiliateId, name);
    return name;
  };

  const toUpdate = [];

  for (const doc of snapshot.docs) {
    const d = doc.data();
    const affiliateId = d.affiliateId;
    if (!affiliateId) continue;

    const affiliateName = await getAffiliateName(affiliateId);
    if (!affiliateName) {
      console.warn(`  ⚠️  No name found for affiliate ${affiliateId} (shortLink ${doc.id})`);
      continue;
    }

    const currentParamsName = d.params?.name;
    if (currentParamsName === affiliateName) continue; // already correct

    toUpdate.push({
      ref: doc.ref,
      id: doc.id,
      affiliateId,
      affiliateName,
      oldName: currentParamsName,
      label: d.label ?? '',
    });
  }

  console.log(`\nShortLinks needing update: ${toUpdate.length}`);
  if (toUpdate.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  toUpdate.forEach(({ id, affiliateName, oldName, label }) => {
    console.log(`  ${id}  "${oldName}" → "${affiliateName}"${label ? `  [${label}]` : ''}`);
  });

  if (DRY_RUN) return;

  console.log('\nWriting updates…');
  let committed = 0;
  for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
    const chunk = toUpdate.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    chunk.forEach(({ ref, affiliateName, label }) => {
      batch.update(ref, {
        'params.name': affiliateName,
        linkTitle: `${affiliateName}${label ? ` – ${label}` : ' invites you to try Vidopick'}`,
      });
    });
    await batch.commit();
    committed += chunk.length;
    console.log(`  committed ${committed} / ${toUpdate.length}`);
  }

  console.log(`\n✅ Done. ${committed} shortLinks updated.`);
}

migrate().catch(e => {
  console.error(e);
  process.exit(1);
});
