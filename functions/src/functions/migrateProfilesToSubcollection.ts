import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

if (!admin.apps.length) admin.initializeApp();

/**
 * One-time admin-only migration: moves each user's `profiles` array field
 * into the `users/{uid}/profiles/{profileId}` subcollection, then removes
 * the array from the user document.
 *
 * Safe to run multiple times (idempotent — skips users with no array).
 */
export const migrateProfilesToSubcollection = onCall(
  { region: 'us-central1', memory: '512MiB', timeoutSeconds: 540 },
  async (request) => {
    if (!request.auth || request.auth.token.role !== 'admin') {
      throw new HttpsError('permission-denied', 'Admin only');
    }

    const db = admin.firestore();
    const usersSnap = await db.collection('users').get();

    let migrated = 0;
    let skipped = 0;

    for (const userDoc of usersSnap.docs) {
      const data = userDoc.data();
      const profilesArray = data.profiles;

      if (!Array.isArray(profilesArray) || profilesArray.length === 0) {
        skipped++;
        continue;
      }

      const batch = db.batch();

      for (const profile of profilesArray) {
        if (!profile.id) continue;
        const profileRef = db
          .collection('users')
          .doc(userDoc.id)
          .collection('profiles')
          .doc(profile.id);
        const { id: _id, ...profileData } = profile;
        batch.set(profileRef, profileData, { merge: true });
      }

      // Remove the array field from the user document
      batch.update(db.collection('users').doc(userDoc.id), {
        profiles: admin.firestore.FieldValue.delete(),
      });

      await batch.commit();
      migrated++;
      console.log(
        `[migrateProfiles] migrated uid=${userDoc.id} (${profilesArray.length} profiles)`
      );
    }

    console.log(`[migrateProfiles] done — migrated=${migrated} skipped=${skipped}`);
    return { success: true, migrated, skipped };
  }
);
