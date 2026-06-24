#!/usr/bin/env node
/**
 * One-time backfill: compress existing organization logos.
 *
 * Logos uploaded via OrganizationForm before June 2026 were stored raw in
 * `organizations/logos/` — a path the compressUploadedImage function did not
 * monitor. Multi-megapixel logos cause main-thread image-resample hangs in
 * the app on older iPhones (Sentry "App Hang" in UIGraphicsImageRenderer),
 * because expo-image downscales them synchronously to the 32pt logo view.
 *
 * For every org whose `logo` is not already a `_compressed.webp`:
 *   1. Download the original from Storage
 *   2. Resize to fit within 256x256 (no enlargement) and convert to webp
 *   3. Upload as `<name>_compressed.webp` (publicRead + download token)
 *   4. Update the org doc's `logo` field
 *   5. Delete the original object (only with --deleteOriginals)
 *
 * SAFETY: Skips logos hosted outside our Storage bucket. Never deletes
 * originals unless --deleteOriginals is passed.
 *
 * Usage (from firebase/functions/):
 *   node scripts/compressOrgLogos.mjs --dryRun
 *   node scripts/compressOrgLogos.mjs
 *   node scripts/compressOrgLogos.mjs --deleteOriginals
 */

import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
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

const { values: args } = parseArgs({
  options: {
    dryRun: { type: 'boolean', default: false },
    deleteOriginals: { type: 'boolean', default: false },
  },
});
const DRY_RUN = args.dryRun;
const DELETE_ORIGINALS = args.deleteOriginals;

if (DRY_RUN) console.log('🔍 DRY RUN — no writes will be made\n');

const TARGET_SIZE = 256;

/**
 * Extract { bucket, objectPath } from a Firebase Storage download URL.
 * Supports:
 *   https://firebasestorage.googleapis.com/v0/b/<bucket>/o/<encodedPath>?...
 *   https://storage.googleapis.com/<bucket>/<path>
 */
function parseStorageUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname === 'firebasestorage.googleapis.com') {
      const match = u.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/);
      if (match) return { bucket: match[1], objectPath: decodeURIComponent(match[2]) };
    }
    if (u.hostname === 'storage.googleapis.com') {
      const [, bucket, ...rest] = u.pathname.split('/');
      if (bucket && rest.length) {
        return { bucket, objectPath: decodeURIComponent(rest.join('/')) };
      }
    }
  } catch {
    // fall through
  }
  return null;
}

async function run() {
  console.log('Fetching organizations…');
  const snapshot = await db.collection('organizations').get();
  console.log(`Total org docs: ${snapshot.size}\n`);

  let compressed = 0;
  let skipped = 0;
  let failed = 0;

  for (const docSnap of snapshot.docs) {
    const { logo, name } = docSnap.data();
    const label = `${docSnap.id} (${name ?? 'unnamed'})`;

    if (!logo) {
      skipped++;
      continue;
    }
    if (logo.includes('_compressed.webp')) {
      skipped++;
      continue;
    }

    const parsed = parseStorageUrl(logo);
    if (!parsed) {
      console.warn(`⚠️  ${label}: logo URL not in our Storage, skipping: ${logo}`);
      skipped++;
      continue;
    }

    try {
      const bucket = getStorage().bucket(parsed.bucket);
      const originalFile = bucket.file(parsed.objectPath);

      const [bytes] = await originalFile.download();
      const meta = await sharp(bytes).metadata();
      console.log(
        `${label}: ${parsed.objectPath} — ${meta.width}x${meta.height}, ${(bytes.length / 1024).toFixed(0)}KB`
      );

      if (DRY_RUN) {
        compressed++;
        continue;
      }

      const webpBuffer = await sharp(bytes)
        .rotate()
        .resize(TARGET_SIZE, TARGET_SIZE, {
          fit: 'inside',
          position: 'center',
          withoutEnlargement: true,
        })
        .webp({ quality: 80 })
        .toBuffer();

      const parsedPath = path.parse(parsed.objectPath);
      const compressedPath = path.posix.join(parsedPath.dir, `${parsedPath.name}_compressed.webp`);
      const token = randomUUID();

      await bucket.file(compressedPath).save(webpBuffer, {
        predefinedAcl: 'publicRead',
        metadata: {
          contentType: 'image/webp',
          metadata: {
            originalFile: parsed.objectPath,
            optimized: 'true',
            firebaseStorageDownloadTokens: token,
          },
        },
      });

      const newUrl =
        `https://firebasestorage.googleapis.com/v0/b/${parsed.bucket}/o/` +
        `${encodeURIComponent(compressedPath)}?alt=media&token=${token}`;

      await docSnap.ref.update({ logo: newUrl });

      if (DELETE_ORIGINALS) {
        await originalFile.delete();
      }

      console.log(`   ✅ → ${compressedPath} (${(webpBuffer.length / 1024).toFixed(0)}KB)`);
      compressed++;
    } catch (error) {
      console.error(`   ❌ ${label}:`, error.message);
      failed++;
    }
  }

  console.log(
    `\nDone. ${DRY_RUN ? 'Would compress' : 'Compressed'}: ${compressed}, skipped: ${skipped}, failed: ${failed}`
  );
  if (!DRY_RUN && !DELETE_ORIGINALS) {
    console.log('Originals were kept. Re-run with --deleteOriginals to remove them.');
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
