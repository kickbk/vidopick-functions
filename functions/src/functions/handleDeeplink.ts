// Short-link redirector: https://vpk.to/:id
import express from 'express';
import * as admin from 'firebase-admin';
import QRCode from 'qrcode';
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

  const inviteTail =
    'to try Vidopick, the child-safe video player where parents select YouTube playlists for kids to watch safely on their own.';

  let ogTitle: string | undefined;
  let ogDescription: string | undefined;
  let ogImage: string | undefined;

  // Profile follow invites get distinct OG copy — no email exposed
  const profileData = data?.params?.profile as { displayName?: string; name?: string } | undefined;
  if (profileData) {
    const profileName = profileData.displayName || profileData.name || 'Profile';
    ogTitle = meta.ogTitle || `You're invited to follow ${profileName} on Vidopick`;
    ogDescription =
      meta.ogDescription ||
      `${profileName} shared their curated playlists with you on Vidopick — the child-safe video player.`;
    ogImage = meta.ogImage || DEFAULT_OG_IMAGE;
  } else {
    const template: 'invite' | 'profile' | 'generic' =
      meta.template || data?.template || (inviterName ? 'invite' : 'generic');
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
async function rollupClick(id: string, platform: 'ios' | 'android' | 'desktop', affiliateId?: string) {
  const date = new Date().toISOString().slice(0, 10);

  // Always update the shortlink counter
  try {
    await db.collection('shortLinks').doc(id).set(
      {
        analytics: {
          clicks: {
            total: admin.firestore.FieldValue.increment(1),
            byPlatform: { [platform]: admin.firestore.FieldValue.increment(1) },
            lastClickAt: admin.firestore.FieldValue.serverTimestamp(),
          },
        },
      },
      { merge: true }
    );
  } catch (e) {
    console.error(`[rollupClick] shortLink write failed id=${id}:`, e);
  }

  // Separately update affiliate dailyStats so a failure here doesn't affect the link counter
  if (affiliateId) {
    try {
      await Promise.all([
        db.collection('affiliates').doc(affiliateId).collection('dailyStats').doc(date).set(
          { clicks: admin.firestore.FieldValue.increment(1) },
          { merge: true }
        ),
        db.doc(`affiliates/${affiliateId}`).set(
          { stats: { clicks: admin.firestore.FieldValue.increment(1) } },
          { merge: true }
        ),
      ]);
    } catch (e) {
      console.error(`[rollupClick] affiliate write failed affiliateId=${affiliateId} date=${date}:`, e);
    }
  }
}

// --- Auth redirect (Firebase magic-link continueUrl) ---
// Firebase redirects to /auth-redirect after processing the oobCode in the browser.
// On mobile the app intercepts vpk.to via universal links before reaching here.
// On desktop we show a QR code page so the user can scan with their phone instead.
app.get('/auth-redirect', async (req, res) => {
  const ua = String(req.headers['user-agent'] || '');

  // For the QR code / deep link URL always use vpk.to so that universal links
  // intercept on the phone and open the app directly. Fall back to the actual
  // host only on localhost (emulator testing).
  const actualHost = req.get('host') || '';
  const isLocal = actualHost.includes('localhost') || actualHost.includes('127.0.0.1');
  const canonicalHost = isLocal ? `${req.protocol}://${actualHost}` : 'https://vpk.to';
  const qs = new URLSearchParams(req.query as Record<string, string>).toString();
  const fullUrl = `${canonicalHost}/auth-redirect${qs ? `?${qs}` : ''}`;

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  const sharedStyles = `
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f172a;color:#e2e8f0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;position:relative;overflow:hidden;}
    .blob{position:absolute;border-radius:50%;filter:blur(80px);pointer-events:none;}
    .blob-1{width:420px;height:420px;background:rgba(59,130,246,0.15);top:-120px;right:-120px;}
    .blob-2{width:320px;height:320px;background:rgba(139,92,246,0.1);bottom:-60px;left:-60px;}
    .card{position:relative;z-index:1;max-width:440px;width:100%;text-align:center;}
    .hero{width:160px;height:160px;object-fit:contain;margin:0 auto 20px;display:block;filter:drop-shadow(0 16px 32px rgba(59,130,246,0.35));animation:float 4s ease-in-out infinite;}
    @keyframes float{0%,100%{transform:translateY(0);}50%{transform:translateY(-10px);}}
    h1{font-size:26px;font-weight:700;color:#fff;margin-bottom:10px;}
    .sub{font-size:15px;color:#94a3b8;line-height:1.6;margin-bottom:24px;}
    .badge{display:block;text-align:center;color:#93c5fd;font-size:11px;font-weight:700;padding:4px 0;margin-bottom:16px;letter-spacing:0.08em;text-transform:uppercase;}`;

  // Mobile: universal links normally intercept before reaching here.
  // This fallback page handles the case where the app is not installed.
  if (isIOS(ua) || isAndroid(ua)) {
    const store = isIOS(ua)
      ? 'https://apps.apple.com/us/app/vidopick/id6749210639'
      : 'https://play.google.com/store/apps/details?id=com.vidopick.app';

    return res.status(200).send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Sign in to Vidopick</title>
  <style>
    ${sharedStyles}
    .btn-primary{display:block;background:#3b82f6;color:#fff;text-decoration:none;padding:15px 24px;border-radius:14px;font-size:16px;font-weight:700;margin-bottom:12px;transition:opacity .15s;}
    .btn-primary:active{opacity:.8;}
    .btn-store{display:block;color:#64748b;font-size:13px;text-decoration:none;padding:10px;}
    .btn-store:hover{color:#94a3b8;}
  </style>
</head>
<body>
  <div class="blob blob-1"></div>
  <div class="blob blob-2"></div>
  <div class="card">
    <img class="hero" src="https://vidopick.com/images/invite.png" alt="Vidopick"/>
    <div class="badge">Sign in</div>
    <h1>Open in Vidopick</h1>
    <p class="sub">Tap below to open the app and complete your sign-in. If the app is not installed, get it first then come back.</p>
    <a class="btn-primary" href="${escapeHtml(fullUrl)}">Open Vidopick</a>
    <a class="btn-store" href="${escapeHtml(store)}">Get Vidopick from the store</a>
  </div>
</body>
</html>`);
  }

  // Desktop: generate QR code SVG server-side (no client-side JS needed)
  let qrSvg: string;
  try {
    qrSvg = await QRCode.toString(fullUrl, { type: 'svg', width: 220, margin: 2 });
  } catch (e) {
    console.error('[auth-redirect] QR generation failed:', e);
    return res.status(200)
      .send(`<!doctype html><html><body style="background:#0f172a;color:#e2e8f0;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:24px;">
      <div><h1 style="color:#fff;margin-bottom:12px;">Open this link on your phone</h1>
      <p style="color:#94a3b8;">Copy the link from your email and open it on your phone to sign in to Vidopick.</p></div>
    </body></html>`);
  }

  return res.status(200).send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Sign in to Vidopick</title>
  <style>
    ${sharedStyles}
    .qr-outer{background:#1e293b;border:1px solid #334155;border-radius:24px;padding:28px 28px 20px;display:inline-block;margin-bottom:16px;}
    .qr-inner{background:#fff;padding:12px;border-radius:14px;display:inline-block;line-height:0;}
    .qr-inner svg{display:block;width:220px;height:220px;}
    .note{font-size:13px;color:#475569;}
  </style>
</head>
<body>
  <div class="blob blob-1"></div>
  <div class="blob blob-2"></div>
  <div class="card">
    <img class="hero" src="https://vidopick.com/images/invite.png" alt="Vidopick"/>
    <div class="badge">Sign in</div>
    <h1>Open on your phone</h1>
    <p class="sub">Scan this code with your phone's camera to complete sign-in to Vidopick.</p>
    <div class="qr-outer">
      <div class="qr-inner">${qrSvg}</div>
    </div>
    <p class="note">Single-use link. Valid for 30 minutes.</p>
  </div>
</body>
</html>`);
});

// --- Device auth handoff ---
// Scanned from the device QR code: vpk.to/device-auth?session=...
// Proxy to vidopick.com/device-auth/ preserving all query params.
app.get('/device-auth', (req, res) => {
  const qs = new URLSearchParams(req.query as Record<string, string>).toString();
  return res.redirect(302, `${VIDOPICK_ORIGIN}/device-auth/${qs ? `?${qs}` : ''}`);
});

// --- Core handler (shared by /:id and /a/:slug) ---
async function handleShortlinkById(id: string, req: express.Request, res: express.Response) {
  const ua = String(req.headers['user-agent'] || '');

  try {
    const doc = await db.collection('shortLinks').doc(id).get();
    if (!doc.exists) {
      return res.redirect(302, `${ERROR_PAGES.notFound}?id=${encodeURIComponent(id)}`);
    }

    const data = doc.data() || {};
    const { ogTitle, ogDescription, ogImage, title, description } = resolveOg(data);

    // Disabled (soft-deleted profile share)
    if ((data as any).disabled === true) {
      return res.redirect(302, `${ERROR_PAGES.expired}?id=${encodeURIComponent(id)}`);
    }

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
    const profileData = (data as any)?.params?.profile as
      | { displayName?: string; name?: string }
      | undefined;
    const isProfileInvite = !!profileData;

    // ?ref= carries the affiliate profile-share attribution — propagate it through all redirects
    const refId = typeof (req.query as any).ref === 'string' ? (req.query as any).ref : undefined;

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
      // Profile follow invite — pass names only (no emails, no full snapshots)
      ...(isProfileInvite && {
        isProfileInvite: '1',
        profileNames: profileData?.displayName || profileData?.name || 'Profile',
      }),
      // Pass ?ref= through so the landing page and desktop redirects preserve attribution
      ...(refId && { ref: refId }),
    };
    const rawParams = (data as any)?.params || {};
    for (const [k, v] of Object.entries(rawParams)) {
      if (v === undefined || v === null) continue;
      const t = typeof v;
      if (t === 'string' || t === 'number' || t === 'boolean') {
        if (k === 'ps') continue; // keep derived ps
        // For profile invites, omit 'name' — it could be an email address
        if (isProfileInvite && k === 'name') continue;
        paramsObj[k] = String(v);
      }
      // Arrays/objects (e.g., playlists, profiles) are intentionally not added to the querystring.
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

    // Continue → device-aware redirect + rollup
    const affiliateId = (data as any).affiliateId as string | undefined;

    // Profile share links skip the /get/ landing page entirely — they go straight to the
    // affiliate's profile page (redirect.desktop already has ?ref= baked in at creation time).
    if ((data as any).isProfileShareLink === true) {
      void rollupClick(id, device, affiliateId);
      return res.redirect(302, desktopUrl || `${VIDOPICK_ORIGIN}/`);
    }

    // Human: first land on /get unless they've confirmed (?c=1)
    const wantsContinue = typeof (req.query as any).c !== 'undefined';
    if (!wantsContinue) return res.redirect(302, landing);
    let target: string;
    if (webOnly) {
      // roll up using actual device (not always desktop)
      void rollupClick(id, device, affiliateId);
      target = appendParams(desktopUrl, qs) || landing;
    } else if (isIOS(ua) && iosUrl) {
      void rollupClick(id, 'ios', affiliateId);
      target = iosUrl; // never append qs to iOS store
    } else if (isAndroid(ua) && androidUrl) {
      void rollupClick(id, 'android', affiliateId);
      const referrerPayload: Record<string, string> = {
        ...paramsObj, // All invite params
        src: 'dl',
        ts: String(Date.now()),
      };
      target = withPlayReferrer(androidUrl, referrerPayload);
    } else {
      void rollupClick(id, 'desktop', affiliateId);
      target = appendParams(desktopUrl, qs) || landing;
    }

    return res.redirect(302, target);
  } catch (err) {
    console.error('Redirect error:', err);
    return res.status(500).send('Internal server error');
  }
}

// Affiliate profile share links: vpk.to/a/{slug} → shortLinks/a_{slug}
app.get('/a/:slug', async (req, res) => {
  await handleShortlinkById(`a_${req.params.slug}`, req, res);
});

// Generic shortlink
app.get('/:id', async (req, res) => {
  await handleShortlinkById(req.params.id, req, res);
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
