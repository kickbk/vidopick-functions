#!/usr/bin/env node
/**
 * One-time backfill: writes the sanitized public mirror doc
 * (affiliates/{id}/public/profile) for every existing influencer affiliate.
 *
 * The /vp/{slug} page reads this mirror instead of the main affiliate doc,
 * which is no longer publicly readable (it holds payout info). New writes are
 * maintained automatically by the onVpAffiliateWrite trigger — this script
 * covers affiliates created before that change. Also moves any legacy `notes`
 * field off the main doc into the admin-only private/admin subcollection doc.
 *
 * Usage (from firebase/functions/):
 *   node scripts/backfillAffiliatePublicDocs.mjs
 *   node scripts/backfillAffiliatePublicDocs.mjs --dryRun
 */

import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
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

async function backfill() {
  const snapshot = await db.collection('affiliates').where('type', '==', 'influencer').get();
  console.log(`Influencer affiliates found: ${snapshot.size}`);

  let mirrors = 0;
  let notesMoved = 0;

  for (const affiliateDoc of snapshot.docs) {
    const d = affiliateDoc.data();
    const mirror = {
      name: d.name ?? '',
      title: d.title ?? null,
      bio: d.bio ?? null,
      photo: d.photo ?? null,
      website: d.website ?? null,
      slug: d.slug ?? null,
      updatedAt: FieldValue.serverTimestamp(),
    };

    console.log(`${affiliateDoc.id} → public/profile (${d.name ?? 'unnamed'})`);
    if (!DRY_RUN) {
      await affiliateDoc.ref.collection('public').doc('profile').set(mirror);
    }
    mirrors++;

    if (typeof d.notes === 'string' && d.notes.trim()) {
      console.log(`${affiliateDoc.id} → moving legacy notes to private/admin`);
      if (!DRY_RUN) {
        await affiliateDoc.ref.collection('private').doc('admin').set({ notes: d.notes }, { merge: true });
        await affiliateDoc.ref.update({ notes: FieldValue.delete() });
      }
      notesMoved++;
    }
  }

  console.log(`\nDone. Mirrors written: ${mirrors}, notes moved: ${notesMoved}${DRY_RUN ? ' (dry run)' : ''}`);
}

backfill().catch((e) => {
  console.error(e);
  process.exit(1);
});
