import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { nanoid } from 'nanoid';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

interface CreateInviteRequest {
  name: string; // Inviter name (e.g., "Candee Land")
  advertiserId?: string; // Optional: Link to advertiser for ad targeting
  playlists?: string[]; // Optional: YouTube playlist IDs
  slug?: string; // Optional: Custom slug
  ttl?: string; // Optional: Expiration date (ISO string)
  ogTitle?: string; // Optional: Custom OG title
  ogDescription?: string; // Optional: Custom OG description
  ogImage?: string; // Optional: Custom OG image
}

/**
 * Create an invite link
 *
 * Permissions:
 * - Admin: Can create invite for any advertiser
 * - Advertiser: Can only create invite for their own advertiserId
 */
export const createInvite = onCall(async (request) => {
  // Must be authenticated
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be logged in');
  }

  const data = request.data as CreateInviteRequest;
  const { name, advertiserId, playlists = [], slug, ttl, ogTitle, ogDescription, ogImage } = data;

  // Validate required fields
  if (!name) {
    throw new HttpsError('invalid-argument', 'Name is required');
  }

  // Check permissions
  const isAdmin = request.auth.token.role === 'admin';
  const isAdvertiser = request.auth.token.role === 'advertiser';
  const userAdvertiserId = request.auth.token.advertiserId;

  // Must be either admin or advertiser
  if (!isAdmin && !isAdvertiser) {
    throw new HttpsError('permission-denied', 'Only admins and advertisers can create invites');
  }

  // Advertisers can only create invites for themselves
  if (isAdvertiser && advertiserId && advertiserId !== userAdvertiserId) {
    throw new HttpsError(
      'permission-denied',
      'Advertisers can only create invites for their own account'
    );
  }

  // If advertiser but no advertiserId provided, use their own
  const finalAdvertiserId = isAdvertiser && !advertiserId ? userAdvertiserId : advertiserId;

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
      ...(finalAdvertiserId ? { advertiserId: finalAdvertiserId } : {}),
      ...(playlists && playlists.length > 0 ? { playlists } : {}),
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

  // Check if user owns this invite (either created it OR is the advertiser)
  if (!isAdmin) {
    // Check if they created it
    if (invite?.createdBy === request.auth.uid) {
      isOwner = true;
    } else {
      // Check if they're the advertiser
      const advertiserSnapshot = await db
        .collection('advertisers')
        .where('authUid', '==', request.auth.uid)
        .limit(1)
        .get();

      if (!advertiserSnapshot.empty) {
        const advertiserId = advertiserSnapshot.docs[0].id;
        if (invite?.params?.advertiserId === advertiserId) {
          isOwner = true;
        }
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

  if (updates.advertiserId !== undefined) {
    updateData['params.advertiserId'] = updates.advertiserId;
  }

  if (updates.playlists !== undefined) {
    updateData['params.playlists'] = updates.playlists;
  }

  if (updates.ttl !== undefined) {
    updateData.ttl = updates.ttl ? new Date(updates.ttl) : null;
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
 * Delete an invite
 */
export const deleteInvite = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be logged in');
  }

  const { id } = request.data;

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

  // Check if user owns this invite (either created it OR is the advertiser)
  if (!isAdmin) {
    // Check if they created it
    if (invite?.createdBy === request.auth.uid) {
      isOwner = true;
    } else {
      // Check if they're the advertiser
      const advertiserSnapshot = await db
        .collection('advertisers')
        .where('authUid', '==', request.auth.uid)
        .limit(1)
        .get();

      if (!advertiserSnapshot.empty) {
        const advertiserId = advertiserSnapshot.docs[0].id;
        if (invite?.params?.advertiserId === advertiserId) {
          isOwner = true;
        }
      }
    }
  }

  if (!isAdmin && !isOwner) {
    throw new HttpsError('permission-denied', 'You can only delete your own invites');
  }

  // Delete
  await inviteRef.delete();

  return {
    success: true,
    id,
  };
});

/**
 * List invites
 * Admin: See all invites
 * Advertiser: See invites for their advertiser account (by params.advertiserId)
 */
export const listInvites = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be logged in');
  }

  const isAdmin = request.auth.token.role === 'admin';
  const uid = request.auth.uid;

  try {
    let query = db.collection('shortLinks');

    // If not admin, find advertiser by authUid and filter by params.advertiserId
    if (!isAdmin) {
      // Find advertiser document where authUid matches
      const advertiserSnapshot = await db
        .collection('advertisers')
        .where('authUid', '==', uid)
        .limit(1)
        .get();

      if (advertiserSnapshot.empty) {
        // No advertiser found for this user
        console.log(`No advertiser found for user ${uid}`);
        return {
          success: true,
          invites: [],
        };
      }

      const advertiserDoc = advertiserSnapshot.docs[0];
      const advertiserId = advertiserDoc.id;

      console.log(`Found advertiser ${advertiserId} for user ${uid}`);

      // Filter invites by params.advertiserId
      query = query.where('params.advertiserId', '==', advertiserId) as any;
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
