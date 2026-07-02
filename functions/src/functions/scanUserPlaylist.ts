/**
 * scanUserPlaylist — HTTP endpoint (POST)
 *
 * Called by the mobile app when a user pastes a YouTube playlist URL/ID.
 * Returns rich metadata (tags, age range, categories, languages, description)
 * by checking our existing collections first, then running AI analysis.
 *
 * Auth: requires a valid Firebase ID token in the Authorization header.
 *
 * Request body: { playlistId: string }
 *
 * Response: full playlist document + { source: 'approved' | 'user' | 'new' }
 *
 * Lookup order:
 *   1. scannedPlaylists/{id}  isApproved: true  — approved library → return immediately
 *   2. scannedPlaylists/{id}  isApproved: false — already scanned → return + add uid
 *   3. Not found              → fetch YouTube XML + AI scan → write to scannedPlaylists (isApproved: false)
 *
 * scannedPlaylists document schema (unapproved):
 *   {id, title, thumbnail, author, authorUrl, ageMin, ageMax, tags, categories, languages,
 *    description, sourceUrl, ranking, videoCount, isAppropriate, isApproved: false,
 *    status: 'scanned' | 'flagged', reviewedBy: 'pending', scannedBy: 'user',
 *    scannedAt, updatedAt, submittedBy: string[], importCount, likes}
 */

import * as admin from 'firebase-admin';
import { onRequest } from 'firebase-functions/v2/https';
import { Resend } from 'resend';
import axios from 'axios';

import { checkRateLimit } from '../utils/rateLimit';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;

// ─── Shared helpers (mirrors analyzeSharedPlaylist.ts) ────────────────────────

const KNOWN_SHOWS = [
  'Bluey',
  'Peppa Pig',
  'Paw Patrol',
  'Cocomelon',
  'Blippi',
  'Sesame Street',
  'Mickey Mouse',
  'SpongeBob',
  'Pokemon',
  'Super Simple Songs',
  'Little Baby Bum',
  'Daniel Tiger',
  'PJ Masks',
  'Thomas & Friends',
  'Curious George',
];

function decodeHtmlEntities(text: string): string {
  if (!text) return '';
  const entities: { [key: string]: string } = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
  };
  return text.replace(/&(?:amp|lt|gt|quot|#39|apos);/g, (m) => entities[m] || m);
}

function extractShowName(title: string, channelTitle: string): string | null {
  const combined = `${title} ${channelTitle}`;
  for (const show of KNOWN_SHOWS) {
    if (combined.includes(show)) return show;
  }
  if (channelTitle.includes('Official')) {
    const match = channelTitle.match(/^([^-]+?)\s+(?:Official|OFFICIAL)/i);
    if (match) {
      const extracted = match[1].trim();
      if (extracted.length > 3 && !['Kids', 'Children', 'Baby'].includes(extracted)) {
        return extracted;
      }
    }
  }
  return null;
}

function detectContentType(title: string, description: string): string | null {
  const text = `${title} ${description}`.toLowerCase();
  if (text.match(/\b(song|songs|music|sing|lullaby|lullabies)\b/)) return 'songs';
  if (text.match(/\b(story|stories|storytime|tale|tales|bedtime)\b/)) return 'stories';
  if (text.match(/\b(compilation|collection|mix|hours)\b/)) return 'compilation';
  if (text.match(/\b(animated|animation|cartoon)\b/)) return 'animated';
  if (text.match(/\b(live.?action|real)\b/)) return 'live-action';
  return null;
}

function enhanceTags(
  aiTags: string[],
  title: string,
  channelTitle: string,
  description = ''
): string[] {
  const enhanced: string[] = [];
  const showName = extractShowName(title, channelTitle);
  if (showName) enhanced.push(showName);
  const contentType = detectContentType(title, description);
  if (contentType && !enhanced.includes(contentType)) enhanced.push(contentType);
  const genericTags = ['learning', 'fun', 'kids', 'children', 'educational'];
  const filteredAiTags = aiTags.filter((tag) => {
    const lower = tag.toLowerCase();
    if (enhanced.length >= 4 && genericTags.includes(lower)) return false;
    if (showName && lower === showName.toLowerCase()) return false;
    if (enhanced.some((existing) => existing.toLowerCase() === lower)) return false;
    return true;
  });
  enhanced.push(...filteredAiTags);
  return [...new Set(enhanced)].slice(0, 6);
}

function calculateEngagementScore(views: number[]): number {
  if (!views || views.length === 0) return 5;
  const avg = views.reduce((a, b) => a + b, 0) / views.length;
  if (avg > 1_000_000) return 10;
  if (avg > 500_000) return 9;
  if (avg > 100_000) return 8;
  if (avg > 10_000) return 7;
  return 6;
}

async function fetchPlaylistXml(playlistId: string): Promise<{
  id: string;
  title: string;
  author: string;
  channelId: string | null;
  videoTitles: string[];
  videoViews: number[];
  firstVideoId: string | null;
  totalCount: number;
}> {
  const url = `https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistId}`;
  try {
    const response = await axios.get(url, { timeout: 8000 });
    const xml: string = response.data;

    const mainTitleMatch = xml.match(/<title>(.*?)<\/title>/);
    const playlistTitle = mainTitleMatch
      ? decodeHtmlEntities(mainTitleMatch[1])
      : 'Unknown Playlist';
    const nameMatch = xml.match(/<name>(.*?)<\/name>/);
    const author = nameMatch ? decodeHtmlEntities(nameMatch[1]) : 'YouTube Channel';
    const channelIdMatch = xml.match(/\/channel\/(UC[\w-]+)/);
    const channelId = channelIdMatch ? channelIdMatch[1] : null;

    const videoTitles: string[] = [];
    const videoViews: number[] = [];
    let firstVideoId: string | null = null;

    const titleMatches = [...xml.matchAll(/<media:title>(.*?)<\/media:title>/g)];
    titleMatches.forEach((m) => videoTitles.push(decodeHtmlEntities(m[1])));

    const idMatches = [...xml.matchAll(/<yt:videoId>([a-zA-Z0-9_-]{11})<\/yt:videoId>/g)];
    if (idMatches.length > 0) firstVideoId = idMatches[0][1];

    const viewMatches = [...xml.matchAll(/<media:statistics views="(\d+)"\/>/g)];
    viewMatches.forEach((m) => videoViews.push(parseInt(m[1], 10)));

    return {
      id: playlistId,
      title: playlistTitle,
      author,
      channelId,
      videoTitles,
      videoViews,
      firstVideoId,
      totalCount: videoTitles.length,
    };
  } catch (error: any) {
    if (error.response?.status === 404) throw new Error('PLAYLIST_NOT_FOUND');
    throw error;
  }
}

async function sendModerationEmail(playlistData: {
  id: string;
  title: string;
  author: string;
  videoCount: number;
  ranking: { factors: { aiScore: number } };
  tags: string[];
}) {
  if (!RESEND_API_KEY) {
    console.warn('[email] RESEND_API_KEY not set, skipping');
    return;
  }
  const resend = new Resend(RESEND_API_KEY);
  await resend.emails
    .send({
      from: 'Vidopick <hello@vidopick.com>',
      to: 'notifications@vidopick.com',
      subject: `📱 User-Added Content: "${playlistData.title}"`,
      html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #ddd;border-radius:8px;padding:20px;">
        <h2 style="color:#2c3e50;margin-top:0;">User-Added Content (pending review)</h2>
        <p>A user imported a playlist or channel not yet in the approved library. It is saved in <strong>scannedPlaylists</strong> with <code>isApproved: false</code>.</p>
        <div style="background:#f8f9fa;padding:15px;border-radius:6px;margin:20px 0;">
          <h3 style="margin:0 0 10px 0;">${playlistData.title}</h3>
          <p style="margin:5px 0;"><strong>Author:</strong> ${playlistData.author}</p>
          <p style="margin:5px 0;"><strong>Videos:</strong> ${playlistData.videoCount}</p>
          <p style="margin:5px 0;"><strong>AI Score:</strong> ${playlistData.ranking.factors.aiScore}/10</p>
          <p style="margin:5px 0;"><strong>Tags:</strong> ${playlistData.tags.join(', ')}</p>
          <p style="margin:5px 0;"><strong>ID:</strong> ${playlistData.id}</p>
        </div>
        <div style="text-align:center;margin:25px 0;">
          <a href="https://www.youtube.com/playlist?list=${playlistData.id}" style="background:#e74c3c;color:white;padding:10px 20px;text-decoration:none;border-radius:5px;margin-right:10px;">View on YouTube</a>
          <a href="https://console.firebase.google.com/project/${process.env.GCLOUD_PROJECT}/firestore/data/~2FscannedPlaylists~2F${playlistData.id}" style="background:#3498db;color:white;padding:10px 20px;text-decoration:none;border-radius:5px;">View in Firestore</a>
        </div>
      </div>`,
    })
    .catch((e) => console.error('Moderation email failed:', e));
}

// ─── Main function ─────────────────────────────────────────────────────────────

export const scanUserPlaylist = onRequest(
  { cors: true, region: 'us-central1', timeoutSeconds: 60 },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    // Verify Firebase ID token
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    let uid: string;
    try {
      const decoded = await admin.auth().verifyIdToken(authHeader.split('Bearer ')[1]);
      uid = decoded.uid;
    } catch {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }

    const { playlistId } = req.body;
    if (!playlistId || typeof playlistId !== 'string') {
      res.status(400).json({ error: 'playlistId is required' });
      return;
    }

    // Each new scan costs an OpenAI + YouTube API call — cap per-user volume.
    if (!(await checkRateLimit(`scan_${uid}`, 20))) {
      res.status(429).json({ error: 'Too many scans. Please try again later.' });
      return;
    }

    console.log(`[scanUserPlaylist] uid=${uid} playlistId=${playlistId}`);

    try {
      // 1. Check scannedPlaylists — covers both approved and previously-scanned records
      const existingSnap = await db.collection('scannedPlaylists').doc(playlistId).get();
      if (existingSnap.exists) {
        console.log(
          `[scanUserPlaylist] found in scannedPlaylists (approved=${existingSnap.data()?.isApproved})`
        );
        // Record that this user submitted it
        await db
          .collection('scannedPlaylists')
          .doc(playlistId)
          .update({ submittedBy: admin.firestore.FieldValue.arrayUnion(uid) });
        res.status(200).json({
          source: existingSnap.data()?.isApproved ? 'approved' : 'scanned',
          ...existingSnap.data(),
        });
        return;
      }

      // 3. Not found — fetch + AI scan
      if (!OPENAI_API_KEY) {
        res.status(500).json({ error: 'AI service unavailable' });
        return;
      }

      const data = await fetchPlaylistXml(playlistId);

      const videoTitlesText = data.videoTitles
        .slice(0, 10)
        .map((t, i) => `${i + 1}. ${t}`)
        .join('\n');
      const prompt = `Analyze this YouTube playlist for children.
Playlist: ${data.title}
Channel: ${data.author}
First 10 video titles:
${videoTitlesText}
Respond with ONLY a JSON object (no markdown):
{
  "isAppropriate": true/false,
  "confidenceScore": 1-10,
  "ageMin": 0-12,
  "ageMax": 0-12,
  "categories": ["Category1"],
  "tags": ["tag1","tag2","tag3","tag4","tag5"],
  "languages": ["<detected language>"],
  "briefDescription": "1-2 sentence description",
  "reasoning": "Brief explanation"
}
IMPORTANT for categories: always return an array. Use: ["Educational","Music","Stories","Animation","Art & Crafts","Dance & Fitness","Health & Wellness","Language","Entertainment"]. 1 category ideal, 2 if truly both apply.
IMPORTANT for languages: always return an array. Rules: (1) Explicit labels like "English Song" or "Spanish Version" in a title are definitive. (2) If the majority of titles share a language, do not add a second language from SEO keywords appended to just one title. (3) Non-English words that form the main part of titles are a strong signal. Never use "Multiple" — list the actual language names.`;

      const aiResponse = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content:
                'You analyze kids content. Provide specific but concise tags about content themes.',
            },
            { role: 'user', content: prompt },
          ],
          temperature: 0.4,
          response_format: { type: 'json_object' },
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${OPENAI_API_KEY}`,
          },
        }
      );

      const aiResult = JSON.parse(aiResponse.data.choices[0].message.content);

      const enhancedTags = enhanceTags(aiResult.tags ?? [], data.title, data.author, '');
      const engagement = calculateEngagementScore(data.videoViews);
      const aiScore = aiResult.confidenceScore ?? 5;
      const channelAuthority = 5;
      const rankingScore =
        Math.round((aiScore * 0.4 + channelAuthority * 0.3 + engagement * 0.2 + 0.7) * 10) / 10;

      const thumbnail = data.firstVideoId
        ? `https://img.youtube.com/vi/${data.firstVideoId}/mqdefault.jpg`
        : '';
      const authorUrl = data.channelId
        ? `https://www.youtube.com/channel/${data.channelId}`
        : `https://www.youtube.com/results?search_query=${encodeURIComponent(data.author)}`;

      const now = new Date().toISOString();
      const result = {
        id: playlistId,
        title: data.title,
        thumbnail,
        author: data.author,
        authorUrl,
        ageMin: aiResult.ageMin ?? 0,
        ageMax: aiResult.ageMax ?? 12,
        tags: enhancedTags,
        categories: Array.isArray(aiResult.categories)
          ? aiResult.categories
          : [aiResult.categories ?? 'Entertainment'],
        languages: Array.isArray(aiResult.languages)
          ? aiResult.languages
          : [aiResult.languages ?? 'English'],
        description: aiResult.briefDescription ?? '',
        sourceUrl: `https://www.youtube.com/playlist?list=${playlistId}`,
        ranking: {
          score: rankingScore,
          boost: 0,
          factors: { aiScore, channelAuthority, engagement, freshness: 7 },
        },
        videoCount: data.totalCount,
        isAppropriate: aiResult.isAppropriate ?? true,
        type: playlistId.startsWith('UU') ? 'channel' : 'playlist',
        isApproved: false,
        status: (aiResult.isAppropriate ?? true) ? 'scanned' : 'flagged',
        reviewedBy: 'pending',
        scannedBy: 'user',
        scannedAt: now,
        updatedAt: now,
        submittedBy: [uid],
        importCount: 1,
        likes: 0,
      };

      await db.collection('scannedPlaylists').doc(playlistId).set(result);
      console.log(`[scanUserPlaylist] saved to scannedPlaylists status=${result.status}`);

      // Fire-and-forget moderation email
      sendModerationEmail(result).catch((e) =>
        console.warn('[scanUserPlaylist] moderation email failed:', e)
      );

      res.status(200).json({ source: 'new', ...result });
    } catch (error: any) {
      console.error('[scanUserPlaylist] error:', error);
      const itemLabel = playlistId.startsWith('UU') ? 'Channel' : 'Playlist';
      if (error.message === 'PLAYLIST_NOT_FOUND') {
        res
          .status(404)
          .json({ error: `${itemLabel} not found on YouTube. It may be private or deleted.` });
      } else {
        res.status(500).json({ error: `Failed to scan ${itemLabel.toLowerCase()}`, details: error.message });
      }
    }
  }
);
