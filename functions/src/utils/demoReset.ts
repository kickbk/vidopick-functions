import * as admin from 'firebase-admin';

const DEMO_ADVERTISER_ID = process.env.DEMO_ADVERTISER_ID;
const DEMO_AD_ID = process.env.DEMO_AD_ID;
const DEMO_INVITE_ID = process.env.DEMO_INVITE_ID;

/**
 * Called at end of every demo session (sign-out, inactivity expiry, or admin force-reset).
 *
 * 1. Deletes all ads and invites created during the session (keeps seed docs).
 * 2. Resets seed ad and invite stats to realistic baseline values.
 * 3. Clears the Firestore session lock fields.
 */
export async function resetDemoSession(): Promise<void> {
  if (!DEMO_ADVERTISER_ID) {
    console.warn('demoReset: DEMO_ADVERTISER_ID not configured, skipping');
    return;
  }

  const db = admin.firestore();

  // ── 1. Delete non-seed ads created during the session ──────────────────────
  if (DEMO_AD_ID) {
    const adsSnap = await db
      .collection('advertisers')
      .doc(DEMO_ADVERTISER_ID)
      .collection('ads')
      .get();

    const toDelete = adsSnap.docs.filter((d) => d.id !== DEMO_AD_ID);
    await Promise.all(toDelete.map((d) => d.ref.delete()));
    if (toDelete.length) console.log(`demoReset: deleted ${toDelete.length} session ad(s)`);
  }

  // ── 2. Delete non-seed invites created during the session ──────────────────
  if (DEMO_INVITE_ID) {
    const invitesSnap = await db
      .collection('shortLinks')
      .where('params.advertiserId', '==', DEMO_ADVERTISER_ID)
      .get();

    const toDelete = invitesSnap.docs.filter((d) => d.id !== DEMO_INVITE_ID);
    await Promise.all(toDelete.map((d) => d.ref.delete()));
    if (toDelete.length) console.log(`demoReset: deleted ${toDelete.length} session invite(s)`);
  }

  // ── 3. Batch: clear session lock + reset seed stats ────────────────────────
  const batch = db.batch();

  // Clear session lock
  const advertiserRef = db.doc(`advertisers/${DEMO_ADVERTISER_ID}`);
  batch.update(advertiserRef, {
    demoSessionActive: false,
    demoSessionLockedAt: admin.firestore.FieldValue.delete(),
    lastDemoActivity: admin.firestore.FieldValue.delete(),
    demoSessionRecipientEmail: admin.firestore.FieldValue.delete(),
  });

  // Reset seed ad to baseline stats
  if (DEMO_AD_ID) {
    const adRef = db.doc(`advertisers/${DEMO_ADVERTISER_ID}/ads/${DEMO_AD_ID}`);
    batch.update(adRef, {
      impressions: 3847,
      skips: 2961,
      saves: 284,
      clicks: 198,
      platformStats: {
        ios:     { impressions: 1920, skips: 1480, saves: 142, clicks: 98 },
        android: { impressions: 1540, skips: 1190, saves: 114, clicks: 78 },
        tv:      { impressions:  387, skips:  291, saves:  28, clicks: 22 },
      },
    });
  }

  // Reset seed invite to baseline analytics.
  // Use dot-notation so we only touch these fields without overwriting the rest of the document.
  if (DEMO_INVITE_ID) {
    const inviteRef = db.doc(`shortLinks/${DEMO_INVITE_ID}`);
    batch.update(inviteRef, {
      'params.advertiserId': DEMO_ADVERTISER_ID,
      analytics: {
        clicks:      { total: 412, byPlatform: { ios: 218, android: 143, tv: 51 } },
        conversions: { total: 87,  byPlatform: { ios: 46,  android: 31,  tv: 10 } },
      },
    });
  }

  await batch.commit();
  console.log(`demoReset: session released and stats reset for advertiser ${DEMO_ADVERTISER_ID}`);
}
