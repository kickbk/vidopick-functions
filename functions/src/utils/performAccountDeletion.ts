import * as admin from 'firebase-admin';
import Stripe from 'stripe';

import {
  RefundError,
  cancelSubscriptionTolerant,
  refundAndCancelSubscription,
} from './refundSubscription';

const REFUND_WINDOW_DAYS = 7;
const BATCH_LIMIT = 450;

interface UserProfileMapEntry {
  isFollowed?: boolean;
}

/** Thrown when the account cannot be deleted (e.g. Stripe failed) so the caller can surface it. */
export class AccountDeletionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccountDeletionError';
  }
}

/** True if the self-paid subscription is still inside the 7-day refund window. */
function isWithinRefundWindow(userData: admin.firestore.DocumentData): boolean {
  const activatedAt: admin.firestore.Timestamp | undefined = userData.stripeActivatedAt;
  if (!activatedAt) return false;
  const windowMs = REFUND_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return Date.now() <= activatedAt.toMillis() + windowMs;
}

/** Runs `apply` against a fresh write batch and commits it. Callers pre-chunk to BATCH_LIMIT. */
async function commitBatch(
  db: admin.firestore.Firestore,
  apply: (batch: admin.firestore.WriteBatch) => void
): Promise<void> {
  const batch = db.batch();
  apply(batch);
  await batch.commit();
}

/**
 * If the deleted user is also an affiliate, DISABLE (never delete) the affiliate:
 * kill the public page + share links but preserve commission/payout/financial records.
 * `regenerateProfile` (generateVpProfile.ts) honors `isDisabled` so the page is not resurrected.
 */
async function disableAffiliateIfPresent(
  db: admin.firestore.Firestore,
  uid: string
): Promise<void> {
  const affSnap = await db
    .collection('affiliates')
    .where('authUid', '==', uid)
    .limit(1)
    .get();
  if (affSnap.empty) return;

  const affiliateDoc = affSnap.docs[0];
  const affiliateId = affiliateDoc.id;
  const slug: string | undefined = affiliateDoc.data()?.slug;

  // 1. Mark the affiliate disabled (keep authUid so re-registering can reattach).
  await affiliateDoc.ref.set(
    { isDisabled: true, disabledAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );

  // 2. Disable every shortlink and clear the affiliate flag on any attached profile.
  const linksSnap = await db
    .collection('shortLinks')
    .where('affiliateId', '==', affiliateId)
    .get();
  for (let i = 0; i < linksSnap.docs.length; i += BATCH_LIMIT) {
    const chunk = linksSnap.docs.slice(i, i + BATCH_LIMIT);
    await commitBatch(db, (batch) => {
      for (const link of chunk) {
        batch.set(link.ref, { disabled: true }, { merge: true });
        const attachedProfileId: string | undefined = link.data()?.params?.profile?.profileId;
        if (attachedProfileId) {
          batch.set(
            db.doc(`profiles/${attachedProfileId}`),
            { isAffiliateLinkActive: false },
            { merge: true }
          );
        }
      }
    });
  }

  // 3. Delete the public-page HTML now (the onVpAffiliateWrite trigger also handles this,
  //    but do it explicitly so the page 404s immediately).
  const bucket = admin.storage().bucket();
  await Promise.all([
    bucket.file(`profile-html/${affiliateId}.html`).delete().catch(() => {}),
    ...(slug ? [bucket.file(`profile-html/${slug}.html`).delete().catch(() => {})] : []),
  ]);

  console.log(`[performAccountDeletion] disabled affiliate ${affiliateId} for uid=${uid}`);
}

/**
 * Destructive teardown of a user account. Cancels (or refunds) any Stripe subscription,
 * disables an affiliate record if present, tears down owned profiles and follow
 * relationships, cleans up related records, recursively deletes the user document,
 * and finally removes the Auth user.
 *
 * @throws {AccountDeletionError} on a hard failure (e.g. Stripe) — nothing critical is
 * destroyed before the Stripe step, so the account stays intact and the user can retry.
 */
export async function performAccountDeletion(params: {
  uid: string;
  refundIfEligible: boolean;
  stripeSecretKey: string;
  stripeSecretKeyTest: string;
}): Promise<void> {
  const { uid, refundIfEligible, stripeSecretKey, stripeSecretKeyTest } = params;
  const db = admin.firestore();

  const userRef = db.doc(`users/${uid}`);
  const userSnap = await userRef.get();
  const userData = userSnap.data() ?? {};

  // ── 1. Stripe: refund-and-cancel (if eligible + requested) or plain cancel ──
  // Done first so a failure aborts before any data is destroyed.
  const subscriptionId: string | null = userData.stripeSubscriptionId ?? null;
  if (subscriptionId) {
    const isTestMode = userData.testMode === true;
    const stripe = new Stripe(isTestMode ? stripeSecretKeyTest : stripeSecretKey, {
      apiVersion: '2026-03-25.dahlia',
    });

    const eligibleForRefund =
      refundIfEligible === true && !userData.refundedAt && isWithinRefundWindow(userData);

    if (eligibleForRefund) {
      try {
        await refundAndCancelSubscription({ db, stripe, uid, subscriptionId, userData, isTestMode });
      } catch (err) {
        if (err instanceof RefundError && err.reason === 'cancel_failed') {
          throw new AccountDeletionError(
            'Refund was issued but the subscription could not be cancelled. Please contact support before deleting your account.'
          );
        }
        throw new AccountDeletionError(
          'Refund could not be processed. Please try again or contact support.'
        );
      }
    } else {
      try {
        await cancelSubscriptionTolerant(stripe, subscriptionId);
        await db
          .doc(`subscriptions/${subscriptionId}`)
          .set(
            { status: 'cancelled', cancelledAt: admin.firestore.FieldValue.serverTimestamp() },
            { merge: true }
          );
      } catch (err: any) {
        console.error('[performAccountDeletion] subscription cancel failed:', err?.message);
        throw new AccountDeletionError(
          'Your subscription could not be cancelled. Please try again or contact support.'
        );
      }
    }
  }

  // ── 2. Affiliate: disable (not delete) if present ──
  try {
    await disableAffiliateIfPresent(db, uid);
  } catch (e) {
    console.warn('[performAccountDeletion] affiliate disable failed:', e);
  }

  // ── 3. Owned profiles: remove follower map entries, then delete the profile ──
  // Deleting the profile doc fires onProfileChanged, which notifies followers and
  // deletes the linked invite + member sharedProfileIds — do NOT duplicate that here.
  const ownedProfilesSnap = await db.collection('profiles').where('uid', '==', uid).get();
  for (const profileDoc of ownedProfilesSnap.docs) {
    const followerUids: string[] = profileDoc.data()?.followerUids ?? [];
    // Follower-map cleanup is cosmetic (a leftover entry points at a now-deleted
    // profile, which the app filters out) — never let it abort the teardown.
    try {
      for (let i = 0; i < followerUids.length; i += BATCH_LIMIT) {
        const chunk = followerUids.slice(i, i + BATCH_LIMIT);
        await commitBatch(db, (batch) => {
          for (const followerUid of chunk) {
            batch.update(db.doc(`users/${followerUid}`), {
              [`profiles.${profileDoc.id}`]: admin.firestore.FieldValue.delete(),
            });
          }
        });
      }
    } catch (e) {
      console.warn(
        `[performAccountDeletion] follower-map cleanup failed for profile=${profileDoc.id}:`,
        e
      );
    }
    await profileDoc.ref.delete();
  }

  // ── 4. Reverse-follow: remove this uid from profiles it was following ──
  const profilesMap = (userData.profiles ?? {}) as Record<string, UserProfileMapEntry>;
  const followedProfileIds = Object.entries(profilesMap)
    .filter(([, entry]) => entry?.isFollowed === true)
    .map(([profileId]) => profileId);

  // Individual updates (not a batch): a followed profile may already be deleted, and
  // update() throws NOT_FOUND on a missing doc — one bad ref must not skip the rest.
  for (const profileId of followedProfileIds) {
    try {
      await db.doc(`profiles/${profileId}`).update({
        followerUids: admin.firestore.FieldValue.arrayRemove(uid),
        deactivatedFollowerUids: admin.firestore.FieldValue.arrayRemove(uid),
      });
    } catch {
      // Profile already gone — nothing to clean up.
    }
  }

  // Cancel any outstanding follow / sponsorship requests made by this user
  for (const coll of ['profileFollowRequests', 'sponsorshipRequests']) {
    const snap = await db.collection(coll).where('requestingUid', '==', uid).get();
    for (let i = 0; i < snap.docs.length; i += BATCH_LIMIT) {
      const chunk = snap.docs.slice(i, i + BATCH_LIMIT);
      await commitBatch(db, (batch) => {
        for (const d of chunk) batch.update(d.ref, { status: 'cancelled' });
      });
    }
  }

  // ── 5. Org sponsorship: close open billing periods ──
  const sponsored = (userData.proSources?.sponsored ?? {}) as Record<string, unknown>;
  const now = admin.firestore.Timestamp.now();
  for (const orgId of Object.keys(sponsored)) {
    try {
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
    } catch (e) {
      console.warn(`[performAccountDeletion] orgSponsors cleanup failed for org=${orgId}:`, e);
    }
  }

  // ── 6. Other uid-keyed records ──
  // Org-member record is org-owned: unlink rather than delete.
  try {
    const membersSnap = await db.collection('members').where('authUid', '==', uid).get();
    for (const m of membersSnap.docs) {
      await m.ref.set({ authUid: admin.firestore.FieldValue.delete() }, { merge: true });
    }
  } catch (e) {
    console.warn('[performAccountDeletion] member unlink failed:', e);
  }

  // Leftover email-change tokens + deck access requests.
  for (const q of [
    db.collection('emailRevertTokens').where('uid', '==', uid),
    db.collection('deckAccessRequests').where('requestingUid', '==', uid),
  ]) {
    try {
      const snap = await q.get();
      for (let i = 0; i < snap.docs.length; i += BATCH_LIMIT) {
        const chunk = snap.docs.slice(i, i + BATCH_LIMIT);
        await commitBatch(db, (batch) => {
          for (const d of chunk) batch.delete(d.ref);
        });
      }
    } catch (e) {
      console.warn('[performAccountDeletion] token/request cleanup failed:', e);
    }
  }

  // ── 7. Recursively delete the user doc + subcollections (watchHistory, notifications) ──
  await db.recursiveDelete(userRef);

  // ── 8. Delete the Auth user last ──
  try {
    await admin.auth().deleteUser(uid);
  } catch (err: any) {
    if (err?.code !== 'auth/user-not-found') {
      console.error('[performAccountDeletion] auth deleteUser failed:', err?.message);
      throw new AccountDeletionError(
        'Account data was removed but sign-in could not be deleted. Please contact support.'
      );
    }
  }

  console.log(
    `[performAccountDeletion] uid=${uid} ownedProfiles=${ownedProfilesSnap.size} followed=${followedProfileIds.length} sub=${subscriptionId ?? 'none'} refundRequested=${refundIfEligible}`
  );
}
