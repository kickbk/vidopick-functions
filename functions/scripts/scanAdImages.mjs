#!/usr/bin/env node
/**
 * Read-only scan: print pixel dimensions and byte size of every image
 * referenced by ads (organizations/{org}/ads/{ad}: imageUrl,
 * imageUrlLandscape, logo) plus each org's logo.
 *
 * Purpose: find oversized creatives that cause main-thread image-resample
 * hangs in the app (Sentry "App Hang" in UIGraphicsImageRenderer) on older
 * devices. Ads uploaded before the compression pipeline may be raw.
 *
 * Makes NO writes — safe to run anytime.
 *
 * Usage (from firebase/functions/):
 *   node scripts/scanAdImages.mjs
 */

import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

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

// Images bigger than this (in megapixels) get flagged — a full-screen
// 1920x1080 creative is ~2.1MP, so anything well above that is suspect.
const FLAG_MEGAPIXELS = 2.5;

async function inspect(label, url) {
  if (!url) return;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.log(`  ${label}: ❌ HTTP ${res.status} — ${url}`);
      return;
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(bytes).metadata();
    const mp = ((meta.width ?? 0) * (meta.height ?? 0)) / 1_000_000;
    const flag = mp > FLAG_MEGAPIXELS ? '  🚨 OVERSIZED' : '';
    console.log(
      `  ${label}: ${meta.width}x${meta.height} (${mp.toFixed(1)}MP, ${(bytes.length / 1024).toFixed(0)}KB, ${meta.format})${flag}`
    );
    console.log(`    ${url}`);
  } catch (error) {
    console.log(`  ${label}: ❌ ${error.message} — ${url}`);
  }
}

async function run() {
  const orgs = await db.collection('organizations').get();
  console.log(`Organizations: ${orgs.size}\n`);

  for (const orgSnap of orgs.docs) {
    const org = orgSnap.data();
    console.log(`Org ${orgSnap.id} (${org.name ?? 'unnamed'})${org.isActive ? '' : ' [inactive]'}`);
    await inspect('org logo', org.logo);

    const ads = await orgSnap.ref.collection('ads').get();
    for (const adSnap of ads.docs) {
      const ad = adSnap.data();
      console.log(`  Ad ${adSnap.id} (${ad.name ?? 'unnamed'})${ad.isActive === false ? ' [inactive]' : ''}`);
      await inspect('  imageUrl', ad.imageUrl);
      await inspect('  imageUrlLandscape', ad.imageUrlLandscape);
      await inspect('  logo', ad.logo);
    }
    console.log('');
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
