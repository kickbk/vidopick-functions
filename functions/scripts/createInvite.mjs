#!/usr/bin/env node
// Enhanced invite creation with scannedPlaylists integration
// Playlists are provided as an array of playlist IDs: ["PLxxx", "PLyyy"]
//
// Usage:
//   node scripts/createInvite.mjs -n "Ben" --playlists '["PLxxx","PLyyy"]'

import axios from 'axios';
import dotenv from 'dotenv';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { nanoid as _nanoid } from 'nanoid';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, URLSearchParams } from 'node:url';
import { parseArgs } from 'node:util';
import OpenAI from 'openai';
import { knownShows } from './knownShows.mjs';

const SHORT_DOMAIN = 'https://vpk.to';
const DEFAULT_DESKTOP = 'https://vidopick.com/get';
const IOS_STORE = 'https://apps.apple.com/us/app/vidopick/id6749210639';
const ANDROID_STORE = 'https://play.google.com/store/apps/details?id=com.vidopick.app';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HARDCODED_CREDS_PATH = path.resolve(
  __dirname,
  '../integrations/firebase/service-account.json'
);

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const { values } = parseArgs({
  options: {
    name: { type: 'string', short: 'n' },
    slug: { type: 'string', short: 's' },
    title: { type: 'string', short: 't' },
    ttl: { type: 'string' },
    ios: { type: 'string' },
    android: { type: 'string' },
    desktop: { type: 'string' },
    webOnly: { type: 'boolean' },
    template: { type: 'string' },
    ogTitle: { type: 'string' },
    ogDescription: { type: 'string' },
    ogImage: { type: 'string' },
    param: { type: 'string', multiple: true },
    projectId: { type: 'string' },
    playlists: { type: 'string' },
  },
});

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function parsePlaylists(playlistsJson) {
  if (!playlistsJson) {
    return [];
  }

  let arr;
  try {
    arr = JSON.parse(playlistsJson);
  } catch (e) {
    fail(`--playlists must be valid JSON array: ${e?.message || e}`);
  }

  if (!Array.isArray(arr)) {
    fail('--playlists must be a JSON array');
  }

  const result = [];
  for (const item of arr) {
    if (typeof item !== 'string') {
      fail('Playlist items must be strings (playlist IDs)');
    }
    const id = item.trim();
    if (!id) {
      fail('Playlist ID cannot be empty');
    }
    result.push(id);
  }

  return result;
}

if (!values.name) {
  fail('Missing required --name (influencer display name).');
}

// Initialize Firebase Admin
let credsJson;
try {
  const raw = fs.readFileSync(HARDCODED_CREDS_PATH, 'utf8');
  credsJson = JSON.parse(raw);
} catch (e) {
  fail(
    `Unable to read hardcoded credentials at ${HARDCODED_CREDS_PATH}.\n` +
      `Error: ${e?.message || e}`
  );
}

const appInitOpts = {
  credential: cert(credsJson),
  projectId: values.projectId || credsJson.project_id,
};

if (!getApps().length) initializeApp(appInitOpts);
const db = getFirestore();

// Initialize OpenAI if we have the key
let openai;
if (OPENAI_API_KEY) {
  openai = new OpenAI({ apiKey: OPENAI_API_KEY });
}

/**
 * Check if playlist exists in scannedPlaylists collection
 */
async function getScannedPlaylist(playlistId) {
  try {
    const doc = await db.collection('scannedPlaylists').doc(playlistId).get();
    if (doc.exists) {
      return doc.data();
    }
    return null;
  } catch (error) {
    console.error(`Error checking scanned playlist ${playlistId}:`, error);
    return null;
  }
}

/**
 * Fetch playlist details from YouTube API
 */
async function fetchPlaylistDetails(playlistId) {
  if (!YOUTUBE_API_KEY) {
    console.warn('⚠️  No YOUTUBE_API_KEY found, skipping metadata fetch');
    return null;
  }

  try {
    const response = await axios.get('https://www.googleapis.com/youtube/v3/playlists', {
      params: {
        part: 'snippet',
        id: playlistId,
        key: YOUTUBE_API_KEY,
      },
    });

    if (response.data.items && response.data.items.length > 0) {
      const item = response.data.items[0];
      return {
        id: playlistId,
        title: item.snippet.title,
        description: item.snippet.description,
        channelTitle: item.snippet.channelTitle,
        channelId: item.snippet.channelId,
        thumbnail: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.default?.url,
      };
    }
    return null;
  } catch (error) {
    console.error(`❌ Error fetching playlist ${playlistId}:`, error.message);
    return null;
  }
}

/**
 * Fetch playlist video titles and view counts from XML feed
 */
async function fetchPlaylistFeed(playlistId) {
  try {
    const response = await axios.get(
      `https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistId}`
    );

    const videoTitles = [];
    const videoViews = [];
    let firstVideoId = null;

    const titleMatches = response.data.matchAll(/<media:title>(.*?)<\/media:title>/g);
    for (const match of titleMatches) {
      videoTitles.push(match[1]);
    }

    const viewMatches = response.data.matchAll(/<media:statistics views="(\d+)"\/>/g);
    for (const match of viewMatches) {
      videoViews.push(parseInt(match[1], 10));
    }

    // Extract first video ID for thumbnail
    const videoIdMatch = response.data.match(/<yt:videoId>([a-zA-Z0-9_-]{11})<\/yt:videoId>/);
    if (videoIdMatch && videoIdMatch[1]) {
      firstVideoId = videoIdMatch[1];
    }

    return {
      titles: videoTitles.slice(0, 10),
      views: videoViews.slice(0, 10),
      firstVideoId,
    };
  } catch (error) {
    console.error(`❌ Error fetching playlist feed for ${playlistId}:`, error.message);
    return { titles: [], views: [], firstVideoId: null };
  }
}

/**
 * Fetch channel statistics (subscriber count, verified status)
 */
async function fetchChannelStats(channelId) {
  if (!YOUTUBE_API_KEY) {
    return { subscriberCount: 0, isVerified: false };
  }

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
 * Calculate channel authority score (0-10) based on subscribers
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
 * Calculate engagement score (0-10) based on average video views
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
 * Extract show/character name from title or channel
 */
function extractShowName(title, channelTitle) {
  const combined = `${title} ${channelTitle}`;

  // Check for exact matches from shared list
  for (const show of knownShows) {
    if (combined.includes(show)) {
      return show;
    }
  }

  // Try to extract from "Official" channels
  if (channelTitle.includes('Official')) {
    const match = channelTitle.match(/^([^-]+?)\s+(?:Official|OFFICIAL)/i);
    if (match) {
      const extracted = match[1].trim();
      // Only return if it's not too generic
      if (extracted.length > 3 && !['Kids', 'Children', 'Baby'].includes(extracted)) {
        return extracted;
      }
    }
  }

  // Check if channel name itself might be the show name (without "Official" suffix)
  const channelWithoutSuffix = channelTitle
    .replace(/\s+Official$/i, '')
    .replace(/\s+Channel$/i, '')
    .replace(/\s+-\s+.*$/, '') // Remove anything after dash
    .trim();

  if (channelWithoutSuffix.length > 3 && channelWithoutSuffix.length < 30) {
    // Likely a show name if it's a reasonable length
    return channelWithoutSuffix;
  }

  return null;
}

/**
 * Detect content type from title and description
 */
function detectContentType(title, description) {
  const text = `${title} ${description}`.toLowerCase();

  // Prioritize specific, searchable content types
  if (text.match(/\b(song|songs|music|sing|lullaby|lullabies)\b/)) return 'songs';
  if (text.match(/\b(story|stories|storytime|tale|tales|bedtime)\b/)) return 'stories';
  if (text.match(/\b(compilation|collection|mix|hours)\b/)) return 'compilation';

  // Only return these if they're meaningful
  if (text.match(/\b(animated|animation|cartoon)\b/)) return 'animated';
  if (text.match(/\b(live.?action|real)\b/)) return 'live-action';

  return null;
}

/**
 * Enhance tags with programmatic additions
 */
function enhanceTags(aiTags, title, channelTitle, description = '') {
  const enhanced = [];

  // 1. Add show name as first tag if identifiable
  const showName = extractShowName(title, channelTitle);
  if (showName) {
    enhanced.push(showName);
  }

  // 2. Add content type (only meaningful ones)
  const contentType = detectContentType(title, description);
  if (contentType && !enhanced.includes(contentType)) {
    enhanced.push(contentType);
  }

  // 3. Add AI tags (filtered)
  const genericTags = ['learning', 'fun', 'kids', 'children', 'educational'];
  const filteredAiTags = aiTags.filter((tag) => {
    const lower = tag.toLowerCase();

    // Skip if it's too generic and we already have 4+ tags
    if (enhanced.length >= 4 && genericTags.includes(lower)) {
      return false;
    }

    // Skip if it's a duplicate of show name
    if (showName && lower === showName.toLowerCase()) {
      return false;
    }

    // Skip if already exists
    if (enhanced.some((existing) => existing.toLowerCase() === lower)) {
      return false;
    }

    return true;
  });

  enhanced.push(...filteredAiTags);

  // Return up to 6 unique tags
  return [...new Set(enhanced)].slice(0, 6);
}

/**
 * Calculate overall ranking score
 */
function calculateRanking(analysis, channelStats, videoViews) {
  const { subscriberCount, isVerified } = channelStats;

  const aiScore = analysis?.confidenceScore || 5;
  const channelAuthority = calculateChannelAuthority(subscriberCount, isVerified);
  const engagement = calculateEngagementScore(videoViews);
  const freshness = 7; // Neutral default

  const baseScore = aiScore * 0.4 + channelAuthority * 0.3 + engagement * 0.2 + freshness * 0.1;

  const finalScore = Math.max(0, Math.min(10, baseScore));

  return {
    score: Math.round(finalScore * 10) / 10,
    boost: 0,
    factors: {
      aiScore: Math.round(aiScore * 10) / 10,
      channelAuthority: Math.round(channelAuthority * 10) / 10,
      engagement: Math.round(engagement * 10) / 10,
      freshness: Math.round(freshness * 10) / 10,
    },
  };
}

/**
 * Analyze playlist with GPT-4o Mini
 */
async function analyzePlaylistWithAI(playlist, videoTitles) {
  if (!openai) {
    console.warn('⚠️  No OpenAI API key, skipping AI analysis');
    return null;
  }

  const prompt = `Analyze this YouTube playlist for children.

Playlist: ${playlist.title}
Channel: ${playlist.channelTitle}
Description: ${playlist.description || 'No description'}

First 10 video titles:
${videoTitles.map((title, i) => `${i + 1}. ${title}`).join('\n')}

Respond with ONLY a JSON object (no markdown):
{
  "isAppropriate": true/false,
  "confidenceScore": 1-10,
  "ageMin": 0-12,
  "ageMax": 0-12,
  "categories": ["Category1"] or ["Category1", "Category2"],
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "languages": ["English"] or ["English", "Spanish"] etc,
  "briefDescription": "1-2 sentence description"
}

IMPORTANT for categories field:
- Always return an array. Use values from this list when possible: ["Educational","Music","Stories","Animation","Art & Crafts","Dance & Fitness","Health & Wellness","Language","Entertainment"]
- Prefer existing categories — only use a new value if the content is genuinely distinct. 1 category is ideal, 2 if truly both apply.

IMPORTANT for languages field:
- Always return an array. Single language: ["English"]. Multiple: ["English", "Spanish"].
- Never use "Multiple" or "Multilingual" — list the actual languages.
For tags: What specific content themes appear in these videos? Use concise but meaningful terms that capture the essence of what kids watch. Avoid character names in tags and overly long descriptions.

GOOD examples:
- "firefighter" (specific job/role)
- "school adventures" (better than just "school")
- "Halloween costumes" (specific activity)
- "cooking show", "space exploration", "animal rescue"

AVOID:
- "firefighter Peppa" (has character name)
- "Baby Evie's fireworks" (has character name)  
- "readiness for school preparation activities" (too long)
- Just "school" or "animals" (too vague)

Focus on searchable themes that give parents a clear idea of content.`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'You analyze kids content. Provide specific but concise tags about content themes. Avoid character names but keep meaningful context.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.4,
      response_format: { type: 'json_object' },
    });

    return JSON.parse(completion.choices[0].message.content);
  } catch (error) {
    console.error(`❌ Error analyzing playlist:`, error.message);
    return null;
  }
}

/**
 * Check if playlist ID is valid (skip YouTube Music auto-playlists)
 */
function isValidPlaylistId(playlistId) {
  // Skip YouTube Music auto-generated playlists
  if (playlistId.startsWith('RDCLAK') || playlistId.startsWith('OLAK')) {
    return false;
  }

  // Skip radio/mix playlists
  if (playlistId.startsWith('RD') && !playlistId.startsWith('RDCLAK')) {
    return false;
  }

  return true;
}

/**
 * Ensure playlist exists in scannedPlaylists collection
 * If not, fetch metadata and add it with ranking
 */
async function ensurePlaylistScanned(playlistId) {
  console.log(`\n📹 Checking playlist: ${playlistId}`);

  // Validate playlist ID first
  if (!isValidPlaylistId(playlistId)) {
    console.log(`   ❌ Invalid playlist type (auto-generated) - skipping`);
    return false;
  }

  // Check if it exists in scannedPlaylists
  const scanned = await getScannedPlaylist(playlistId);
  if (scanned) {
    console.log(`   ✅ Already in scannedPlaylists`);
    return true;
  }

  // If not, fetch from YouTube and add it
  console.log(`   🔍 Not in collection, fetching from YouTube...`);
  const details = await fetchPlaylistDetails(playlistId);

  if (!details) {
    console.log(`   ⚠️  Could not fetch details - will add basic entry`);
    // Add minimal entry so invite works
    await db
      .collection('scannedPlaylists')
      .doc(playlistId)
      .set({
        id: playlistId,
        title: 'Untitled Playlist',
        thumbnail: '',
        author: '',
        isApproved: false,

        // Default ranking for unknown playlists
        ranking: {
          score: 5.0,
          boost: 0,
          factors: {
            aiScore: 5.0,
            channelAuthority: 5.0,
            engagement: 5.0,
            freshness: 7.0,
          },
        },

        // Review tracking - no AI review possible without details
        reviewedBy: 'manual',
        reviewedAt: new Date(),

        // Metadata
        scannedAt: new Date(),
        updatedAt: new Date(),
        scannedBy: 'invite',

        // Analytics
        importCount: 0,
        likes: 0,
      });
    return true;
  }

  console.log(`   ✅ Fetched YouTube details`);

  // Fetch channel stats
  const channelStats = await fetchChannelStats(details.channelId);
  if (channelStats.subscriberCount > 0) {
    console.log(
      `   👥 Subscribers: ${channelStats.subscriberCount.toLocaleString()}${
        channelStats.isVerified ? ' ✓' : ''
      }`
    );
  }

  // Fetch video titles and views for AI analysis and engagement
  const feedData = await fetchPlaylistFeed(playlistId);
  const videoTitles = feedData.titles;
  const videoViews = feedData.views;
  const firstVideoId = feedData.firstVideoId;

  // Use video thumbnail instead of playlist thumbnail
  const thumbnail = firstVideoId
    ? `https://img.youtube.com/vi/${firstVideoId}/mqdefault.jpg`
    : details.thumbnail;

  let playlistData = {
    id: details.id,
    title: details.title,
    thumbnail,
    author: details.channelTitle,
    authorUrl: `https://www.youtube.com/channel/${details.channelId}`,
    sourceUrl: `https://www.youtube.com/playlist?list=${playlistId}`,
    description: details.description || '',
    isApproved: false, // Not auto-approved from invites

    // Channel metadata for ranking
    channelSubscribers: channelStats.subscriberCount,
    channelVerified: channelStats.isVerified,

    // Review tracking
    reviewedBy: 'ai',
    reviewedAt: new Date(),

    // Metadata
    scannedAt: new Date(),
    updatedAt: new Date(),
    scannedBy: 'invite',

    // Analytics
    importCount: 0,
    likes: 0,
  };

  let analysis = null;

  // Try AI analysis if we have videos
  if (videoTitles.length > 0 && openai) {
    console.log(`   🤖 Analyzing with AI...`);
    analysis = await analyzePlaylistWithAI(details, videoTitles);

    if (analysis) {
      console.log(`   ✅ AI Analysis complete (score: ${analysis.confidenceScore}/10)`);

      // Enhance tags with programmatic additions
      const enhancedTags = enhanceTags(
        analysis.tags,
        details.title,
        details.channelTitle,
        details.description
      );

      // Store AI analysis results
      playlistData = {
        ...playlistData,
        ageMin: analysis.ageMin,
        ageMax: analysis.ageMax,
        tags: enhancedTags, // Use enhanced tags
        categories: Array.isArray(analysis.categories) ? analysis.categories : [analysis.categories || analysis.category || 'Entertainment'],
        languages: Array.isArray(analysis.languages) ? analysis.languages : [analysis.languages || analysis.language || 'English'],
        description: analysis.briefDescription,
        isAppropriate: analysis.isAppropriate,
      };

      console.log(`   🏷️  Tags: ${enhancedTags.join(', ')}`);

      // If AI rejected it, store the reasoning
      if (!analysis.isAppropriate) {
        playlistData.aiRejectionReason = analysis.reasoning;
        console.log(`   ⚠️  AI flagged as inappropriate: ${analysis.reasoning}`);
        console.log(`   💡 Storing anyway (from invite) - needs manual review`);
      }
    }
  }

  // Calculate ranking
  const ranking = calculateRanking(analysis, channelStats, videoViews);
  playlistData.ranking = ranking;

  console.log(`   ⭐ Ranking: ${ranking.score}/10`);
  console.log(
    `      • AI: ${ranking.factors.aiScore} | Authority: ${ranking.factors.channelAuthority} | Engagement: ${ranking.factors.engagement}`
  );

  // Save to scannedPlaylists
  await db.collection('scannedPlaylists').doc(playlistId).set(playlistData);
  console.log(`   ✅ Added to scannedPlaylists (isApproved: false)`);

  return true;
}

/**
 * Ensure all playlists are in scannedPlaylists collection
 */
async function ensurePlaylistsScanned(playlists) {
  if (playlists.length === 0) {
    return;
  }

  console.log(`\n🔍 Ensuring ${playlists.length} playlist(s) are in scannedPlaylists...`);

  for (const playlistId of playlists) {
    await ensurePlaylistScanned(playlistId);

    // Small delay to avoid rate limits
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

// Main execution
const linkTitle = values.title || `${values.name} invites you to try Vidopick`;

const ttlDate = values.ttl ? new Date(values.ttl) : null;
if (ttlDate && isNaN(ttlDate.getTime())) fail(`Invalid --ttl: ${values.ttl}`);

const extraParams = {};
for (const kv of values.param || []) {
  const i = kv.indexOf('=');
  if (i > 0) extraParams[kv.slice(0, i)] = kv.slice(i + 1);
}

const playlists = parsePlaylists(values.playlists);

// Ensure playlists are in scannedPlaylists collection
await ensurePlaylistsScanned(playlists);

const redirect = {
  ios: values.ios || IOS_STORE,
  android: values.android || ANDROID_STORE,
  desktop: values.desktop || DEFAULT_DESKTOP,
  webOnly: !!values.webOnly,
};

const meta = {
  template: values.template || 'invite',
  ...(values.ogTitle ? { ogTitle: values.ogTitle } : {}),
  ...(values.ogDescription ? { ogDescription: values.ogDescription } : {}),
  ...(values.ogImage ? { ogImage: values.ogImage } : {}),
};

const docBody = {
  linkTitle,
  createdAt: FieldValue.serverTimestamp(),
  ttl: ttlDate || null,
  redirect,
  params: {
    name: values.name,
    ...extraParams,
    // Store playlists as array of IDs
    ...(playlists.length ? { playlists } : {}),
  },
  analytics: {},
  meta,
};

// Reserve ID and create document
async function reserveId(preferredId) {
  if (preferredId) {
    const ref = db.collection('shortLinks').doc(preferredId);
    const snap = await ref.get();
    if (snap.exists) fail(`Slug already exists: ${preferredId}`);
    return preferredId;
  }
  for (let i = 0; i < 5; i++) {
    const id = _nanoid(10);
    const snap = await db.collection('shortLinks').doc(id).get();
    if (!snap.exists) return id;
  }
  fail('Could not find a free ID after several attempts.');
}

const id = await reserveId(values.slug || null);
await db.collection('shortLinks').doc(id).set(docBody);

const shortLink = `${SHORT_DOMAIN}/${id}`;

const previewParams = new URLSearchParams({
  id,
  name: values.name,
  ...Object.fromEntries(Object.entries(extraParams).map(([k, v]) => [k, String(v)])),
  ...(playlists.length ? { pids: playlists.join(',') } : {}),
}).toString();

const preview = `${DEFAULT_DESKTOP}${previewParams ? `?${previewParams}` : ''}`;

console.log('\n' + '='.repeat(60));
console.log('✅ INVITE LINK CREATED');
console.log('='.repeat(60));
console.log(
  JSON.stringify(
    {
      id,
      shortLink,
      docPath: `shortLinks/${id}`,
      title: linkTitle,
      preview,
      playlists,
      projectId: appInitOpts.projectId,
    },
    null,
    2
  )
);
console.log('='.repeat(60));

process.exit(0);
