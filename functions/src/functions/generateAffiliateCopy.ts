import * as admin from 'firebase-admin';
import { onRequest } from 'firebase-functions/v2/https';
import axios from 'axios';
import { checkRateLimit } from '../utils/rateLimit';
import { getAffiliateDisplayFields } from '../utils/affiliateDisplay';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

type Format = 'blog' | 'social' | 'website' | 'email' | 'bio';
type Platform = 'instagram' | 'tiktok' | 'linkedin' | 'twitter' | 'facebook' | 'pinterest' | 'whatsapp';
type BlogLength = 'micro' | 'short' | 'news' | 'mid' | 'long';

const VALID_FORMATS: Format[] = ['blog', 'social', 'website', 'email', 'bio'];
const VALID_PLATFORMS: Platform[] = ['instagram', 'tiktok', 'linkedin', 'twitter', 'facebook', 'pinterest', 'whatsapp'];

const BLOG_LENGTH_SPEC: Record<BlogLength, { range: string; note: string }> = {
  micro: { range: '100-175 words', note: 'This is a micro post — one hook, one problem, one solution, one soft call to action. No structure headers needed. Punchy and opinionated.' },
  short: { range: '350-500 words', note: 'Standard short-form — get in, make a point, get out. Good for social shares.' },
  news: { range: '650-800 words', note: 'Journalism length — cover the story with enough depth to feel authoritative and link-worthy.' },
  mid:  { range: '1000-1400 words', note: 'Mid-form — go deep enough to actually solve something for the reader. More shares, fewer comments.' },
  long: { range: '2200-2800 words', note: 'Long-form, SEO-optimized — comprehensive, multiple angles, evergreen value. Use subheadings here.' },
};

function buildFormatInstruction(format: Format, platform?: Platform, blogLength?: BlogLength): string {
  if (format === 'blog') {
    const spec = BLOG_LENGTH_SPEC[blogLength ?? 'short'];
    if (blogLength === 'micro') {
      return `Write a micro blog post (${spec.range}) about Vidopick from the first-person perspective of the affiliate. ${spec.note}

Do NOT use subheadings or lists.
Aim to sound like something you'd actually publish, not a product blurb.`;
    }
    return `Write a complete blog post (${spec.range}) about Vidopick from the first-person perspective of the affiliate. ${spec.note}

Structure:
- An opening hook that does NOT start with "I" or "Are you" — start with a situation, an observation, or a specific moment
- 2-3 paragraphs about the problem: the specific frustration parents face with kids and YouTube (autoplay to random content, ads, inappropriate suggestions, rabbit holes)
- 2-3 paragraphs about how Vidopick actually solves it — be specific, not abstract
- A personal take or anecdote (can be brief)
- Short closing with a call to action — keep it low-key, not salesy

${blogLength === 'long' ? 'Use subheadings to organize the post.' : 'Do NOT use subheadings unless the post is naturally structured enough to benefit from them.'}
Do NOT write a listicle.
Aim to sound like a blog post you'd actually want to read, not a product announcement.`;
  }
  if (format === 'social') {
    const p = platform ?? 'instagram';
    if (p === 'instagram') return `Write an Instagram caption (under 150 characters, no hashtags in the count). Personal, direct, sounds like something you'd actually post. No "Check this out!" or "So excited to share". No hashtag spam — max 3 relevant hashtags at the end if any.`;
    if (p === 'tiktok') return `Write a TikTok caption (under 100 characters). Punchy and direct. Sounds like a person, not a brand. Skip the hashtags in the main text.`;
    if (p === 'linkedin') return `Write a LinkedIn post (150-250 words). Three short paragraphs. Professional but conversational — the kind of thing a person would actually write, not a company. No "I'm thrilled to announce", no buzzwords, no excessive hashtags. End with a question or observation, not a sales pitch.`;
    if (p === 'twitter') return `Write a tweet (under 240 characters including spaces). Casual and direct. No hashtag spam. Can be a take, a recommendation, or an observation. Sounds like a real person tweeting, not a brand account.`;
    if (p === 'facebook') return `Write a Facebook post (100-200 words). Warm and conversational — the kind of thing a real parent would share with their community group. One short opening line to hook, then 2-3 sentences of context, then a soft recommendation. No hashtag spam — one or two at most if they fit naturally.`;
    if (p === 'pinterest') return `Write a Pinterest pin description (under 150 characters for the title, then 2-3 sentences for the body). The title should be search-friendly and descriptive. The body should be practical and specific — what will someone find or get by following the link. Hashtags optional, keep to 2-3 niche ones if used.`;
    if (p === 'whatsapp') return `Write a WhatsApp message (2-4 short sentences) to share with a parent group or friend. Casual and personal, like you're texting someone you know. No hashtags. No formatting. Just a natural recommendation a real person would forward.`;
  }
  if (format === 'website') {
    return `Write website copy (60-90 words) for a "Tools I recommend" or "Resources" sidebar section. One or two short paragraphs. Say what Vidopick is, why you recommend it, and include a soft call to action. No lists. No bullet points. No "It's available on iOS and Android" as a standalone filler sentence — only mention the platforms if it flows naturally.`;
  }
  if (format === 'email') {
    return `Write a paragraph (80-120 words) to be dropped into the middle of an existing email newsletter — NOT a standalone email.

Critical rules:
- Do NOT start with a greeting ("Hi", "Hey", "Hello", "Hi there")
- Do NOT write a sign-off or "P.S."
- Write it as if the person is sharing something mid-newsletter, as a natural aside or recommendation
- First person, direct, genuine
- The reader is already subscribed to this newsletter — skip pleasantries
- No "I just wanted to share", "I came across", or "I thought you might like"`;
  }
  if (format === 'bio') {
    return `Write 1-2 sentences (under 50 words) the affiliate can add to their social bio or website "about" section mentioning they partner with or recommend Vidopick. Should feel like a natural addition, not a forced plug. Like something you'd see at the bottom of a real person's bio.`;
  }
  return '';
}

export const generateAffiliateCopy = onRequest(
  { cors: true, region: 'us-central1', timeoutSeconds: 60, memory: '256MiB' },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    let uid: string;
    let callerIsAdmin = false;
    try {
      const decoded = await admin.auth().verifyIdToken(authHeader.split('Bearer ')[1]);
      uid = decoded.uid;
      callerIsAdmin = decoded['role'] === 'admin';
    } catch {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }

    const { format, platform, blogLength, instructions: userInstructions, affiliateId } = req.body as {
      format: Format;
      platform?: Platform;
      blogLength?: BlogLength;
      instructions?: { title: string; description: string }[];
      affiliateId?: string;
    };

    const safeInstructions = Array.isArray(userInstructions)
      ? userInstructions
          .filter(i => i && typeof i.title === 'string' && typeof i.description === 'string')
          .slice(0, 10)
          .map(i => ({ title: i.title.slice(0, 100), description: i.description.slice(0, 500) }))
      : [];

    if (!format || !VALID_FORMATS.includes(format)) {
      res.status(400).json({ error: 'Invalid format' });
      return;
    }
    if (format === 'social' && platform && !VALID_PLATFORMS.includes(platform)) {
      res.status(400).json({ error: 'Invalid platform' });
      return;
    }

    if (!(await checkRateLimit(`copy_${uid}`, 20))) {
      res.status(429).json({ error: 'Too many requests. Please try again later.' });
      return;
    }

    let affiliate: FirebaseFirestore.DocumentData;
    let resolvedAffiliateId: string;
    if (affiliateId) {
      if (!callerIsAdmin) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      const affiliateDoc = await db.collection('affiliates').doc(affiliateId).get();
      if (!affiliateDoc.exists || affiliateDoc.data()?.type !== 'influencer') {
        res.status(404).json({ error: 'Affiliate not found' });
        return;
      }
      affiliate = affiliateDoc.data()!;
      resolvedAffiliateId = affiliateDoc.id;
    } else {
      const affiliateSnap = await db
        .collection('affiliates')
        .where('authUid', '==', uid)
        .where('type', '==', 'influencer')
        .limit(1)
        .get();
      if (affiliateSnap.empty) {
        res.status(404).json({ error: 'Affiliate not found' });
        return;
      }
      affiliate = affiliateSnap.docs[0].data();
      resolvedAffiliateId = affiliateSnap.docs[0].id;
    }

    if (!OPENAI_API_KEY) {
      res.status(500).json({ error: 'AI service unavailable' });
      return;
    }

    // name/website/bio live in public/profile since the root-doc strip migration;
    // websiteSummary/websiteKeywords still live on the root doc.
    const display = await getAffiliateDisplayFields(db, resolvedAffiliateId);
    const contextLines: string[] = [];
    if (display.name) contextLines.push(`The affiliate's name is ${display.name}.`);
    if (display.website) contextLines.push(`Their website: ${display.website}`);
    if (display.bio) contextLines.push(`In their own words: ${display.bio}`);
    if (affiliate.websiteSummary) contextLines.push(`About them (from website analysis): ${affiliate.websiteSummary}`);
    if (affiliate.websiteKeywords?.length) {
      contextLines.push(`Their audience/focus: ${(affiliate.websiteKeywords as string[]).join(', ')}`);
    }
    const formatInstruction = buildFormatInstruction(format, platform, blogLength);

    const userPrompt = [
      contextLines.length > 0 ? contextLines.join('\n') : '',
      contextLines.length > 0 ? '' : '',
      `About Vidopick:
Vidopick is an app for parents who are tired of handing their kid a phone and watching them disappear into YouTube's autoplay rabbit hole. The way it works: the parent curates playlists from YouTube, and the kid only sees what the parent picked. No autoplay to random videos, no ads between clips, no suggestions sidebar leading somewhere else. The parent builds the playlist once; the kid watches it in a closed loop.

It's primarily for younger kids. Parents use it to set up educational content, shows their kids love, or a mix. The app is on iOS and Android. There's a free tier and a paid Pro plan.

The specific problem it solves: most parental controls block content or add friction for the parent. Vidopick flips it — instead of blocking bad stuff, you just pre-select the good stuff. The kid gets a clean, simple interface with only what you've approved.`,
      '',
      formatInstruction,
      ...(safeInstructions.length > 0 ? [
        '',
        'The affiliate has attached the following instructions — apply all of them across every variation:',
        ...safeInstructions.map(i => `- ${i.title}: ${i.description}`),
      ] : []),
      '',
      format === 'social'
        ? 'Generate exactly 3 distinct variations. Each should take a meaningfully different angle or voice — not just the same content rearranged. Return JSON: { "variations": [string, string, string] }'
        : 'Write exactly 1 variation. Return JSON: { "variations": [string] }',
    ].filter(Boolean).join('\n');

    const aiResponse = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `You write promotional copy for affiliate partners. Your job is to write like a real person, not like a content marketer.

HARD RULES — these apply to every single word of output, no exceptions:
- NEVER use em dashes (—) or en dashes (–). Replace with a comma or split into two sentences.
- NEVER use curly/smart quotes. Use plain ASCII apostrophes and quote marks only.

Banned phrases and patterns — never use these:
- "Hi there", "Hey there", "Hello!" as openers
- "super [adjective]" (super easy, super accessible, super helpful)
- "worth checking out", "check it out", "worth a look"
- "peace of mind"
- "aligns with our values" / "aligns with your values"
- "big win"
- "makes it easy"
- "curated content"
- "game-changer", "delve", "harness", "elevate", "seamless", "dive in", "unleash", "transformative", "leverage"
- Feature lists phrased as "It's X, Y, and Z, making it the perfect..."
- Ending with "It's available on iOS and Android!" as a filler closer
- Multiple exclamation marks across a single variation

Brand rules:
- The app is always called "Vidopick" — this exact spelling, every time. Never "VidoPick", "Videopick", "Video Pick", "vidopick" (lowercase), or any other form.
- Every variation must mention Vidopick by name at least once.

Tone rules:
- Short sentences. One idea per sentence.
- Casual but credible. Specific over general. Personal over polished.
- Write like you're telling a friend about something, not writing ad copy.`,
          },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.8,
        response_format: { type: 'json_object' },
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
      }
    );

    const result = JSON.parse(aiResponse.data.choices[0].message.content);

    // Post-process: the model ignores the no-em-dash rule often enough that we enforce it here.
    // ` — ` → `, `   bare `—` or `–` → `, `
    const sanitize = (s: string) =>
      s.replace(/\s*[—–]\s*/g, ', ').replace(/,\s*,/g, ',').trim();

    const variations = (result.variations ?? []).map((v: unknown) =>
      typeof v === 'string' ? sanitize(v) : v
    );

    res.status(200).json({ variations });
  }
);
