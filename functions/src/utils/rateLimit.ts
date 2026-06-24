import * as admin from 'firebase-admin';

if (!admin.apps.length) admin.initializeApp();

/**
 * Firestore-backed fixed-window rate limiter (hour buckets).
 * Returns true when the call is allowed.
 *
 * Docs live in rateLimits/{key}_{hourBucket} with an `expireAt` field —
 * set a TTL policy on rateLimits.expireAt so buckets clean themselves up.
 */
export async function checkRateLimit(key: string, maxPerHour: number): Promise<boolean> {
  const db = admin.firestore();
  const hourBucket = Math.floor(Date.now() / 3_600_000);
  const safeKey = key.replace(/[^a-zA-Z0-9@._-]/g, '_').slice(0, 400);
  const ref = db.doc(`rateLimits/${safeKey}_${hourBucket}`);
  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const count = (snap.data()?.count as number | undefined) ?? 0;
      if (count >= maxPerHour) return false;
      tx.set(
        ref,
        {
          count: count + 1,
          expireAt: admin.firestore.Timestamp.fromMillis(Date.now() + 2 * 3_600_000),
        },
        { merge: true }
      );
      return true;
    });
  } catch (e) {
    // Availability over strictness: a limiter outage must not take down the endpoint.
    console.warn('[rateLimit] transaction failed — allowing request:', e);
    return true;
  }
}

/**
 * Firestore-backed fixed-window rate limiter (day buckets).
 * Returns true when the call is allowed.
 */
export async function checkRateLimitDaily(key: string, maxPerDay: number): Promise<boolean> {
  const db = admin.firestore();
  const dayBucket = Math.floor(Date.now() / 86_400_000);
  const safeKey = key.replace(/[^a-zA-Z0-9@._-]/g, '_').slice(0, 400);
  const ref = db.doc(`rateLimits/${safeKey}_d${dayBucket}`);
  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const count = (snap.data()?.count as number | undefined) ?? 0;
      if (count >= maxPerDay) return false;
      tx.set(
        ref,
        {
          count: count + 1,
          expireAt: admin.firestore.Timestamp.fromMillis(Date.now() + 2 * 86_400_000),
        },
        { merge: true }
      );
      return true;
    });
  } catch (e) {
    console.warn('[rateLimit] daily transaction failed — allowing request:', e);
    return true;
  }
}

/** Client IP for onRequest handlers (Cloud Run sits behind a proxy). */
export function requestIp(req: { headers: NodeJS.Dict<string | string[]>; ip?: string }): string {
  const fwd = req.headers['x-forwarded-for'];
  const first = Array.isArray(fwd) ? fwd[0] : typeof fwd === 'string' ? fwd.split(',')[0] : '';
  return (first || req.ip || 'unknown').trim();
}

/** Escape a string for safe interpolation into HTML email templates. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
