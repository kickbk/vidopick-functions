import * as admin from 'firebase-admin';
import { onSchedule } from 'firebase-functions/v2/scheduler';

if (!admin.apps.length) admin.initializeApp();

/**
 * Runs daily at 02:00 UTC.
 * Finds all pending affiliate commissions whose approvableAt has passed
 * and flips them to 'approved', updating affiliate stats.
 */
export const approveCommissions = onSchedule(
  { schedule: '0 2 * * *', region: 'us-central1', timeoutSeconds: 300 },
  async () => {
    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();

    const snap = await db
      .collectionGroup('commissions')
      .where('status', '==', 'pending')
      .where('approvableAt', '<=', now)
      .get();

    if (snap.empty) {
      console.log('[approveCommissions] no pending commissions to approve');
      return;
    }

    // Group by affiliateId for efficient stat updates
    type CommissionItem = { ref: admin.firestore.DocumentReference; cents: number };
    const byAffiliate = new Map<string, CommissionItem[]>();

    for (const commDoc of snap.docs) {
      // Path: affiliates/{affiliateId}/commissions/{commissionId}
      const affiliateId = commDoc.ref.parent.parent?.id;
      if (!affiliateId) continue;

      if (!byAffiliate.has(affiliateId)) {
        byAffiliate.set(affiliateId, []);
      }
      byAffiliate.get(affiliateId)!.push({
        ref: commDoc.ref,
        cents: (commDoc.data().commissionCents as number) ?? 0,
      });
    }

    // Firestore batches cap at 500 ops — chunk into multiple batches. An
    // affiliate with more commissions than fit in one batch is split across
    // several, each carrying a stats increment for exactly the commissions in
    // that batch, so stats stay consistent even if a later batch fails.
    const MAX_BATCH_OPS = 450;
    const batches: admin.firestore.WriteBatch[] = [];
    let batch = db.batch();
    let opCount = 0;

    const flushBatch = () => {
      if (opCount > 0) {
        batches.push(batch);
        batch = db.batch();
        opCount = 0;
      }
    };

    for (const [affiliateId, items] of byAffiliate) {
      const affiliateRef = db.doc(`affiliates/${affiliateId}`);
      // Commission updates + 1 stats op per chunk
      const CHUNK_SIZE = MAX_BATCH_OPS - 1;

      for (let i = 0; i < items.length; i += CHUNK_SIZE) {
        const chunk = items.slice(i, i + CHUNK_SIZE);
        if (opCount > 0 && opCount + chunk.length + 1 > MAX_BATCH_OPS) flushBatch();

        let chunkCents = 0;
        for (const { ref, cents } of chunk) {
          chunkCents += cents;
          batch.update(ref, {
            status: 'approved',
            approvedAt: now,
          });
        }

        batch.set(
          affiliateRef,
          {
            stats: {
              pendingEarningsCents: admin.firestore.FieldValue.increment(-chunkCents),
              approvedEarningsCents: admin.firestore.FieldValue.increment(chunkCents),
            },
          },
          { merge: true }
        );
        opCount += chunk.length + 1;
      }
    }

    flushBatch();
    for (const b of batches) await b.commit();
    console.log(
      `[approveCommissions] approved ${snap.size} commission(s) across ${byAffiliate.size} affiliate(s)`
    );
  }
);
