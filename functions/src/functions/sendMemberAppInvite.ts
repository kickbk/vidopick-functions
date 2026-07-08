import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { Resend } from 'resend';

import { buildMemberAppInviteEmail } from '../utils/emailTemplates';

if (!admin.apps.length) admin.initializeApp();

const RESEND_API_KEY = process.env.RESEND_API_KEY;

const IOS_STORE_URL = 'https://apps.apple.com/us/app/vidopick/id6749210639';
const ANDROID_STORE_URL = 'https://play.google.com/store/apps/details?id=com.vidopick.app';

const INVITE_TTL_DAYS = 14;

/**
 * Creates a memberAppInvite short link and emails it to the member.
 * The member opens the link (vpk.to/ID) in the Vidopick app and is signed in
 * automatically — no dashboard visit required.
 *
 * On resend: the previous invite link (if any) is disabled first.
 */
export const sendMemberAppInvite = onCall(async (request) => {
  const role = request.auth?.token.role as string | undefined;
  const callerOrgId = request.auth?.token.organizationId as string | undefined;

  if (!request.auth || (role !== 'admin' && role !== 'organization')) {
    throw new HttpsError(
      'permission-denied',
      'Only admins and organization accounts can send member invites'
    );
  }

  const { memberId, organizationId } = request.data as { memberId: string; organizationId: string };

  if (!memberId || !organizationId) {
    throw new HttpsError('invalid-argument', 'memberId and organizationId are required');
  }

  if (role === 'organization' && callerOrgId !== organizationId) {
    throw new HttpsError(
      'permission-denied',
      'You can only send invites for your own organization'
    );
  }

  if (!RESEND_API_KEY) {
    throw new HttpsError('internal', 'Email configuration missing');
  }

  const db = admin.firestore();

  const [memberSnap, orgSnap] = await Promise.all([
    db.doc(`members/${memberId}`).get(),
    db.doc(`organizations/${organizationId}`).get(),
  ]);

  if (!memberSnap.exists) throw new HttpsError('not-found', 'Member not found');
  if (!orgSnap.exists) throw new HttpsError('not-found', 'Organization not found');

  const memberData = memberSnap.data()!;
  const { email, name: memberName } = memberData;
  const { name: orgName } = orgSnap.data()!;

  if (!email) throw new HttpsError('failed-precondition', 'Member has no email address');

  // Disable the previous invite link if there is one
  const prevLinkId: string | undefined = memberData.lastAppInviteLinkId;
  if (prevLinkId) {
    await db
      .doc(`shortLinks/${prevLinkId}`)
      .update({ disabled: true })
      .catch((e) =>
        console.warn(`[sendMemberAppInvite] disabling previous link ${prevLinkId} failed:`, e)
      );
  }

  // Create the new invite short link
  const ttl = new Date();
  ttl.setDate(ttl.getDate() + INVITE_TTL_DAYS);

  const linkRef = db.collection('shortLinks').doc();
  const shortLinkId = linkRef.id;

  await linkRef.set({
    linkTitle: `Vidopick invite for ${memberName}`,
    createdAt: FieldValue.serverTimestamp(),
    ttl,
    params: {
      memberAppInvite: true,
      memberId,
      organizationId,
      email,
      name: memberName,
      orgName,
    },
    redirect: {
      ios: IOS_STORE_URL,
      android: ANDROID_STORE_URL,
      desktop: 'https://vidopick.com/get',
    },
    meta: {
      template: 'invite',
      ogTitle: `${orgName} invites you to Vidopick`,
      ogDescription: `${memberName}, you've been added as a staff member for ${orgName} on Vidopick.`,
    },
    organizationId,
  });

  // Store the new link ID on the member doc for future resend invalidation
  await db.doc(`members/${memberId}`).update({ lastAppInviteLinkId: shortLinkId });

  const inviteLink = `https://vpk.to/${shortLinkId}`;

  const resend = new Resend(RESEND_API_KEY);
  await resend.emails.send({
    from: 'Vidopick <noreply@vidopick.com>',
    to: email,
    subject: `${orgName} invites you to Vidopick`,
    html: buildMemberAppInviteEmail(
      memberName ?? 'there',
      orgName ?? 'Your organization',
      inviteLink
    ),
  });

  console.log(
    `Sent member app invite to ${email} memberId=${memberId} org=${organizationId} link=${shortLinkId}`
  );
  return { success: true };
});
