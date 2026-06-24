import * as admin from 'firebase-admin';
import { onRequest } from 'firebase-functions/v2/https';

if (!admin.apps.length) admin.initializeApp();

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export const serveSitemap = onRequest(
  { region: 'us-central1', memory: '256MiB' },
  async (_req, res) => {
    const db = admin.firestore();
    const snap = await db
      .collection('affiliates')
      .where('type', '==', 'influencer')
      .where('isPublic', '==', true)
      .get();

    const urls = snap.docs
      .filter((d) => !d.data().isHidden)
      .map((d) => {
        const data = d.data();
        const slug = data.slug ?? d.id;
        return `  <url>\n    <loc>https://vidopick.com/vp/${esc(slug)}</loc>\n    <changefreq>weekly</changefreq>\n    <priority>0.6</priority>\n  </url>`;
      })
      .join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;

    res
      .set('Content-Type', 'application/xml; charset=utf-8')
      .set('Cache-Control', 'public, max-age=3600, s-maxage=3600')
      .send(xml);
  }
);
