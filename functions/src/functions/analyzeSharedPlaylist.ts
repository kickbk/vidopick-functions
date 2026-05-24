import * as admin from 'firebase-admin';
import { onRequest } from 'firebase-functions/v2/https';
import { Resend } from 'resend';
import axios from 'axios';

// 1. Initialize Firestore
if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

// --- CONFIGURATION ---
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
// const MIN_VIDEOS = 5;

// --- HELPER DATA ---
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

// --- HELPERS ---

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
  description: string = ''
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
  if (avg > 1000000) return 10;
  if (avg > 500000) return 9;
  if (avg > 100000) return 8;
  if (avg > 10000) return 7;
  return 6;
}

async function fetchPlaylistFromApi(playlistId: string): Promise<any> {
  if (!YOUTUBE_API_KEY) throw new Error('Missing YOUTUBE_API_KEY');

  const [playlistRes, itemsRes] = await Promise.all([
    axios.get('https://www.googleapis.com/youtube/v3/playlists', {
      params: { part: 'snippet,contentDetails', id: playlistId, key: YOUTUBE_API_KEY },
      timeout: 8000,
    }),
    axios.get('https://www.googleapis.com/youtube/v3/playlistItems', {
      params: { part: 'snippet', playlistId, maxResults: 10, key: YOUTUBE_API_KEY },
      timeout: 8000,
    }),
  ]);

  const playlist = playlistRes.data.items?.[0];
  if (!playlist) throw new Error('PLAYLIST_NOT_FOUND');

  const snippet = playlist.snippet;
  const videoItems: any[] = itemsRes.data.items ?? [];
  const videoTitles = videoItems.map((item: any) => item.snippet?.title).filter(Boolean);
  const firstVideoId = videoItems[0]?.snippet?.resourceId?.videoId ?? null;

  return {
    id: playlistId,
    title: decodeHtmlEntities(snippet.title ?? 'Unknown Playlist'),
    author: decodeHtmlEntities(snippet.channelTitle ?? 'YouTube Channel'),
    channelId: snippet.channelId ?? null,
    videoTitles,
    videoViews: [],
    firstVideoId,
    totalCount: playlist.contentDetails?.itemCount ?? videoTitles.length,
  };
}

async function fetchPlaylistXml(playlistId: string): Promise<any> {
  const url = `https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistId}`;
  try {
    const response = await axios.get(url, { timeout: 8000 });
    const xml = response.data;
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
    if (error.response?.status === 404) {
      // RSS feed doesn't serve unlisted playlists — fall back to YouTube Data API
      return fetchPlaylistFromApi(playlistId);
    }
    throw error;
  }
}

async function sendModerationEmail(playlistData: any) {
  if (!RESEND_API_KEY) {
    console.warn('[email] RESEND_API_KEY not set, skipping');
    return;
  }

  const resend = new Resend(RESEND_API_KEY);
  try {
    await resend.emails.send({
      from: 'Vidopick <hello@vidopick.com>',
      to: 'hello@vidopick.com',
      subject: `📝 New Playlist Submitted: "${playlistData.title}"`,
      html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #ddd; border-radius: 8px; padding: 20px;">
        <h2 style="color: #2c3e50; margin-top: 0;">New Playlist Submission</h2>
        <p>A user shared a new playlist via the Vidopick app. It has been saved but requires approval.</p>

        <div style="background-color: #f8f9fa; padding: 15px; border-radius: 6px; margin: 20px 0;">
          <h3 style="margin: 0 0 10px 0;">${playlistData.title}</h3>
          <p style="margin: 5px 0;"><strong>Author:</strong> ${playlistData.author}</p>
          <p style="margin: 5px 0;"><strong>Videos:</strong> ${playlistData.videoCount}</p>
          <p style="margin: 5px 0;"><strong>AI Score:</strong> ${playlistData.ranking.factors.aiScore}/10</p>
          <p style="margin: 5px 0;"><strong>Tags:</strong> ${playlistData.tags.join(', ')}</p>
          <p style="margin: 5px 0;"><strong>ID:</strong> ${playlistData.id}</p>
        </div>

        <div style="text-align: center; margin: 25px 0;">
          <a href="https://www.youtube.com/playlist?list=${playlistData.id}" style="background-color: #e74c3c; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; margin-right: 10px;">View on YouTube</a>
          <a href="https://console.firebase.google.com/u/0/project/${process.env.GCLOUD_PROJECT}/firestore/data/~2FscannedPlaylists~2F${playlistData.id}" style="background-color: #3498db; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Manage in Firestore</a>
        </div>

        <p style="color: #7f8c8d; font-size: 12px; margin-top: 20px;">
          This playlist is currently set to <strong>isApproved: false</strong>. Users can see it in their personal library, but it won't appear in public discovery until approved.
        </p>
      </div>
    `,
    });
    console.log('Moderation email sent successfully');
  } catch (error) {
    console.error('Failed to send moderation email:', error);
  }
}

// --- MAIN FUNCTION ---

export const analyzeSharedPlaylist = onRequest(
  {
    cors: true,
    region: 'us-central1',
    timeoutSeconds: 60,
  },
  async (request, response) => {
    if (request.method !== 'POST') {
      response.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const { playlistId } = request.body;
    if (!playlistId) {
      response.status(400).json({ error: 'Missing playlistId' });
      return;
    }

    console.log(`Processing shared playlist: ${playlistId}`);

    try {
      // Check scannedPlaylists — covers both approved and previously-scanned records
      const existingSnap = await db.collection('scannedPlaylists').doc(playlistId).get();
      if (existingSnap.exists) {
        console.log(`[analyzeSharedPlaylist] found in scannedPlaylists, returning cached`);
        response.status(200).json(existingSnap.data());
        return;
      }

      // 1. Fetch & Analyze
      const data = await fetchPlaylistXml(playlistId);
      // We don't want to limit by number of videos. We will not approve small lists, but allow them to be added.
      // if (data.totalCount < MIN_VIDEOS) {
      //   response.status(400).json({
      //     error: `Playlist has too few videos (${data.totalCount}). Minimum required is ${MIN_VIDEOS}.`
      //   });
      //   return;
      // }

      if (!OPENAI_API_KEY) throw new Error('Missing OpenAI API Key');

      // 2. OpenAI Analysis (Consistent Prompt)
      const videoTitlesText = data.videoTitles
        .slice(0, 10)
        .map((t: string, i: number) => `${i + 1}. ${t}`)
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
  "categories": ["Category1"] or ["Category1", "Category2"],
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "languages": ["<detected language>"],
  "briefDescription": "1-2 sentence description",
  "reasoning": "Brief explanation"
}
IMPORTANT for categories field: always return an array. Use values from this list when possible: ["Educational","Music","Stories","Animation","Art & Crafts","Dance & Fitness","Health & Wellness","Language","Entertainment"]. Prefer existing categories — only use a new value if the content is genuinely distinct. 1 category is ideal, 2 if truly both apply.
IMPORTANT for languages field: always return an array. Rules: (1) Explicit labels like "English Song" or "Spanish Version" in a title are definitive. (2) If the majority of titles share a language, do not add a second language from SEO keywords appended to just one title. (3) Non-English words that form the main part of titles are a strong signal. Never use "Multiple" — list the actual language names. Tags should be concise themes.`;

      const aiResponse = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content:
                'You analyze kids content. Provide specific but concise tags about content themes. Avoid character names but keep meaningful context.',
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

      // 3. Enhance & Rank
      const enhancedTags = enhanceTags(aiResult.tags, data.title, data.author, '');
      const engagement = calculateEngagementScore(data.videoViews);
      const aiScore = aiResult.confidenceScore || 5;
      const channelAuthority = 5; // Default for shared content without deep analysis
      const rankingScore =
        Math.round((aiScore * 0.4 + channelAuthority * 0.3 + engagement * 0.2 + 0.7) * 10) / 10;

      const thumbnail = data.firstVideoId
        ? `https://img.youtube.com/vi/${data.firstVideoId}/mqdefault.jpg`
        : '';
      const authorUrl = data.channelId
        ? `https://www.youtube.com/channel/${data.channelId}`
        : `https://www.youtube.com/results?search_query=${encodeURIComponent(data.author)}`;

      // 4. Construct Result
      const result = {
        id: playlistId,
        title: data.title,
        thumbnail: thumbnail,
        author: data.author,
        authorUrl: authorUrl,
        ageMin: aiResult.ageMin,
        ageMax: aiResult.ageMax,
        tags: enhancedTags,
        categories: Array.isArray(aiResult.categories)
          ? aiResult.categories
          : [aiResult.categories || aiResult.category || 'Entertainment'],
        languages: Array.isArray(aiResult.languages)
          ? aiResult.languages
          : [aiResult.languages || aiResult.language || 'English'],
        description: aiResult.briefDescription || 'No description available',
        sourceUrl: `https://www.youtube.com/playlist?list=${playlistId}`,
        ranking: {
          score: rankingScore,
          boost: 0,
          factors: { aiScore, channelAuthority, engagement, freshness: 7 },
        },
        channelSubscribers: 0, // Placeholder
        channelVerified: false,

        isAppropriate: aiResult.isAppropriate,
        isApproved: false,
        reviewedBy: 'pending',
        reviewedAt: new Date().toISOString(),

        scannedAt: new Date().toISOString(),
        scannedBy: 'share',
        updatedAt: new Date().toISOString(),

        videoCount: data.totalCount,
        importCount: 1,
        likes: 0,
      };

      // 5. Save to scannedPlaylists with isApproved: false (pending admin review) & Notify
      if (result.isAppropriate) {
        await db.collection('scannedPlaylists').doc(playlistId).set(result);
        console.log(
          `[analyzeSharedPlaylist] saved ${playlistId} to scannedPlaylists (pending review)`
        );

        // Fire & Forget Email Notification (don't block response)
        sendModerationEmail(result).catch((e) => console.error('Email failed', e));
      } else {
        console.log(
          `[analyzeSharedPlaylist] playlist ${playlistId} flagged as inappropriate, not saving`
        );
      }

      response.status(200).json(result);
    } catch (error: any) {
      console.error('Error analyzing playlist:', error);
      if (error.message === 'PLAYLIST_NOT_FOUND') {
        response
          .status(404)
          .json({ error: 'Playlist not found on YouTube. It might be private or deleted.' });
      } else {
        response.status(500).json({ error: 'Failed to analyze playlist', details: error.message });
      }
    }
  }
);
