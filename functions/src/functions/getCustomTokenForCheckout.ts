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

    let customToken: string;
    try {
      customToken = await admin.auth().createCustomToken(uid, { checkoutPurpose: true });
    } catch (err: any) {
      console.error('[getCustomTokenForCheckout] createCustomToken failed:', err?.message ?? err);
      res.status(500).json({ error: 'Failed to generate checkout token. Check function logs.' });
      return;
    }

    const url = `${CHECKOUT_BASE_URL}?token=${encodeURIComponent(customToken)}`;
    res.json({ url });
  }
);
