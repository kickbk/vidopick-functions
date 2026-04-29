import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { sendExpoPushNotifications } from '../utils/expoPush.js';

if (!admin.apps.length) admin.initializeApp();

/**
 * Send a push notification announcement to all Pro subscribers of an organization.
 *
 * Caller must be an admin, organization account, or member of the org.
 *
 * @param organizationId - target org
 * @param title          - notification title
 * @param body           - notification body
 * @param target         - 'active' (approved users) | 'pending' (pending users) | 'all'
 */
export const sendAnnouncement = onCall(
  { region: 'us-central1', memory: '256MiB', timeoutSeconds: 60 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Not authenticated');

    const callerRole = request.auth.token.role as string | undefined;
    const callerOrgId = request.auth.token.organizationId as string | undefined;

    if (callerRole !== 'admin' && callerRole !== 'organization' && callerRole !== 'member') {
      throw new HttpsError('permission-denied', 'Only admins and organization accounts can send announcements');
    }

    const { organizationId, title, body, target = 'active' } = (request.data ?? {}) as {
      organizationId?: string;
      title?: string;
      body?: string;
      target?: 'active' | 'pending' | 'all';
    };

    if (!organizationId) throw new HttpsError('invalid-argument', 'organizationId is required');
    if (!title?.trim()) throw new HttpsError('invalid-argument', 'title is required');
    if (!body?.trim()) throw new HttpsError('invalid-argument', 'body is required');

    // Org accounts and members can only send for their own org
    if (
      (callerRole === 'organization' || callerRole === 'member') &&
      callerOrgId !== organizationId
    ) {
      throw new HttpsError('permission-denied', 'You can only send announcements for your own organization');
    }

    const db = admin.firestore();

    // Build query for target users
    let usersQuery = db.collection('users').where(
      'sponsoredBy',
      'array-contains',
      organizationId
    );

    if (target === 'pending') {
      usersQuery = db.collection('users').where(
        'pendingApprovalFrom',
        'array-contains',
        organizationId
      ) as typeof usersQuery;
    }

    const snap = await usersQuery.get();

    if (snap.empty) {
      return { success: true, sent: 0, message: 'No subscribers found' };
    }

    // Collect all device tokens across all matching users
    const allTokens: string[] = [];
    for (const userDoc of snap.docs) {
      const tokens: string[] = userDoc.data().deviceTokens ?? [];
      allTokens.push(...tokens);
    }

    if (allTokens.length === 0) {
      return { success: true, sent: 0, message: 'No device tokens registered for subscribers' };
    }

    await sendExpoPushNotifications(
      allTokens,
      { title: title.trim(), body: body.trim() },
      { type: 'announcement', organizationId },
    );

    console.log(
      `[sendAnnouncement] org=${organizationId} title="${title}" tokens=${allTokens.length}`
    );

    return { success: true, sent: allTokens.length, total: allTokens.length };
  }
);
