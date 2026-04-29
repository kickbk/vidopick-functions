import * as admin from 'firebase-admin';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';

if (!admin.apps.length) admin.initializeApp();

/**
 * Triggered when `authUid` is written to a `members/{memberId}` document.
 * Sets custom claims: { role: 'member', memberId, organizationId }
 */
export const setMemberClaims = onDocumentUpdated(
  'members/{memberId}',
  async (event) => {
    const memberId = event.params.memberId;
    const before = event.data?.before.data();
    const after = event.data?.after.data();

    if (!before || !after) return;

    // Only act when authUid is newly set
    if (before.authUid || !after.authUid) return;

    const authUid: string = after.authUid;
    const organizationId: string = after.organizationId;

    try {
      await admin.auth().setCustomUserClaims(authUid, {
        role: 'member',
        memberId,
        organizationId,
      });

      await event.data!.after.ref.update({
        claimsSet: true,
        claimsSetAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log(`[setMemberClaims] claims set for member=${memberId} uid=${authUid} org=${organizationId}`);
    } catch (e) {
      console.error('[setMemberClaims] failed:', e);
    }
  }
);
