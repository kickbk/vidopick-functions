import * as admin from 'firebase-admin';
import { onRequest } from 'firebase-functions/v2/https';
import axios from 'axios';

import { checkRateLimit } from '../utils/rateLimit';

if (!admin.apps.length) {
  admin.initializeApp();
}

export const reportPlaylistUnavailable = onRequest(
  { timeoutSeconds: 30 },
  async (request, response) => {
    if (request.method !== 'POST') {
      response.status(405).json({ error: 'Method not allowed' });
      return;
    }

    // Require a valid Firebase ID token
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      response.status(401).json({ error: 'Unauthorized' });
      return;
    }
    let uid: string;
    try {
      const decoded = await admin.auth().verifyIdToken(authHeader.split('Bearer ')[1]);
      uid = decoded.uid;
    } catch {
      response.status(401).json({ error: 'Invalid token' });
      return;
    }

    const { playlistId } = request.body as { playlistId?: string };
    if (!playlistId || !/^[A-Za-z0-9_-]{10,60}$/.test(playlistId)) {
      response.status(400).json({ error: 'Invalid playlist ID' });
      return;
    }

    const allowed = await checkRateLimit(`reportPlaylistUnavailable:${uid}`, 20);
    if (!allowed) {
      response.status(429).json({ error: 'Too many requests' });
      return;
    }

    const db = admin.firestore();

    // Independently verify via YouTube RSS — the device may have had a transient
    // network error, so we don't trust its report alone.
    let isConfirmedGone = false;
    try {
      await axios.get(`https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistId}`, {
        timeout: 8000,
      });
    } catch (err: any) {
      if (err.response?.status === 404) {
        isConfirmedGone = true;
      }
      // Timeouts / 5xx = treat as temporary; don't mark removed
    }

    // Write error telemetry on the shared playlist doc.
    // Transaction ensures firstReported is only set once.
    const playlistRef = db.collection('scannedPlaylists').doc(playlistId);
    try {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(playlistRef);
        if (!snap.exists) return; // ignore unknown playlists

        const existing = snap.data()?.errors?.unavailable;
        const updates: Record<string, unknown> = {
          'errors.unavailable.count': admin.firestore.FieldValue.increment(1),
          'errors.unavailable.lastReported': admin.firestore.FieldValue.serverTimestamp(),
        };
        if (!existing?.firstReported) {
          updates['errors.unavailable.firstReported'] =
            admin.firestore.FieldValue.serverTimestamp();
        }
        if (isConfirmedGone) {
          updates['isRemoved'] = true;
        }
        tx.update(playlistRef, updates);
      });
    } catch (err: any) {
      console.error('[reportPlaylistUnavailable] Firestore transaction failed:', err.message);
      response.status(500).json({ error: 'Internal error' });
      return;
    }

    // If truly gone, also mark on the caller's user entry so the flag
    // survives reinstalls / device switches (the local AS is just a cache).
    if (isConfirmedGone) {
      await db
        .collection('users')
        .doc(uid)
        .set({ playlists: { [playlistId]: { isRemoved: true } } }, { merge: true });
    }

    response.json({ isConfirmedGone });
  }
);
