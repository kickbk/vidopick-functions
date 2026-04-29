import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

if (!admin.apps.length) admin.initializeApp();

/**
 * Mark an org's billing for cancellation at end of the current month.
 *
 * - No immediate suspension: users keep Pro access until end of month.
 * - Dashboard access maintained until end of month.
 * - The monthlyOrgBilling scheduler handles the final invoice + suspension on the 1st.
 */
export const cancelOrgSubscription = onCall(
  { region: 'us-central1', memory: '256MiB' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Not authenticated');

    const callerRole = request.auth.token.role as string | undefined;
    const callerOrgId = request.auth.token.organizationId as string | undefined;

    if (callerRole !== 'admin' && callerRole !== 'organization') {
      throw new HttpsError('permission-denied', 'Only admins and organization accounts can cancel');
    }

    const { organizationId } = request.data as { organizationId?: string };
    const orgId = organizationId ?? callerOrgId;
    if (!orgId) throw new HttpsError('invalid-argument', 'organizationId required');

    if (callerRole === 'organization' && orgId !== callerOrgId) {
      throw new HttpsError('permission-denied', 'You can only cancel billing for your own organization');
    }

    const db = admin.firestore();
    const orgSnap = await db.doc(`organizations/${orgId}`).get();
    if (!orgSnap.exists) throw new HttpsError('not-found', 'Organization not found');

    // End of current month = 1st of next month 00:00 UTC
    // This matches the billing scheduler's monthEnd boundary exactly.
    const now = new Date();
    const cancelAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const cancelAtTimestamp = admin.firestore.Timestamp.fromDate(cancelAt);

    await orgSnap.ref.update({
      cancelAtPeriodEnd: true,
      cancelAt: cancelAtTimestamp,
    });

    console.log(`[cancelOrgSubscription] org=${orgId} set to cancel at ${cancelAt.toISOString()}`);

    return { success: true, endsAt: cancelAt.toISOString() };
  }
);
