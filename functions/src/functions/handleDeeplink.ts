// Short-link redirector: https://vpk.to/:id
import express from 'express';
import * as admin from 'firebase-admin';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/v2/https';

if (!getApps().length) initializeApp();

const db = getFirestore();
const app = express();

// Ensure req.protocol / req.get('host') reflect the original client request behind proxies/CDNs
app.set('trust proxy', true);

// --- Origins & defaults ---
const VIDOPICK_ORIGIN = 'https://vidopick.com'; // main site (hosts OG images)
const DEFAULT_OG_IMAGE = `${VIDOPICK_ORIGIN}/images/vidopick-og.jpg`; // unified default (JPEG)

// UA helpers
const BOT_UA_KEYWORDS = [
  'facebookexternalhit', // Facebook/Meta crawler (Messenger & WhatsApp)
  'Twitterbot',
  'Slackbot',
  'LinkedInBot',
  'Discordbot',
  'TelegramBot',
  'Applebot',
  'Google-Structured-Data',
  'WhatsAppBot',
  'WhatsApp',
];

const ERROR_PAGES = {
  notFound: `${VIDOPICK_ORIGIN}/invite/not-found`,
  expired: `${VIDOPICK_ORIGIN}/invite/expired`,
};

const isBotUA = (ua: string): boolean =>
  BOT_UA_KEYWORDS.some((bot) => ua?.toLowerCase().includes(bot.toLowerCase()));

const isIOS = (ua: string) => /iPhone|iPad|iPod|iOS/i.test(ua);
const isAndroid = (ua: string) => /Android/i.test(ua);

// Helpers
const escapeHtml = (str: string) =>
  String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const clip = (s: string | undefined, n: number) => {
  if (!s) return s;
  const t = String(s).trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
};

// Turn possibly-relative into absolute, anchored to vidopick.com.
// - If missing -> default JPG on vidopick.com
// - If already absolute -> return as-is
// - If relative -> resolve against VIDOPICK_ORIGIN
const toAbs = (url?: string) => {
  if (!url) return DEFAULT_OG_IMAGE;
  if (/^https?:\/\//i.test(url)) return url;
  return `${VIDOPICK_ORIGIN}${url.startsWith('/') ? '' : '/'}${url}`;
};

const appendParams = (baseUrl: string | null | undefined, qs: string) => {
  if (!baseUrl) return null;
  if (!qs) return baseUrl;
  return baseUrl.includes('?') ? `${baseUrl}&${qs}` : `${baseUrl}?${qs}`;
};

const withPlayReferrer = (playUrl: string, payload: Record<string, string>): string => {
  const u = new URL(playUrl);
  const ref = new URLSearchParams(payload).toString();
  u.searchParams.set('referrer', ref); // ✅ Single encoding only
  return u.toString();
};

// OG resolver: chooses title/description/image; ensures image is absolute via toAbs()
function resolveOg(data: any) {
  const meta = data?.meta ?? {};
  const inviterName = data?.params?.name;
  const userCustomTitle = data?.meta?.ogTitle;
  const userCustomDescription = data?.meta?.ogDescription;
  const template: 'invite' | 'profile' | 'generic' =
    meta.template || data?.template || (inviterName ? 'invite' : 'generic');

  const inviteTail =
    'to try Vidopick, the child-safe video player where parents select YouTube playlists for kids to watch safely on their own.';

  let ogTitle: string | undefined;
  let ogDescription: string | undefined;
  let ogImage: string | undefined;

  if (template === 'invite') {
    ogTitle = meta.ogTitle || data?.linkTitle || 'Vidopick — the child-safe video player';
    ogDescription =
      meta.ogDescription ||
      (inviterName ? `${inviterName} invites you ${inviteTail}` : `You're invited ${inviteTail}`);
    ogImage = meta.ogImage || DEFAULT_OG_IMAGE;
  } else if (template === 'profile') {
    const username = data?.params?.username || data?.params?.handle || inviterName || 'User';
    ogTitle = meta.ogTitle || `${username} on Vidopick`;
    ogDescription = meta.ogDescription || `Explore ${username}'s playlists on Vidopick.`;
    ogImage = meta.ogImage || DEFAULT_OG_IMAGE;
  } else {
    ogTitle = meta.ogTitle || data?.linkTitle || 'Vidopick';
    ogDescription =
      meta.ogDescription ||
      'Vidopick lets parents pick YouTube playlists kids can safely watch on their own.';
    ogImage = meta.ogImage || DEFAULT_OG_IMAGE;
  }

  ogTitle = clip(ogTitle, 80) || 'Vidopick';
  ogDescription = clip(ogDescription, 200) || '';
  ogImage = toAbs(ogImage);

  return {
    ogTitle,
    ogDescription,
    ogImage,
    title: userCustomTitle,
    description: userCustomDescription,
  };
}

// Defensive playlist count derivation
function derivePlaylistCount(data: any): number {
  const clamp = (n: number) => Math.max(0, Math.min(99, n | 0));

  const psRaw = data?.params?.ps ?? data?.ps;
  if (psRaw !== undefined && psRaw !== null && !Number.isNaN(Number(psRaw))) {
    return clamp(Number(psRaw));
  }

  const candidates = [
    data?.params?.playlists,
    data?.playlists,
    data?.params?.lists,
    data?.lists,
    data?.params?.playlistItems?.items,
    data?.playlistItems?.items,
  ];

  for (const c of candidates) {
    if (Array.isArray(c)) return clamp(c.length);
    if (c && typeof c === 'object' && Array.isArray((c as any).items)) {
      return clamp((c as any).items.length);
    }
  }

  return 0;
}

// Rollup only (no per-click docs)
function rollupClick(id: string, platform: 'ios' | 'android' | 'desktop') {
  db.collection('shortLinks')
    .doc(id)
    .set(
      {
        analytics: {
          clicks: {
            total: admin.firestore.FieldValue.increment(1),
            byPlatform: { [platform]: admin.firestore.FieldValue.increment(1) }, // fixed key
            lastClickAt: admin.firestore.FieldValue.serverTimestamp(),
          },
        },
      },
      { merge: true }
    )
    .catch((e) => console.warn('click analytics update failed', e));
}

// --- Route ---
app.get('/:id', async (req, res) => {
  const { id } = req.params;
  const ua = String(req.headers['user-agent'] || '');

  try {
    const doc = await db.collection('shortLinks').doc(id).get();
    if (!doc.exists) {
      return res.redirect(302, `${ERROR_PAGES.notFound}?id=${encodeURIComponent(id)}`);
    }

    const data = doc.data() || {};
    const { ogTitle, ogDescription, ogImage, title, description } = resolveOg(data);

    // TTL
    const ttl = (data as any).ttl;
    if (ttl && typeof ttl.toMillis === 'function' && Date.now() > ttl.toMillis()) {
      return res.redirect(302, `${ERROR_PAGES.expired}?id=${encodeURIComponent(id)}`);
    }

    const device: 'ios' | 'android' | 'desktop' = isIOS(ua)
      ? 'ios'
      : isAndroid(ua)
      ? 'android'
      : 'desktop';

    // Derive playlist count for /get
    const ps = derivePlaylistCount(data); // 0..99

    // Params for /get — omit non-primitives to avoid bloating the URL
    const paramsObj: Record<string, string> = {
      ogTitle,
      ogDescription,
      ogImage, // already absolute from resolveOg()
      id,
      device,
      ps: String(ps),
      ...(title && { title }),
      ...(description && { desc: description }),
      ...(ttl && typeof ttl.toMillis === 'function' && { ttl: String(ttl.toMillis()) }),
    };
    const rawParams = (data as any)?.params || {};
    for (const [k, v] of Object.entries(rawParams)) {
      if (v === undefined || v === null) continue;
      const t = typeof v;
      if (t === 'string' || t === 'number' || t === 'boolean') {
        if (k === 'ps') continue; // keep derived ps
        paramsObj[k] = String(v);
      }
      // Arrays/objects (e.g., playlists) are intentionally not added to the querystring.
    }

    const qs = new URLSearchParams(paramsObj).toString();
    const landing = `https://vidopick.com/get${qs ? `?${qs}` : ''}`;

    const r = (data as any)?.redirect || {};
    const webOnly = !!r.webOnly;
    const iosUrl = r.ios || null;
    const androidUrl = r.android || null;
    const desktopUrl = r.desktop || 'https://vidopick.com/get';

    // ---- Bot vs Human detection ----
    const isHumanNav = req.headers['sec-fetch-user'] === '?1'; // present on real navigations
    const secPurpose = String(req.headers['sec-purpose'] || req.headers['purpose'] || '');
    const isPrefetch =
      secPurpose.includes('prefetch') ||
      req.headers['sec-fetch-mode'] === 'prefetch' ||
      req.method === 'HEAD';

    // Treat as bot if UA is a crawler OR it's a prefetch/head — UNLESS it's a real navigation
    const treatAsBot = !isHumanNav && (isBotUA(ua) || isPrefetch);

    // Bot: serve OG (no caching!)
    if (treatAsBot) {
      const shortHost = `${req.protocol}://${req.get('host')}`; // e.g., https://vpk.to
      const fullUrl = `${shortHost}${req.originalUrl}`;

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      // Do NOT cache the crawler HTML; also vary by headers that distinguish bots vs humans
      res.setHeader('Cache-Control', 'private, no-store, max-age=0');
      res.setHeader('Vary', 'User-Agent, Sec-Fetch-User, Sec-Purpose, Purpose');

      // Known-good social dimensions for 1200x630 JPG
      const OG_IMAGE_WIDTH = 1200;
      const OG_IMAGE_HEIGHT = 630;

      const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(ogTitle)}</title>
  <meta name="description" content="${escapeHtml(ogDescription)}" />
  <link rel="canonical" href="${escapeHtml(fullUrl)}" />
  <meta property="og:site_name" content="Vidopick" />
  <meta property="og:url" content="${escapeHtml(fullUrl)}" />
  <meta property="og:title" content="${escapeHtml(ogTitle)}" />
  <meta property="og:description" content="${escapeHtml(ogDescription)}" />
  <meta property="og:image" content="${escapeHtml(ogImage)}" />
  <meta property="og:image:secure_url" content="${escapeHtml(ogImage)}" />
  <meta property="og:image:width" content="${OG_IMAGE_WIDTH}" />
  <meta property="og:image:height" content="${OG_IMAGE_HEIGHT}" />
  <meta property="og:image:type" content="image/jpeg" />
  <meta property="og:image:alt" content="Vidopick preview" />
  <meta property="og:type" content="website" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(ogTitle)}" />
  <meta name="twitter:description" content="${escapeHtml(ogDescription)}" />
  <meta name="twitter:image" content="${escapeHtml(ogImage)}" />
</head>
<body>
  <noscript><p>${escapeHtml(ogDescription)}</p></noscript>
  <!-- Optional human escape hatch in case of misclassification -->
  <p><a href="${escapeHtml(landing)}">Open Vidopick</a></p>
</body>
</html>`;
      return res.status(200).send(html);
    }

    // Human: first land on /get unless they've confirmed (?c=1)
    const wantsContinue = typeof (req.query as any).c !== 'undefined';
    if (!wantsContinue) return res.redirect(302, landing);

    // Continue → device-aware redirect + rollup
    let target: string;
    if (webOnly) {
      // roll up using actual device (not always desktop)
      void rollupClick(id, device);
      target = appendParams(desktopUrl, qs) || landing;
    } else if (isIOS(ua) && iosUrl) {
      void rollupClick(id, 'ios');
      target = iosUrl; // never append qs to iOS store
    } else if (isAndroid(ua) && androidUrl) {
      void rollupClick(id, 'android');
      const referrerPayload: Record<string, string> = {
        ...paramsObj, // All invite params
        src: 'dl',
        ts: String(Date.now()),
      };
      target = withPlayReferrer(androidUrl, referrerPayload);
    } else {
      void rollupClick(id, 'desktop');
      target = appendParams(desktopUrl, qs) || landing;
    }

    return res.redirect(302, target);
  } catch (err) {
    console.error('Redirect error:', err);
    return res.status(500).send('Internal server error');
  }
});

export const handleDeeplink = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 10,
    memory: '256MiB',
    invoker: 'public',
  },
  app
);
