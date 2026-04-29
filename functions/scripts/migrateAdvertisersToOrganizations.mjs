#!/usr/bin/env node
/**
 * Migration: advertisers → organizations
 *
 * What this script does:
 * 1. Copies every document from `advertisers` → `organizations` (preserving document IDs)
 * 2. Copies each `advertisers/{id}/ads` subcollection into `organizations/{id}/ads`
 * 3. Updates all `shortLinks` docs that have `params.advertiserId` → `params.organizationId`
 *
 * Run from /firebase/functions with:
 *   node scripts/migrateAdvertisersToOrganizations.mjs
 *
 * Requires serviceAccountKey.json in the scripts/ directory.
 */

import { createRequire } from "module";
const require = createRequire(import.meta.url);

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const serviceAccount = require("../integrations/firebase/service-account.json");

initializeApp({ credential: cert(serviceAccount) });

const db = getFirestore();

async function main() {
  console.log("🚀 Starting migration: advertisers → organizations\n");

  // ─── Step 1: Copy advertisers → organizations ────────────────────────────
  console.log("Step 1: Copying advertisers collection…");
  const advertisersSnap = await db.collection("advertisers").get();

  if (advertisersSnap.empty) {
    console.log("  ⚠️  No advertisers found. Skipping collection copy.");
  } else {
    let orgCount = 0;
    for (const advertiserDoc of advertisersSnap.docs) {
      const orgRef = db.collection("organizations").doc(advertiserDoc.id);
      const existing = await orgRef.get();

      if (existing.exists) {
        console.log(
          `  ⏭  organizations/${advertiserDoc.id} already exists — skipping`,
        );
      } else {
        await orgRef.set(advertiserDoc.data());
        console.log(
          `  ✅ Copied advertisers/${advertiserDoc.id} → organizations/${advertiserDoc.id}`,
        );
        orgCount++;
      }

      // ── Step 2: Copy ads subcollection ─────────────────────────────────
      const adsSnap = await db
        .collection("advertisers")
        .doc(advertiserDoc.id)
        .collection("ads")
        .get();

      if (!adsSnap.empty) {
        let adCount = 0;
        for (const adDoc of adsSnap.docs) {
          const newAdRef = db
            .collection("organizations")
            .doc(advertiserDoc.id)
            .collection("ads")
            .doc(adDoc.id);
          const existingAd = await newAdRef.get();
          if (!existingAd.exists) {
            await newAdRef.set(adDoc.data());
            adCount++;
          }
        }
        if (adCount > 0) {
          console.log(
            `    └─ Copied ${adCount} ad(s) into organizations/${advertiserDoc.id}/ads`,
          );
        }
      }
    }
    console.log(`  Done. Migrated ${orgCount} new organization(s).\n`);
  }

  // ─── Step 3: Update shortLinks params.advertiserId → params.organizationId ──
  console.log(
    "Step 3: Updating shortLinks params.advertiserId → params.organizationId…",
  );
  const shortLinksSnap = await db.collection("shortLinks").get();

  let updatedLinks = 0;
  let skippedLinks = 0;

  for (const linkDoc of shortLinksSnap.docs) {
    const data = linkDoc.data();
    if (data.params?.advertiserId !== undefined) {
      await db.collection("shortLinks").doc(linkDoc.id).update({
        "params.organizationId": data.params.advertiserId,
        "params.advertiserId": FieldValue.delete(),
      });
      console.log(
        `  ✅ shortLinks/${linkDoc.id}: advertiserId="${data.params.advertiserId}" → organizationId`,
      );
      updatedLinks++;
    } else {
      skippedLinks++;
    }
  }

  console.log(
    `  Done. Updated ${updatedLinks} link(s), skipped ${skippedLinks} (no advertiserId field).\n`,
  );

  console.log("✅ Migration complete!");
  console.log("");
  console.log("Next steps:");
  console.log("  1. Deploy updated cloud functions and web dashboard");
  console.log(
    "  2. Verify the admin dashboard works with the organizations collection",
  );
  console.log("  3. Verify ad serving still works (getNextAdBatch)");
  console.log(
    "  4. Once confirmed, the old `advertisers` collection can be deleted from Firebase Console",
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Migration failed:", err);
  process.exit(1);
});
