#!/usr/bin/env node
/**
 * One-time migration: copies profile data from the old subcollection layout to the new
 * root-collection + user-doc-map layout.
 *
 * OLD layout:
 *   users/{uid}/profiles/{profileId}                        — owned profile docs
 *   users/{uid}/following/{docId}                           — followed profile docs
 *   users/{uid}/profiles/{profileId}/watchHistory/{date}    — owned watch history
 *   users/{uid}/following/{docId}/watchHistory/{date}       — followed watch history
 *
 * NEW layout:
 *   profiles/{profileId}                 — root collection; uid field = owner
 *   users/{uid}.profiles                 — map of profileId → per-user settings
 *   users/{uid}/watchHistory/{profileId} — single doc, keyed by date string
 *
 * SAFETY: This script NEVER deletes old data. Run deletion separately after the
 * new client version is live and verified.
 *
 * Usage (from firebase/functions/):
 *   node scripts/migrateToRootProfiles.mjs
 *   node scripts/migrateToRootProfiles.mjs --dryRun
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
if (DRY_RUN) console.log('*** DRY RUN — no writes will be made ***\n');

async function migrateUser(uid) {
  console.log(`\n[migrate] uid=${uid}`);

  // ── 1. Migrate owned profiles ───────────────────────────────────────────────

  const ownedSnap = await db.collection(`users/${uid}/profiles`).get();
  const profilesMapEntries = {};

  for (const profileDoc of ownedSnap.docs) {
    const profileId = profileDoc.id;
    const data = profileDoc.data();

    const rootData = {
      uid,
      name: data.name ?? 'Profile',
      color: data.color ?? '#E53935',
      playlistIds: data.playlistIds ?? [],
      scheduledForDeletion: data.scheduledForDeletion ?? {},
      inviteSubscriptions: data.inviteSubscriptions ?? [],
      isShared: data.isShared ?? false,
      ...(data.inviteId != null ? { inviteId: data.inviteId } : {}),
      ...(data.followerUids ? { followerUids: data.followerUids } : {}),
      ...(data.createdAt != null ? { createdAt: data.createdAt } : {}),
    };

    if (!DRY_RUN) {
      await db.doc(`profiles/${profileId}`).set(rootData, { merge: true });
    }
    console.log(`  [owned] ${DRY_RUN ? '(dry) ' : ''}wrote profiles/${profileId}`);

    profilesMapEntries[profileId] = {
      isFollowed: false,
      dailyLimitMinutes: data.dailyLimitMinutes ?? null,
      skipShufflePlaylistIds: data.skipShufflePlaylistIds ?? [],
    };

    // ── 1a. Migrate owned-profile watch history ─────────────────────────────

    const whSnap = await db
      .collection(`users/${uid}/profiles/${profileId}/watchHistory`)
      .get();

    if (!whSnap.empty) {
      const dateMap = {};
      for (const dateDoc of whSnap.docs) {
        const d = dateDoc.data();
        dateMap[dateDoc.id] = {
          seconds: d.seconds ?? 0,
          ...(d.isLimitOverridden != null ? { isLimitOverridden: d.isLimitOverridden } : {}),
        };
      }
      if (!DRY_RUN) {
        await db.doc(`users/${uid}/watchHistory/${profileId}`).set(dateMap, { merge: true });
      }
      console.log(
        `  [watchHistory] ${DRY_RUN ? '(dry) ' : ''}wrote ${whSnap.size} days for owned profile ${profileId}`,
      );
    }
  }

  // ── 2. Migrate followed profiles ────────────────────────────────────────────

  const followingSnap = await db.collection(`users/${uid}/following`).get();

  for (const followDoc of followingSnap.docs) {
    const data = followDoc.data();
    const profileId = data.profileId;
    if (!profileId) {
      console.warn(`  [following] doc ${followDoc.id} missing profileId — skipping`);
      continue;
    }

    // Ensure the root profile doc exists (written by the owner's migration run)
    const ownerUid = data.sourceUid;
    if (ownerUid) {
      const ownerProfileSnap = await db.doc(`users/${ownerUid}/profiles/${profileId}`).get();
      if (ownerProfileSnap.exists) {
        const ownerData = ownerProfileSnap.data();
        const rootData = {
          uid: ownerUid,
          name: ownerData.name ?? 'Profile',
          color: ownerData.color ?? '#E53935',
          playlistIds: ownerData.playlistIds ?? [],
          scheduledForDeletion: ownerData.scheduledForDeletion ?? {},
          inviteSubscriptions: ownerData.inviteSubscriptions ?? [],
          isShared: ownerData.isShared ?? false,
          ...(ownerData.inviteId != null ? { inviteId: ownerData.inviteId } : {}),
          ...(ownerData.followerUids ? { followerUids: ownerData.followerUids } : {}),
          ...(ownerData.createdAt != null ? { createdAt: ownerData.createdAt } : {}),
        };
        if (!DRY_RUN) {
          await db.doc(`profiles/${profileId}`).set(rootData, { merge: true });
        }
        console.log(
          `  [followed] ${DRY_RUN ? '(dry) ' : ''}ensured root profiles/${profileId} from owner ${ownerUid}`,
        );
      } else {
        console.warn(
          `  [followed] owner profile doc not found: users/${ownerUid}/profiles/${profileId} — skipping root write`,
        );
      }
    }

    profilesMapEntries[profileId] = {
      isFollowed: true,
      dailyLimitMinutes: data.dailyLimitMinutes ?? null,
      skipShufflePlaylistIds: data.skipShufflePlaylistIds ?? [],
      ...(data.organizationId ? { organizationId: data.organizationId } : {}),
      ...(data.memberId ? { memberId: data.memberId } : {}),
    };

    // ── 2a. Migrate followed-profile watch history ──────────────────────────

    const whSnap = await db
      .collection(`users/${uid}/following/${followDoc.id}/watchHistory`)
      .get();

    if (!whSnap.empty) {
      const dateMap = {};
      for (const dateDoc of whSnap.docs) {
        const d = dateDoc.data();
        dateMap[dateDoc.id] = {
          seconds: d.seconds ?? 0,
          ...(d.isLimitOverridden != null ? { isLimitOverridden: d.isLimitOverridden } : {}),
        };
      }
      if (!DRY_RUN) {
        await db.doc(`users/${uid}/watchHistory/${profileId}`).set(dateMap, { merge: true });
      }
      console.log(
        `  [watchHistory] ${DRY_RUN ? '(dry) ' : ''}wrote ${whSnap.size} days for followed profile ${profileId}`,
      );
    }
  }

  // ── 3. Write profiles map to user doc ───────────────────────────────────────

  if (Object.keys(profilesMapEntries).length > 0) {
    const dotUpdate = {};
    for (const [profileId, settings] of Object.entries(profilesMapEntries)) {
      dotUpdate[`profiles.${profileId}`] = settings;
    }
    if (!DRY_RUN) {
      await db.doc(`users/${uid}`).update(dotUpdate);
    }
    console.log(
      `  [userDoc] ${DRY_RUN ? '(dry) ' : ''}wrote profiles map with ${Object.keys(profilesMapEntries).length} entries`,
    );
  } else {
    console.log(`  [userDoc] no profiles to migrate`);
  }
}

async function main() {
  console.log('=== migrateToRootProfiles ===');
  console.log('Listing all users...');

  const usersSnap = await db.collection('users').get();
  console.log(`Found ${usersSnap.size} users`);

  let migrated = 0;
  let errors = 0;

  for (const userDoc of usersSnap.docs) {
    try {
      await migrateUser(userDoc.id);
      migrated++;
    } catch (e) {
      console.error(`[migrate] ERROR for uid=${userDoc.id}:`, e);
      errors++;
    }
  }

  console.log(`\n=== Done: ${migrated} migrated, ${errors} errors ===`);
  process.exit(errors > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
