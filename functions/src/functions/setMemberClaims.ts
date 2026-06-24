import * as admin from 'firebase-admin';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';

if (!admin.apps.length) admin.initializeApp();

/**
 * Triggered when `authUid` is written to a `members/{memberId}` document.
 * Sets custom claims: { role: 'member', memberId, organizationId }
 * Also writes Pro status and member info to users/{authUid} so the app
 * picks it up immediately via the existing Firestore listener.
 */
export const setMemberClaims = onDocumentUpdated('members/{memberId}', async (event) => {
  const memberId = event.params.memberId;
  const before = event.data?.before.data();
  const after = event.data?.after.data();

  if (!before || !after) return;

  // Only act when authUid is newly set
  if (before.authUid || !after.authUid) return;

  const authUid: string = after.authUid;
  const organizationId: string = after.organizationId;
  const memberName: string = after.name ?? '';

  const db = admin.firestore();

  try {
    await admin.auth().setCustomUserClaims(authUid, {
      role: 'member',
      memberId,
      organizationId,
    });

    // Write Pro status to users/{authUid} so profileSync picks it up without
    // needing a manual trigger or client-side claim read.
    await db.doc(`users/${authUid}`).set(
      {
        proStatus: 'active',
        proType: 'sponsored',
        orgMemberId: memberId,
        name: memberName,
      },
      { merge: true }
    );

    await event.data!.after.ref.update({
      claimsSet: true,
      claimsSetAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Backfill pre-existing shortLinks that were created before this user joined
    // the organization so parents scanning those invites can still request
    // sponsorship/follow properly.
    const orgDoc = await db.doc(`organizations/${organizationId}`).get();
    const organizationName: string = orgDoc.data()?.name ?? '';

    const shortLinksSnap = await db
      .collection('shortLinks')
      .where('createdBy', '==', authUid)
      .get();

    const docsToBackfill = shortLinksSnap.docs.filter((doc) => !doc.data().params?.organizationId);

    if (docsToBackfill.length > 0) {
      const BATCH_SIZE = 500;
      for (let i = 0; i < docsToBackfill.length; i += BATCH_SIZE) {
        const chunk = docsToBackfill.slice(i, i + BATCH_SIZE);
        const batch = db.batch();
        chunk.forEach((doc) => {
          const update: Record<string, string> = {
            'params.organizationId': organizationId,
            'params.memberId': memberId,
          };
          if (organizationName) update['params.organizationName'] = organizationName;
          if (memberName) update['params.memberName'] = memberName;
          batch.update(doc.ref, update);
        });
        await batch.commit();
      }
      console.log(
        `[setMemberClaims] backfilled ${docsToBackfill.length} shortLinks for uid=${authUid} org=${organizationId}`
      );
    }

    console.log(
      `[setMemberClaims] claims + pro status set for member=${memberId} uid=${authUid} org=${organizationId}`
    );
  } catch (e) {
    console.error('[setMemberClaims] failed:', e);
  }
});
