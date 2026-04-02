import * as admin from 'firebase-admin';
import { onRequest } from 'firebase-functions/v2/https';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

export const deletePlaylistFromExtension = onRequest(
  {
    cors: true,
    region: 'us-central1',
  },
  async (request, response) => {
    // 1. Only allow POST for security (matches your 'save' pattern)
    if (request.method !== 'POST') {
      response.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const { apiKey, playlistId } = request.body;
    const expectedKey = process.env.EXTENSION_API_KEY;

    console.log(`Extension playlist delete attempt for ID: ${playlistId}`);

    // 2. Verify API key
    if (!apiKey || !expectedKey || apiKey !== expectedKey) {
      console.error('Invalid API key for deletion');
      response.status(401).json({ error: 'Invalid API key' });
      return;
    }

    // 3. Validate ID presence
    if (!playlistId) {
      response.status(400).json({ error: 'Missing playlist ID' });
      return;
    }

    try {
      // 4. Delete the document from the same collection used in 'save'
      await db.collection('scannedPlaylists').doc(playlistId).delete();

      console.log('Playlist deleted successfully:', playlistId);
      response.status(200).json({ success: true, id: playlistId });
    } catch (error: any) {
      console.error('Error deleting playlist:', error);
      response.status(500).json({
        error: 'Failed to delete playlist',
        details: error?.message,
      });
    }
  }
);