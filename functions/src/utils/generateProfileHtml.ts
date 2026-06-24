import QRCode from 'qrcode';

const IOS_STORE = 'https://apps.apple.com/us/app/vidopick/id6749210639';
const ANDROID_STORE = 'https://play.google.com/store/apps/details?id=com.vidopick.app';
const QR_LOGO_URL = 'https://vidopick.com/images/qr-invite-center.png';

export interface VpProfileEntry {
  shortlinkId: string;
  profileName: string;
  profileColor: string;
  description: string;
}

export interface VpAffiliateProfile {
  id: string;
  slug?: string;
  name: string;
  title?: string;
  bio?: string;
  photo?: string;
  website?: string;
  socialLinks?: { platform: string; url: string }[];
  ogImageUrl?: string;
  shouldIndex?: boolean;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function ensureHttps(url: string): string {
  return url.startsWith('http') ? url : `https://${url}`;
}

function displayDomain(url: string): string {
  try {
    return new URL(ensureHttps(url)).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function socialHandleLabel(url: string): string {
  try {
    const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
    const handle = parsed.pathname.replace(/^\/(@?)/, '$1') || parsed.hostname;
    return handle.length > 24 ? parsed.hostname.replace(/^www\./, '') : handle;
  } catch {
    return url;
  }
}

const GLOBE_SVG = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10A15.3 15.3 0 0 1 12 2z"/></svg>`;

const SOCIAL_ICONS: Record<string, string> = {
  instagram: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>`,
  tiktok:    `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5"/></svg>`,
  youtube:   `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22.54 6.42a2.78 2.78 0 0 0-1.95-1.96C18.88 4 12 4 12 4s-6.88 0-8.59.46a2.78 2.78 0 0 0-1.95 1.96A29 29 0 0 0 1 12a29 29 0 0 0 .46 5.58A2.78 2.78 0 0 0 3.41 19.54C5.12 20 12 20 12 20s6.88 0 8.59-.46a2.78 2.78 0 0 0 1.95-1.96A29 29 0 0 0 23 12a29 29 0 0 0-.46-5.58z"/><polygon points="9.75 15.02 15.5 12 9.75 8.98 9.75 15.02" fill="currentColor" stroke="none"/></svg>`,
  facebook:  `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>`,
  pinterest: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8.56 2.75c4.37 6.03 6.02 9.42 8.03 17.72m2.54-15.38c-3.72 4.35-8.94 5.66-16.88 5.85m19.5 1.9c-3.5-.93-6.63-.82-8.94 0-2.58.92-5.01 2.86-7.44 6.32"/></svg>`,
  x:         `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.74l7.73-8.835L1.254 2.25H8.08l4.259 5.63 5.906-5.63zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`,
  linkedin:  `<svg width="13" height="13" viewBox="0 0 448 512" fill="currentColor"><path d="M100.28 448H7.4V148.9h92.88zM53.79 108.1C24.09 108.1 0 83.5 0 53.8a53.79 53.79 0 0 1 107.58 0c0 29.7-24.1 54.3-53.79 54.3zM447.9 448h-92.68V302.4c0-34.7-.7-79.2-48.29-79.2-48.29 0-55.69 37.7-55.69 76.7V448h-92.78V148.9h89.08v40.8h1.3c12.4-23.5 42.69-48.3 87.88-48.3 94 0 111.28 61.9 111.28 142.3V448z"/></svg>`,
  threads:   `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M16 8a6 6 0 0 1 2 4 6 6 0 0 1-6 6c-2 0-3.5-.8-4.5-2"/><path d="M12 6a6 6 0 0 1 6 6"/></svg>`,
  substack:  `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 4H4v2h16V4zM20 9H4v2h16V9zM4 14h16v8l-8-4-8 4v-8z"/></svg>`,
  podcast:   `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`,
};

function qrSvg(url: string): string {
  const qr = (QRCode as any).create(url, { errorCorrectionLevel: 'H' });
  const moduleCount: number = qr.modules.size;
  const data: Uint8Array = qr.modules.data;

  const cellSize = 10;
  const margin = 4;
  const totalSize = moduleCount * cellSize + margin * 2;
  const dotR = cellSize * 0.42;

  let circles = '';
  for (let row = 0; row < moduleCount; row++) {
    for (let col = 0; col < moduleCount; col++) {
      if (data[row * moduleCount + col]) {
        const cx = margin + (col + 0.5) * cellSize;
        const cy = margin + (row + 0.5) * cellSize;
        circles += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${dotR.toFixed(2)}" fill="#0f172a"/>`;
      }
    }
  }

  // White circle + logo overlay in the center
  const logoSize = totalSize * 0.28;
  const cx = totalSize / 2;
  const cy = totalSize / 2;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalSize} ${totalSize}" width="${totalSize}" height="${totalSize}">
<rect width="${totalSize}" height="${totalSize}" fill="white"/>
${circles}
<circle cx="${cx}" cy="${cy}" r="${(logoSize * 0.52).toFixed(2)}" fill="white"/>
<image href="${QR_LOGO_URL}" x="${(cx - logoSize / 2).toFixed(1)}" y="${(cy - logoSize / 2).toFixed(1)}" width="${logoSize.toFixed(1)}" height="${logoSize.toFixed(1)}"/>
</svg>`;
}

export function generateProfileHtml(
  profile: VpAffiliateProfile,
  entries: VpProfileEntry[]
): string {
  const canonicalId = profile.slug ?? profile.id;
  const pageUrl = `https://vidopick.com/vp/${canonicalId}`;
  const ogDesc = profile.bio
    ? profile.bio.substring(0, 160)
    : `${profile.name} shares curated video profiles for children on Vidopick.`;
  const ogImage = profile.ogImageUrl ?? profile.photo ?? 'https://vidopick.com/images/vidopick-og.png';
  const pageTitle = `${profile.name} | Vidopick`;
  const year = new Date().getFullYear();

  const cards = entries
    .map((e) => {
      const svg = qrSvg(`https://vpk.to/${e.shortlinkId}`);
      return `
    <div class="card" style="border-top:3px solid ${esc(e.profileColor)}">
      <div class="card-body">
        <div class="plabel">
          <span class="dot" style="background:${esc(e.profileColor)}"></span>
          <span class="pname">${esc(e.profileName)}</span>
        </div>
        <p class="desc">${esc(e.description)}</p>
        <div class="qr-wrap">
          <div class="qr-box">${svg}</div>
          <p class="qr-hint">Scan to get this profile in Vidopick</p>
        </div>
        <button class="get-btn" onclick="handleGet()">Get Vidopick →</button>
      </div>
    </div>`;
    })
    .join('');

  const photoPart = profile.photo
    ? `<img class="avatar" src="${esc(profile.photo)}" alt="${esc(profile.name)}" />`
    : `<div class="avatar avatar-init">${esc((profile.name[0] ?? '?').toUpperCase())}</div>`;

  const linkPills: string[] = [];
  if (profile.website) {
    linkPills.push(`<a class="site-link" href="${esc(ensureHttps(profile.website))}" target="_blank" rel="noopener noreferrer">${GLOBE_SVG}${esc(displayDomain(profile.website))}</a>`);
  }
  for (const sl of (profile.socialLinks ?? [])) {
    const icon = SOCIAL_ICONS[sl.platform] ?? GLOBE_SVG;
    linkPills.push(`<a class="site-link" href="${esc(ensureHttps(sl.url))}" target="_blank" rel="noopener noreferrer">${icon}${esc(socialHandleLabel(sl.url))}</a>`);
  }
  const linksPart = linkPills.length > 0
    ? `<div class="links">${linkPills.join('')}</div>`
    : '';

  const bioPart = profile.bio
    ? `<p class="bio">${esc(profile.bio).replace(/\n/g, '<br>')}</p>`
    : '';

  const titlePart = profile.title
    ? `<p class="role">${esc(profile.title)}</p>`
    : '';

  const profilesSection = entries.length > 0
    ? `<hr class="divider" />
       <div class="section-head">
         <h2 class="section-title">My recommended profiles</h2>
         <p class="section-sub">Scan a QR code or tap the button to get Vidopick and follow my profile. Once you subscribe, any updates I make will automatically appear in your Vidopick.</p>
       </div>
       <div class="grid">${cards}</div>`
    : '';

  const themeInitScript = `(function(){
    var s=localStorage.getItem('vpk-theme');
    var d=window.matchMedia('(prefers-color-scheme:dark)').matches;
    document.documentElement.setAttribute('data-theme',s?s:(d?'dark':'light'));
  })();`;

  const platformScript = `
    (function(){
      var f=sessionStorage.getItem('vpk_open_fallback');
      if(f){sessionStorage.removeItem('vpk_open_fallback');window.location.replace(f);return;}
    })();
    function handleGet(){
      var ua=navigator.userAgent||'';
      var android=/Android/i.test(ua);
      var ipadOS=/Macintosh/i.test(ua)&&navigator.maxTouchPoints>1;
      var iphone=/iPhone|iPad|iPod/i.test(ua)||ipadOS;
      if(android){window.location.href='${ANDROID_STORE}';}
      else if(iphone){window.location.href='${IOS_STORE}';}
      else{
        sessionStorage.setItem('vpk_open_fallback','${IOS_STORE}');
        window.location.href='vidopick://';
        setTimeout(function(){
          sessionStorage.removeItem('vpk_open_fallback');
          if(!document.hidden){window.location.href='${IOS_STORE}';}
        },1500);
      }
    }
    function toggleTheme(){
      var next=document.documentElement.getAttribute('data-theme')==='dark'?'light':'dark';
      document.documentElement.setAttribute('data-theme',next);
      localStorage.setItem('vpk-theme',next);
    }
  `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(pageTitle)}</title>
<meta name="description" content="${esc(ogDesc)}"/>
<link rel="canonical" href="${pageUrl}"/>
<link rel="shortcut icon" href="https://vidopick.com/favicons/favicon.ico"/>
<link rel="icon" type="image/svg+xml" href="https://vidopick.com/favicons/favicon.svg"/>
<link rel="icon" type="image/png" sizes="32x32" href="https://vidopick.com/favicons/favicon32.png"/>
<link rel="icon" type="image/png" sizes="16x16" href="https://vidopick.com/favicons/favicon16.png"/>
<link rel="apple-touch-icon" sizes="180x180" href="https://vidopick.com/favicons/apple-touch-icon.png"/>
${profile.shouldIndex === false ? '<meta name="robots" content="noindex,nofollow"/>' : ''}
<meta property="og:type" content="profile"/>
<meta property="og:url" content="${pageUrl}"/>
<meta property="og:title" content="${esc(pageTitle)}"/>
<meta property="og:description" content="${esc(ogDesc)}"/>
<meta property="og:image" content="${esc(ogImage)}"/>
<meta property="og:site_name" content="Vidopick"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${esc(pageTitle)}"/>
<meta name="twitter:description" content="${esc(ogDesc)}"/>
<meta name="twitter:image" content="${esc(ogImage)}"/>
<script>${themeInitScript}</script>
<style>
@font-face{font-family:'Vidopick';src:url('https://vidopick.com/fonts/Vidopick-Bold.ttf') format('truetype');font-weight:700;font-display:swap}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#f8fafc;--surface:#fff;--foot-bg:#f8fafc;--border:#e2e8f0;--text:#0f172a;--muted:#64748b;--faint:#94a3b8;--blue:#2563eb;--blue-h:#1d4ed8;--btn-bg:#f1f5f9;--btn-text:#475569;--btn-hover:#e2e8f0;--icon-sun:block;--icon-moon:none}
@media(prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#020617;--surface:#0f172a;--foot-bg:#020617;--border:#1e293b;--text:#f8fafc;--muted:#cbd5e1;--faint:#64748b;--btn-bg:#1e293b;--btn-text:#fbbf24;--btn-hover:#334155;--icon-sun:none;--icon-moon:block}}
:root[data-theme="dark"]{--bg:#020617;--surface:#0f172a;--foot-bg:#020617;--border:#1e293b;--text:#f8fafc;--muted:#cbd5e1;--faint:#64748b;--btn-bg:#1e293b;--btn-text:#fbbf24;--btn-hover:#334155;--icon-sun:none;--icon-moon:block}
:root[data-theme="light"]{--bg:#f8fafc;--surface:#fff;--foot-bg:#f8fafc;--border:#e2e8f0;--text:#0f172a;--muted:#64748b;--faint:#94a3b8;--blue:#2563eb;--blue-h:#1d4ed8;--btn-bg:#f1f5f9;--btn-text:#475569;--btn-hover:#e2e8f0;--icon-sun:block;--icon-moon:none}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--text);min-height:100vh;display:flex;flex-direction:column}

/* ── Header ── */
header{position:sticky;top:0;z-index:50;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);transition:background .2s,border-color .2s;background:color-mix(in srgb,var(--bg) 85%,transparent)}
@supports not (color:color-mix(in srgb,red 50%,blue)){header{background:var(--bg)}}
.header-inner{max-width:80rem;margin:0 auto;padding:0 1rem;height:5rem;display:flex;align-items:center;justify-content:space-between}
@media(min-width:640px){.header-inner{padding:0 1.5rem}}
@media(min-width:1024px){.header-inner{padding:0 2rem}}
.logo{font-family:'Vidopick',sans-serif;font-size:1.875rem;font-weight:700;text-decoration:none;color:var(--text);letter-spacing:-.01em}
#theme-btn{background:var(--btn-bg);color:var(--btn-text);border:none;border-radius:9999px;width:2.5rem;height:2.5rem;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:background .15s}
#theme-btn:hover{background:var(--btn-hover)}
#theme-btn .icon-sun{display:var(--icon-sun)}
#theme-btn .icon-moon{display:var(--icon-moon)}

/* ── Main ── */
main{flex:1;max-width:80rem;margin:0 auto;width:100%;padding:3.5rem 1rem 6rem}
@media(min-width:640px){main{padding:4rem 1.5rem 6rem}}
@media(min-width:1024px){main{padding:4.5rem 2rem 6rem}}
.profile{display:flex;flex-direction:column;gap:2.5rem;margin-bottom:3.5rem}
@media(min-width:640px){.profile{flex-direction:row;gap:3rem;align-items:flex-start}}
.avatar{width:13rem;height:13rem;border-radius:1rem;object-fit:cover;flex-shrink:0;margin:0 auto}
@media(min-width:640px){.avatar{margin:0;width:16rem;height:16rem}}
.avatar-init{display:flex;align-items:center;justify-content:center;background:var(--border);color:var(--faint);font-size:3rem;font-weight:700}
.creds{flex:1;min-width:0;display:flex;flex-direction:column;gap:.75rem;text-align:center}
@media(min-width:640px){.creds{text-align:left;justify-content:center}}
h1{font-size:2rem;font-weight:700;letter-spacing:-.025em;line-height:1.2}
@media(min-width:640px){h1{font-size:2.5rem}}
.role{color:var(--muted);font-size:1rem;font-weight:500;margin-top:.25rem}
.bio{font-size:.9375rem;line-height:1.65;color:var(--muted);white-space:pre-line}
.links{display:flex;flex-wrap:wrap;gap:.5rem;justify-content:center}
@media(min-width:640px){.links{justify-content:flex-start}}
.site-link{display:inline-flex;align-items:center;gap:.375rem;font-size:.75rem;font-weight:500;color:var(--muted);text-decoration:none;background:var(--btn-bg);border:1px solid var(--border);border-radius:9999px;padding:.375rem .75rem;transition:background .15s,border-color .15s,color .15s}
.site-link:hover{color:var(--text);border-color:var(--faint);background:var(--btn-hover)}
.divider{border:none;border-top:1px solid var(--border);margin-bottom:2.5rem}
.section-head{margin-bottom:1.5rem}
.section-title{font-size:1.125rem;font-weight:600}
.section-sub{font-size:.875rem;color:var(--faint);margin-top:.25rem}
.grid{display:grid;gap:1.25rem}
@media(min-width:640px){.grid{grid-template-columns:repeat(2,1fr)}}
@media(min-width:1024px){.grid{grid-template-columns:repeat(3,1fr)}}
.card{background:var(--surface);border:1px solid var(--border);border-radius:1rem;overflow:hidden;display:flex;flex-direction:column}
.card-body{padding:1.5rem;display:flex;flex-direction:column;gap:1rem;flex:1}
.plabel{display:flex;align-items:center;gap:.5rem}
.dot{width:.625rem;height:.625rem;border-radius:9999px;flex-shrink:0}
.pname{font-size:.875rem;font-weight:600}
.desc{font-size:.875rem;line-height:1.6;color:var(--muted)}
.qr-wrap{display:flex;flex-direction:column;align-items:center;gap:.5rem;padding:.5rem 0}
.qr-box{width:11rem;height:11rem;border-radius:1rem;overflow:hidden;background:#fff;padding:.375rem;box-shadow:0 0 0 1px var(--border)}
.qr-box svg{width:100%;height:100%;display:block}
.qr-hint{font-size:.6875rem;color:var(--faint)}
.get-btn{margin-top:auto;width:100%;background:var(--blue);color:#fff;border:none;border-radius:.75rem;padding:.625rem 1rem;font-size:.875rem;font-weight:600;cursor:pointer;transition:background .15s}
.get-btn:hover{background:var(--blue-h)}

/* ── Footer ── */
footer{background:var(--foot-bg);border-top:1px solid var(--border);padding:3rem 1rem;padding-bottom:calc(3rem + env(safe-area-inset-bottom,0px))}
@media(min-width:640px){footer{padding:3rem 1.5rem;padding-bottom:calc(3rem + env(safe-area-inset-bottom,0px))}}
@media(min-width:1024px){footer{padding:3rem 2rem;padding-bottom:calc(3rem + env(safe-area-inset-bottom,0px))}}
.footer-inner{max-width:80rem;margin:0 auto;display:flex;flex-direction:column;gap:3rem}
@media(min-width:768px){.footer-inner{flex-direction:row;justify-content:space-between;align-items:flex-start}}
.footer-brand{display:flex;flex-direction:column;gap:.25rem}
.footer-logo{font-family:'Vidopick',sans-serif;font-weight:700;font-size:1.25rem;color:var(--text);text-decoration:none;display:inline-block}
.footer-copy{font-size:.75rem;color:var(--faint);white-space:nowrap;margin-top:.125rem}
.footer-links{display:grid;grid-template-columns:repeat(2,1fr);gap:3rem;width:100%}
@media(min-width:640px){.footer-links{grid-template-columns:repeat(3,1fr)}}
.footer-col{display:flex;flex-direction:column;gap:.75rem}
.footer-col h3{font-size:.875rem;font-weight:700;color:var(--text)}
.footer-col a{font-size:.875rem;color:var(--muted);text-decoration:none;transition:color .15s}
.footer-col a:hover{color:#3b82f6}
</style>
</head>
<body>

<header>
  <div class="header-inner">
    <a class="logo" href="https://vidopick.com/">Vidopick</a>
    <button id="theme-btn" onclick="toggleTheme()" aria-label="Toggle dark mode">
      <svg class="icon-sun" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>
      </svg>
      <svg class="icon-moon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
      </svg>
    </button>
  </div>
</header>

<main>
  <div class="profile">
    ${photoPart}
    <div class="creds">
      <div>
        <h1>${esc(profile.name)}</h1>
        ${titlePart}
      </div>
      ${linksPart}
      ${bioPart}
    </div>
  </div>
  ${profilesSection}
</main>

<footer>
  <div class="footer-inner">
    <div class="footer-brand">
      <a class="footer-logo" href="https://vidopick.com/">Vidopick</a>
      <p class="footer-copy">© ${year} Vidopick. All rights reserved.</p>
    </div>
    <div class="footer-links">
      <div class="footer-col">
        <h3>Company</h3>
        <a href="https://vidopick.com/privacy/">Privacy Policy</a>
        <a href="https://vidopick.com/terms/">Terms of Service</a>
        <a href="https://vidopick.com/contact/">Contact</a>
      </div>
      <div class="footer-col">
        <h3>Products</h3>
        <a href="https://vidopick.com/pro/">Vidopick Pro</a>
      </div>
      <div class="footer-col">
        <h3>Solutions</h3>
        <a href="https://vidopick.com/business/">Business</a>
        <a href="https://vidopick.com/schools/">Schools</a>
        <a href="https://vidopick.com/teachers/">Teachers</a>
      </div>
    </div>
  </div>
</footer>

<script>${platformScript}</script>
</body>
</html>`;
}
