import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

if (!admin.apps.length) admin.initializeApp();

/**
 * Called from the app when a member pastes or deep-links a memberAppInvite short link.
 * Validates the link, creates (or reuses) the Firebase Auth user, sets member custom claims,
 * writes the pro user record, updates the member doc, disables the link, and returns a
 * custom token the app can exchange via signInWithCustomToken.
 */
export const completeMemberAppSignIn = onCall(async (request) => {
  const { shortLinkId } = request.data as { shortLinkId: string };

  if (!shortLinkId || typeof shortLinkId !== 'string') {
    throw new HttpsError('invalid-argument', 'shortLinkId is required');
  }

  const db = admin.firestore();

  const linkSnap = await db.doc(`shortLinks/${shortLinkId}`).get();
  if (!linkSnap.exists) {
    throw new HttpsError('not-found', 'Invite link not found');
  }

  const linkData = linkSnap.data()!;

  if (linkData.disabled) {
    throw new HttpsError(
      'failed-precondition',
      'This invite link has already been used. Ask your admin to resend it.'
    );
  }

  if (linkData.ttl && linkData.ttl.toMillis() < Date.now()) {
    throw new HttpsError(
      'failed-precondition',
      'This invite link has expired. Ask your admin to resend it.'
    );
  }

  if (!linkData.params?.memberAppInvite) {
    throw new HttpsError('invalid-argument', 'Not a member invite link');
  }

  const {
    memberId,
    organizationId,
    email,
    name: memberName,
    orgName,
  } = linkData.params as {
    memberId: string;
    organizationId: string;
    email: string;
    name: string;
    orgName?: string;
  };

  if (!memberId || !organizationId || !email) {
    throw new HttpsError('internal', 'Invite link is missing required data');
  }

  const memberSnap = await db.doc(`members/${memberId}`).get();
  if (!memberSnap.exists) {
    throw new HttpsError('not-found', 'Member record not found');
  }
  if (memberSnap.data()!.organizationId !== organizationId) {
    throw new HttpsError('permission-denied', 'Member does not belong to this organization');
  }

  // Create or reuse the Firebase Auth user for this email
  let uid: string;
  try {
    const existing = await admin.auth().getUserByEmail(email);
    uid = existing.uid;
  } catch (err: any) {
    if (err.code === 'auth/user-not-found') {
      const created = await admin.auth().createUser({
        email,
        displayName: memberName ?? '',
        emailVerified: false,
      });
      uid = created.uid;
    } else {
      throw err;
    }
  }

  // Set (or refresh) member custom claims
  await admin.auth().setCustomUserClaims(uid, {
    role: 'member',
    memberId,
    organizationId,
  });

  // Write pro status to users doc (merge so existing fields are preserved)
  await db.doc(`users/${uid}`).set(
    {
      proStatus: 'active',
      proType: 'sponsored',
      orgMemberId: memberId,
      memberName: memberName ?? '',
      orgName: orgName ?? '',
    },
    { merge: true }
  );

  // Update member doc with the auth UID
  await db.doc(`members/${memberId}`).update({
    authUid: uid,
    claimsSet: true,
    claimsSetAt: FieldValue.serverTimestamp(),
  });

  // Disable the short link so it can't be reused
  await linkSnap.ref.update({ disabled: true });

  const customToken = await admin.auth().createCustomToken(uid);
  return { customToken };
});
