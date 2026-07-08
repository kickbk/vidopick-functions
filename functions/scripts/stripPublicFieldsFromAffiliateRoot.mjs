#!/usr/bin/env node
/**
 * One-time migration: removes display fields (name, bio, title, photo, website,
 * socialLinks) from each affiliate root document now that they are stored exclusively
 * in affiliates/{id}/public/profile.
 *
 * Safety check: skips any affiliate whose public/profile doc does not yet exist,
 * so no data is lost if an affiliate hasn't completed their profile setup.
 *
 * Run AFTER deploying the updated web + functions code that reads/writes these
 * fields from public/profile instead of the root doc.
 *
 * Usage (from firebase/functions/):
 *   node scripts/stripPublicFieldsFromAffiliateRoot.mjs
 *   node scripts/stripPublicFieldsFromAffiliateRoot.mjs --dryRun
 */

import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
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
  console.error(`Cannot read service account at ${CREDS_PATH}`);
  process.exit(1);
}

const { values: args } = parseArgs({
  options: { dryRun: { type: 'boolean', default: false } },
});
const DRY_RUN = args.dryRun;

if (!getApps().length) {
  initializeApp({ credential: cert(credsJson) });
}
const db = getFirestore();

const DISPLAY_FIELDS = ['name', 'bio', 'title', 'photo', 'website', 'socialLinks'];

async function run() {
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);

  const affiliatesSnap = await db.collection('affiliates').get();
  const affiliates = affiliatesSnap.docs.filter(
    (d) => d.data().type === 'influencer'
  );

  console.log(`Found ${affiliates.length} influencer affiliates.`);

  let skipped = 0;
  let stripped = 0;
  let noFieldsToRemove = 0;

  for (const affiliateDoc of affiliates) {
    const affiliateId = affiliateDoc.id;
    const rootData = affiliateDoc.data();

    // Check which display fields actually exist on the root doc.
    const fieldsPresent = DISPLAY_FIELDS.filter((f) => rootData[f] !== undefined);
    if (fieldsPresent.length === 0) {
      noFieldsToRemove++;
      continue;
    }

    // Safety: only strip if public/profile exists (data already in destination).
    const profileSnap = await db.doc(`affiliates/${affiliateId}/public/profile`).get();
    if (!profileSnap.exists) {
      console.warn(`  SKIP ${affiliateId} — public/profile does not exist yet`);
      skipped++;
      continue;
    }

    const deletion = fieldsPresent.reduce((acc, field) => {
      acc[field] = FieldValue.delete();
      return acc;
    }, {});

    console.log(`  ${DRY_RUN ? '[dry]' : ''} Strip [${fieldsPresent.join(', ')}] from ${affiliateId}`);
    if (!DRY_RUN) {
      await db.doc(`affiliates/${affiliateId}`).update(deletion);
    }
    stripped++;
  }

  console.log(`\nDone. stripped=${stripped} skipped=${skipped} already_clean=${noFieldsToRemove}`);
  if (skipped > 0) {
    console.warn(`\nWARNING: ${skipped} affiliates were skipped because public/profile does not exist.`);
    console.warn('Ensure those affiliates complete their profile setup before re-running.');
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
