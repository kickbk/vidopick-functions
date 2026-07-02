import * as admin from 'firebase-admin';
import { onRequest } from 'firebase-functions/v2/https';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

export const savePlaylistFromExtension = onRequest(
  {
    cors: true,
    region: 'us-central1',
  },
  async (request, response) => {
    if (request.method !== 'POST') {
      response.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const { apiKey, playlistData } = request.body;
    const expectedKey = process.env.EXTENSION_API_KEY;

    console.log('Extension playlist save attempt');

    // 1. Verify API key
    if (!apiKey || !expectedKey || apiKey !== expectedKey) {
      console.error('Invalid API key');
      response.status(401).json({ error: 'Invalid API key' });
      return;
    }

    // 2. SECURITY: Check Payload Size (Limit to 500KB)
    // Prevents malicious large payloads from crashing function or spiking costs
    const payloadSize = JSON.stringify(playlistData).length;
    if (payloadSize > 500000) {
      console.warn(`Payload too large: ${payloadSize} bytes`);
      response.status(413).json({ error: 'Payload too large' });
      return;
    }

    // 3. SECURITY: Validate Data Structure
    if (!playlistData || typeof playlistData !== 'object' || !playlistData.id) {
      response.status(400).json({ error: 'Missing playlist data or ID' });
      return;
    }

    if (typeof playlistData.id !== 'string' || !/^[A-Za-z0-9_-]{10,60}$/.test(playlistData.id)) {
      response.status(400).json({ error: 'Invalid playlist ID' });
      return;
    }

    // 4. SECURITY: Field allowlist — the shared API key ships inside the Chrome
    // extension, so treat the payload as untrusted and only accept known fields.
    const ALLOWED_FIELDS = [
      'id', 'title', 'thumbnail', 'author', 'authorUrl', 'ageMin', 'ageMax',
      'tags', 'category', 'categories', 'languages', 'description', 'sourceUrl',
      'ranking', 'channelSubscribers', 'channelVerified', 'isAppropriate',
      'reviewedBy', 'reviewedAt', 'scannedAt', 'updatedAt', 'scannedBy', 'likes',
    ];
    const cleanedData: Record<string, unknown> = {};
    for (const field of ALLOWED_FIELDS) {
      if (field in playlistData) cleanedData[field] = playlistData[field];
    }
    if (typeof cleanedData.title !== 'string' || cleanedData.title.length > 500) {
      response.status(400).json({ error: 'Invalid title' });
      return;
    }

    try {
      const playlistId = playlistData.id as string;

      // Check if already in scannedPlaylists (previously scanned by a user — isApproved: false).
      // If so, merge the existing AI data with the extension-provided data so we don't lose it.
      // Note: importCount is intentionally NOT accepted from the payload — the extension
      // sends 0, which would clobber the real counter on re-save.
      const existingSnap = await db.collection('scannedPlaylists').doc(playlistId).get();
      const existingData = existingSnap.exists ? existingSnap.data() : null;

      const type = playlistId.startsWith('UU') ? 'channel' : 'playlist';

      const dataToSave = existingData
        ? { ...existingData, ...cleanedData, isApproved: true, type }
        : { ...cleanedData, importCount: 0, isApproved: true, type };

      await db.collection('scannedPlaylists').doc(playlistId).set(dataToSave, { merge: true });

      console.log(`[savePlaylistFromExtension] saved ${playlistId} (promoted=${!!existingData})`);
      response.status(200).json({ success: true, id: playlistId });
    } catch (error: any) {
      console.error('Error saving playlist:', error);
      response.status(500).json({ error: 'Failed to save playlist' });
    }
  }
);
