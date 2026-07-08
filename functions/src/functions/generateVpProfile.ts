import * as admin from 'firebase-admin';
import { onDocumentDeleted, onDocumentWritten } from 'firebase-functions/v2/firestore';
import {
  generateProfileHtml,
  VpAffiliateProfile,
  VpProfileEntry,
} from '../utils/generateProfileHtml';
import { generateOgImage } from '../utils/generateOgImage';
import { buildAffiliateWelcomeEmail } from '../utils/emailTemplates';

if (!admin.apps.length) admin.initializeApp();

async function regenerateProfile(
  affiliateId: string,
  beforeProfile?: admin.firestore.DocumentData,
  { skipOg = false } = {}
): Promise<void> {
  const db = admin.firestore();

  // Root doc provides private/admin fields only (slug, isHidden, type).
  const affiliateSnap = await db.doc(`affiliates/${affiliateId}`).get();
  if (!affiliateSnap.exists) return;
  const rootData = affiliateSnap.data()!;
  if (rootData.type === 'slug') return;

  // public/profile is the single source of truth for all display fields.
  const profileSnap = await db.doc(`affiliates/${affiliateId}/public/profile`).get();
  const profileData = profileSnap.exists ? profileSnap.data()! : {};

  const profilesSnap = await db
    .collection('affiliates')
    .doc(affiliateId)
    .collection('publicProfiles')
    .get();

  const entries: VpProfileEntry[] = profilesSnap.docs.map((d) => ({
    shortlinkId: d.data().shortlinkId ?? '',
    profileName: d.data().profileName ?? 'Profile',
    profileColor: d.data().profileColor ?? '#3b82f6',
    description: d.data().description ?? '',
    thumbnails: d.data().thumbnails ?? [],
  }));

  const hasAllFields = !!(profileData.name && profileData.bio && profileData.photo);
  const isPublic = hasAllFields;
  const shouldIndex = isPublic && !rootData.isHidden;

  // Write isPublic back to root doc only when it changed (used by admin panel).
  if ((rootData.isPublic as boolean | undefined) !== isPublic) {
    await db.doc(`affiliates/${affiliateId}`).update({ isPublic });
  }

  // Keep system fields (slug, isHidden, isPublic) in sync on public/profile
  // so the Creators page collectionGroup query and public SPA can read them.
  const currentSlug = profileData.slug ?? null;
  const currentIsHidden = profileData.isHidden ?? false;
  const currentIsPublic = profileData.isPublic ?? null;
  const newSlug = rootData.slug ?? null;
  const newIsHidden = rootData.isHidden ?? false;
  if (currentSlug !== newSlug || currentIsHidden !== newIsHidden || currentIsPublic !== isPublic) {
    await db
      .doc(`affiliates/${affiliateId}/public/profile`)
      .set(
        {
          slug: newSlug,
          isHidden: newIsHidden,
          isPublic,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
  }

  // Generate OG image when photo or name changed (only detectable from public/profile trigger).
  const photoChanged = beforeProfile !== undefined && beforeProfile?.photo !== profileData.photo;
  const nameChanged = beforeProfile !== undefined && beforeProfile?.name !== profileData.name;
  const shouldGenerateOg = !skipOg && hasAllFields && (photoChanged || nameChanged);

  let ogImageUrl: string | undefined;
  if (shouldGenerateOg) {
    try {
      const bucket = admin.storage().bucket();
      const ogFile = bucket.file(`affiliates/${affiliateId}/og.jpg`);
      const jpgBuffer = await generateOgImage(profileData.name, profileData.photo);
      await ogFile.save(jpgBuffer, { contentType: 'image/jpeg' });
      await ogFile.makePublic();
      ogImageUrl = ogFile.publicUrl();
      console.log(`[generateVpProfile] OG image generated for ${affiliateId}`);
    } catch (err) {
      console.error(`[generateVpProfile] OG image generation failed for ${affiliateId}:`, err);
    }
  }

  if (!ogImageUrl) {
    try {
      const bucket = admin.storage().bucket();
      const ogFile = bucket.file(`affiliates/${affiliateId}/og.jpg`);
      const [exists] = await ogFile.exists();
      if (exists) ogImageUrl = ogFile.publicUrl();
    } catch {
      // Non-fatal
    }
  }

  const profile: VpAffiliateProfile = {
    id: affiliateId,
    slug: rootData.slug,
    name: profileData.name ?? '',
    title: profileData.title,
    bio: profileData.bio,
    photo: profileData.photo,
    website: profileData.website,
    socialLinks: profileData.socialLinks ?? [],
    ogImageUrl,
    shouldIndex,
  };

  const html = generateProfileHtml(profile, entries);
  const buf = Buffer.from(html, 'utf8');
  const bucket = admin.storage().bucket();
  const robotsValue = shouldIndex ? 'index,follow' : 'noindex,nofollow';
  const opts = {
    contentType: 'text/html; charset=utf-8',
    metadata: { xRobots: robotsValue },
  };

  await bucket.file(`profile-html/${affiliateId}.html`).save(buf, opts);

  if (rootData.slug) {
    await bucket.file(`profile-html/${rootData.slug}.html`).save(buf, opts);
  }

  console.log(
    `[generateVpProfile] regenerated ${affiliateId}${rootData.slug ? ` + slug:${rootData.slug}` : ''} (${entries.length} profiles)`
  );
}

// Fires when the affiliate's public/profile doc changes (affiliate saved their profile form).
export const onVpPublicProfileDocWrite = onDocumentWritten(
  { document: 'affiliates/{affiliateId}/public/{docId}', region: 'us-central1' },
  async (event) => {
    if (event.params.docId !== 'profile') return;
    const affiliateId = event.params.affiliateId;

    if (!event.data?.after?.exists) return;

    await regenerateProfile(affiliateId, event.data.before?.data(), { skipOg: false });
  }
);

// Fires when the root affiliate doc changes (slug claim, admin isHidden update, etc.).
export const onVpAffiliateWrite = onDocumentWritten(
  { document: 'affiliates/{affiliateId}', region: 'us-central1' },
  async (event) => {
    const affiliateId = event.params.affiliateId;

    if (!event.data?.after?.exists) {
      // Affiliate deleted — remove the stored HTML so the URL returns 404
      const before = event.data?.before?.data();
      if (before?.type === 'slug') return;
      const bucket = admin.storage().bucket();
      await Promise.all([
        bucket
          .file(`profile-html/${affiliateId}.html`)
          .delete()
          .catch(() => {}),
        ...(before?.slug
          ? [
              bucket
                .file(`profile-html/${before.slug}.html`)
                .delete()
                .catch(() => {}),
            ]
          : []),
      ]);
      console.log(
        `[generateVpProfile] deleted HTML for ${affiliateId}${before?.slug ? ` + slug:${before.slug}` : ''}`
      );
      return;
    }

    const data = event.data.after.data()!;
    if (data.type === 'slug') return;

    // No beforeProfile here — OG image regeneration is handled by onVpPublicProfileDocWrite.
    await regenerateProfile(affiliateId, undefined, { skipOg: true });
    await maybeSendWelcomeEmail(affiliateId, event.data.before?.data(), data);
  }
);

/**
 * Sends the "welcome to Vidopick affiliates" email exactly once, when
 * onboardingCompletedAt is first written. welcomeEmailSentAt guards against
 * trigger retries and repeated transitions.
 */
async function maybeSendWelcomeEmail(
  affiliateId: string,
  before: admin.firestore.DocumentData | undefined,
  after: admin.firestore.DocumentData
): Promise<void> {
  if (after.type !== 'influencer') return;
  if (!after.onboardingCompletedAt || before?.onboardingCompletedAt) return;
  if (after.welcomeEmailSentAt) return;

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const email: string | undefined = after.email;
  if (!RESEND_API_KEY || !email) return;

  const db = admin.firestore();
  const claimed = await db.runTransaction(async (tx) => {
    const ref = db.doc(`affiliates/${affiliateId}`);
    const snap = await tx.get(ref);
    if (snap.data()?.welcomeEmailSentAt) return false;
    tx.update(ref, { welcomeEmailSentAt: admin.firestore.FieldValue.serverTimestamp() });
    return true;
  });
  if (!claimed) return;

  try {
    // Name lives in public/profile; fetch it for the welcome email.
    const profileSnap = await db.doc(`affiliates/${affiliateId}/public/profile`).get();
    const name: string = profileSnap.data()?.name ?? after.name ?? 'there';

    const { Resend } = await import('resend');
    const resend = new Resend(RESEND_API_KEY);
    const commissionPercent = Math.round((after.commissionRate ?? 0.25) * 100);
    const publicProfilePercent = Math.round((after.publicProfileCommissionRate ?? 0.1) * 100);
    const publicPageUrl = after.slug ? `https://vidopick.com/vp/${after.slug}` : null;

    await resend.emails.send({
      from: 'Vidopick Partners <noreply@vidopick.com>',
      to: email,
      subject: 'Welcome to Vidopick Affiliates 🎉',
      html: buildAffiliateWelcomeEmail(
        name,
        commissionPercent,
        publicProfilePercent,
        publicPageUrl,
        'https://vidopick.com/vp/dashboard/'
      ),
    });
    console.log(`[generateVpProfile] welcome email sent affiliateId=${affiliateId}`);
  } catch (e) {
    await db
      .doc(`affiliates/${affiliateId}`)
      .update({ welcomeEmailSentAt: admin.firestore.FieldValue.delete() })
      .catch((rollbackErr) =>
        console.error(
          `[generateVpProfile] welcome email rollback failed affiliateId=${affiliateId}:`,
          rollbackErr
        )
      );
    console.error('[generateVpProfile] welcome email failed:', e);
  }
}

export const onVpPublicProfileWrite = onDocumentWritten(
  { document: 'affiliates/{affiliateId}/publicProfiles/{profileId}', region: 'us-central1' },
  async (event) => {
    await regenerateProfile(event.params.affiliateId, undefined, { skipOg: true });
  }
);

// When a profile is hard-deleted from the app, clean up any publicProfiles entry
// (onProfileSharingDisabled covers the isShared→false case; this covers outright deletion)
export const onVidopickProfileDeleted = onDocumentDeleted(
  { document: 'profiles/{profileId}', region: 'us-central1' },
  async (event) => {
    const data = event.data?.data();
    const affiliateId: string | undefined = data?.publicAffiliateId;
    const profileId = event.params.profileId;
    if (!affiliateId) return;

    const db = admin.firestore();
    const entrySnap = await db.doc(`affiliates/${affiliateId}/publicProfiles/${profileId}`).get();
    if (!entrySnap.exists) return;

    const shortlinkId: string | undefined = entrySnap.data()?.shortlinkId;
    await Promise.all([
      db.doc(`affiliates/${affiliateId}/publicProfiles/${profileId}`).delete(),
      ...(shortlinkId
        ? [db.doc(`shortLinks/${shortlinkId}`).set({ disabled: true }, { merge: true })]
        : []),
    ]);

    console.log(
      `[onVidopickProfileDeleted] profileId=${profileId} affiliateId=${affiliateId} shortlinkId=${shortlinkId}`
    );
  }
);
