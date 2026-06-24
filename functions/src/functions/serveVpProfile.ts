import * as admin from 'firebase-admin';
import { onRequest } from 'firebase-functions/v2/https';

if (!admin.apps.length) admin.initializeApp();

// Reserved slugs that are affiliate portal routes, not profile pages
const RESERVED = new Set(['login', 'dashboard', 'auth']);

export const serveVpProfile = onRequest(
  { region: 'us-central1', memory: '256MiB' },
  async (req, res) => {
    // Firebase Hosting passes the original path, e.g. /vp/ben
    const segments = req.path.split('/').filter(Boolean);
    // segments: ['vp', 'ben']
    const affiliateId = segments[1];

    if (!affiliateId || !/^[a-zA-Z0-9_-]{1,64}$/.test(affiliateId)) {
      res.status(404).send('Not found');
      return;
    }

    // Reserved words should be handled by Firebase Hosting rewrites before reaching here.
    // If they somehow arrive, redirect to the homepage rather than back to the same path (loop).
    if (RESERVED.has(affiliateId)) {
      res.redirect(302, 'https://vidopick.com/');
      return;
    }

    try {
      const bucket = admin.storage().bucket();
      const file = bucket.file(`profile-html/${affiliateId}.html`);
      const [exists] = await file.exists();

      if (!exists) {
        res
          .set('Cache-Control', 'no-store')
          .redirect(302, 'https://vidopick.com/404/');
        return;
      }

      // Read metadata first — cheap, lets us send a 304 without downloading the body.
      const [fileMeta] = await file.getMetadata();
      const xRobots = (fileMeta.metadata as Record<string, string> | undefined)?.xRobots ?? 'noindex,nofollow';
      const etag = `"${fileMeta.generation}"`;

      const sharedHeaders = {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Robots-Tag': xRobots,
        // no-cache: browser always revalidates via ETag before using cached copy.
        // Omitting s-maxage so the CDN does not cache — profile HTML changes when
        // the affiliate updates their profile and CDN invalidation is not wired up.
        'Cache-Control': 'no-cache',
        ETag: etag,
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'SAMEORIGIN',
        'Content-Security-Policy':
          "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src https: data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
      };

      if (req.headers['if-none-match'] === etag) {
        res.set(sharedHeaders).status(304).end();
        return;
      }

      const [content] = await file.download();
      res.set(sharedHeaders).send(content);
    } catch (err) {
      console.error('[serveVpProfile] error:', err);
      res.status(500).send('Internal error');
    }
  }
);
