import * as admin from 'firebase-admin';
import { onDocumentDeleted, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { generateProfileHtml, VpAffiliateProfile, VpProfileEntry } from '../utils/generateProfileHtml';
import { generateOgImage } from '../utils/generateOgImage';
import { buildAffiliateWelcomeEmail } from '../utils/emailTemplates';

if (!admin.apps.length) admin.initializeApp();

async function regenerateProfile(
  affiliateId: string,
  before?: admin.firestore.DocumentData,
  { skipOg = false } = {}
): Promise<void> {
  const db = admin.firestore();
  const affiliateSnap = await db.doc(`affiliates/${affiliateId}`).get();

  if (!affiliateSnap.exists) return;
  const data = affiliateSnap.data()!;

  // Slug pointer docs have no profile page of their own
  if (data.type === 'slug') return;

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
  }));

  const hasAllFields = !!(data.name && data.bio && data.photo);
  const isPublic = hasAllFields;
  const shouldIndex = isPublic && !data.isHidden;

  // Write isPublic back only when it changed, to avoid retriggering this function.
  if ((data.isPublic as boolean | undefined) !== isPublic) {
    await db.doc(`affiliates/${affiliateId}`).update({ isPublic });
  }

  // Generate OG image when all fields are present and name or photo changed
  const photoChanged = before?.photo !== data.photo;
  const nameChanged = before?.name !== data.name;
  const shouldGenerateOg = !skipOg && hasAllFields && (photoChanged || nameChanged);

  let ogImageUrl: string | undefined;
  if (shouldGenerateOg) {
    try {
      const bucket = admin.storage().bucket();
      const ogFile = bucket.file(`affiliates/${affiliateId}/og.jpg`);
      const jpgBuffer = await generateOgImage(data.name, data.photo);
      await ogFile.save(jpgBuffer, { contentType: 'image/jpeg' });
      await ogFile.makePublic();
      ogImageUrl = ogFile.publicUrl();
      console.log(`[generateVpProfile] OG image generated for ${affiliateId}`);
    } catch (err) {
      console.error(`[generateVpProfile] OG image generation failed for ${affiliateId}:`, err);
      // Non-fatal — fall through, profile HTML will use the raw photo as og:image
    }
  }

  // If we didn't just generate it, check if one already exists in Storage
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
    slug: data.slug,
    name: data.name ?? '',
    title: data.title,
    bio: data.bio,
    photo: data.photo,
    website: data.website,
    socialLinks: data.socialLinks ?? [],
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

  // Sanitized public mirror for the /vp/{slug} SPA page. The main affiliate doc is
  // not publicly readable (it holds payout info), so the page reads this doc instead.
  await db.doc(`affiliates/${affiliateId}/public/profile`).set({
    name: data.name ?? '',
    title: data.title ?? null,
    bio: data.bio ?? null,
    photo: data.photo ?? null,
    website: data.website ?? null,
    socialLinks: data.socialLinks ?? [],
    slug: data.slug ?? null,
    isPublic,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Store under the real affiliate ID
  await bucket.file(`profile-html/${affiliateId}.html`).save(buf, opts);

  // Also store under the slug so /vp/{slug} works without a Firestore lookup at serve time
  if (data.slug) {
    await bucket.file(`profile-html/${data.slug}.html`).save(buf, opts);
  }

  console.log(
    `[generateVpProfile] regenerated ${affiliateId}${data.slug ? ` + slug:${data.slug}` : ''} (${entries.length} profiles)`
  );
}

export const onVpAffiliateWrite = onDocumentWritten(
  { document: 'affiliates/{affiliateId}', region: 'us-central1' },
  async (event) => {
    const affiliateId = event.params.affiliateId;

    if (!event.data?.after?.exists) {
      // Affiliate deleted — remove the stored HTML so the URL returns 404
      const before = event.data?.before?.data();
      if (before?.type === 'slug') return; // slug pointer docs never had an HTML file
      const bucket = admin.storage().bucket();
      await Promise.all([
        bucket.file(`profile-html/${affiliateId}.html`).delete().catch(() => {}),
        ...(before?.slug
          ? [bucket.file(`profile-html/${before.slug}.html`).delete().catch(() => {})]
          : []),
      ]);
      console.log(`[generateVpProfile] deleted HTML for ${affiliateId}${before?.slug ? ` + slug:${before.slug}` : ''}`);
      return;
    }

    const data = event.data.after.data()!;
    if (data.type === 'slug') return; // slug pointer docs have no profile page

    await regenerateProfile(affiliateId, event.data.before?.data());
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
  // Claim the send before emailing so a concurrent retry can't double-send
  const claimed = await db.runTransaction(async (tx) => {
    const ref = db.doc(`affiliates/${affiliateId}`);
    const snap = await tx.get(ref);
    if (snap.data()?.welcomeEmailSentAt) return false;
    tx.update(ref, { welcomeEmailSentAt: admin.firestore.FieldValue.serverTimestamp() });
    return true;
  });
  if (!claimed) return;

  try {
    const { Resend } = await import('resend');
    const resend = new Resend(RESEND_API_KEY);
    const commissionPercent = Math.round((after.commissionRate ?? 0.25) * 100);
    const publicProfilePercent = Math.round((after.publicProfileCommissionRate ?? 0.1) * 100);
    const publicPageUrl = after.slug ? `https://vidopick.com/vp/${after.slug}` : null;

    await resend.emails.send({
      from: 'Vidopick Partners <hello@vidopick.com>',
      to: email,
      subject: 'Welcome to Vidopick Affiliates 🎉',
      html: buildAffiliateWelcomeEmail(
        after.name ?? 'there',
        commissionPercent,
        publicProfilePercent,
        publicPageUrl,
        'https://vidopick.com/vp/dashboard/'
      ),
    });
    console.log(`[generateVpProfile] welcome email sent affiliateId=${affiliateId}`);
  } catch (e) {
    // Roll back the claim so the email isn't marked sent; resend manually if needed
    await db
      .doc(`affiliates/${affiliateId}`)
      .update({ welcomeEmailSentAt: admin.firestore.FieldValue.delete() })
      .catch((rollbackErr) =>
        console.error(
          `[generateVpProfile] welcome email rollback failed affiliateId=${affiliateId} — email is marked sent but was not delivered:`,
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
