#!/usr/bin/env node
/**
 * One-time regeneration: triggers onVpAffiliateWrite for all influencer affiliates
 * by touching (no-op updating) each affiliate document. The function will regenerate
 * the static HTML in Cloud Storage and the public/profile Firestore mirror.
 *
 * Run AFTER deploying functions that change generateProfileHtml.ts.
 *
 * Usage (from firebase/functions/):
 *   node scripts/regenerateVpProfileHtml.mjs
 *   node scripts/regenerateVpProfileHtml.mjs --dryRun
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
  console.error(`Service account not found at: ${CREDS_PATH}`);
  process.exit(1);
}

if (!getApps().length) {
  initializeApp({ credential: cert(credsJson) });
}

const { values: flags } = parseArgs({
  options: { dryRun: { type: 'boolean', default: false } },
});

const db = getFirestore();

async function main() {
  console.log(`Mode: ${flags.dryRun ? 'DRY RUN' : 'LIVE'}\n`);

  const snap = await db
    .collection('affiliates')
    .where('type', '==', 'influencer')
    .get();

  console.log(`Found ${snap.size} influencer affiliate(s)\n`);

  let touched = 0;
  for (const doc of snap.docs) {
    const id = doc.id;
    console.log(`  [touch] affiliateId=${id}`);
    if (!flags.dryRun) {
      await doc.ref.update({ _htmlRegenAt: FieldValue.serverTimestamp() });
    }
    touched++;
  }

  console.log(`\nDone. Touched ${touched} affiliate(s)${flags.dryRun ? ' (dry run — no writes)' : ''}.`);
  console.log('onVpAffiliateWrite will now regenerate each profile HTML in the background.');
}

main().catch((e) => { console.error(e); process.exit(1); });
