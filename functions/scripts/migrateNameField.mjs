#!/usr/bin/env node
/**
 * One-time migration: copies `displayName` / `memberName` → `name` in the
 * `users` collection for every doc that has the old field(s) but no `name`.
 *
 * Priority: displayName > memberName  (displayName was set by the
 * updateDisplayName CF for Pro users; memberName was set by
 * completeMemberAppSignIn / setMemberClaims for org members).
 *
 * SAFETY: Only writes when `name` is absent. Never deletes the old fields
 * (remove them separately once the new client + CF versions are stable).
 *
 * Usage (from firebase/functions/):
 *   node scripts/migrateNameField.mjs
 *   node scripts/migrateNameField.mjs --dryRun
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
  console.log('Fetching users collection…');
  const snapshot = await db.collection('users').get();
  console.log(`Total user docs: ${snapshot.size}`);

  let toUpdate = [];

  for (const doc of snapshot.docs) {
    const d = doc.data();
    if (d.name) continue; // already has name, skip
    const value = d.displayName ?? d.memberName;
    if (!value) continue; // nothing to copy
    toUpdate.push({ ref: doc.ref, name: value, from: d.displayName ? 'displayName' : 'memberName' });
  }

  console.log(`Docs needing migration: ${toUpdate.length}`);
  if (toUpdate.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  if (DRY_RUN) {
    toUpdate.slice(0, 10).forEach(({ ref, name, from }) =>
      console.log(`  ${ref.id}  ${from} → name: "${name}"`)
    );
    if (toUpdate.length > 10) console.log(`  … and ${toUpdate.length - 10} more`);
    return;
  }

  let committed = 0;
  for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
    const chunk = toUpdate.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    chunk.forEach(({ ref, name }) => batch.update(ref, { name }));
    await batch.commit();
    committed += chunk.length;
    console.log(`  committed ${committed} / ${toUpdate.length}`);
  }

  console.log(`\n✅ Done. ${committed} docs updated.`);
}

migrate().catch(e => {
  console.error(e);
  process.exit(1);
});
