import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { nanoid } from 'nanoid';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

interface ProfileSnapshot {
  uid: string;
  profileId: string;
  displayName: string;
  color: string;
  playlistIds: string[];
}

interface CreateInviteRequest {
  name: string; // Inviter name (e.g., "Candee Land")
  organizationId?: string;
  organizationName?: string; // Stored in params so app doesn't need a Firestore fetch
  memberId?: string;
  memberName?: string; // Stored in params so app doesn't need a Firestore fetch
  playlists?: string[];
  profile?: { uid: string; profileId: string }; // profile to include in invite
  requiresDisplayName?: boolean;
  slug?: string;
  ttl?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
}

/**
 * Create an invite link
 *
 * Permissions:
 * - Admin: Can create invite for any organization
 * - Organization: Can only create invite for their own organizationId
 */
export const createInvite = onCall(async (request) => {
  // Must be authenticated
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be logged in');
  }

  const data = request.data as CreateInviteRequest;
  const {
    name,
    organizationId,
    organizationName,
    memberId,
    memberName,
    playlists = [],
    profile: profileRef,
    requiresDisplayName,
    slug,
    ttl,
    ogTitle,
    ogDescription,
    ogImage,
  } = data;

  if (!name) {
    throw new HttpsError('invalid-argument', 'Name is required');
  }

  const isAdmin = request.auth.token.role === 'admin';
  const isOrganization = request.auth.token.role === 'organization';
  const isMember = request.auth.token.role === 'member';
  const userOrganizationId = request.auth.token.organizationId as string | undefined;
  const userMemberId = request.auth.token.memberId as string | undefined;

  if (!isAdmin && !isOrganization && !isMember) {
    throw new HttpsError(
      'permission-denied',
      'Only admins, organizations, and members can create invites'
    );
  }

  if ((isOrganization || isMember) && organizationId && organizationId !== userOrganizationId) {
    throw new HttpsError(
      'permission-denied',
      'You can only create invites for your own organization'
    );
  }

  // Auto-fill from token claims for org/member users
  const finalOrganizationId = !isAdmin && userOrganizationId ? userOrganizationId : organizationId;
  const finalMemberId = isMember ? userMemberId : memberId;

  // Reserve ID (either custom slug or generate random)
  let id: string;

  if (slug) {
    // Check if slug already exists
    const existing = await db.collection('shortLinks').doc(slug).get();
    if (existing.exists) {
      throw new HttpsError('already-exists', `Slug "${slug}" is already taken`);
    }
    id = slug;
  } else {
    // Generate random ID
    let candidateId: string | null = null;
    let attempts = 0;

    while (!candidateId && attempts < 5) {
      const testId = nanoid(10);
      const snap = await db.collection('shortLinks').doc(testId).get();

      if (!snap.exists) {
        candidateId = testId;
      }

      attempts++;
    }

    if (!candidateId) {
      throw new HttpsError('internal', 'Could not generate unique ID');
    }

    id = candidateId;
  }

  // Parse TTL if provided
  let ttlDate = null;
  if (ttl) {
    ttlDate = new Date(ttl);
    if (isNaN(ttlDate.getTime())) {
      throw new HttpsError('invalid-argument', 'Invalid TTL date');
    }
  }

  // Validate + snapshot the profile included in the invite (if any)
  let profileSnapshot: ProfileSnapshot | null = null;
  let existingDisabledInviteId: string | null = null;
  if (profileRef) {
    const { uid: profileUid, profileId } = profileRef;
    if (!isAdmin && profileUid !== request.auth.uid) {
      throw new HttpsError('permission-denied', `You do not own profile ${profileId}`);
    }
    const profileSnap = await db.collection('profiles').doc(profileId).get();
    if (!profileSnap.exists) {
      throw new HttpsError('not-found', `Profile ${profileId} not found`);
    }
    const profileData = profileSnap.data()!;
    if (profileData.inviteId) {
      existingDisabledInviteId = profileData.inviteId as string;
    }
    profileSnapshot = {
      uid: profileUid,
      profileId,
      displayName: profileData.name ?? 'Profile',
      color: profileData.color ?? '#E53935',
      playlistIds: profileData.playlistIds ?? [],
    };
  }

  // Re-enable a previously disabled invite rather than creating a new one
  if (existingDisabledInviteId && profileSnapshot) {
    const existingDoc = await db.collection('shortLinks').doc(existingDisabledInviteId).get();
    if (existingDoc.exists && existingDoc.data()?.disabled === true) {
      await existingDoc.ref.update({ disabled: false });
      const { profileId } = profileSnapshot;
      const reEnableUpdates: Promise<any>[] = [
        db.collection('profiles').doc(profileId).set({ isShared: true }, { merge: true }),
      ];
      if (finalMemberId) {
        reEnableUpdates.push(
          db
            .collection('members')
            .doc(finalMemberId)
            .update({
              sharedProfileIds: admin.firestore.FieldValue.arrayUnion(profileId),
            })
        );
      }
      await Promise.all(reEnableUpdates).catch((e) =>
        console.warn('[createInvite] re-enable profile isShared failed:', e)
      );
      return {
        success: true,
        id: existingDisabledInviteId,
        shortLink: `https://vpk.to/${existingDisabledInviteId}`,
      };
    }
  }

  // Build invite document
  const inviteDoc = {
    linkTitle: `${name} invites you to try Vidopick`,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: request.auth.uid,
    ttl: ttlDate,
    redirect: {
      ios: 'https://apps.apple.com/us/app/vidopick/id6749210639',
      android: 'https://play.google.com/store/apps/details?id=com.vidopick.app',
      desktop: 'https://vidopick.com/get',
      webOnly: false,
    },
    params: {
      name,
      ...(finalOrganizationId ? { organizationId: finalOrganizationId } : {}),
      ...(organizationName ? { organizationName } : {}),
      ...(finalMemberId ? { memberId: finalMemberId } : {}),
      ...(memberName ? { memberName } : {}),
      ...(playlists && playlists.length > 0 ? { playlists } : {}),
      ...(profileSnapshot ? { profile: profileSnapshot } : {}),
      ...(requiresDisplayName ? { requiresDisplayName: true } : {}),
    },
    analytics: {},
    meta: {
      template: 'invite',
      ...(ogTitle ? { ogTitle } : {}),
      ...(ogDescription ? { ogDescription } : {}),
      ...(ogImage ? { ogImage } : {}),
    },
  };

  // Save to Firestore
  await db.collection('shortLinks').doc(id).set(inviteDoc);

  // Mark shared profile as isShared=true and store the inviteId
  if (profileSnapshot) {
    const { profileId } = profileSnapshot;
    const profileUpdates: Promise<any>[] = [
      db
        .collection('profiles')
        .doc(profileId)
        .set({ isShared: true, inviteId: id }, { merge: true }),
    ];
    if (finalMemberId) {
      profileUpdates.push(
        db
          .collection('members')
          .doc(finalMemberId)
          .update({
            sharedProfileIds: admin.firestore.FieldValue.arrayUnion(profileId),
          })
      );
    }
    await Promise.all(profileUpdates).catch((e) =>
      console.warn('[createInvite] profile isShared update failed:', e)
    );
  }

  // Return the created invite
  return {
    success: true,
    id,
    shortLink: `https://vpk.to/${id}`,
  };
});

/**
 * Update an existing invite
 */
export const updateInvite = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be logged in');
  }

  const { id, ...updates } = request.data;

  if (!id) {
    throw new HttpsError('invalid-argument', 'Invite ID is required');
  }

  // Get the invite
  const inviteRef = db.collection('shortLinks').doc(id);
  const inviteSnap = await inviteRef.get();

  if (!inviteSnap.exists) {
    throw new HttpsError('not-found', 'Invite not found');
  }

  const invite = inviteSnap.data();

  // Check permissions
  const isAdmin = request.auth.token.role === 'admin';

  let isOwner = false;

  if (!isAdmin) {
    if (invite?.createdBy === request.auth.uid) {
      isOwner = true;
    } else if (request.auth.token.role === 'organization') {
      const orgSnapshot = await db
        .collection('organizations')
        .where('authUid', '==', request.auth.uid)
        .limit(1)
        .get();
      if (!orgSnapshot.empty && invite?.params?.organizationId === orgSnapshot.docs[0].id) {
        isOwner = true;
      }
    } else if (request.auth.token.role === 'member') {
      const tokenMemberId = request.auth.token.memberId as string | undefined;
      const tokenOrgId = request.auth.token.organizationId as string | undefined;
      if (
        tokenMemberId &&
        invite?.params?.memberId === tokenMemberId &&
        invite?.params?.organizationId === tokenOrgId
      ) {
        isOwner = true;
      }
    }
  }

  if (!isAdmin && !isOwner) {
    throw new HttpsError('permission-denied', 'You can only edit your own invites');
  }

  // Build update object
  const updateData: any = {
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (updates.name) {
    updateData['params.name'] = updates.name;
    updateData.linkTitle = `${updates.name} invites you to try Vidopick`;
  }

  if (updates.organizationId !== undefined) {
    updateData['params.organizationId'] = updates.organizationId;
  }

  if (updates.organizationName !== undefined) {
    updateData['params.organizationName'] = updates.organizationName;
  }

  if (updates.memberId !== undefined) {
    updateData['params.memberId'] = updates.memberId;
  }

  if (updates.memberName !== undefined) {
    updateData['params.memberName'] = updates.memberName;
  }

  if (updates.playlists !== undefined) {
    updateData['params.playlists'] = updates.playlists;
  }

  if (updates.profile !== undefined) {
    if (updates.profile === null) {
      updateData['params.profile'] = admin.firestore.FieldValue.delete();
    } else {
      const { uid: profileUid, profileId } = updates.profile as { uid: string; profileId: string };
      if (!isAdmin && profileUid !== request.auth.uid) {
        throw new HttpsError('permission-denied', `You do not own profile ${profileId}`);
      }
      const profileSnap = await db.collection('profiles').doc(profileId).get();
      if (!profileSnap.exists) throw new HttpsError('not-found', `Profile ${profileId} not found`);
      const d = profileSnap.data()!;
      updateData['params.profile'] = {
        uid: profileUid,
        profileId,
        displayName: d.name ?? 'Profile',
        color: d.color ?? '#E53935',
        playlistIds: d.playlistIds ?? [],
      };
    }
  }

  if (updates.ttl !== undefined) {
    updateData.ttl = updates.ttl ? new Date(updates.ttl) : null;
  }

  if (updates.requiresDisplayName !== undefined) {
    updateData['params.requiresDisplayName'] = updates.requiresDisplayName || false;
  }

  if (updates.ogTitle !== undefined) {
    updateData['meta.ogTitle'] = updates.ogTitle;
  }

  if (updates.ogDescription !== undefined) {
    updateData['meta.ogDescription'] = updates.ogDescription;
  }

  if (updates.ogImage !== undefined) {
    updateData['meta.ogImage'] = updates.ogImage;
  }

  // Update
  await inviteRef.update(updateData);

  return {
    success: true,
    id,
  };
});

/**
 * Delete an invite (hard delete — use disableInvite to preserve analytics)
 */
export const deleteInvite = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be logged in');
  }

  const { id } = request.data;

  if (!id) {
    throw new HttpsError('invalid-argument', 'Invite ID is required');
  }

  const inviteRef = db.collection('shortLinks').doc(id);
  const inviteSnap = await inviteRef.get();

  if (!inviteSnap.exists) {
    throw new HttpsError('not-found', 'Invite not found');
  }

  const invite = inviteSnap.data();
  const isAdmin = request.auth.token.role === 'admin';
  let isOwner = invite?.createdBy === request.auth.uid;

  if (!isAdmin && !isOwner) {
    const orgSnapshot = await db
      .collection('organizations')
      .where('authUid', '==', request.auth.uid)
      .limit(1)
      .get();
    if (!orgSnapshot.empty && invite?.params?.organizationId === orgSnapshot.docs[0].id) {
      isOwner = true;
    }
  }

  if (!isAdmin && !isOwner) {
    throw new HttpsError('permission-denied', 'You can only delete your own invites');
  }

  const cleanups: Promise<any>[] = [];

  // If this invite is linked to a shared profile, mark it as no longer shared
  const profile = invite?.params?.profile;
  if (profile?.uid && profile?.profileId) {
    cleanups.push(
      db
        .collection('profiles')
        .doc(profile.profileId)
        .set({ isShared: false }, { merge: true })
        .catch((e) => console.warn('[deleteInvite] profile isShared update failed:', e))
    );
  }

  // Cancel pending profile follow requests for this invite
  cleanups.push(
    db
      .collection('profileFollowRequests')
      .where('inviteId', '==', id)
      .where('status', '==', 'pending')
      .get()
      .then(async (snap) => {
        if (snap.empty) return;
        const batch = db.batch();
        snap.docs.forEach((doc) => batch.update(doc.ref, { status: 'cancelled' }));
        await batch.commit();
        console.log(
          `[deleteInvite] cancelled ${snap.size} pending profileFollowRequests for invite=${id}`
        );
      })
      .catch((e) => console.warn('[deleteInvite] profileFollowRequests cleanup failed:', e))
  );

  // Cancel pending sponsorship requests for this invite
  cleanups.push(
    db
      .collection('sponsorshipRequests')
      .where('inviteId', '==', id)
      .where('status', '==', 'pending')
      .get()
      .then(async (snap) => {
        if (snap.empty) return;
        const batch = db.batch();
        snap.docs.forEach((doc) => batch.update(doc.ref, { status: 'cancelled' }));
        await batch.commit();
        console.log(
          `[deleteInvite] cancelled ${snap.size} pending sponsorshipRequests for invite=${id}`
        );
      })
      .catch((e) => console.warn('[deleteInvite] sponsorshipRequests cleanup failed:', e))
  );

  await Promise.all(cleanups);
  await inviteRef.delete();
  return { success: true, id };
});

/**
 * Disable a profile share invite. Preserves the shortLinks record and analytics.
 * The invite can be re-enabled by calling createInvite again for the same profile.
 */
export const disableInvite = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be logged in');
  }

  const { id } = request.data;
  if (!id) throw new HttpsError('invalid-argument', 'Invite ID is required');

  const inviteRef = db.collection('shortLinks').doc(id);
  const inviteSnap = await inviteRef.get();
  if (!inviteSnap.exists) throw new HttpsError('not-found', 'Invite not found');

  const invite = inviteSnap.data();
  const isAdmin = request.auth.token.role === 'admin';
  let isOwner = invite?.createdBy === request.auth.uid;

  if (!isAdmin && !isOwner) {
    const orgSnapshot = await db
      .collection('organizations')
      .where('authUid', '==', request.auth.uid)
      .limit(1)
      .get();
    if (!orgSnapshot.empty && invite?.params?.organizationId === orgSnapshot.docs[0].id) {
      isOwner = true;
    }
  }

  if (!isAdmin && !isOwner) {
    throw new HttpsError('permission-denied', 'You can only disable your own invites');
  }

  // Set disabled flag — keeps analytics intact
  await inviteRef.update({ disabled: true });

  // Mark any shared profile as no longer shared
  const profile = invite?.params?.profile;
  if (profile) {
    await db
      .collection('profiles')
      .doc(profile.profileId)
      .set({ isShared: false }, { merge: true })
      .catch((e) => console.warn('[disableInvite] profile isShared update failed:', e));
  }

  return { success: true, id };
});

/**
 * List invites
 * Admin: See all invites
 * Organization: See invites for their organization account (by params.organizationId)
 */
export const listInvites = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be logged in');
  }

  const role = request.auth.token.role as string | undefined;
  const isAdmin = role === 'admin';
  const isMember = role === 'member';
  const uid = request.auth.uid;

  try {
    let query = db.collection('shortLinks');

    if (isMember) {
      // Members have organizationId + memberId in their JWT claims — no Firestore lookup needed.
      // Show only invites they created (filtered by memberId).
      const memberId = request.auth.token.memberId as string | undefined;
      const organizationId = request.auth.token.organizationId as string | undefined;

      if (!memberId || !organizationId) {
        return { success: true, invites: [] };
      }

      query = query.where('params.memberId', '==', memberId) as any;
    } else if (!isAdmin) {
      // Organization account — look up org by authUid
      const orgSnapshot = await db
        .collection('organizations')
        .where('authUid', '==', uid)
        .limit(1)
        .get();

      if (orgSnapshot.empty) {
        console.log(`No organization found for user ${uid}`);
        return { success: true, invites: [] };
      }

      const orgDoc = orgSnapshot.docs[0];
      const organizationId = orgDoc.id;

      console.log(`Found organization ${organizationId} for user ${uid}`);

      query = query.where('params.organizationId', '==', organizationId) as any;
    }

    // Try to order by createdAt (might need Firestore index)
    let snapshot;
    try {
      snapshot = await query.orderBy('createdAt', 'desc').limit(100).get();
    } catch (indexError: any) {
      // If index error, fall back to no ordering
      console.warn('Firestore index needed for createdAt ordering:', indexError.message);
      snapshot = await query.limit(100).get();
    }

    const invites = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
      shortLink: `https://vpk.to/${doc.id}`,
    }));

    return {
      success: true,
      invites,
    };
  } catch (error: any) {
    console.error('Error listing invites:', error);
    throw new HttpsError('internal', `Failed to list invites: ${error.message}`);
  }
});
