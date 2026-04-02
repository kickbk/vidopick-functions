import * as admin from 'firebase-admin';
import { onDocumentCreated, onDocumentDeleted } from 'firebase-functions/v2/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const INDEX_DOC = db.collection('meta').doc('playlistIdSet');

/**
 * Triggered whenever a new playlist is added to scannedPlaylists (by any means).
 * Adds the playlist ID as a key in meta/playlistIdSet.
 */
export const onPlaylistCreated = onDocumentCreated(
  { document: 'scannedPlaylists/{playlistId}', region: 'us-central1' },
  async (event) => {
    const playlistId = event.params.playlistId;
    console.log(`Playlist created, adding to index: ${playlistId}`);

    try {
      await INDEX_DOC.set({ [playlistId]: true }, { merge: true });
      console.log(`Index updated — added: ${playlistId}`);
    } catch (error: any) {
      console.error('Failed to update index on create:', error?.message);
    }
  }
);

/**
 * Triggered whenever a playlist is deleted from scannedPlaylists (by any means).
 * Removes the playlist ID key from meta/playlistIdSet.
 */
export const onPlaylistDeleted = onDocumentDeleted(
  { document: 'scannedPlaylists/{playlistId}', region: 'us-central1' },
  async (event) => {
    const playlistId = event.params.playlistId;
    console.log(`Playlist deleted, removing from index: ${playlistId}`);

    try {
      await INDEX_DOC.update({ [playlistId]: FieldValue.delete() });
      console.log(`Index updated — removed: ${playlistId}`);
    } catch (error: any) {
      console.error('Failed to update index on delete:', error?.message);
    }
  }
);

/**
 * Returns all playlist IDs from meta/playlistIdSet as a flat array.
 * Used by the Chrome extension on init — bypasses App Check via API key auth.
 */
export const getPlaylistIdIndex = onRequest(
  { cors: true, region: 'us-central1' },
  async (request, response) => {
    if (request.method !== 'POST') {
      response.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const { apiKey } = request.body;
    const expectedKey = process.env.EXTENSION_API_KEY;

    if (!apiKey || !expectedKey || apiKey !== expectedKey) {
      response.status(401).json({ error: 'Invalid API key' });
      return;
    }

    try {
      const doc = await INDEX_DOC.get();
      const ids = doc.exists ? Object.keys(doc.data() || {}) : [];
      response.status(200).json({ ids });
    } catch (error: any) {
      console.error('Failed to fetch playlist ID index:', error);
      response.status(500).json({ error: 'Failed to fetch index', details: error?.message });
    }
  }
);

/**
 * One-time backfill HTTP function.
 * Call once to build the initial meta/playlistIdSet from all existing scannedPlaylists docs.
 * Requires the ADMIN_SETUP_SECRET env variable to be set.
 * Once called successfully, this function can be removed or disabled.
 */
export const backfillPlaylistIdIndex = onRequest(
  { cors: false, region: 'us-central1', timeoutSeconds: 300 },
  async (request, response) => {
    if (request.method !== 'POST') {
      response.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const { secret } = request.body;
    const expectedSecret = process.env.EXTENSION_API_KEY;

    if (!secret || !expectedSecret || secret !== expectedSecret) {
      response.status(403).json({ error: 'Invalid secret' });
      return;
    }

    try {
      console.log('Starting playlist ID index backfill...');

      const snapshot = await db.collection('scannedPlaylists').get();
      console.log(`Found ${snapshot.size} playlists to index`);

      if (snapshot.empty) {
        await INDEX_DOC.set({});
        response.status(200).json({ success: true, count: 0 });
        return;
      }

      // Build the full map in one write
      const idMap: Record<string, boolean> = {};
      snapshot.forEach((doc) => {
        idMap[doc.id] = true;
      });

      await INDEX_DOC.set(idMap);

      console.log(`Backfill complete. Indexed ${snapshot.size} playlist IDs.`);
      response.status(200).json({ success: true, count: snapshot.size });
    } catch (error: any) {
      console.error('Backfill failed:', error);
      response.status(500).json({ error: 'Backfill failed', details: error?.message });
    }
  }
);
