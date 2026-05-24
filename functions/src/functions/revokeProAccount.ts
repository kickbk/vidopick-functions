import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { notifyUser } from '../utils/notifyUser.js';

if (!admin.apps.length) admin.initializeApp();

/**
 * Revoke a user's sponsored Pro account.
 * Callable from the web dashboard by org admins, members (for their org), or platform admins.
 */
export const revokeProAccount = onCall(
  { region: 'us-central1', memory: '256MiB' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Not authenticated');

    const callerRole = request.auth.token.role as string | undefined;
    const callerOrgId = request.auth.token.organizationId as string | undefined;

    if (callerRole !== 'admin' && callerRole !== 'organization' && callerRole !== 'member') {
      throw new HttpsError(
        'permission-denied',
        'Only admins and organization accounts can revoke Pro'
      );
    }

    const { uid, organizationId } = request.data as { uid?: string; organizationId?: string };
    if (!uid) throw new HttpsError('invalid-argument', 'uid is required');

    const orgId = organizationId ?? callerOrgId;
    if (!orgId) throw new HttpsError('invalid-argument', 'organizationId required');

    if ((callerRole === 'organization' || callerRole === 'member') && orgId !== callerOrgId) {
      throw new HttpsError(
        'permission-denied',
        'You can only revoke users for your own organization'
      );
    }

    const db = admin.firestore();
    const userSnap = await db.doc(`users/${uid}`).get();
    if (!userSnap.exists) throw new HttpsError('not-found', 'User not found');

    const userData = userSnap.data()!;
    const sponsoredBy: string[] = userData.sponsoredBy ?? [];

    if (!sponsoredBy.includes(orgId)) {
      throw new HttpsError(
        'failed-precondition',
        'This user is not sponsored by your organization'
      );
    }

    const remainingSponsors = sponsoredBy.filter((id) => id !== orgId);

    const now = admin.firestore.Timestamp.now();

    await db.doc(`users/${uid}`).update({
      sponsoredBy: admin.firestore.FieldValue.arrayRemove(orgId),
      ...(remainingSponsors.length === 0 ? { proStatus: 'none', proType: null } : {}),
    });

    // Close the open billing period in orgSponsors subcollection
    const orgUserRef = db.doc(`orgSponsors/${orgId}/users/${uid}`);
    const orgUserSnap = await orgUserRef.get();
    if (orgUserSnap.exists) {
      const periods: any[] = orgUserSnap.data()!.periods ?? [];
      const updatedPeriods = periods.map((p: any) =>
        p.endedAt === null ? { ...p, endedAt: now } : p
      );
      await orgUserRef.update({ periods: updatedPeriods, revokedAt: now, updatedAt: now });
    }

    console.log(`[revokeProAccount] uid=${uid} revoked by org=${orgId}`);

    // Fetch the revoking org name + all remaining sponsor org names in parallel
    const orgIdsToFetch = [orgId, ...remainingSponsors];
    const [orgSnaps, authRecord] = await Promise.all([
      Promise.all(orgIdsToFetch.map((id) => db.doc(`organizations/${id}`).get())),
      admin.auth().getUser(uid),
    ]);
    const orgNames = new Map(orgIdsToFetch.map((id, i) => [id, orgSnaps[i].data()?.name ?? id]));

    const revokedOrgName: string = orgNames.get(orgId) ?? orgId;
    const remainingOrgNames: string[] = remainingSponsors.map((id) => orgNames.get(id) ?? id);
    const stillCovered = remainingOrgNames.length > 0;

    const userEmail: string = authRecord.email ?? '';
    const displayName: string = authRecord.displayName || userEmail || 'there';

    // Push + in-app notification
    const deviceTokens: string[] = userData.deviceTokens ?? [];
    const notifTitle = `${revokedOrgName} no longer sponsors your Pro`;
    const notifBody = stillCovered
      ? `Still covered by ${remainingOrgNames[0]}${remainingOrgNames.length > 1 ? ` and ${remainingOrgNames.length - 1} other${remainingOrgNames.length > 2 ? 's' : ''}` : ''}`
      : 'Open the app to get your own Pro subscription.';

    await notifyUser(admin.firestore(), uid, deviceTokens, notifTitle, notifBody, {
      type: 'pro_revoked',
      organizationId: orgId,
    }).catch((e) => console.warn('[revokeProAccount] notification failed:', e));

    // Email notification
    if (userEmail) {
      try {
        const RESEND_API_KEY = process.env.RESEND_API_KEY;
        if (RESEND_API_KEY) {
          const { Resend } = await import('resend');
          const { buildProRevokedEmail } = await import('../utils/emailTemplates.js');
          const resend = new Resend(RESEND_API_KEY);
          const subject = stillCovered
            ? `A change to your Vidopick Pro membership`
            : `Your Vidopick Pro membership from ${revokedOrgName} has ended`;
          await resend.emails.send({
            from: 'Vidopick <hello@vidopick.com>',
            to: userEmail,
            subject,
            html: buildProRevokedEmail(displayName, revokedOrgName, remainingOrgNames),
          });
          console.log(`[revokeProAccount] email sent to ${userEmail}`);
        }
      } catch (e) {
        console.warn('[revokeProAccount] email failed:', e);
      }
    }

    return { success: true };
  }
);
