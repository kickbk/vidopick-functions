#!/usr/bin/env node
/**
 * Automated Playlist Discovery Script
 *
 * Discovers and curates age-appropriate YouTube playlists using AI analysis.
 * Stores results in unified 'scannedPlaylists' collection.
 *
 * Usage:
 *   node scripts/discoverPlaylists.mjs
 *   node scripts/discoverPlaylists.mjs --totalTarget 500 --autoApproveScore 7
 */
import { algoliasearch } from 'algoliasearch';
import axios from 'axios';
import dotenv from 'dotenv';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import OpenAI from 'openai';
import { knownShows } from './knownShows.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ALGOLIA_APP_ID = 'ACLDY9FF4Y';
const ALGOLIA_WRITE_API = process.env.ALGOLIA_WRITE_API;

// Load service account credentials
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

if (!YOUTUBE_API_KEY || !OPENAI_API_KEY) {
  console.error('❌ Missing API keys. Create scripts/.env with:');
  console.error('YOUTUBE_API_KEY=your_key');
  console.error('OPENAI_API_KEY=your_key');
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
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const algolia = algoliasearch(ALGOLIA_APP_ID, ALGOLIA_WRITE_API || '');

// Collection name for scanned playlists
const COLLECTION_NAME = 'scannedPlaylists';

/**
 * Default categories — used as fallback if Algolia fetch fails.
 * This list is the starting point and may grow over time.
 */
const DEFAULT_CATEGORIES = [
  'Educational',
  'Music',
  'Stories',
  'Animation',
  'Art & Crafts',
  'Dance & Fitness',
  'Health & Wellness',
  'Language',
  'Entertainment',
];

/**
 * Fetch the current list of categories from Algolia facets.
 * Falls back to DEFAULT_CATEGORIES if Algolia is unreachable.
 */
async function fetchCategoriesFromAlgolia() {
  try {
    const result = await algolia.searchForFacetValues({
      indexName: COLLECTION_NAME,
      facetName: 'categories',
      searchForFacetValuesRequest: { facetQuery: '', maxFacetHits: 100 },
    });
    const categories = result.facetHits.map((h) => h.value).filter(Boolean);
    if (categories.length > 0) {
      console.log(`🗂️  Loaded ${categories.length} categories from Algolia: ${categories.join(', ')}`);
      return categories;
    }
  } catch (err) {
    console.warn(`⚠️  Could not fetch categories from Algolia (${err.message}) — using defaults`);
  }
  console.log(`🗂️  Using default categories: ${DEFAULT_CATEGORIES.join(', ')}`);
  return DEFAULT_CATEGORIES;
}
const MIN_VIDEOS = 10;

// Search queries organized by age group
const SEARCH_QUERIES = {
  '0-2': [
    'baby sensory videos',
    'infant lullabies',
    'toddler learning colors',
    'baby songs nursery rhymes',
    'toddler educational videos',
    'baby music',
    'sensory videos for babies',
    'toddler learning shapes',
  ],
  '3-5': [
    'preschool educational',
    'kindergarten learning videos',
    'learning ABCs for kids',
    'preschool songs',
    'educational cartoons preschool',
    'counting songs for kids',
    'kids learning animals',
    'preschool science videos',
  ],
  '6-8': [
    'elementary school learning',
    'kids science experiments',
    'educational videos grade 1-3',
    'kids geography',
    'math videos for children',
    'reading comprehension kids',
    'elementary art lessons',
    'kids history',
  ],
  '9-12': [
    'middle school educational',
    'STEM videos for kids',
    'tween learning',
    'kids science channel',
    'educational videos grade 4-6',
    'kids coding tutorials',
    'geography for tweens',
    'math for middle school',
  ],
};

// Additional category queries
const CATEGORY_QUERIES = [
  'kids music',
  'children stories',
  'kids dance videos',
  'art for kids',
  'spanish for kids',
  'french learning kids',
  'kids yoga',
  'children meditation',
  'dinosaur videos kids',
  'space videos for children',
  'animal documentary kids',
];

/**
 * Decode HTML entities in text
 */
function decodeHtmlEntities(text) {
  const entities = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
  };

  return text.replace(/&(?:amp|lt|gt|quot|#39|apos);/g, (match) => entities[match] || match);
}

/**
 * Check if playlist already exists in Firebase
 */
async function playlistExists(playlistId) {
  try {
    const doc = await db.collection(COLLECTION_NAME).doc(playlistId).get();
    return doc.exists;
  } catch (error) {
    console.error(`Error checking playlist ${playlistId}:`, error);
    return false;
  }
}

/**
 * Search YouTube for playlists by channel ID
 */
async function searchChannelPlaylists(channelId, maxResults = 50) {
  try {
    const response = await axios.get('https://www.googleapis.com/youtube/v3/playlists', {
      params: {
        part: 'snippet,contentDetails',
        channelId: channelId,
        maxResults,
        key: YOUTUBE_API_KEY,
      },
    });

    return response.data.items.map((item) => ({
      playlistId: item.id,
      title: item.snippet.title,
      description: item.snippet.description,
      channelTitle: item.snippet.channelTitle,
      channelId: item.snippet.channelId,
      thumbnail: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.default?.url,
      query: `channel:${channelId}`,
      videoCount: item.contentDetails?.itemCount || 0,
      source: 'api',
    }));
  } catch (error) {
    console.error(
      `❌ Error searching channel playlists for ${channelId}:`,
      error.response?.data || error.message
    );
    return [];
  }
}

/**
 * Fetch specific playlist details by ID
 */
async function fetchSpecificPlaylist(playlistId) {
  try {
    const response = await axios.get('https://www.googleapis.com/youtube/v3/playlists', {
      params: {
        part: 'snippet,contentDetails',
        id: playlistId,
        key: YOUTUBE_API_KEY,
      },
    });

    if (response.data.items && response.data.items.length > 0) {
      const item = response.data.items[0];
      return {
        playlistId: item.id,
        title: item.snippet.title,
        description: item.snippet.description,
        channelTitle: item.snippet.channelTitle,
        channelId: item.snippet.channelId,
        thumbnail: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.default?.url,
        query: `specific:${playlistId}`,
        videoCount: item.contentDetails?.itemCount || 0,
        source: 'api',
      };
    }
    return null;
  } catch (error) {
    console.error(
      `❌ Error fetching playlist ${playlistId}:`,
      error.response?.data || error.message
    );
    return null;
  }
}

/**
 * Scrape YouTube search results (better quality than API)
 */
async function scrapeYouTubePlaylistSearch(query, maxResults = 20) {
  try {
    console.log(`   🔍 Fetching YouTube page...`);
    const response = await axios.get('https://www.youtube.com/results', {
      params: {
        search_query: query,
        sp: 'EgIQAw%3D%3D', // Filter for playlists only
      },
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: 10000,
    });

    console.log(`   📄 Got response, length: ${response.data.length} bytes`);

    // YouTube embeds data in the HTML as JSON
    const ytInitialDataMatch = response.data.match(/var ytInitialData = ({.+?});/);
    if (!ytInitialDataMatch) {
      console.warn(`   ⚠️  Could not find ytInitialData in page`);
      return null;
    }

    console.log(`   ✅ Found ytInitialData, parsing JSON...`);

    const data = JSON.parse(ytInitialDataMatch[1]);
    const contents =
      data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer
        ?.contents;

    if (!contents) {
      console.warn(`   ⚠️  Could not find contents in parsed data`);
      return null;
    }

    console.log(`   📦 Found contents sections: ${contents.length}`);

    const playlists = [];

    for (const section of contents || []) {
      const items = section?.itemSectionRenderer?.contents || [];
      console.log(`   📋 Processing section with ${items.length} items...`);

      for (const item of items) {
        const lockupViewModel = item?.lockupViewModel;
        if (!lockupViewModel) continue;

        // Extract playlist ID from contentId
        const playlistId = lockupViewModel.contentId;
        if (!playlistId) continue;

        // Extract title
        const title = decodeHtmlEntities(
          lockupViewModel.metadata?.lockupMetadataViewModel?.title?.content || ''
        );

        // Extract channel name and ID from first metadata row
        const metadataRows =
          lockupViewModel.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel
            ?.metadataRows || [];
        const firstRow = metadataRows[0];
        const channelPart = firstRow?.metadataParts?.[0];
        const channelTitle = decodeHtmlEntities(channelPart?.text?.content || '');

        // Extract channel ID from browseEndpoint
        const channelId =
          channelPart?.text?.commandRuns?.[0]?.onTap?.innertubeCommand?.browseEndpoint?.browseId ||
          '';

        // Extract video count from thumbnail overlay badge
        const thumbnailBadge =
          lockupViewModel.contentImage?.collectionThumbnailViewModel?.primaryThumbnail
            ?.thumbnailViewModel?.overlays?.[0]?.thumbnailOverlayBadgeViewModel
            ?.thumbnailBadges?.[0]?.thumbnailBadgeViewModel;
        const videoCountText = thumbnailBadge?.text || '0';
        const videoCount = parseInt(videoCountText.replace(/\D/g, '')) || 0;

        // Extract thumbnail
        const thumbnails =
          lockupViewModel.contentImage?.collectionThumbnailViewModel?.primaryThumbnail
            ?.thumbnailViewModel?.image?.sources || [];
        const thumbnail = thumbnails[thumbnails.length - 1]?.url || '';

        playlists.push({
          playlistId: playlistId,
          title: title,
          description: '', // Not available in search results
          channelTitle: channelTitle,
          channelId: channelId,
          thumbnail: thumbnail,
          query: query,
          videoCount: videoCount,
          source: 'scraping',
        });

        if (playlists.length >= maxResults) break;
      }
      if (playlists.length >= maxResults) break;
    }

    console.log(`   ✅ Extracted ${playlists.length} playlists`);
    return playlists;
  } catch (error) {
    console.error(`❌ Error scraping YouTube for "${query}":`, error.message);
    console.error(`   Stack trace:`, error.stack);
    return null;
  }
}
/**
 * Search YouTube for playlists using API (fallback)
 */
async function searchYouTubePlaylistsAPI(query, maxResults = 20) {
  try {
    const response = await axios.get('https://www.googleapis.com/youtube/v3/search', {
      params: {
        part: 'snippet',
        q: query,
        type: 'playlist',
        maxResults,
        key: YOUTUBE_API_KEY,
        safeSearch: 'strict',
        order: 'relevance',
        relevanceLanguage: 'en',
        regionCode: 'US',
      },
    });

    // Get playlist IDs to fetch item counts
    const playlistIds = response.data.items.map((item) => item.id.playlistId);

    // Fetch full details including video counts
    let playlistDetails = {};
    if (playlistIds.length > 0) {
      try {
        const detailsResponse = await axios.get('https://www.googleapis.com/youtube/v3/playlists', {
          params: {
            part: 'contentDetails',
            id: playlistIds.join(','),
            key: YOUTUBE_API_KEY,
          },
        });

        playlistDetails = Object.fromEntries(
          detailsResponse.data.items.map((item) => [item.id, item.contentDetails?.itemCount || 0])
        );
      } catch (error) {
        console.warn(`   ⚠️  Could not fetch playlist details, video counts will be 0`);
      }
    }

    return response.data.items.map((item) => ({
      playlistId: item.id.playlistId,
      title: item.snippet.title,
      description: item.snippet.description,
      channelTitle: item.snippet.channelTitle,
      channelId: item.snippet.channelId,
      thumbnail: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.default?.url,
      query: query,
      videoCount: playlistDetails[item.id.playlistId] || 0,
      source: 'api',
    }));
  } catch (error) {
    console.error(
      `❌ Error searching YouTube API for "${query}":`,
      error.response?.data || error.message
    );
    return [];
  }
}

/**
 * Search YouTube for playlists (scraping with API fallback)
 */
async function searchYouTubePlaylists(query, maxResults = 20) {
  // Try scraping first (best quality, matches YouTube.com results)
  console.log(`   🌐 Attempting to scrape YouTube.com...`);

  // Try scraping (best quality, matches YouTube.com results)
  const scraped = await scrapeYouTubePlaylistSearch(query, maxResults);

  if (scraped === null) {
    console.log(`   ❌ Scraping failed (could not parse page)`);
    return [];
  }

  if (scraped && scraped.length > 0) {
    console.log(`   ✅ Scraped ${scraped.length} playlists from YouTube.com`);
    return scraped;
  }

  // Fallback to API if scraping fails
  console.log(`   🔌 Using YouTube API (scraping failed)`);
  return await searchYouTubePlaylistsAPI(query, maxResults);
}

/**
 * Fetch playlist XML feed to get video titles and view counts
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
      titles: videoTitles.slice(0, 20),
      views: videoViews.slice(0, 20),
      firstVideoId,
      totalCount: videoTitles.length,
    };
  } catch (error) {
    console.error(`❌ Error fetching playlist feed for ${playlistId}:`, error.message);
    return { titles: [], views: [], firstVideoId: null, totalCount: 0 };
  }
}

/**
 * Fetch channel statistics (subscriber count, verified status)
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
    const isVerified = channel.status?.isLinked || false; // Verified channels are linked

    return { subscriberCount, isVerified };
  } catch (error) {
    console.error(`❌ Error fetching channel stats for ${channelId}:`, error.message);
    return { subscriberCount: 0, isVerified: false };
  }
}

/**
 * Calculate channel authority score (0-10) based on subscribers
 */
function calculateChannelAuthority(subscriberCount, isVerified) {
  let score = 0;

  // Base score from subscriber count
  if (subscriberCount >= 10000000) {
    score = 10; // 10M+ subscribers
  } else if (subscriberCount >= 1000000) {
    score = 8 + (subscriberCount / 10000000) * 2; // 1M-10M: scale 8-10
  } else if (subscriberCount >= 100000) {
    score = 6 + (subscriberCount / 1000000) * 2; // 100K-1M: scale 6-8
  } else if (subscriberCount >= 10000) {
    score = 4 + (subscriberCount / 100000) * 2; // 10K-100K: scale 4-6
  } else if (subscriberCount >= 1000) {
    score = 2 + (subscriberCount / 10000) * 2; // 1K-10K: scale 2-4
  } else {
    score = Math.min(2, (subscriberCount / 1000) * 2); // <1K: scale 0-2
  }

  // Verification bonus
  if (isVerified) {
    score = Math.min(10, score + 1);
  }

  return Math.round(score * 10) / 10; // Round to 1 decimal
}

/**
 * Calculate engagement score (0-10) based on average video views
 */
function calculateEngagementScore(videoViews) {
  if (!videoViews || videoViews.length === 0) return 5; // Default if no data

  const avgViews = videoViews.reduce((sum, v) => sum + v, 0) / videoViews.length;

  // Score based on average views
  if (avgViews >= 10000000) return 10; // 10M+ avg views
  if (avgViews >= 1000000) return 8 + (avgViews / 10000000) * 2; // 1M-10M
  if (avgViews >= 100000) return 6 + (avgViews / 1000000) * 2; // 100K-1M
  if (avgViews >= 10000) return 4 + (avgViews / 100000) * 2; // 10K-100K
  if (avgViews >= 1000) return 2 + (avgViews / 10000) * 2; // 1K-10K

  return Math.min(2, (avgViews / 1000) * 2); // <1K
}

/**
 * Calculate freshness score (0-10) - placeholder for now
 * Can be enhanced later with actual upload dates from API
 */
function calculateFreshnessScore() {
  // For now, give neutral score since we don't have publish dates easily
  // This can be improved by parsing dates from XML or using the API
  return 7; // Slightly favor content (assume reasonably fresh)
}

/**
 * Detect content quality issues (returns penalty 0-3)
 */
function detectQualityPenalties(title, description, videoTitles) {
  let penalty = 0;
  const allText = `${title} ${description} ${videoTitles.join(' ')}`.toLowerCase();

  // Excessive caps (more than 50% uppercase in title)
  const capsRatio = (title.match(/[A-Z]/g) || []).length / title.length;
  if (capsRatio > 0.5 && title.length > 10) {
    penalty += 1;
  }

  // Suspicious repeated patterns (content farms)
  const suspiciousPatterns = [/learn colors/gi, /finger family/gi, /nursery rhymes/gi];

  let patternCount = 0;
  suspiciousPatterns.forEach((pattern) => {
    const matches = allText.match(pattern);
    if (matches && matches.length > 5) patternCount++; // More than 5 mentions is suspicious
  });

  if (patternCount >= 2) {
    penalty += 0.5; // Small penalty, but don't exclude good educational content
  }

  // Multiple languages detected (possible content farm)
  const hasMultipleLanguages =
    /[\u0400-\u04FF]/.test(allText) && // Cyrillic
    /[\u4E00-\u9FFF]/.test(allText); // Chinese
  if (hasMultipleLanguages) {
    penalty += 1;
  }

  return Math.min(3, penalty); // Cap at 3 point penalty
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
function calculateRanking(analysis, channelStats, videoViews, playlist) {
  const { subscriberCount, isVerified, authorityScore } = channelStats;

  // Calculate individual factors
  const aiScore = analysis.confidenceScore;
  const channelAuthority = authorityScore || calculateChannelAuthority(subscriberCount, isVerified);
  const engagement = calculateEngagementScore(videoViews);
  const freshness = calculateFreshnessScore();

  // Detect quality penalties
  const qualityPenalty = detectQualityPenalties(playlist.title, playlist.description || '', []);

  // Weighted average
  const baseScore = aiScore * 0.4 + channelAuthority * 0.3 + engagement * 0.2 + freshness * 0.1;

  // Apply penalty
  const finalScore = Math.max(0, Math.min(10, baseScore - qualityPenalty));

  return {
    score: Math.round(finalScore * 10) / 10, // Round to 1 decimal
    boost: 0, // Default boost, can be adjusted by admins later
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
async function analyzePlaylistWithAI(playlist, videoTitles, categories = DEFAULT_CATEGORIES) {
  const decodedTitles = videoTitles.map((title) => decodeHtmlEntities(title));

  const prompt = `Analyze this YouTube playlist for children.

Playlist: ${decodeHtmlEntities(playlist.title)}
Channel: ${decodeHtmlEntities(playlist.channelTitle)}
Description: ${decodeHtmlEntities(playlist.description || 'No description')}

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
  "briefDescription": "1-2 sentence description",
  "reasoning": "Brief explanation"
}

IMPORTANT for categories field:
- Current categories in use: ${JSON.stringify(categories)}
- Always return an array, even for one: ["Educational"]
- Use existing categories whenever reasonable — prefer fitting into what already exists over creating a new one.
- Only add a new category name (not in the list above) if the content is genuinely distinct and would apply to many similar playlists.
- Keep it short: 1 category is ideal, 2 is fine if truly both apply.

IMPORTANT for languages field:
- Always return an array, even for a single language: ["English"], ["Spanish"], ["Chinese"], etc.
- If videos contain multiple languages, list each one: ["English", "Spanish"], ["Hebrew", "English"], etc.
- Never return a string like "Multiple" or "Bilingual" — always list the actual languages in the array.

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

    const analysis = JSON.parse(completion.choices[0].message.content);
    return analysis;
  } catch (error) {
    console.error(`❌ Error analyzing playlist ${playlist.playlistId}:`, error.message);
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
 * Upload playlist to Firebase scannedPlaylists collection
 */
async function uploadToFirebase(playlist, videoCount, autoApprove = false) {
  const {
    analysis,
    ranking,
    channelStats,
    playlistId,
    title,
    channelTitle,
    channelId,
    thumbnail,
    description,
  } = playlist;

  // Enhance tags with programmatic additions
  const enhancedTags = enhanceTags(analysis.tags, title, channelTitle, description);

  const playlistData = {
    id: playlistId,
    title,
    thumbnail,
    author: channelTitle,
    authorUrl: `https://www.youtube.com/channel/${channelId}`,
    ageMin: analysis.ageMin,
    ageMax: analysis.ageMax,
    tags: enhancedTags, // Use enhanced tags instead of raw AI tags
    categories: Array.isArray(analysis.categories) ? analysis.categories : [analysis.categories || analysis.category || 'Entertainment'],
    languages: Array.isArray(analysis.languages) ? analysis.languages : [analysis.languages || analysis.language || 'Unknown'],
    description: analysis.briefDescription,
    sourceUrl: `https://www.youtube.com/playlist?list=${playlistId}`,

    // Video count
    videos: videoCount,

    // Ranking data (nested structure)
    ranking: {
      score: ranking.score,
      boost: ranking.boost,
      factors: ranking.factors,
    },

    // Channel metadata
    channelSubscribers: channelStats.subscriberCount,
    channelVerified: channelStats.isVerified,

    // Status flags
    isApproved: autoApprove,
    isAppropriate: analysis.isAppropriate,

    // Review tracking
    reviewedBy: 'ai',
    reviewedAt: new Date(),

    // Metadata
    scannedAt: new Date(),
    updatedAt: new Date(),
    scannedBy: 'ai',

    // Analytics (initialize)
    importCount: 0,
    likes: 0,
  };

  try {
    await db.collection(COLLECTION_NAME).doc(playlistId).set(playlistData);
    return true;
  } catch (error) {
    console.error(`Error uploading playlist ${playlistId}:`, error);
    return false;
  }
}

/**
 * Main discovery function
 */
async function discoverPlaylists(options = {}) {
  const {
    totalTarget = 200,
    autoApproveScore = 8,
    resultsPerQuery = 20,
    saveToFiles = true,
    ageGroup = null,
    customQueries = [],
    channelId = null,
    playlistIds = [],
  } = options;

  console.log('🚀 Starting Playlist Discovery...');
  console.log(`📊 Target: ${totalTarget} playlists`);
  console.log(`✅ Auto-approve threshold: ${autoApproveScore}/10`);
  console.log(`📹 Minimum videos: ${MIN_VIDEOS}`);

  // Fetch live category list from Algolia so AI is aware of what already exists
  const currentCategories = await fetchCategoriesFromAlgolia();

  // Show targeted search mode if specified
  if (playlistIds.length > 0) {
    console.log(`🎯 Mode: Specific playlists (${playlistIds.length} IDs)`);
  } else if (channelId) {
    console.log(`🎯 Mode: Channel search (${channelId})`);
  } else if (ageGroup) {
    console.log(`🎯 Mode: Age group (${ageGroup})`);
  } else if (customQueries.length > 0) {
    console.log(`🎯 Mode: Custom queries (${customQueries.length} queries)`);
  } else {
    console.log(`🎯 Mode: Full discovery (all age groups)`);
  }
  console.log('');

  const allQueries = [];

  // Handle specific playlist IDs
  if (playlistIds.length > 0) {
    console.log(`🔍 Fetching ${playlistIds.length} specific playlists...`);

    const discovered = [];
    const approved = [];
    const needsReview = [];
    const rejected = [];
    let skippedExisting = 0;

    for (let i = 0; i < playlistIds.length; i++) {
      const playlistId = playlistIds[i];
      console.log(`\n📹 [${i + 1}/${playlistIds.length}] Fetching: ${playlistId}`);

      // Check if already exists in Firebase
      const exists = await playlistExists(playlistId);
      if (exists) {
        console.log(`      ⏭️  Already in scannedPlaylists - skipping`);
        skippedExisting++;
        continue;
      }

      // Fetch playlist details
      const playlist = await fetchSpecificPlaylist(playlistId);
      if (!playlist) {
        console.log(`      ❌ Could not fetch playlist details`);
        continue;
      }

      console.log(`      Title: ${playlist.title}`);
      console.log(`      Channel: ${playlist.channelTitle}`);

      // Skip playlists without thumbnails early to save processing
      if (!playlist.thumbnail) {
        console.log(`      ⚠️  Skipping - no thumbnail available`);
        continue;
      }

      // Skip invalid playlist IDs
      if (!isValidPlaylistId(playlist.playlistId)) {
        console.log(`      ⚠️  Skipping - invalid playlist type (auto-generated)`);
        continue;
      }

      // Process the playlist (same as normal discovery)
      const result = await processPlaylist(
        playlist,
        approved,
        needsReview,
        rejected,
        discovered,
        totalTarget,
        currentCategories
      );

      if (result === 'target_reached' && approved.length >= totalTarget) {
        console.log(`\n🎉 Target reached! ${approved.length} playlists approved`);
        break;
      }

      // Small delay to avoid rate limits
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    return await finalizeBatch(
      discovered,
      approved,
      needsReview,
      rejected,
      skippedExisting,
      saveToFiles
    );
  }

  // Handle channel search
  if (channelId) {
    console.log(`🔍 Searching channel: ${channelId}`);
    const results = await searchChannelPlaylists(channelId, Math.min(50, totalTarget));
    console.log(`   Found ${results.length} playlists from channel`);

    allQueries.push({ query: `channel:${channelId}`, results, ageGroup: 'channel' });
  }
  // Handle custom queries
  else if (customQueries.length > 0) {
    console.log(`🔍 Using ${customQueries.length} custom queries`);
    for (const query of customQueries) {
      allQueries.push({ query, ageGroup: 'custom' });
    }
  }
  // Handle specific age group
  else if (ageGroup && SEARCH_QUERIES[ageGroup]) {
    console.log(`🔍 Using age group: ${ageGroup}`);
    SEARCH_QUERIES[ageGroup].forEach((query) => {
      allQueries.push({ query, ageGroup });
    });
  }
  // Handle full discovery (all age groups)
  else {
    // Collect all queries with age group labels
    for (const [group, queries] of Object.entries(SEARCH_QUERIES)) {
      queries.forEach((query) => {
        allQueries.push({ query, ageGroup: group });
      });
    }

    // Add category queries
    CATEGORY_QUERIES.forEach((query) => {
      allQueries.push({ query, ageGroup: 'auto' });
    });
  }

  // Shuffle queries for balanced discovery (except for channel/specific searches)
  if (!channelId) {
    allQueries.sort(() => Math.random() - 0.5);
  }

  const discovered = [];
  const approved = [];
  const needsReview = [];
  const rejected = [];

  let processed = 0;
  let skippedExisting = 0;
  const queriesToRun = channelId
    ? 1
    : Math.min(Math.ceil(totalTarget / resultsPerQuery), allQueries.length);

  for (let i = 0; i < queriesToRun; i++) {
    const queryData = allQueries[i];

    if (!queryData) break;

    const { query, ageGroup: queryAgeGroup } = queryData;

    console.log(`\n🔍 [${i + 1}/${queriesToRun}] Searching: "${query}" (${queryAgeGroup})`);

    // Get results (either pre-fetched for channel or search now)
    let results;
    if (queryData.results) {
      results = queryData.results; // Channel search results
    } else {
      results = await searchYouTubePlaylists(query, resultsPerQuery);
    }

    console.log(`   Found ${results.length} playlists`);

    // Filter out playlists with too few videos before processing
    const filteredResults = results.filter((playlist) => {
      if (playlist.videoCount < MIN_VIDEOS) {
        console.log(
          `   ⏭️  Skipping "${playlist.title}" - only ${playlist.videoCount} videos (min: ${MIN_VIDEOS})`
        );
        return false;
      }
      return true;
    });

    console.log(`   📊 ${filteredResults.length} playlists meet minimum video requirement`);

    // Analyze each playlist
    for (const playlist of filteredResults) {
      processed++;

      console.log(`\n   📹 [${processed}] ${playlist.title}`);
      console.log(`      Channel: ${playlist.channelTitle}`);
      console.log(`      Videos: ${playlist.videoCount}`);

      // Skip playlists without thumbnails early to save processing
      if (!playlist.thumbnail) {
        console.log(`      ⚠️  Skipping - no thumbnail available`);
        continue;
      }

      // Check if already exists in Firebase
      const exists = await playlistExists(playlist.playlistId);
      if (exists) {
        console.log(`      ⏭️  Already in scannedPlaylists - skipping`);
        skippedExisting++;
        continue;
      }

      // Skip invalid playlist IDs
      if (!isValidPlaylistId(playlist.playlistId)) {
        console.log(`      ⚠️  Skipping - invalid playlist type (auto-generated)`);
        continue;
      }

      // Process the playlist
      const result = await processPlaylist(
        playlist,
        approved,
        needsReview,
        rejected,
        discovered,
        totalTarget,
        currentCategories
      );
      if (result === 'target_reached' && approved.length >= totalTarget) {
        console.log(`\n🎉 Target reached! ${approved.length} playlists approved`);
        break;
      }

      // Small delay to avoid rate limits (longer for scraping)
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    if (approved.length >= totalTarget) break;

    // Delay between queries (longer for scraping to avoid detection)
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  return await finalizeBatch(
    discovered,
    approved,
    needsReview,
    rejected,
    skippedExisting,
    saveToFiles
  );
}

/**
 * Process a single playlist (extracted for reuse)
 */
async function processPlaylist(
  playlist,
  approved,
  needsReview,
  rejected,
  discovered,
  totalTarget = Infinity,
  categories = DEFAULT_CATEGORIES
) {
  // Fetch video titles and views from XML feed
  const feedData = await fetchPlaylistFeed(playlist.playlistId);
  const videoTitles = feedData.titles;
  const videoViews = feedData.views;
  const firstVideoId = feedData.firstVideoId;
  const actualVideoCount = feedData.totalCount;

  if (videoTitles.length === 0) {
    console.log(`      ⚠️  Skipping - no videos found in feed`);
    return 'skipped';
  }

  // Double-check minimum videos using actual feed count
  if (actualVideoCount < MIN_VIDEOS) {
    console.log(
      `      ⚠️  Skipping - only ${actualVideoCount} videos in feed (minimum: ${MIN_VIDEOS})`
    );
    return 'skipped';
  }

  // Use video thumbnail instead of playlist thumbnail
  if (firstVideoId) {
    playlist.thumbnail = `https://img.youtube.com/vi/${firstVideoId}/mqdefault.jpg`;
  }

  // Fetch channel statistics (skip if from web scraping - already high quality)
  let channelStats;
  if (playlist.source === 'scraping') {
    // Trust YouTube's ranking - skip API call
    console.log(`      🌐 From YouTube.com - trusting ranking (authority: 8.5)`);
    channelStats = {
      subscriberCount: 0, // Not needed
      isVerified: false, // Not needed
      authorityScore: 8.5, // Fixed high score for scraped results
    };
  } else {
    console.log(`      🔎 Fetching channel stats...`);
    channelStats = await fetchChannelStats(playlist.channelId);
    channelStats.authorityScore = calculateChannelAuthority(
      channelStats.subscriberCount,
      channelStats.isVerified
    );
    console.log(
      `      👥 Subscribers: ${channelStats.subscriberCount.toLocaleString()}${
        channelStats.isVerified ? ' ✓' : ''
      }`
    );
  }

  // Analyze with AI
  const analysis = await analyzePlaylistWithAI(playlist, videoTitles, categories);

  if (!analysis) {
    console.log(`      ❌ Skipping - analysis failed`);
    return 'failed';
  }

  // Calculate ranking
  const ranking = calculateRanking(analysis, channelStats, videoViews, playlist);

  const discoveredItem = {
    ...playlist,
    videoTitles,
    analysis,
    ranking,
    channelStats,
    discoveredAt: new Date().toISOString(),
  };

  discovered.push(discoveredItem);

  // Enhance tags for display and storage
  const enhancedTags = enhanceTags(
    analysis.tags,
    playlist.title,
    playlist.channelTitle,
    playlist.description
  );

  // Log analysis results
  console.log(`      🤖 AI Score: ${analysis.confidenceScore}/10`);
  console.log(`      ⭐ Ranking: ${ranking.score}/10`);
  console.log(
    `         • AI: ${ranking.factors.aiScore} | Authority: ${ranking.factors.channelAuthority} | Engagement: ${ranking.factors.engagement} | Fresh: ${ranking.factors.freshness}`
  );
  console.log(`      👶 Ages: ${analysis.ageMin}-${analysis.ageMax}`);
  console.log(`      📚 Category: ${analysis.category}`);
  console.log(`      🏷️  Tags: ${enhancedTags.join(', ')}`);
  if (enhancedTags.join(', ') !== analysis.tags.join(', ')) {
    console.log(`         (AI: ${analysis.tags.join(', ')})`);
  }

  // Use actual video count from feed (more accurate than API)
  const finalVideoCount = actualVideoCount || playlist.videoCount;

  if (analysis.isAppropriate && analysis.confidenceScore >= 8) {
    // Use fixed auto-approve score
    // Upload to Firebase with isApproved: true
    const uploaded = await uploadToFirebase(discoveredItem, finalVideoCount, true);
    if (uploaded) {
      approved.push(discoveredItem);
      console.log(`      ✅ AUTO-APPROVED & UPLOADED (isApproved: true)`);
    } else {
      console.log(`      ❌ Failed to upload to Firebase`);
    }
  } else if (analysis.isAppropriate && analysis.confidenceScore < 8) {
    // Upload but needs manual review (isApproved: false)
    const uploaded = await uploadToFirebase(discoveredItem, finalVideoCount, false);
    if (uploaded) {
      needsReview.push(discoveredItem);
      console.log(`      ⏳ NEEDS REVIEW - Uploaded (isApproved: false)`);
    }
  } else {
    // Rejected - DO NOT upload (discovery scan rejects completely)
    rejected.push(discoveredItem);
    console.log(`      ❌ REJECTED - Not uploaded (${analysis.reasoning})`);
  }

  return approved.length >= totalTarget ? 'target_reached' : 'continue';
}

/**
 * Finalize and save batch results
 */
async function finalizeBatch(
  discovered,
  approved,
  needsReview,
  rejected,
  skippedExisting,
  saveToFiles
) {
  // Save results to files (optional)
  if (saveToFiles) {
    const timestamp = new Date().toISOString().split('T')[0];
    const outputDir = path.join(__dirname, 'output');

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const discoveredPath = path.join(outputDir, `discovered-${timestamp}.json`);
    const approvedPath = path.join(outputDir, `approved-${timestamp}.json`);
    const needsReviewPath = path.join(outputDir, `needs-review-${timestamp}.json`);
    const rejectedPath = path.join(outputDir, `rejected-${timestamp}.json`);

    fs.writeFileSync(discoveredPath, JSON.stringify(discovered, null, 2));
    fs.writeFileSync(approvedPath, JSON.stringify(approved, null, 2));
    fs.writeFileSync(needsReviewPath, JSON.stringify(needsReview, null, 2));
    fs.writeFileSync(rejectedPath, JSON.stringify(rejected, null, 2));

    console.log(`\n📁 Files saved in: ${outputDir}`);
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 DISCOVERY COMPLETE');
  console.log('='.repeat(60));
  console.log(`✅ Approved (isApproved: true): ${approved.length} playlists`);
  console.log(`⏳ Needs Review (isApproved: false): ${needsReview.length} playlists`);
  console.log(`⏭️  Already Existed: ${skippedExisting} playlists`);
  console.log(`❌ Rejected (not uploaded): ${rejected.length} playlists`);
  console.log('='.repeat(60));
  console.log('💡 Note: Rejected playlists from invites are still stored for review');
  console.log('='.repeat(60));

  return { discovered, approved, needsReview, rejected, skippedExisting };
}

// CLI support
const { values } = parseArgs({
  options: {
    totalTarget: { type: 'string', default: '200' },
    autoApproveScore: { type: 'string', default: '8' },
    resultsPerQuery: { type: 'string', default: '20' },
    saveToFiles: { type: 'boolean', default: true },
    ageGroup: { type: 'string' },
    customQuery: { type: 'string', multiple: true },
    channelId: { type: 'string' },
    playlistIds: { type: 'string' },
  },
  strict: false,
});

const options = {
  totalTarget: parseInt(values.totalTarget),
  autoApproveScore: parseInt(values.autoApproveScore),
  resultsPerQuery: parseInt(values.resultsPerQuery),
  saveToFiles: values.saveToFiles,
  ageGroup: values.ageGroup,
  customQueries: values.customQuery || [],
  channelId: values.channelId,
  playlistIds: values.playlistIds ? values.playlistIds.split(',').map((id) => id.trim()) : [],
};

discoverPlaylists(options)
  .then(() => {
    console.log('\n✨ Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Error:', error);
    process.exit(1);
  });
