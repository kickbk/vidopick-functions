import * as admin from 'firebase-admin';
import { onRequest } from 'firebase-functions/v2/https';

if (!admin.apps.length) admin.initializeApp();

const CHECKOUT_BASE_URL = 'https://vidopick.com/pro/checkout/';

/**
 * Generate a short-lived Firebase custom token and return a checkout URL so
 * the app can hand off the user's identity to the Stripe web checkout page.
 *
 * The web page exchanges this token via `signInWithCustomToken()` and then
 * creates a Stripe Checkout Session on behalf of the authenticated user.
 *
 * Auth: Firebase ID token in Authorization: Bearer header.
 */
export const getCustomTokenForCheckout = onRequest(
  { region: 'us-central1', memory: '256MiB', timeoutSeconds: 15, invoker: 'public', cors: true },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const authHeader = req.headers.authorization ?? '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!idToken) {
      res.status(401).json({ error: 'Missing auth token' });
      return;
    }

    let decodedToken: admin.auth.DecodedIdToken;
    try {
      decodedToken = await admin.auth().verifyIdToken(idToken);
    } catch {
      res.status(401).json({ error: 'Invalid auth token' });
      return;
    }

    const uid = decodedToken.uid;
    const db = admin.firestore();

    // Determine sandbox eligibility before creating the token so the claim
    // can be embedded. Authorization lives in the token — not the URL param —
    // so callers can't self-grant sandbox by crafting the request body.
    const sandboxRequested = req.body?.sandboxMode === true;
    const isAdmin = decodedToken.role === 'admin';
    let effectiveSandboxMode = false;
    if (sandboxRequested) {
      if (isAdmin) {
        effectiveSandboxMode = true;
      } else {
        // Non-admin testers: check the allowSandbox flag on the user doc.
        // Only an admin (via Firebase Console or Admin SDK) can write that field.
        try {
          const sandboxSnap = await db.doc(`users/${uid}`).get();
          effectiveSandboxMode = sandboxSnap.data()?.allowSandbox === true;
        } catch {
          // Non-fatal — sandbox not granted
        }
      }
    }

    let customToken: string;
    try {
      customToken = await admin.auth().createCustomToken(uid, {
        checkoutPurpose: true,
        ...(isAdmin ? { role: 'admin' } : {}),
        ...(effectiveSandboxMode ? { sandboxMode: true } : {}),
      });
    } catch (err: any) {
      console.error('[getCustomTokenForCheckout] createCustomToken failed:', err?.message ?? err);
      res.status(500).json({ error: 'Failed to generate checkout token. Check function logs.' });
      return;
    }

    // Read affiliate discount so the web checkout page can display discounted prices.
    // If the app passes a shortlinkId that hasn't been persisted to the user doc yet
    // (race condition: user taps Get Pro before saveReferral runs), write it now so
    // the Stripe checkout session gets the correct coupon applied.
    let discountPercent = 0;
    let isFirstTimeBuyer = true;
    try {
      const rawShortlinkId: string | undefined =
        typeof req.body?.shortlinkId === 'string' ? req.body.shortlinkId.trim() : undefined;
      // Only accept a well-formed id — it's interpolated into a Firestore doc path,
      // so reject anything with slashes/other chars to avoid writing junk to
      // arbitrary shortLinks/** paths. An invalid value is treated as no referral.
      const candidateShortlinkId: string | undefined =
        rawShortlinkId && /^[A-Za-z0-9_-]{1,128}$/.test(rawShortlinkId) ? rawShortlinkId : undefined;

      const userSnap = await db.doc(`users/${uid}`).get();
      const userData = userSnap.data() ?? {};
      isFirstTimeBuyer = !userData.stripeActivatedAt;
      let resolvedShortlinkId: string | undefined = userData.referredByShortlinkId;

      // Write the referral if the app supplied one and the user isn't locked yet
      if (candidateShortlinkId && !userData.referralLockedAt && !resolvedShortlinkId) {
        const slSnap = await db.doc(`shortLinks/${candidateShortlinkId}`).get();
        if (slSnap.exists) {
          const slData = slSnap.data()!;
          const affiliateId: string | undefined = slData.affiliateId;
          if (affiliateId) {
            const date = new Date().toISOString().slice(0, 10);
            await Promise.all([
              db.doc(`users/${uid}`).set(
                {
                  referredByShortlinkId: candidateShortlinkId,
                  referredByAffiliateId: affiliateId,
                  referredAt: admin.firestore.FieldValue.serverTimestamp(),
                },
                { merge: true }
              ),
              db.doc(`shortLinks/${candidateShortlinkId}`).set(
                { analytics: { signups: admin.firestore.FieldValue.increment(1) } },
                { merge: true }
              ),
              db.collection(`affiliates/${affiliateId}/dailyStats`).doc(date).set(
                { signups: admin.firestore.FieldValue.increment(1) },
                { merge: true }
              ),
            ]);
            resolvedShortlinkId = candidateShortlinkId;
            console.log(`[getCustomTokenForCheckout] inline referral saved uid=${uid} shortlinkId=${candidateShortlinkId}`);
          }
        }
      }

      if (resolvedShortlinkId) {
        const slSnap = await db.doc(`shortLinks/${resolvedShortlinkId}`).get();
        const slData = slSnap.data();
        if (slData?.discountPercent && !slData?.disabled) {
          discountPercent = slData.discountPercent;
        }
      }
    } catch {
      // Non-fatal — discount just won't show on the web page
    }

    console.log(`[getCustomTokenForCheckout] uid=${uid} sandboxMode=${effectiveSandboxMode} body=${JSON.stringify(req.body ?? null)}`);

    const checkoutUrl = new URL(CHECKOUT_BASE_URL);
    checkoutUrl.searchParams.set('token', customToken);
    if (discountPercent > 0) checkoutUrl.searchParams.set('discount', String(discountPercent));
    if (effectiveSandboxMode) checkoutUrl.searchParams.set('sandbox', '1');
    if (isFirstTimeBuyer) checkoutUrl.searchParams.set('trial', '1');
    res.json({ url: checkoutUrl.toString() });
  }
);
