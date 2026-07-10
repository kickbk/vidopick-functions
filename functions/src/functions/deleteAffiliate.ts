import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

if (!admin.apps.length) admin.initializeApp();

export const deleteAffiliate = onCall(
  { region: 'us-central1', memory: '512MiB' },
  async (request) => {
    if (request.auth?.token.role !== 'admin') {
      throw new HttpsError('permission-denied', 'Admin only');
    }

    const { affiliateId } = (request.data ?? {}) as { affiliateId?: string };
    if (!affiliateId) throw new HttpsError('invalid-argument', 'affiliateId required');

    const db = admin.firestore();
    const affiliateRef = db.doc(`affiliates/${affiliateId}`);
    const affiliateSnap = await affiliateRef.get();

    if (!affiliateSnap.exists) {
      throw new HttpsError('not-found', 'Affiliate not found');
    }

    const data = affiliateSnap.data()!;
    const slug: string | undefined = data.slug;
    const authUid: string | undefined = data.authUid;

    // Delete all shortlinks belonging to this affiliate
    const linksSnap = await db
      .collection('shortLinks')
      .where('affiliateId', '==', affiliateId)
      .get();

    if (!linksSnap.empty) {
      const batches: admin.firestore.WriteBatch[] = [];
      let batch = db.batch();
      let opCount = 0;
      for (const doc of linksSnap.docs) {
        batch.delete(doc.ref);
        opCount++;
        if (opCount === 500) {
          batches.push(batch);
          batch = db.batch();
          opCount = 0;
        }
      }
      if (opCount > 0) batches.push(batch);
      await Promise.all(batches.map((b) => b.commit()));
      console.log(`[deleteAffiliate] deleted ${linksSnap.size} shortlinks for ${affiliateId}`);
    }

    // Delete Firebase Auth user if present
    if (authUid) {
      try {
        await admin.auth().deleteUser(authUid);
        console.log(`[deleteAffiliate] deleted auth user ${authUid}`);
      } catch (err: any) {
        if (err.code !== 'auth/user-not-found') {
          throw new HttpsError('internal', `Failed to delete auth user: ${err.message}`);
        }
      }
    }

    // Delete Storage HTML files (onVpAffiliateWrite would also do this, but be explicit)
    // and the entire affiliates/{id}/ folder (photo.jpg, og.jpg, etc.)
    const bucket = admin.storage().bucket();
    await Promise.all([
      bucket.file(`profile-html/${affiliateId}.html`).delete().catch(() => {}),
      ...(slug ? [bucket.file(`profile-html/${slug}.html`).delete().catch(() => {})] : []),
      bucket.deleteFiles({ prefix: `affiliates/${affiliateId}/` }).catch(() => {}),
    ]);

    // Recursively delete the affiliate doc + all subcollections (publicProfiles, dailyStats, etc.)
    await db.recursiveDelete(affiliateRef);

    console.log(`[deleteAffiliate] deleted affiliate ${affiliateId} (${data.name ?? ''})`);
    return { success: true };
  }
);
