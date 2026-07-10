#!/usr/bin/env node
/**
 * One-time "rename": Firestore can't rename a collection, so this copies every
 * document from `outreach_affiliates` → `affiliatesOutreachh` (preserving doc IDs
 * and data), then optionally deletes the old collection.
 *
 * SAFETY:
 *   - Default is a copy only. The old collection is left untouched unless you
 *     pass --deleteOld.
 *   - Copy is idempotent (uses set() with the same doc ID), so it's safe to
 *     re-run.
 *   - Deploy the code + rules changes (which point at `affiliatesOutreachh`)
 *     BEFORE running this, otherwise the live Cloud Functions keep writing to
 *     the old collection and repopulate it.
 *
 * NOTE: This copies top-level documents only. If any outreach lead has
 * subcollections, they are NOT copied (this collection is flat). The script
 * warns if it detects any.
 *
 * Usage (from firebase/functions/):
 *   node scripts/renameOutreachCollection.mjs --dryRun     # preview
 *   node scripts/renameOutreachCollection.mjs              # copy only
 *   node scripts/renameOutreachCollection.mjs --deleteOld  # copy, then delete old
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

const SOURCE = 'outreach_affiliates';
const TARGET = 'affiliatesOutreachh';

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
  options: {
    dryRun: { type: 'boolean', default: false },
    deleteOld: { type: 'boolean', default: false },
  },
});
const DRY_RUN = args.dryRun;
const DELETE_OLD = args.deleteOld;

if (DRY_RUN) console.log('🔍 DRY RUN — no writes will be made\n');

const BATCH_SIZE = 500;

async function migrate() {
  console.log(`Fetching "${SOURCE}"…`);
  const snapshot = await db.collection(SOURCE).get();
  console.log(`Docs in ${SOURCE}: ${snapshot.size}`);

  if (snapshot.empty) {
    console.log('Nothing to copy.');
    return;
  }

  // Warn if any doc has subcollections (not copied by this script).
  for (const doc of snapshot.docs) {
    const subcols = await doc.ref.listCollections();
    if (subcols.length) {
      console.warn(
        `⚠️  ${SOURCE}/${doc.id} has subcollections [${subcols
          .map((c) => c.id)
          .join(', ')}] — these will NOT be copied.`
      );
    }
  }

  if (DRY_RUN) {
    console.log(`\nWould copy ${snapshot.size} docs → "${TARGET}" (same IDs).`);
    snapshot.docs
      .slice(0, 10)
      .forEach((d) => console.log(`  ${SOURCE}/${d.id} → ${TARGET}/${d.id}`));
    if (snapshot.size > 10) console.log(`  … and ${snapshot.size - 10} more`);
    if (DELETE_OLD) console.log(`\nWould THEN delete all ${snapshot.size} docs from "${SOURCE}".`);
    return;
  }

  // ── Copy ──────────────────────────────────────────────────────────────────
  let copied = 0;
  const docs = snapshot.docs;
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const chunk = docs.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    chunk.forEach((d) => batch.set(db.collection(TARGET).doc(d.id), d.data()));
    await batch.commit();
    copied += chunk.length;
    console.log(`  copied ${copied} / ${docs.length}`);
  }
  console.log(`✅ Copied ${copied} docs → "${TARGET}".`);

  // ── Delete old (optional) ───────────────────────────────────────────────────
  if (!DELETE_OLD) {
    console.log(`\nOld collection "${SOURCE}" left intact. Re-run with --deleteOld once verified.`);
    return;
  }

  let deleted = 0;
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const chunk = docs.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    chunk.forEach((d) => batch.delete(db.collection(SOURCE).doc(d.id)));
    await batch.commit();
    deleted += chunk.length;
    console.log(`  deleted ${deleted} / ${docs.length}`);
  }
  console.log(`\n🗑️  Deleted ${deleted} docs from "${SOURCE}". Rename complete.`);
}

migrate().catch((e) => {
  console.error(e);
  process.exit(1);
});
