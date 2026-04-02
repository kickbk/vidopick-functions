#!/usr/bin/env node
/**
 * Migration Script: Add Rankings to Existing Playlists
 *
 * This script updates existing playlists in scannedPlaylists collection
 * that don't have ranking data yet.
 *
 * Usage:
 *   node scripts/migrateRankings.mjs
 *   node scripts/migrateRankings.mjs --dryRun  // Preview without making changes
 */

import axios from 'axios';
import dotenv from 'dotenv';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

const CREDS_PATH = path.resolve(__dirname, '../integrations/firebase/service-account.json');

let credsJson;
try {
  const raw = fs.readFileSync(CREDS_PATH, 'utf8');
  credsJson = JSON.parse(raw);
} catch (e) {
  console.error(`❌ Unable to read credentials at ${CREDS_PATH}`);
  console.error(`Error: ${e?.message || e}`);
  process.exit(1);
}

if (!YOUTUBE_API_KEY) {
  console.error('❌ Missing YOUTUBE_API_KEY in .env');
  process.exit(1);
}

// Initialize Firebase Admin
if (!getApps().length) {
  initializeApp({
    credential: cert(credsJson),
    projectId: credsJson.project_id,
  });
}

const db = getFirestore();
const COLLECTION_NAME = 'scannedPlaylists';

/**
 * Fetch channel statistics
 */
async function fetchChannelStats(channelId) {
  try {
    const response = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
      params: {
        part: 'statistics,status',
        id: channelId,
        key: YOUTUBE_API_KEY,
      },
    });

    if (!response.data.items || response.data.items.length === 0) {
      return { subscriberCount: 0, isVerified: false };
    }

    const channel = response.data.items[0];
    const subscriberCount = parseInt(channel.statistics?.subscriberCount || '0', 10);
    const isVerified = channel.status?.isLinked || false;

    return { subscriberCount, isVerified };
  } catch (error) {
    console.error(`❌ Error fetching channel stats:`, error.message);
    return { subscriberCount: 0, isVerified: false };
  }
}

/**
 * Extract channel ID from authorUrl
 */
function extractChannelId(authorUrl) {
  if (!authorUrl) return null;
  const match = authorUrl.match(/\/channel\/([^/?]+)/);
  return match ? match[1] : null;
}

/**
 * Fetch video views from XML feed
 */
async function fetchVideoViews(playlistId) {
  try {
    const response = await axios.get(
      `https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistId}`
    );

    const videoViews = [];
    const viewMatches = response.data.matchAll(/<media:statistics views="(\d+)"\/>/g);

    for (const match of viewMatches) {
      videoViews.push(parseInt(match[1], 10));
    }

    return videoViews.slice(0, 10);
  } catch (error) {
    console.error(`❌ Error fetching video views:`, error.message);
    return [];
  }
}

/**
 * Calculate channel authority score
 */
function calculateChannelAuthority(subscriberCount, isVerified) {
  let score = 0;

  if (subscriberCount >= 10000000) {
    score = 10;
  } else if (subscriberCount >= 1000000) {
    score = 8 + (subscriberCount / 10000000) * 2;
  } else if (subscriberCount >= 100000) {
    score = 6 + (subscriberCount / 1000000) * 2;
  } else if (subscriberCount >= 10000) {
    score = 4 + (subscriberCount / 100000) * 2;
  } else if (subscriberCount >= 1000) {
    score = 2 + (subscriberCount / 10000) * 2;
  } else {
    score = Math.min(2, (subscriberCount / 1000) * 2);
  }

  if (isVerified) {
    score = Math.min(10, score + 1);
  }

  return Math.round(score * 10) / 10;
}

/**
 * Calculate engagement score
 */
function calculateEngagementScore(videoViews) {
  if (!videoViews || videoViews.length === 0) return 5;

  const avgViews = videoViews.reduce((sum, v) => sum + v, 0) / videoViews.length;

  if (avgViews >= 10000000) return 10;
  if (avgViews >= 1000000) return 8 + (avgViews / 10000000) * 2;
  if (avgViews >= 100000) return 6 + (avgViews / 1000000) * 2;
  if (avgViews >= 10000) return 4 + (avgViews / 100000) * 2;
  if (avgViews >= 1000) return 2 + (avgViews / 10000) * 2;

  return Math.min(2, (avgViews / 1000) * 2);
}

/**
 * Calculate ranking
 */
function calculateRanking(aiScore, channelStats, videoViews) {
  const { subscriberCount, isVerified } = channelStats;

  const ai = aiScore || 5;
  const channelAuthority = calculateChannelAuthority(subscriberCount, isVerified);
  const engagement = calculateEngagementScore(videoViews);
  const freshness = 7;

  const baseScore = ai * 0.4 + channelAuthority * 0.3 + engagement * 0.2 + freshness * 0.1;

  const finalScore = Math.max(0, Math.min(10, baseScore));

  return {
    score: Math.round(finalScore * 10) / 10,
    boost: 0,
    factors: {
      aiScore: Math.round(ai * 10) / 10,
      channelAuthority: Math.round(channelAuthority * 10) / 10,
      engagement: Math.round(engagement * 10) / 10,
      freshness: Math.round(freshness * 10) / 10,
    },
  };
}

/**
 * Main migration function
 */
async function migrateRankings(options = {}) {
  const { dryRun = false } = options;

  console.log('🚀 Starting ranking migration...');
  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n');
  }

  // Fetch all playlists
  const snapshot = await db.collection(COLLECTION_NAME).get();
  const playlists = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

  console.log(`📊 Found ${playlists.length} playlists in collection`);

  // Filter playlists that need ranking
  const needsRanking = playlists.filter((p) => !p.ranking);
  console.log(`🔧 ${needsRanking.length} playlists need ranking data\n`);

  if (needsRanking.length === 0) {
    console.log('✅ All playlists already have ranking data!');
    return;
  }

  let updated = 0;
  let failed = 0;

  for (const playlist of needsRanking) {
    console.log(`\n📹 Processing: ${playlist.title || playlist.id}`);

    try {
      // Extract channel ID
      const channelId = extractChannelId(playlist.authorUrl);
      if (!channelId) {
        console.log(`   ⚠️  No channel ID found - using defaults`);
      }

      // Fetch channel stats
      let channelStats = { subscriberCount: 0, isVerified: false };
      if (channelId) {
        channelStats = await fetchChannelStats(channelId);
        if (channelStats.subscriberCount > 0) {
          console.log(
            `   👥 Subscribers: ${channelStats.subscriberCount.toLocaleString()}${
              channelStats.isVerified ? ' ✓' : ''
            }`
          );
        }
      }

      // Fetch video views
      const videoViews = await fetchVideoViews(playlist.id);

      // Calculate ranking
      const aiScore = playlist.aiScore || playlist.confidenceScore || 5;
      const ranking = calculateRanking(aiScore, channelStats, videoViews);

      console.log(`   ⭐ Calculated Ranking: ${ranking.score}/10`);
      console.log(
        `      • AI: ${ranking.factors.aiScore} | Authority: ${ranking.factors.channelAuthority} | Engagement: ${ranking.factors.engagement}`
      );

      if (!dryRun) {
        // Update document
        await db.collection(COLLECTION_NAME).doc(playlist.id).update({
          ranking,
          channelSubscribers: channelStats.subscriberCount,
          channelVerified: channelStats.isVerified,
          updatedAt: new Date(),
        });
        console.log(`   ✅ Updated in database`);
      } else {
        console.log(`   🔍 Would update (dry run)`);
      }

      updated++;

      // Rate limiting delay
      await new Promise((resolve) => setTimeout(resolve, 500));
    } catch (error) {
      console.error(`   ❌ Failed: ${error.message}`);
      failed++;
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 MIGRATION COMPLETE');
  console.log('='.repeat(60));
  console.log(`✅ Successfully processed: ${updated} playlists`);
  if (failed > 0) {
    console.log(`❌ Failed: ${failed} playlists`);
  }
  if (dryRun) {
    console.log('\n💡 Run without --dryRun to apply changes');
  }
  console.log('='.repeat(60));
}

// CLI support
const { values } = parseArgs({
  options: {
    dryRun: { type: 'boolean', default: false },
  },
  strict: false,
});

migrateRankings({ dryRun: values.dryRun })
  .then(() => {
    console.log('\n✨ Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Error:', error);
    process.exit(1);
  });
