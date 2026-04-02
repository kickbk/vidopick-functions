import { getFirestore } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/v2/https';

const db = getFirestore();

// === CONFIGURATION ===
const TOTAL_AFFILIATE_PERCENT = 10; // 10% dedicated to user's invites (guaranteed slots)
const GLOBAL_AFFILIATE_FILL_RATE = 0.03; // 3% probability per available global slot
// =====================

interface RequestBody {
  deviceId: string;
  affiliateIds?: string[];
  platform: 'ios' | 'android' | 'tv';
  batchSize: number;
}

interface AdvertiserProfile {
  id: string;
  isActive: boolean;
  roles: ('affiliate' | 'paid')[];
  paidConfig?: {
    tier: 1 | 2 | 3 | 4 | 5;
    billingStatus: 'active' | 'paused' | 'cancelled';
  };
}

interface AdReference {
  advertiserId: string;
  adId: string;
}

export const getNextAdBatch = onRequest(
  {
    cors: ['*'],
    region: 'us-central1',
    memory: '256MiB',
  },
  async (request, response) => {
    try {
      if (request.method !== 'POST') {
        response.status(405).json({ error: 'Method not allowed' });
        return;
      }

      const body = request.body as RequestBody;
      const { deviceId, affiliateIds = [], platform, batchSize } = body;

      if (!deviceId || !platform || !batchSize) {
        response.status(400).json({ error: 'Missing required fields' });
        return;
      }

      // 1. Fetch Advertisers (Standard)
      const snapshot = await db.collection('advertisers').where('isActive', '==', true).get();
      if (snapshot.empty) {
        response.status(200).json({ ads: Array(batchSize).fill(null) });
        return;
      }

      // 2. Fetch Ads Parallel (Standard)
      const now = Date.now();
      const eligibleAds: AdReference[] = [];

      const results = await Promise.allSettled(
        snapshot.docs.map(async (doc) => {
          const advertiserId = doc.id;
          const adsSnapshot = await db
            .collection('advertisers')
            .doc(advertiserId)
            .collection('ads')
            .where('isApproved', '==', true)
            .get();

          const validAds: AdReference[] = [];
          for (const adDoc of adsSnapshot.docs) {
            const ad = adDoc.data();
            if (ad.isPaused === true) continue;
            if (ad.activeFrom && now < ad.activeFrom) continue;
            if (ad.activeUntil && now > ad.activeUntil) continue;
            validAds.push({ advertiserId, adId: adDoc.id });
          }
          return validAds;
        })
      );

      results.forEach((result) => {
        if (result.status === 'fulfilled') eligibleAds.push(...result.value);
      });

      if (eligibleAds.length === 0) {
        response.status(200).json({ ads: Array(batchSize).fill(null) });
        return;
      }

      // 3. Map Data
      const adsByAdvertiser = new Map<string, AdReference[]>();
      for (const ad of eligibleAds) {
        if (!adsByAdvertiser.has(ad.advertiserId)) adsByAdvertiser.set(ad.advertiserId, []);
        adsByAdvertiser.get(ad.advertiserId)!.push(ad);
      }

      const advertiserProfiles = new Map<string, AdvertiserProfile>();
      const affiliateAdvertiserIds: string[] = [];
      const paidAdvertiserIds: string[] = [];

      for (const doc of snapshot.docs) {
        if (adsByAdvertiser.has(doc.id)) {
          const profile = { id: doc.id, ...doc.data() } as AdvertiserProfile;
          advertiserProfiles.set(doc.id, profile);

          if (profile.roles.includes('affiliate')) affiliateAdvertiserIds.push(doc.id);
          if (profile.roles.includes('paid') && profile.paidConfig?.billingStatus === 'active') {
            paidAdvertiserIds.push(doc.id);
          }
        }
      }

      // 4. LOGIC START: Dedicated Affiliate Allocation
      const adBatch: Array<AdReference | null> = [];

      // Filter to only affiliates that actually exist in our DB and have active ads
      const validUserAffiliates = affiliateIds.filter(
        (id) => advertiserProfiles.has(id) && adsByAdvertiser.has(id)
      );

      if (validUserAffiliates.length > 0) {
        // Calculate 10% of batch
        const totalAffiliateSlots = Math.round((batchSize * TOTAL_AFFILIATE_PERCENT) / 100);

        // Split equally
        const slotsPerAffiliate = Math.floor(totalAffiliateSlots / validUserAffiliates.length);
        const remainderSlots = totalAffiliateSlots % validUserAffiliates.length;

        console.log(
          `📊 Dedicating ${totalAffiliateSlots} slots to ${validUserAffiliates.length} affiliates`
        );

        for (let i = 0; i < validUserAffiliates.length; i++) {
          const affiliateId = validUserAffiliates[i];
          const affiliateAds = adsByAdvertiser.get(affiliateId)!;

          // Add remainder to first few affiliates to ensure we use exactly 10%
          const slotsForThisAffiliate = slotsPerAffiliate + (i < remainderSlots ? 1 : 0);

          for (let j = 0; j < slotsForThisAffiliate; j++) {
            // Round Robin through their specific ads
            adBatch.push(affiliateAds[j % affiliateAds.length]);
          }
        }
      } else {
        console.log('ℹ️ No valid user affiliates found - all slots go to global pool');
      }

      // 5. Fill Global Pool (The rest of the batch)
      // We calculate remaining slots based on what we ACTUALLY used above
      const globalPoolSlots = batchSize - adBatch.length;

      if (globalPoolSlots > 0) {
        const globalAds = buildGlobalPool(
          adsByAdvertiser,
          advertiserProfiles,
          affiliateAdvertiserIds,
          paidAdvertiserIds,
          globalPoolSlots,
          validUserAffiliates // ✅ These will now be EXCLUDED from the global pool
        );
        adBatch.push(...globalAds);
      }

      // 6. Shuffle & Return
      const shuffled = shuffleArray(adBatch);
      console.log(
        `✅ Returning ${shuffled.length} slots (${
          adBatch.length - globalPoolSlots
        } dedicated, ${globalPoolSlots} global)`
      );

      response.status(200).json({ ads: shuffled });
    } catch (error) {
      console.error('Error in getNextAdBatch:', error);
      response.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * Build Global Pool
 */
function buildGlobalPool(
  adsByAdvertiser: Map<string, AdReference[]>,
  advertiserProfiles: Map<string, AdvertiserProfile>,
  allAffiliateAdvertiserIds: string[],
  paidAdvertiserIds: string[],
  totalSlots: number,
  excludeAffiliateIds: string[]
): Array<AdReference | null> {
  const pool: Array<AdReference | null> = [];

  // --- 1. Affiliate Bonus Logic (Probabilistic & Exclusive) ---

  // First, filter the affiliate list to REMOVE any the user already has
  const eligibleAffiliateIds = allAffiliateAdvertiserIds.filter(
    (id) => !excludeAffiliateIds.includes(id)
  );

  let allocatedAffiliateCount = 0;

  // We only add an affiliate ad if there are actually eligible ones to show
  if (eligibleAffiliateIds.length > 0) {
    // Calculate probability for ONE batch
    // Example: 9 slots * 0.03 fill rate = 0.27 (27% chance)
    const batchProbability = totalSlots * GLOBAL_AFFILIATE_FILL_RATE;

    // Single roll to prevent getting 2 ads in one batch
    if (Math.random() < batchProbability) {
      allocatedAffiliateCount = 1;

      // Get a flat list of ads from ONLY the eligible (unscanned) affiliates
      const eligibleAdPool: AdReference[] = [];
      eligibleAffiliateIds.forEach((id) => {
        const ads = adsByAdvertiser.get(id);
        if (ads) eligibleAdPool.push(...ads);
      });

      if (eligibleAdPool.length > 0) {
        // Pick 1 random ad
        const randomAd = eligibleAdPool[Math.floor(Math.random() * eligibleAdPool.length)];
        pool.push(randomAd);
        console.log(
          `🎲 Won lottery: Inserting 1 Global Affiliate Ad (ID: ${randomAd.advertiserId})`
        );
      } else {
        // Fallback if pool calculation was off (shouldn't happen given check above)
        allocatedAffiliateCount = 0;
      }
    }
  }

  // --- 2. Paid Pool (Fills the rest) ---
  const paidSlots = totalSlots - allocatedAffiliateCount;

  // Filter paid advertisers: remove user's affiliates to prevent domination
  // (Unless they are purely paid, but this keeps logic consistent with your exclusion rule)
  const eligiblePaidIds = paidAdvertiserIds.filter((id) => !excludeAffiliateIds.includes(id));

  if (eligiblePaidIds.length > 0) {
    const weightedAdvertiserPool = buildWeightedAdvertiserPool(eligiblePaidIds, advertiserProfiles);
    const weightedAdDeck: AdReference[] = [];

    // Build Deck
    weightedAdvertiserPool.forEach((advertiserId) => {
      const ads = adsByAdvertiser.get(advertiserId);
      if (ads && ads.length > 0) {
        weightedAdDeck.push(ads[Math.floor(Math.random() * ads.length)]);
      }
    });

    const shuffledDeck = shuffleArray(weightedAdDeck);

    for (let i = 0; i < paidSlots; i++) {
      if (shuffledDeck.length > 0) {
        pool.push(shuffledDeck[i % shuffledDeck.length]);
      } else {
        pool.push(null);
      }
    }
  } else {
    // No paid advertisers? Fill with nulls.
    for (let i = 0; i < paidSlots; i++) pool.push(null);
  }

  return pool;
}

function buildWeightedAdvertiserPool(
  advertiserIds: string[],
  advertiserProfiles: Map<string, AdvertiserProfile>
): string[] {
  const weighted: string[] = [];
  const AD_CONFIG = {
    paidTierWeights: { tier1: 1.0, tier2: 2.5, tier3: 5.5, tier4: 12, tier5: 25 },
  };

  for (const advertiserId of advertiserIds) {
    const profile = advertiserProfiles.get(advertiserId);
    if (!profile?.paidConfig) continue;

    const tier = profile.paidConfig.tier;
    const weightKey = `tier${tier}` as keyof typeof AD_CONFIG.paidTierWeights;
    const weight = AD_CONFIG.paidTierWeights[weightKey];

    for (let i = 0; i < weight; i++) weighted.push(advertiserId);
  }

  return weighted;
}

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}
