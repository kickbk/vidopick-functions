import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { sendExpoPushNotifications } from '../utils/expoPush.js';
import { notifyUser } from '../utils/notifyUser.js';

if (!admin.apps.length) admin.initializeApp();

const ADMIN_BASE_URL = process.env.FUNCTIONS_EMULATOR
  ? 'http://localhost:5173'
  : 'https://vidopick.com';

// ── Types ─────────────────────────────────────────────────────────────────────

interface FollowingDoc {
  profileId: string;
  sourceUid: string;
  organizationId?: string;
  memberId?: string;
  inviteId: string;
  createdAt: number;
}

interface ProSources {
  stripe?: boolean;
  sponsored?: Record<string, { memberId?: string; grantedAt: number }>;
}

interface ProfileSnapshot {
  profileId: string;
  profileOwnerUid: string;
  profileName: string;
  profileColor: string;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) return;
  try {
    const { Resend } = await import('resend');
    const resend = new Resend(RESEND_API_KEY);
    await resend.emails.send({
      from: 'Vidopick <hello@vidopick.com>',
      to,
      subject,
      html,
    });
  } catch (e) {
    console.warn('[profileFollow] email failed:', e);
  }
}

/**
 * Batch-fetches device tokens for a list of UIDs and sends push notifications to all of them.
 */
async function notifyFollowers(
  db: admin.firestore.Firestore,
  followerUids: string[],
  notification: { title: string; body: string },
  data: Record<string, string>
): Promise<void> {
  if (followerUids.length === 0) return;
  const userRefs = followerUids.map((uid) => db.doc(`users/${uid}`));
  const userSnaps = await db.getAll(...userRefs);
  const allTokens: string[] = [];
  for (const snap of userSnaps) {
    const tokens: string[] = snap.data()?.deviceTokens ?? [];
    allTokens.push(...tokens);
  }

  const sentAt = admin.firestore.FieldValue.serverTimestamp();
  const notifPayload = { ...notification, ...data, sentAt, viewedAt: null };
  const batches: Promise<admin.firestore.WriteResult[]>[] = [];
  let batch = db.batch();
  let opCount = 0;
  for (const uid of followerUids) {
    batch.set(db.collection(`users/${uid}/notifications`).doc(), notifPayload);
    if (++opCount >= 499) {
      batches.push(batch.commit());
      batch = db.batch();
      opCount = 0;
    }
  }
  if (opCount > 0) batches.push(batch.commit());

  await Promise.all([sendExpoPushNotifications(allTokens, notification, data), ...batches]);
}

/**
 * Writes a map entry to the user doc at `users/{uid}` under `profiles.{profileId}`.
 */
async function writeFollowingDoc(
  db: admin.firestore.Firestore,
  uid: string,
  doc: FollowingDoc
): Promise<void> {
  await db.doc(`users/${uid}`).update({
    [`profiles.${doc.profileId}`]: {
      isFollowed: true,
      dailyLimitMinutes: null,
      skipShufflePlaylistIds: [],
      ...(doc.organizationId ? { organizationId: doc.organizationId } : {}),
      ...(doc.memberId ? { memberId: doc.memberId } : {}),
    },
  });
}

/**
 * Grants Pro sponsorship from an org, updating proSources and orgSponsors billing.
 */
async function grantOrgPro(
  db: admin.firestore.Firestore,
  requestingUid: string,
  organizationId: string,
  memberId: string | undefined,
  userData: admin.firestore.DocumentData
): Promise<void> {
  const userRef = db.doc(`users/${requestingUid}`);
  const now = admin.firestore.Timestamp.now();
  const alreadyPro = userData?.proStatus === 'active';

  await userRef.update({
    [`proSources.sponsored.${organizationId}`]: {
      ...(memberId ? { memberId } : {}),
      grantedAt: Date.now(),
    },
    proStatus: 'active',
    proType: 'sponsored',
    ...(alreadyPro ? {} : { approvedAt: now }),
  });

  const orgUserRef = db.doc(`orgSponsors/${organizationId}/users/${requestingUid}`);
  const orgUserSnap = await orgUserRef.get();
  const authRecord = await admin.auth().getUser(requestingUid);
  const email = authRecord.email ?? '';
  const displayName = authRecord.displayName || email;

  if (orgUserSnap.exists) {
    const periods: any[] = orgUserSnap.data()!.periods ?? [];
    const closed = periods.map((p: any) => (p.endedAt === null ? { ...p, endedAt: now } : p));
    await orgUserRef.set({
      uid: requestingUid,
      displayName,
      email,
      periods: [...closed, { startedAt: now, endedAt: null }],
      approvedAt: now,
      updatedAt: now,
    });
  } else {
    await orgUserRef.set({
      uid: requestingUid,
      displayName,
      email,
      periods: [{ startedAt: now, endedAt: null }],
      approvedAt: now,
      updatedAt: now,
    });
  }
}

/**
 * Writes the following subcollection doc, then grants Pro if org-sponsored.
 * Used both at immediate approval time and inside approveSponsorshipRequest.
 */
async function applyFollowApproval(
  db: admin.firestore.Firestore,
  requestingUid: string,
  profileOwnerUid: string,
  profileId: string,
  inviteId: string,
  organizationId: string | undefined,
  memberId: string | undefined
): Promise<void> {
  // Check for an existing identical follow to avoid duplicates
  const userSnapForCheck = await db.doc(`users/${requestingUid}`).get();
  const alreadyFollowing = userSnapForCheck.data()?.profiles?.[profileId]?.isFollowed === true;

  if (!alreadyFollowing) {
    const followDoc: FollowingDoc = {
      profileId,
      sourceUid: profileOwnerUid,
      inviteId,
      createdAt: Date.now(),
      ...(organizationId ? { organizationId } : {}),
      ...(memberId ? { memberId } : {}),
    };
    await writeFollowingDoc(db, requestingUid, followDoc);
    await db.doc(`profiles/${profileId}`).update({
      followerUids: admin.firestore.FieldValue.arrayUnion(requestingUid),
    });
  }

  // Grant Pro if org-sponsored
  if (organizationId) {
    const userSnap = await db.doc(`users/${requestingUid}`).get();
    await grantOrgPro(db, requestingUid, organizationId, memberId, userSnap.data() ?? {});
  }
}

/**
 * Checks proSources and revokes pro if appropriate.
 * Returns true if Pro was revoked.
 */
async function revokeOrgProIfNeeded(
  db: admin.firestore.Firestore,
  uid: string,
  orgId: string,
  now: admin.firestore.Timestamp
): Promise<boolean> {
  const userRef = db.doc(`users/${uid}`);

  // Remove the sponsored entry for this org
  await userRef.update({
    [`proSources.sponsored.${orgId}`]: admin.firestore.FieldValue.delete(),
  });

  // Re-read to check remaining proSources
  const updatedSnap = await userRef.get();
  const proSources: ProSources = updatedSnap.data()?.proSources ?? {};
  const hasStripe = !!proSources.stripe;
  const remainingSponsored = proSources.sponsored ? Object.keys(proSources.sponsored).length : 0;

  if (!hasStripe && remainingSponsored === 0) {
    await userRef.update({ proStatus: 'none', proType: null });

    // Close billing period
    const orgUserRef = db.doc(`orgSponsors/${orgId}/users/${uid}`);
    const orgUserSnap = await orgUserRef.get();
    if (orgUserSnap.exists) {
      const periods: any[] = orgUserSnap.data()!.periods ?? [];
      await orgUserRef.update({
        periods: periods.map((p: any) => (p.endedAt === null ? { ...p, endedAt: now } : p)),
        revokedAt: now,
        updatedAt: now,
      });
    }
    return true;
  }

  return false;
}

// ── requestOrgSponsorship ─────────────────────────────────────────────────────

export const requestOrgSponsorship = onCall(
  { region: 'us-central1', memory: '256MiB' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Not authenticated');

    const {
      organizationId,
      memberId,
      inviteId,
      displayName: callerName,
    } = request.data as {
      organizationId?: string;
      memberId?: string;
      inviteId?: string;
      displayName?: string;
    };

    if (!organizationId) throw new HttpsError('invalid-argument', 'organizationId required');
    if (!inviteId) throw new HttpsError('invalid-argument', 'inviteId required');

    const db = admin.firestore();
    const requestingUid = request.auth.uid;

    console.log(
      `[requestOrgSponsorship] uid=${requestingUid} org=${organizationId} inviteId=${inviteId}`
    );

    // Read short link to get the single profile snapshot
    const shortLinkSnap = await db.doc(`shortLinks/${inviteId}`).get();
    if (!shortLinkSnap.exists) {
      throw new HttpsError('not-found', 'Invite link not found');
    }
    const shortLinkParams = shortLinkSnap.data()?.params ?? {};
    const linkProfile = shortLinkParams.profile as
      | {
          profileId?: string;
          uid?: string;
          displayName?: string;
          color?: string;
        }
      | undefined;

    if (!linkProfile?.uid || !linkProfile?.profileId) {
      throw new HttpsError('not-found', 'Profile not found in invite link');
    }

    const profileSnapshots: ProfileSnapshot[] = [
      {
        profileId: linkProfile.profileId,
        profileOwnerUid: linkProfile.uid,
        profileName: linkProfile.displayName ?? 'Profile',
        profileColor: linkProfile.color ?? '#E53935',
      },
    ];

    // Load user doc
    const userSnap = await db.doc(`users/${requestingUid}`).get();
    const userData = userSnap.data() ?? {};
    const email = request.auth.token.email ?? '';
    const displayName = callerName?.trim() || 'Unknown';

    // Check if already sponsored by this org
    const proSources: ProSources = userData.proSources ?? {};
    const alreadySponsored = !!proSources.sponsored?.[organizationId];

    if (alreadySponsored) {
      console.log(
        `[requestOrgSponsorship] already sponsored uid=${requestingUid} org=${organizationId} — applying follows directly`
      );

      const newlyFollowed: typeof profileSnapshots = [];
      const requestingUserSnap = await db.doc(`users/${requestingUid}`).get();
      for (const snapshot of profileSnapshots) {
        const alreadyFollowingSnap =
          requestingUserSnap.data()?.profiles?.[snapshot.profileId]?.isFollowed === true;
        if (alreadyFollowingSnap) continue;

        await writeFollowingDoc(db, requestingUid, {
          profileId: snapshot.profileId,
          sourceUid: snapshot.profileOwnerUid,
          organizationId,
          ...(memberId ? { memberId } : {}),
          inviteId,
          createdAt: Date.now(),
        });
        await db.doc(`profiles/${snapshot.profileId}`).update({
          followerUids: admin.firestore.FieldValue.arrayUnion(requestingUid),
        });

        // Upsert profileFollowRequest so the follower appears in the member's followers list
        const now = admin.firestore.FieldValue.serverTimestamp();
        const existingPfr = await db
          .collection('profileFollowRequests')
          .where('requestingUid', '==', requestingUid)
          .where('profileId', '==', snapshot.profileId)
          .limit(1)
          .get();
        if (!existingPfr.empty) {
          await existingPfr.docs[0].ref.update({
            status: 'approved',
            approvedAt: now,
            organizationId,
            ...(memberId ? { memberId } : {}),
          });
        } else {
          await db.collection('profileFollowRequests').add({
            requestingUid,
            profileId: snapshot.profileId,
            profileOwnerUid: snapshot.profileOwnerUid,
            profileName: snapshot.profileName,
            profileColor: snapshot.profileColor,
            organizationId,
            ...(memberId ? { memberId } : {}),
            inviteId,
            email,
            displayName,
            status: 'approved',
            requestedAt: now,
            approvedAt: now,
          });
        }

        newlyFollowed.push(snapshot);
      }

      // Notify the member for each profile they were re-followed on (non-fatal)
      if (memberId && newlyFollowed.length > 0) {
        try {
          const memberSnap = await db.doc(`members/${memberId}`).get();
          const memberAuthUid: string | undefined =
            memberSnap.data()?.authUid ?? newlyFollowed[0].profileOwnerUid;
          if (memberAuthUid) {
            const memberUserSnap = await db.doc(`users/${memberAuthUid}`).get();
            const memberTokens: string[] = memberUserSnap.data()?.deviceTokens ?? [];
            const profileName = newlyFollowed[0].profileName ?? 'your profile';
            await notifyUser(
              db,
              memberAuthUid,
              memberTokens,
              'New follower',
              `${displayName} is now following ${profileName}.`,
              { type: 'profile_follow_new', profileId: newlyFollowed[0].profileId },
              { type: 'profile_follow_new', profileId: newlyFollowed[0].profileId }
            );
          }
        } catch (e) {
          console.warn('[requestOrgSponsorship] re-follow member notification failed:', e);
        }
      }

      return { success: true, status: 'approved' };
    }

    // Not yet sponsored — create a sponsorshipRequest
    const sponsorshipRef = db.collection('sponsorshipRequests').doc();
    await sponsorshipRef.set({
      requestingUid,
      email,
      displayName,
      organizationId,
      ...(memberId ? { memberId } : {}),
      inviteId,
      profileSnapshots,
      requestedAt: admin.firestore.FieldValue.serverTimestamp(),
      status: 'pending',
    });

    console.log(
      `[requestOrgSponsorship] created sponsorshipRequestId=${sponsorshipRef.id} uid=${requestingUid}`
    );

    // Notify approvers via branded email (non-fatal)
    try {
      const [orgSnap, memberSnap] = await Promise.all([
        db.doc(`organizations/${organizationId}`).get(),
        memberId ? db.doc(`members/${memberId}`).get() : Promise.resolve(null),
      ]);
      const orgData = orgSnap.data() ?? {};
      const orgName: string = orgData.name ?? 'Your organization';
      const approvalRole: string = orgData.sponsorshipApprovalRole ?? 'organization';
      const dashboardUrl = `${ADMIN_BASE_URL}/admin/organizations/${organizationId}/pro-approvals/`;

      const { buildMemberSubscriberNotificationEmail, buildOrgSubscriberNotificationEmail } =
        await import('../utils/emailTemplates.js');

      const emailTasks: Promise<void>[] = [];

      if (memberId && memberSnap && (approvalRole === 'member' || approvalRole === 'both')) {
        const memberData = memberSnap.data();
        if (memberData?.email) {
          const memberName: string = memberData.name ?? 'there';
          emailTasks.push(
            sendEmail(
              memberData.email,
              `New Pro request from ${displayName}`,
              buildMemberSubscriberNotificationEmail(
                memberName,
                displayName,
                email || undefined,
                orgName,
                dashboardUrl
              )
            )
          );
        }
      }

      if (approvalRole === 'organization' || approvalRole === 'both') {
        const orgAuthUid: string | undefined = orgData.authUid;
        if (orgAuthUid) {
          const orgAuthRecord = await admin
            .auth()
            .getUser(orgAuthUid)
            .catch(() => null);
          if (orgAuthRecord?.email) {
            emailTasks.push(
              sendEmail(
                orgAuthRecord.email,
                `New Pro request from ${displayName}`,
                buildOrgSubscriberNotificationEmail(
                  orgName,
                  displayName,
                  email || undefined,
                  dashboardUrl
                )
              )
            );
          }
        }
      }

      await Promise.all(emailTasks);
    } catch (e) {
      console.warn('[requestOrgSponsorship] email notification failed:', e);
    }

    // Push + in-app notification to member (non-fatal)
    if (memberId) {
      try {
        const [memberSnap, orgSnap] = await Promise.all([
          db.doc(`members/${memberId}`).get(),
          db.doc(`organizations/${organizationId}`).get(),
        ]);
        const approvalRole: string = orgSnap.data()?.sponsorshipApprovalRole ?? 'organization';
        const needsApproval = approvalRole === 'member' || approvalRole === 'both';

        if (needsApproval) {
          // Fall back to profileOwnerUid if authUid not yet set on the member doc
          // (teacher may not have completed completeMemberAppSignIn yet)
          const memberAuthUid: string | undefined =
            memberSnap.data()?.authUid ?? profileSnapshots[0]?.profileOwnerUid;
          if (memberAuthUid) {
            const memberUserSnap = await db.doc(`users/${memberAuthUid}`).get();
            const memberTokens: string[] = memberUserSnap.data()?.deviceTokens ?? [];
            const profileName: string = profileSnapshots[0]?.profileName ?? 'your profile';
            const notifTitle = 'New sponsorship request';
            const notifBody = `${displayName} wants to follow ${profileName}. Approve by tapping on ${profileName} and open Followers, or use the dashboard on the Vidopick website.`;

            await notifyUser(db, memberAuthUid, memberTokens, notifTitle, notifBody, {
              type: 'new_follower_request',
            });
          }
        }
      } catch (e) {
        console.warn('[requestOrgSponsorship] member notification failed:', e);
      }
    }

    return { success: true, status: 'pending', requestId: sponsorshipRef.id };
  }
);

// ── approveSponsorshipRequest ─────────────────────────────────────────────────

export const approveSponsorshipRequest = onCall(
  { region: 'us-central1', memory: '256MiB' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Not authenticated');

    const callerRole = request.auth.token.role as string | undefined;
    const callerOrgId = request.auth.token.organizationId as string | undefined;

    if (callerRole !== 'admin' && callerRole !== 'organization' && callerRole !== 'member') {
      throw new HttpsError(
        'permission-denied',
        'Only admins and organization accounts can approve'
      );
    }

    const { requestId } = request.data as { requestId?: string };
    if (!requestId) throw new HttpsError('invalid-argument', 'requestId required');

    const db = admin.firestore();
    const sponsorshipRef = db.doc(`sponsorshipRequests/${requestId}`);
    const sponsorshipSnap = await sponsorshipRef.get();

    if (!sponsorshipSnap.exists) throw new HttpsError('not-found', 'Sponsorship request not found');

    const req = sponsorshipSnap.data()!;
    if (req.status !== 'pending') {
      return { success: true, alreadyProcessed: true };
    }

    if (callerRole !== 'admin' && req.organizationId !== callerOrgId) {
      throw new HttpsError(
        'permission-denied',
        'You can only approve requests for your organization'
      );
    }

    if (callerRole === 'member') {
      const orgSnap = await db.doc(`organizations/${req.organizationId}`).get();
      const approvalRole: string = orgSnap.data()?.sponsorshipApprovalRole ?? 'organization';
      if (approvalRole === 'organization') {
        throw new HttpsError(
          'permission-denied',
          'Only the organization account can approve this request'
        );
      }
      const callerMemberId = request.auth.token.memberId as string | undefined;
      if (req.memberId && req.memberId !== callerMemberId) {
        throw new HttpsError(
          'permission-denied',
          'You can only approve requests for your own invites'
        );
      }
    }

    const { requestingUid, organizationId, memberId, profileSnapshots, inviteId } = req as {
      requestingUid: string;
      organizationId: string;
      memberId?: string;
      profileSnapshots: ProfileSnapshot[];
      inviteId: string;
    };

    console.log(
      `[approveSponsorshipRequest] requestId=${requestId} uid=${requestingUid} org=${organizationId}`
    );

    // Mark approved
    await sponsorshipRef.update({
      status: 'approved',
      approvedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Grant Pro
    const [userSnap, authRecord] = await Promise.all([
      db.doc(`users/${requestingUid}`).get(),
      admin.auth().getUser(requestingUid),
    ]);
    await grantOrgPro(db, requestingUid, organizationId, memberId, userSnap.data() ?? {});
    const userData = userSnap.data() ?? {};
    const email = authRecord.email ?? '';
    const displayName: string = (req as any).displayName || email;
    const now = admin.firestore.FieldValue.serverTimestamp();

    // For each profile: write follow directly — org approval is the sole gate.
    // member-level requiresProfileFollowApproval does not apply to org-sponsored follows.
    const approveUserSnap = await db.doc(`users/${requestingUid}`).get();
    for (const snapshot of profileSnapshots) {
      // Check already following
      const alreadyFollowingApprove =
        approveUserSnap.data()?.profiles?.[snapshot.profileId]?.isFollowed === true;
      if (alreadyFollowingApprove) continue;

      await writeFollowingDoc(db, requestingUid, {
        profileId: snapshot.profileId,
        sourceUid: snapshot.profileOwnerUid,
        organizationId,
        ...(memberId ? { memberId } : {}),
        inviteId,
        createdAt: Date.now(),
      });

      await db.doc(`profiles/${snapshot.profileId}`).update({
        followerUids: admin.firestore.FieldValue.arrayUnion(requestingUid),
      });

      // Upsert a profileFollowRequest record so the dashboard (web + mobile) can list this
      // follower. Query for an existing one first (e.g. from a prior personal-invite request).
      try {
        const existingPfr = await db
          .collection('profileFollowRequests')
          .where('requestingUid', '==', requestingUid)
          .where('profileId', '==', snapshot.profileId)
          .limit(1)
          .get();

        if (!existingPfr.empty) {
          await existingPfr.docs[0].ref.update({
            status: 'approved',
            approvedAt: now,
            organizationId,
            ...(memberId ? { memberId } : {}),
          });
        } else {
          await db.collection('profileFollowRequests').add({
            requestingUid,
            profileId: snapshot.profileId,
            profileOwnerUid: snapshot.profileOwnerUid,
            profileName: snapshot.profileName,
            profileColor: snapshot.profileColor,
            organizationId,
            ...(memberId ? { memberId } : {}),
            inviteId,
            email,
            displayName,
            status: 'approved',
            requestedAt: now,
            approvedAt: now,
          });
        }
      } catch (e) {
        console.warn('[approveSponsorshipRequest] profileFollowRequests upsert failed:', e);
      }
    }

    // Push + in-app notification to user (non-fatal)
    try {
      const tokens: string[] = userData.deviceTokens ?? [];
      const approvedProfileName: string = profileSnapshots[0]?.profileName ?? 'the profile';
      const notifTitle = 'Sponsorship approved';
      const notifBody = `Your Pro access has been approved. You now follow ${approvedProfileName}.`;
      await notifyUser(db, requestingUid, tokens, notifTitle, notifBody, {
        type: 'sponsorship_approved',
        organizationId,
      });
    } catch (e) {
      console.warn('[approveSponsorshipRequest] push failed:', e);
    }

    // Email to user (non-fatal)
    try {
      if (email) {
        const { buildProApprovalEmail } = await import('../utils/emailTemplates.js');
        const orgSnap = await db.doc(`organizations/${organizationId}`).get();
        const orgName: string = orgSnap.data()?.name ?? organizationId;
        const displayName: string = (req as any).displayName || email;
        await sendEmail(
          email,
          "You're a Vidopick Pro! ✦",
          buildProApprovalEmail(displayName, orgName)
        );
      }
    } catch (e) {
      console.warn('[approveSponsorshipRequest] user email failed:', e);
    }

    return { success: true };
  }
);

// ── declineSponsorshipRequest ─────────────────────────────────────────────────

export const declineSponsorshipRequest = onCall(
  { region: 'us-central1', memory: '256MiB' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Not authenticated');

    const callerRole = request.auth.token.role as string | undefined;
    const callerOrgId = request.auth.token.organizationId as string | undefined;

    if (callerRole !== 'admin' && callerRole !== 'organization' && callerRole !== 'member') {
      throw new HttpsError(
        'permission-denied',
        'Only admins and organization accounts can decline'
      );
    }

    const { requestId } = request.data as { requestId?: string };
    if (!requestId) throw new HttpsError('invalid-argument', 'requestId required');

    const db = admin.firestore();
    const sponsorshipRef = db.doc(`sponsorshipRequests/${requestId}`);
    const sponsorshipSnap = await sponsorshipRef.get();

    if (!sponsorshipSnap.exists) throw new HttpsError('not-found', 'Sponsorship request not found');

    const req = sponsorshipSnap.data()!;
    if (req.status !== 'pending') {
      return { success: true, alreadyProcessed: true };
    }

    if (callerRole !== 'admin' && req.organizationId !== callerOrgId) {
      throw new HttpsError(
        'permission-denied',
        'You can only decline requests for your organization'
      );
    }

    if (callerRole === 'member') {
      const orgSnap = await db.doc(`organizations/${req.organizationId}`).get();
      const approvalRole: string = orgSnap.data()?.sponsorshipApprovalRole ?? 'organization';
      if (approvalRole === 'organization') {
        throw new HttpsError(
          'permission-denied',
          'Only the organization account can decline this request'
        );
      }
      const callerMemberId = request.auth.token.memberId as string | undefined;
      if (req.memberId && req.memberId !== callerMemberId) {
        throw new HttpsError(
          'permission-denied',
          'You can only decline requests for your own invites'
        );
      }
    }

    await sponsorshipRef.update({
      status: 'declined',
      declinedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`[declineSponsorshipRequest] requestId=${requestId} uid=${req.requestingUid}`);

    // Push + in-app notification (non-fatal)
    try {
      const userSnap = await db.doc(`users/${req.requestingUid}`).get();
      const tokens: string[] = userSnap.data()?.deviceTokens ?? [];
      await notifyUser(
        db,
        req.requestingUid,
        tokens,
        'Sponsorship request declined',
        'Your request for sponsored Pro access was not approved.',
        { type: 'sponsorship_declined', organizationId: req.organizationId }
      );
    } catch (e) {
      console.warn('[declineSponsorshipRequest] push failed:', e);
    }

    return { success: true };
  }
);

// ── requestProfileFollow ──────────────────────────────────────────────────────
// Personal Pro-to-Pro only. Callers with an org context must use requestOrgSponsorship.

export const requestProfileFollow = onCall(
  { region: 'us-central1', memory: '256MiB' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Not authenticated');

    const {
      profileId,
      profileOwnerUid,
      inviteId,
      organizationId,
      displayName: callerName,
    } = request.data as {
      profileId?: string;
      profileOwnerUid?: string;
      inviteId?: string;
      organizationId?: string;
      displayName?: string;
    };

    if (organizationId) {
      throw new HttpsError(
        'invalid-argument',
        'For org-sponsored follows use requestOrgSponsorship instead'
      );
    }

    if (!profileId) throw new HttpsError('invalid-argument', 'profileId required');
    if (!profileOwnerUid) throw new HttpsError('invalid-argument', 'profileOwnerUid required');
    if (!inviteId) throw new HttpsError('invalid-argument', 'inviteId required');

    const db = admin.firestore();
    const requestingUid = request.auth.uid;

    // Verify the requesting user has an active Pro account
    const requesterSnap = await db.doc(`users/${requestingUid}`).get();
    const requesterProStatus = requesterSnap.data()?.proStatus;
    if (requesterProStatus !== 'active') {
      throw new HttpsError('permission-denied', 'Pro subscription required to follow profiles');
    }

    // Verify the profile exists and isShared
    const profileSnap = await db.doc(`profiles/${profileId}`).get();
    if (!profileSnap.exists || !profileSnap.data()?.isShared) {
      throw new HttpsError('not-found', 'Profile not found or not shared');
    }

    // Check if already following
    const requestingUserSnap = await db.doc(`users/${requestingUid}`).get();
    const alreadyFollowing = requestingUserSnap.data()?.profiles?.[profileId]?.isFollowed === true;
    if (alreadyFollowing) {
      return { success: true, status: 'already_following' };
    }

    // Auto-approve immediately (no org approval needed for personal Pro-to-Pro)
    const [authRecord, ownerSnap] = await Promise.all([
      admin.auth().getUser(requestingUid),
      db.doc(`users/${profileOwnerUid}`).get(),
    ]);
    const displayName = callerName?.trim() || authRecord.displayName || 'Unknown';

    await writeFollowingDoc(db, requestingUid, {
      profileId,
      sourceUid: profileOwnerUid,
      inviteId,
      createdAt: Date.now(),
    });

    // Record follower so onProfileChanged can notify them about new playlists
    await db.doc(`profiles/${profileId}`).update({
      followerUids: admin.firestore.FieldValue.arrayUnion(requestingUid),
    });

    // Notify profile owner (non-fatal)
    try {
      const profileName: string = profileSnap.data()?.name ?? 'a profile';
      const ownerTokens: string[] = ownerSnap.data()?.deviceTokens ?? [];
      await notifyUser(
        db,
        profileOwnerUid,
        ownerTokens,
        'New follower',
        `${displayName} is now following ${profileName}.`,
        { type: 'profile_follow_new', profileId, followerUid: requestingUid },
        { type: 'profile_follow_new', profileId }
      );
    } catch (e) {
      console.warn('[requestProfileFollow] owner notification failed:', e);
    }

    console.log(`[requestProfileFollow] uid=${requestingUid} profile=${profileId} auto-approved`);
    return { success: true, status: 'approved' };
  }
);

// ── approveProfileFollow ──────────────────────────────────────────────────────
// Member-level profile follow approval only (not org sponsorship).

export const approveProfileFollow = onCall(
  { region: 'us-central1', memory: '256MiB' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Not authenticated');

    const callerRole = request.auth.token.role as string | undefined;
    const callerOrgId = request.auth.token.organizationId as string | undefined;

    if (callerRole !== 'admin' && callerRole !== 'organization' && callerRole !== 'member') {
      throw new HttpsError(
        'permission-denied',
        'Only admins and organization accounts can approve'
      );
    }

    const { requestId } = request.data as { requestId?: string };
    if (!requestId) throw new HttpsError('invalid-argument', 'requestId required');

    const db = admin.firestore();
    const followReqRef = db.doc(`profileFollowRequests/${requestId}`);
    const followReqSnap = await followReqRef.get();

    if (!followReqSnap.exists) throw new HttpsError('not-found', 'Request not found');

    const req = followReqSnap.data()!;
    if (req.status !== 'pending') {
      return { success: true, alreadyProcessed: true };
    }

    if (callerRole !== 'admin' && req.organizationId !== callerOrgId) {
      throw new HttpsError(
        'permission-denied',
        'You can only approve requests for your organization'
      );
    }

    console.log(`[approveProfileFollow] requestId=${requestId} uid=${req.requestingUid}`);

    await applyFollowApproval(
      db,
      req.requestingUid,
      req.profileOwnerUid,
      req.profileId,
      req.inviteId,
      req.organizationId,
      req.memberId
    );

    await followReqRef.update({
      status: 'approved',
      approvedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Push + in-app notification to requester (non-fatal)
    try {
      const userSnap = await db.doc(`users/${req.requestingUid}`).get();
      const tokens: string[] = userSnap.data()?.deviceTokens ?? [];
      const profileSnap = await db.doc(`profiles/${req.profileId}`).get();
      const profileName: string = profileSnap.data()?.name ?? 'a profile';
      await notifyUser(
        db,
        req.requestingUid,
        tokens,
        'Follow request approved',
        `You can now access ${profileName}.`,
        { type: 'profile_follow_approved', profileId: req.profileId },
        { type: 'profile_follow_approved', profileId: req.profileId }
      );
    } catch (e) {
      console.warn('[approveProfileFollow] push failed:', e);
    }

    return { success: true };
  }
);

// ── declineProfileFollow ──────────────────────────────────────────────────────

export const declineProfileFollow = onCall(
  { region: 'us-central1', memory: '256MiB' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Not authenticated');

    const callerRole = request.auth.token.role as string | undefined;
    const callerOrgId = request.auth.token.organizationId as string | undefined;

    if (callerRole !== 'admin' && callerRole !== 'organization' && callerRole !== 'member') {
      throw new HttpsError(
        'permission-denied',
        'Only admins and organization accounts can decline'
      );
    }

    const { requestId } = request.data as { requestId?: string };
    if (!requestId) throw new HttpsError('invalid-argument', 'requestId required');

    const db = admin.firestore();
    const followReqRef = db.doc(`profileFollowRequests/${requestId}`);
    const followReqSnap = await followReqRef.get();

    if (!followReqSnap.exists) throw new HttpsError('not-found', 'Request not found');

    const req = followReqSnap.data()!;
    if (callerRole !== 'admin' && req.organizationId !== callerOrgId) {
      throw new HttpsError(
        'permission-denied',
        'You can only decline requests for your organization'
      );
    }

    await followReqRef.update({
      status: 'declined',
      declinedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`[declineProfileFollow] requestId=${requestId}`);

    // Push + in-app notification (non-fatal)
    try {
      const userSnap = await db.doc(`users/${req.requestingUid}`).get();
      const tokens: string[] = userSnap.data()?.deviceTokens ?? [];
      await notifyUser(
        db,
        req.requestingUid,
        tokens,
        'Follow request declined',
        'Your request to follow a profile was not approved.',
        { type: 'profile_follow_declined' }
      );
    } catch (e) {
      console.warn('[declineProfileFollow] push failed:', e);
    }

    return { success: true };
  }
);

// ── unfollowProfile ───────────────────────────────────────────────────────────

export const unfollowProfile = onCall(
  { region: 'us-central1', memory: '256MiB' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Not authenticated');

    const { sourceUid, profileId } = request.data as {
      sourceUid?: string;
      profileId?: string;
    };

    if (!sourceUid) throw new HttpsError('invalid-argument', 'sourceUid required');
    if (!profileId) throw new HttpsError('invalid-argument', 'profileId required');

    const db = admin.firestore();
    const uid = request.auth.uid;

    // Check if currently following via the user doc map
    const userDocSnap = await db.doc(`users/${uid}`).get();
    const followEntry = userDocSnap.data()?.profiles?.[profileId];

    if (!followEntry?.isFollowed) {
      console.log(
        `[unfollowProfile] no following entry found uid=${uid} sourceUid=${sourceUid} profileId=${profileId}`
      );
      return { success: true };
    }

    const orgId: string | undefined = followEntry.organizationId;

    // Remove the map entry from the user doc
    await db.doc(`users/${uid}`).update({
      [`profiles.${profileId}`]: admin.firestore.FieldValue.delete(),
    });

    // Remove follower from the profile's followerUids
    try {
      await db.doc(`profiles/${profileId}`).update({
        followerUids: admin.firestore.FieldValue.arrayRemove(uid),
      });
    } catch (e) {
      console.warn('[unfollowProfile] followerUids cleanup failed:', e);
    }

    let proRevoked = false;

    if (orgId) {
      // Check if any remaining profiles map entries have this orgId
      const userProfiles = userDocSnap.data()?.profiles ?? {};
      const hasRemainingForOrg = Object.entries(userProfiles).some(
        ([pid, entry]: [string, any]) => pid !== profileId && entry?.organizationId === orgId
      );

      if (!hasRemainingForOrg) {
        // No remaining entries for this org — revoke pro if appropriate
        const now = admin.firestore.Timestamp.now();
        proRevoked = await revokeOrgProIfNeeded(db, uid, orgId, now);
      }
    }

    // Cancel the profileFollowRequest (if one exists)
    try {
      const reqSnap = await db
        .collection('profileFollowRequests')
        .where('requestingUid', '==', uid)
        .where('profileId', '==', profileId)
        .where('status', '==', 'approved')
        .limit(1)
        .get();
      if (!reqSnap.empty) {
        await reqSnap.docs[0].ref.update({ status: 'cancelled' });
      }
    } catch (e) {
      console.warn('[unfollowProfile] cleanup profileFollowRequests failed:', e);
    }

    // Cancel the sponsorshipRequest if pro was revoked (mirrors revokeProfileFollower behaviour)
    if (proRevoked && orgId) {
      try {
        const sponsorshipSnap = await db
          .collection('sponsorshipRequests')
          .where('requestingUid', '==', uid)
          .where('organizationId', '==', orgId)
          .where('status', '==', 'approved')
          .get();
        const batch = db.batch();
        sponsorshipSnap.docs.forEach((d) => batch.update(d.ref, { status: 'cancelled' }));
        await batch.commit();
      } catch (e) {
        console.warn('[unfollowProfile] cleanup sponsorshipRequests failed:', e);
      }
    }

    console.log(
      `[unfollowProfile] uid=${uid} sourceUid=${sourceUid} profileId=${profileId} orgRevoked=${orgId ?? 'none'} proRevoked=${proRevoked}`
    );
    return { success: true };
  }
);

// ── revokeOrgSponsorship ──────────────────────────────────────────────────────
// Revokes Pro access only. Does NOT remove follow relationships.

export const revokeOrgSponsorship = onCall(
  { region: 'us-central1', memory: '256MiB' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Not authenticated');

    const callerRole = request.auth.token.role as string | undefined;
    const callerOrgId = request.auth.token.organizationId as string | undefined;

    if (callerRole !== 'admin' && callerRole !== 'organization') {
      throw new HttpsError(
        'permission-denied',
        'Only admins and organization accounts can revoke sponsorships'
      );
    }

    const { uid, organizationId } = request.data as {
      uid?: string;
      organizationId?: string;
    };
    if (!uid) throw new HttpsError('invalid-argument', 'uid required');

    const orgId = organizationId ?? callerOrgId;
    if (!orgId) throw new HttpsError('invalid-argument', 'organizationId required');

    if (callerRole !== 'admin' && orgId !== callerOrgId) {
      throw new HttpsError(
        'permission-denied',
        'You can only revoke sponsorships for your own organization'
      );
    }

    const db = admin.firestore();

    const userSnap = await db.doc(`users/${uid}`).get();
    if (!userSnap.exists) throw new HttpsError('not-found', 'User not found');
    const userData = userSnap.data()!;

    // Revoke Pro only — following docs and profileFollowRequests are left intact
    const now = admin.firestore.Timestamp.now();
    await revokeOrgProIfNeeded(db, uid, orgId, now);

    // Mark sponsorshipRequests as cancelled
    try {
      const snap = await db
        .collection('sponsorshipRequests')
        .where('requestingUid', '==', uid)
        .where('organizationId', '==', orgId)
        .where('status', '==', 'approved')
        .get();
      const batch = db.batch();
      snap.docs.forEach((d) => batch.update(d.ref, { status: 'cancelled', revokedAt: now }));
      await batch.commit();
    } catch (e) {
      console.warn('[revokeOrgSponsorship] sponsorshipRequests cleanup failed:', e);
    }

    // Push + in-app notification (non-fatal)
    try {
      const tokens: string[] = userData.deviceTokens ?? [];
      await notifyUser(
        db,
        uid,
        tokens,
        'Pro access revoked',
        'Your sponsored Pro access has been revoked.',
        { type: 'sponsorship_revoked', organizationId: orgId }
      );
    } catch (e) {
      console.warn('[revokeOrgSponsorship] push failed:', e);
    }

    console.log(`[revokeOrgSponsorship] uid=${uid} org=${orgId}`);
    return { success: true };
  }
);

// ── removeProfileFollower ─────────────────────────────────────────────────────
// Removes a follow relationship only. Does NOT touch Pro/sponsorship.

export const removeProfileFollower = onCall(
  { region: 'us-central1', memory: '256MiB' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Not authenticated');

    const callerRole = request.auth.token.role as string | undefined;
    const callerOrgId = request.auth.token.organizationId as string | undefined;

    if (callerRole !== 'admin' && callerRole !== 'organization' && callerRole !== 'member') {
      throw new HttpsError(
        'permission-denied',
        'Only admins, organizations and members can remove followers'
      );
    }

    const { requestId } = request.data as { requestId?: string };
    if (!requestId) throw new HttpsError('invalid-argument', 'requestId required');

    const db = admin.firestore();
    const followReqRef = db.doc(`profileFollowRequests/${requestId}`);
    const followReqSnap = await followReqRef.get();

    if (!followReqSnap.exists) throw new HttpsError('not-found', 'Follow request not found');

    const req = followReqSnap.data()!;

    // Permission: admin passes through; org/member must own the request
    if (callerRole !== 'admin') {
      const reqOrgId = req.organizationId as string | undefined;
      const reqMemberId = req.memberId as string | undefined;
      const callerMemberId = request.auth.token.memberId as string | undefined;
      const isOrgMatch = reqOrgId && reqOrgId === callerOrgId;
      const isMemberMatch = reqMemberId && reqMemberId === callerMemberId;
      if (!isOrgMatch && !isMemberMatch) {
        throw new HttpsError(
          'permission-denied',
          'You can only remove followers for your own organization or profile'
        );
      }
    }

    const { requestingUid, profileId, profileName } = req as {
      requestingUid: string;
      profileId: string;
      profileName: string;
    };

    // Remove the map entry from the user doc
    await db.doc(`users/${requestingUid}`).update({
      [`profiles.${profileId}`]: admin.firestore.FieldValue.delete(),
    });

    // Remove uid from the profile's followerUids
    try {
      await db.doc(`profiles/${profileId}`).update({
        followerUids: admin.firestore.FieldValue.arrayRemove(requestingUid),
      });
    } catch (e) {
      console.warn('[removeProfileFollower] followerUids cleanup failed:', e);
    }

    // Mark the follow request as removed
    await followReqRef.update({
      status: 'removed',
      removedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Push + in-app notification (non-fatal)
    try {
      const userSnap = await db.doc(`users/${requestingUid}`).get();
      const tokens: string[] = userSnap.data()?.deviceTokens ?? [];
      await notifyUser(
        db,
        requestingUid,
        tokens,
        'Removed from profile',
        `You were removed from following ${profileName}.`,
        { type: 'profile_follower_removed', profileId }
      );
    } catch (e) {
      console.warn('[removeProfileFollower] push failed:', e);
    }

    console.log(
      `[removeProfileFollower] requestId=${requestId} uid=${requestingUid} profile=${profileId}`
    );
    return { success: true };
  }
);

// ── revokeProfileFollower ─────────────────────────────────────────────────────

export const revokeProfileFollower = onCall(
  { region: 'us-central1', memory: '256MiB' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Not authenticated');

    const callerRole = request.auth.token.role as string | undefined;
    const callerOrgId = request.auth.token.organizationId as string | undefined;

    if (callerRole !== 'admin' && callerRole !== 'organization' && callerRole !== 'member') {
      throw new HttpsError('permission-denied', 'Only admins and organization accounts can revoke');
    }

    const { uid, organizationId } = request.data as {
      uid?: string;
      organizationId?: string;
    };
    if (!uid) throw new HttpsError('invalid-argument', 'uid required');

    const orgId = organizationId ?? callerOrgId;
    if (!orgId) throw new HttpsError('invalid-argument', 'organizationId required');

    if (callerRole !== 'admin' && orgId !== callerOrgId) {
      throw new HttpsError(
        'permission-denied',
        'You can only revoke users for your own organization'
      );
    }

    const db = admin.firestore();

    // Check user exists
    const userSnap = await db.doc(`users/${uid}`).get();
    if (!userSnap.exists) throw new HttpsError('not-found', 'User not found');
    const userData = userSnap.data()!;

    // Find all profiles map entries for this org and remove them
    const allProfiles = userData.profiles ?? {};
    const orgProfileIds: string[] = Object.entries(allProfiles)
      .filter(([, entry]: [string, any]) => entry?.organizationId === orgId)
      .map(([pid]) => pid);

    if (orgProfileIds.length > 0) {
      const mapUpdates: Record<string, admin.firestore.FieldValue> = {};
      for (const pid of orgProfileIds) {
        mapUpdates[`profiles.${pid}`] = admin.firestore.FieldValue.delete();
      }
      await db.doc(`users/${uid}`).update(mapUpdates);

      // Remove uid from each profile's followerUids
      const followerBatch = db.batch();
      for (const pid of orgProfileIds) {
        followerBatch.update(db.doc(`profiles/${pid}`), {
          followerUids: admin.firestore.FieldValue.arrayRemove(uid),
        });
      }
      await followerBatch.commit();
    }

    console.log(
      `[revokeProfileFollower] uid=${uid} org=${orgId} removed ${orgProfileIds.length} profile map entries`
    );

    // Revoke Pro: remove proSources.sponsored[orgId] and conditionally set proStatus
    const now = admin.firestore.Timestamp.now();
    await revokeOrgProIfNeeded(db, uid, orgId, now);

    // Update all sponsorshipRequests for this user+org to cancelled
    try {
      const sponsorshipSnap = await db
        .collection('sponsorshipRequests')
        .where('requestingUid', '==', uid)
        .where('organizationId', '==', orgId)
        .where('status', '==', 'approved')
        .get();
      const batch = db.batch();
      for (const doc of sponsorshipSnap.docs) {
        batch.update(doc.ref, { status: 'cancelled' });
      }
      await batch.commit();
    } catch (e) {
      console.warn('[revokeProfileFollower] cleanup sponsorshipRequests failed:', e);
    }

    // Update profileFollowRequests for this user+org to cancelled
    try {
      const reqsSnap = await db
        .collection('profileFollowRequests')
        .where('requestingUid', '==', uid)
        .where('organizationId', '==', orgId)
        .get();
      const batch = db.batch();
      for (const doc of reqsSnap.docs) {
        batch.update(doc.ref, { status: 'cancelled' });
      }
      await batch.commit();
    } catch (e) {
      console.warn('[revokeProfileFollower] cleanup profileFollowRequests failed:', e);
    }

    // Push + in-app notification (non-fatal)
    try {
      const orgSnap = await db.doc(`organizations/${orgId}`).get();
      const orgName: string = orgSnap.data()?.name ?? 'the organization';
      const tokens: string[] = userData.deviceTokens ?? [];
      await notifyUser(
        db,
        uid,
        tokens,
        'Profile access revoked',
        `${orgName} has removed your access to their profiles.`,
        { type: 'profile_follow_revoked', organizationId: orgId }
      );
    } catch (e) {
      console.warn('[revokeProfileFollower] push failed:', e);
    }

    return { success: true };
  }
);

// ── listProfileFollowers ──────────────────────────────────────────────────────
// Allows a profile owner to retrieve display info for all followerUids.

export const listProfileFollowers = onCall(
  { region: 'us-central1', memory: '256MiB' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Not authenticated');

    const { profileId } = request.data as { profileId?: string };
    if (!profileId) throw new HttpsError('invalid-argument', 'profileId required');

    const db = admin.firestore();
    const callerUid = request.auth.uid;

    const profileSnap = await db.doc(`profiles/${profileId}`).get();
    if (!profileSnap.exists || profileSnap.data()?.uid !== callerUid)
      throw new HttpsError('not-found', 'Profile not found');

    const followerUids: string[] = profileSnap.data()?.followerUids ?? [];
    if (followerUids.length === 0) return { followers: [] };

    const followers = await Promise.all(
      followerUids.map(async (uid) => {
        try {
          const userSnap = await db.doc(`users/${uid}`).get();
          const data = userSnap.data() ?? {};
          return {
            uid,
            displayName: (data.displayName as string) ?? '',
            email: (data.email as string) ?? '',
          };
        } catch {
          return { uid, displayName: '', email: '' };
        }
      })
    );

    return { followers };
  }
);

// ── removeProfileFollowerDirect ───────────────────────────────────────────────
// Allows a profile owner (regular Pro, no org role required) to remove a follower by UID.

export const removeProfileFollowerDirect = onCall(
  { region: 'us-central1', memory: '256MiB' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Not authenticated');

    const { profileId, followerUid } = request.data as {
      profileId?: string;
      followerUid?: string;
    };
    if (!profileId || !followerUid)
      throw new HttpsError('invalid-argument', 'profileId and followerUid required');

    const db = admin.firestore();
    const callerUid = request.auth.uid;

    const profileSnap = await db.doc(`profiles/${profileId}`).get();
    if (!profileSnap.exists || profileSnap.data()?.uid !== callerUid)
      throw new HttpsError('not-found', 'Profile not found or not owned by caller');

    await db.doc(`profiles/${profileId}`).update({
      followerUids: admin.firestore.FieldValue.arrayRemove(followerUid),
    });

    await db.doc(`users/${followerUid}`).update({
      [`profiles.${profileId}`]: admin.firestore.FieldValue.delete(),
    });

    console.log(
      `[removeProfileFollowerDirect] owner=${callerUid} profile=${profileId} removed=${followerUid}`
    );
    return { success: true };
  }
);

// ── onProfileChanged (Firestore trigger) ──────────────────────────────────────

export const onProfileChanged = onDocumentWritten('profiles/{profileId}', async (event) => {
  const profileId = event.params.profileId;
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  // uid lives in the doc itself (root collection doesn't have it in the path)
  const uid: string | undefined = (after?.uid ?? before?.uid) as string | undefined;

  const wasShared = before?.isShared === true;
  const isShared = after?.isShared === true;
  const isDeleted = !event.data?.after.exists;

  const db = admin.firestore();

  // Profile was shared and still is — check for new playlists and notify followers
  if (wasShared && isShared && !isDeleted) {
    const beforeIds: string[] = before?.playlistIds ?? [];
    const afterIds: string[] = after?.playlistIds ?? [];
    const newIds = afterIds.filter((id) => !beforeIds.includes(id));

    if (newIds.length > 0) {
      const followerUids: string[] = after?.followerUids ?? [];
      if (followerUids.length > 0) {
        try {
          const profileName: string = after?.name ?? 'a profile';
          await notifyFollowers(
            db,
            followerUids,
            {
              title: profileName,
              body:
                newIds.length === 1
                  ? 'A new playlist was added.'
                  : `${newIds.length} new playlists were added.`,
            },
            { type: 'profile_playlist_added', profileId }
          );
          console.log(
            `[onProfileChanged] notified ${followerUids.length} follower(s) of playlist addition profile=${profileId}`
          );
        } catch (e) {
          console.warn('[onProfileChanged] follower push (playlist added) failed:', e);
        }
      }
    }
    return;
  }

  // Nothing to do if profile was never shared
  if (!wasShared) return;

  // Profile was shared and is now unshared or deleted — update member sharedProfileIds
  try {
    const membersSnap = await db.collection('members').where('authUid', '==', uid).limit(1).get();

    if (!membersSnap.empty) {
      await membersSnap.docs[0].ref.update({
        sharedProfileIds: admin.firestore.FieldValue.arrayRemove(profileId),
      });
      console.log(`[onProfileChanged] removed profileId=${profileId} from member sharedProfileIds`);
    }
  } catch (e) {
    console.warn('[onProfileChanged] member sharedProfileIds update failed:', e);
  }

  // Profile deleted — notify followers and clean up the linked invite
  if (isDeleted) {
    const followerUids: string[] = before?.followerUids ?? [];
    if (followerUids.length > 0) {
      try {
        const profileName: string = before?.name ?? 'a profile';
        await notifyFollowers(
          db,
          followerUids,
          {
            title: profileName,
            body: 'This profile is no longer available.',
          },
          { type: 'profile_deleted', profileId }
        );
        console.log(
          `[onProfileChanged] notified ${followerUids.length} follower(s) of deletion profile=${profileId}`
        );
      } catch (e) {
        console.warn('[onProfileChanged] follower push (profile deleted) failed:', e);
      }
    }

    if (before?.inviteId) {
      try {
        await db.doc(`shortLinks/${before.inviteId}`).delete();
        console.log(
          `[onProfileChanged] deleted linked invite=${before.inviteId} for deleted profile=${profileId}`
        );
      } catch (e) {
        console.warn('[onProfileChanged] linked invite deletion failed:', e);
      }
    }
  }
});
