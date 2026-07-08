import * as admin from 'firebase-admin';

export interface AffiliateDisplayFields {
  name: string | null;
  title: string | null;
  bio: string | null;
  photo: string | null;
  website: string | null;
  socialLinks: Record<string, string> | null;
}

/**
 * Display fields (name, title, bio, photo, website, socialLinks) live
 * exclusively in affiliates/{id}/public/profile since the root-doc strip
 * migration (stripPublicFieldsFromAffiliateRoot.mjs). The admin form writes
 * name to the mirror on create, so it exists for every affiliate.
 */
export async function getAffiliateDisplayFields(
  db: admin.firestore.Firestore,
  affiliateId: string
): Promise<AffiliateDisplayFields> {
  const profileSnap = await db.doc(`affiliates/${affiliateId}/public/profile`).get();
  const profile = profileSnap.data() ?? {};
  return {
    name: profile.name ?? null,
    title: profile.title ?? null,
    bio: profile.bio ?? null,
    photo: profile.photo ?? null,
    website: profile.website ?? null,
    socialLinks: profile.socialLinks ?? null,
  };
}
