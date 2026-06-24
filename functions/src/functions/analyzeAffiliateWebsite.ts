import * as admin from 'firebase-admin';
import { onRequest } from 'firebase-functions/v2/https';
import axios from 'axios';
import * as dns from 'dns';
import * as http from 'http';
import * as https from 'https';
import * as net from 'net';
import { promisify } from 'util';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const resolve4 = promisify(dns.resolve4);
const resolve6 = promisify(dns.resolve6);

// Private/loopback/reserved CIDRs — prevents SSRF against GCP metadata and internal services
const PRIVATE_IP_PATTERNS = [
  /^127\./,                                      // loopback
  /^10\./,                                       // RFC-1918
  /^172\.(1[6-9]|2[0-9]|3[01])\./,             // RFC-1918
  /^192\.168\./,                                 // RFC-1918
  /^169\.254\./,                                 // link-local / GCP+AWS metadata
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,  // CGNAT 100.64.0.0/10
  /^0\.0\.0\.0$/,
  /^::1$/,                                       // IPv6 loopback
  /^fe[89ab][0-9a-f]:/i,                        // IPv6 link-local fe80::/10
  /^fc[0-9a-f]{2}:/i,                           // IPv6 unique-local
  /^fd[0-9a-f]{2}:/i,
  /^::ffff:/i,                                   // IPv4-mapped IPv6
  /^2002:/i,                                     // 6to4
  /^64:ff9b:/i,                                  // NAT64
];

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.google',
]);

// Resolves ALL A/AAAA records for the URL's hostname and returns the first address
// if all records are safe, or null if any resolve to a private/reserved range.
// Returns the IP so the caller can pin the TCP connection to it (avoiding TOCTOU).
async function resolveSafeIp(urlStr: string): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (BLOCKED_HOSTNAMES.has(hostname)) return null;

  const [v4Result, v6Result] = await Promise.allSettled([
    resolve4(hostname),
    resolve6(hostname),
  ]);
  const addresses = [
    ...(v4Result.status === 'fulfilled' ? v4Result.value : []),
    ...(v6Result.status === 'fulfilled' ? v6Result.value : []),
  ];
  if (addresses.length === 0) return null;
  if (addresses.some((addr) => PRIVATE_IP_PATTERNS.some((re) => re.test(addr)))) return null;

  return addresses[0];
}

// Creates an Agent whose lookup always returns the pre-validated IP, eliminating the
// TOCTOU window between the DNS safety check and the actual TCP connect syscall.
function pinnedAgent(protocol: string, ip: string): http.Agent | https.Agent {
  const family = net.isIPv6(ip) ? 6 : 4;
  // Node 22 may call lookup with { all: true }, expecting an array response.
  // Handle both forms to avoid "Invalid IP address: undefined" errors.
  const lookup = (
    _host: string,
    opts: Record<string, unknown>,
    cb: (...args: unknown[]) => void
  ) => {
    if (opts?.all) {
      cb(null, [{ address: ip, family }]);
    } else {
      cb(null, ip, family);
    }
  };
  const opts = { lookup } as Record<string, unknown>;
  return protocol === 'https:'
    ? new https.Agent(opts as https.AgentOptions)
    : new http.Agent(opts as http.AgentOptions);
}

// Fetch with SSRF-safe redirect handling: resolves DNS once per hop, pins the TCP
// connection to the validated IP, then re-validates every Location redirect.
const MAX_REDIRECT_HOPS = 3;

async function safeFetch(initialUrl: string): Promise<string | null> {
  let currentUrl = initialUrl;

  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
    const safeIp = await resolveSafeIp(currentUrl);
    if (!safeIp) return null;

    const protocol = new URL(currentUrl).protocol;
    const agent = pinnedAgent(protocol, safeIp);

    const response = await axios.get(currentUrl, {
      timeout: 8000,
      maxRedirects: 0,
      validateStatus: () => true,
      responseType: 'text',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        Accept: 'text/html',
      },
      httpAgent: agent,
      httpsAgent: agent,
    });

    if (response.status >= 300 && response.status < 400) {
      if (hop === MAX_REDIRECT_HOPS) return null;
      const location = response.headers['location'] as string | undefined;
      if (!location) return null;
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    if (response.status >= 400) return null;
    return response.data as string;
  }

  return null;
}

// Headless-browser fallback for sites that block simple HTTP requests (Cloudflare, etc.).
//
// SSRF hardening (three layers):
//   1. resolveSafeIp() validates the initial hostname before browser launch.
//   2. --host-resolver-rules pins that hostname to the validated IP inside Chromium,
//      eliminating the DNS-rebinding window between our check and Chromium's own lookup.
//   3. Request interception re-validates every document navigation (i.e. every redirect
//      target that may resolve to a different host) and caps hop count.
async function safeFetchWithBrowser(urlStr: string): Promise<string | null> {
  const safeIp = await resolveSafeIp(urlStr);
  if (!safeIp) return null;

  let parsed: URL;
  try { parsed = new URL(urlStr); } catch { return null; }
  const hostname = parsed.hostname;

  let browser: import('puppeteer').Browser | undefined;
  try {
    const puppeteer = await import('puppeteer');

    browser = await puppeteer.default.launch({
      // Pin the initial hostname → validated IP so Chromium never re-resolves it
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        `--host-resolver-rules=MAP ${hostname} ${safeIp}`,
      ],
      headless: true,
    });

    const page = await browser.newPage();
    let docHops = 0;

    await page.setRequestInterception(true);
    page.on('request', async (req) => {
      // Block sub-resources — we only need the HTML document
      if (req.resourceType() !== 'document') { req.abort(); return; }

      // Cap redirect chains
      if (docHops >= MAX_REDIRECT_HOPS) { req.abort(); return; }

      // Re-validate every redirect target (may resolve to a different host than the origin)
      const safe = await resolveSafeIp(req.url()).catch(() => null);
      if (!safe) { req.abort(); return; }

      docHops++;
      req.continue();
    });

    await page.goto(urlStr, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    return await page.content();
  } catch (err) {
    console.error('[safeFetchWithBrowser] failed:', err instanceof Error ? err.message : err);
    return null;
  } finally {
    await browser?.close();
  }
}

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

function extractTextFromHtml(html: string): string {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '';
  const metaDesc =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i)?.[1] ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i)?.[1] ??
    '';
  const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)]
    .map((m) => m[1].replace(/<[^>]+>/g, ''))
    .join(' ');
  const h2s = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)]
    .slice(0, 4)
    .map((m) => m[1].replace(/<[^>]+>/g, ''))
    .join(' ');
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = body.split(' ').slice(0, 500).join(' ');
  return [title, metaDesc, h1s, h2s, words].filter(Boolean).join('\n').slice(0, 3000);
}

export const analyzeAffiliateWebsite = onRequest(
  { cors: true, region: 'us-central1', timeoutSeconds: 60, memory: '1GiB' },
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
    let isAdmin = false;
    try {
      const decoded = await admin.auth().verifyIdToken(authHeader.split('Bearer ')[1]);
      uid = decoded.uid;
      isAdmin = decoded.role === 'admin';
    } catch {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }
    const requestedAffiliateId = (req.body?.affiliateId ?? '') as string;

    let affiliateDoc: admin.firestore.QueryDocumentSnapshot | admin.firestore.DocumentSnapshot;

    if (isAdmin && requestedAffiliateId) {
      const snap = await db.doc(`affiliates/${requestedAffiliateId}`).get();
      if (!snap.exists) {
        res.status(404).json({ error: 'Affiliate not found' });
        return;
      }
      affiliateDoc = snap;
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
      affiliateDoc = affiliateSnap.docs[0];
    }
    const affiliate = affiliateDoc.data()!;

    console.log('[analyze] affiliateId:', affiliateDoc.id, 'website:', affiliate.website ?? '(not set)', 'hasSummary:', !!affiliate.websiteSummary);

    if (!affiliate.website) {
      console.log('[analyze] skipped: no website field');
      res.status(200).json({ skipped: true });
      return;
    }

    const force = req.body?.force === true;
    if (!force && affiliate.websiteSummary) {
      console.log('[analyze] returning cached summary');
      res.status(200).json({
        websiteSummary: affiliate.websiteSummary,
        websiteKeywords: affiliate.websiteKeywords ?? [],
      });
      return;
    }

    if (!OPENAI_API_KEY) {
      res.status(500).json({ error: 'AI service unavailable' });
      return;
    }

    let extractedText = '';
    try {
      const rawUrl = (affiliate.website as string).trim();
      const websiteUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
      console.log('[analyze] fetching:', websiteUrl);
      let html = await safeFetch(websiteUrl);
      console.log('[analyze] safeFetch result:', html ? `${html.length} bytes` : 'null');
      if (!html) {
        console.log('[analyze] trying browser fallback');
        html = await safeFetchWithBrowser(websiteUrl);
        console.log('[analyze] browser result:', html ? `${html.length} bytes` : 'null');
      }
      if (!html) {
        console.log('[analyze] skipped: both fetches returned null');
        res.status(200).json({ skipped: true });
        return;
      }
      extractedText = extractTextFromHtml(html);
    } catch (err) {
      console.error('[analyze] fetch error:', err instanceof Error ? err.message : err);
      res.status(200).json({ skipped: true });
      return;
    }

    if (!extractedText.trim()) {
      res.status(200).json({ skipped: true });
      return;
    }

    const aiResponse = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You summarize websites concisely and extract keywords.',
          },
          {
            role: 'user',
            content: `Based on this website content, summarize who this person or organization is in 2-3 sentences. Also extract 5-10 keywords that describe their work or audience. Return JSON: { "summary": string, "keywords": string[] }\n\nWebsite content:\n${extractedText}`,
          },
        ],
        temperature: 0.3,
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

    await db.doc(`affiliates/${affiliateDoc.id}`).update({
      websiteSummary: result.summary ?? '',
      websiteKeywords: result.keywords ?? [],
    });

    res.status(200).json({
      websiteSummary: result.summary,
      websiteKeywords: result.keywords,
    });
  }
);
