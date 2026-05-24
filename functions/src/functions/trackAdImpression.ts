import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/v2/https';

const db = getFirestore();

interface AdImpression {
  adId: string;
  organizationId: string;
  deviceId: string;
  platform: 'ios' | 'android' | 'tv';
  timestamp: number;
  wasSkipped: boolean;
  timeToSkip?: number;
  wasSaved?: boolean;
  wasClicked?: boolean;
}

interface RequestBody {
  impressions: AdImpression[];
}

export const trackAdImpression = onRequest(
  {
    cors: ['*'], // Allow all origins
    region: 'us-central1',
  },
  async (request, response) => {
    try {
      if (request.method !== 'POST') {
        response.status(405).json({ error: 'Method not allowed' });
        return;
      }

      const body = request.body as RequestBody;
      const { impressions } = body;

      if (!impressions || !Array.isArray(impressions) || impressions.length === 0) {
        response.status(400).json({ error: 'Invalid impressions data' });
        return;
      }

      // Process each impression
      const batch = db.batch();
      const updates: { [key: string]: any } = {};

      for (const impression of impressions) {
        const { adId, organizationId, platform, wasSkipped, timeToSkip, wasSaved, wasClicked } =
          impression;

        // Update ad document stats
        const adRef = db
          .collection('organizations')
          .doc(organizationId)
          .collection('ads')
          .doc(adId);

        // Aggregate updates per ad
        if (!updates[adId]) {
          updates[adId] = {
            ref: adRef,
            organizationId,
            impressions: 0,
            skips: 0,
            saves: 0,
            clicks: 0,
            timeToSkipSum: 0,
            timeToSkipCount: 0,
            platformStats: {
              ios: { impressions: 0, skips: 0 },
              android: { impressions: 0, skips: 0 },
              tv: { impressions: 0, skips: 0 },
            },
          };
        }

        // Increment counters
        updates[adId].impressions++;
        updates[adId].platformStats[platform].impressions++;

        if (wasSkipped) {
          updates[adId].skips++;
          updates[adId].platformStats[platform].skips++;
        }

        if (wasSaved) {
          updates[adId].saves++;
        }

        if (wasClicked) {
          updates[adId].clicks++;
        }

        if (timeToSkip !== undefined) {
          updates[adId].timeToSkipSum += timeToSkip;
          updates[adId].timeToSkipCount++;
        }
      }

      // Apply batched updates
      const errors: string[] = [];
      let successCount = 0;

      for (const adId in updates) {
        const data = updates[adId];
        const { ref, organizationId, timeToSkipSum, timeToSkipCount, ...incrementData } = data;

        try {
          // Use set with merge instead of update to avoid document existence check
          // This saves reads and handles missing docs gracefully
          batch.set(
            ref,
            {
              impressions: FieldValue.increment(incrementData.impressions),
              skips: FieldValue.increment(incrementData.skips),
              saves: FieldValue.increment(incrementData.saves),
              clicks: FieldValue.increment(incrementData.clicks),

              // Store SUM and COUNT, calculate average in frontend
              // This preserves historical data across batches
              timeToSkipSum: FieldValue.increment(timeToSkipSum),
              timeToSkipCount: FieldValue.increment(timeToSkipCount),

              'platformStats.ios.impressions': FieldValue.increment(
                incrementData.platformStats.ios.impressions
              ),
              'platformStats.ios.skips': FieldValue.increment(
                incrementData.platformStats.ios.skips
              ),
              'platformStats.android.impressions': FieldValue.increment(
                incrementData.platformStats.android.impressions
              ),
              'platformStats.android.skips': FieldValue.increment(
                incrementData.platformStats.android.skips
              ),
              'platformStats.tv.impressions': FieldValue.increment(
                incrementData.platformStats.tv.impressions
              ),
              'platformStats.tv.skips': FieldValue.increment(incrementData.platformStats.tv.skips),
            },
            { merge: true }
          ); // ✅ Merge true = no read needed!

          successCount++;
        } catch (error) {
          console.error(`❌ Error processing ad ${adId}:`, error);
          errors.push(`Failed to process ad ${adId}: ${error}`);
        }
      }

      // Commit batch
      if (successCount > 0) {
        await batch.commit();
      }

      const message = `✅ Tracked ${successCount}/${impressions.length} impressions${
        errors.length > 0 ? ` (${errors.length} errors)` : ''
      }`;
      console.log(message);

      response.status(200).json({
        success: true,
        tracked: successCount,
        total: impressions.length,
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (error) {
      console.error('Error tracking impressions:', error);
      response.status(500).json({ error: 'Internal server error' });
    }
  }
);
