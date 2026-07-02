/**
 * Firebase Cloud Function to refresh playlist/channel metadata
 *
 * Checks playlist/channel thumbnails and updates metadata from YouTube XML feeds
 * - Verifies existing thumbnails are still valid
 * - Fetches new thumbnails and titles if changed
 * - Marks playlists as removed if feed returns 404
 * - Sends email notifications for changes
 */

import * as admin from 'firebase-admin';
import { onRequest } from 'firebase-functions/v2/https';
import { Resend } from 'resend';
import axios from 'axios';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const RESEND_API_KEY = process.env.RESEND_API_KEY;

interface PlaylistMetadata {
  id: string;
  thumbnail: string;
  oldThumbnail?: string;
  title: string;
}

interface RefreshResult {
  updated: PlaylistMetadata[];
  removed: string[];
  unchanged: string[];
}

interface PlaylistChange {
  id: string;
  title: string;
  oldThumbnail?: string;
  newThumbnail?: string;
  oldTitle?: string;
  newTitle?: string;
}

/**
 * Check if a URL is accessible (returns 200)
 */
async function isUrlAccessible(url: string, retries = 2): Promise<boolean> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await axios.head(url, { timeout: 5000 });
      if (response.status === 200) {
        return true;
      }
    } catch (error) {
      // If not last attempt, wait before retry
      if (attempt < retries - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }
  return false;
}

/**
 * Fetch playlist metadata from YouTube XML feed
 */
async function fetchPlaylistMetadata(playlistId: string): Promise<{
  videoId: string | null;
  title: string | null;
  exists: boolean;
}> {
  try {
    const response = await axios.get(
      `https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistId}`,
      { timeout: 10000 }
    );

    // Extract first video ID for thumbnail
    const videoIdMatch = response.data.match(/<yt:videoId>([a-zA-Z0-9_-]{11})<\/yt:videoId>/);

    // Extract playlist title
    const titleMatch = response.data.match(/<title>([^<]+)<\/title>/);

    return {
      videoId: videoIdMatch ? videoIdMatch[1] : null,
      title: titleMatch ? titleMatch[1] : null,
      exists: true,
    };
  } catch (error: any) {
    // 404 means playlist was removed
    if (error.response?.status === 404) {
      return { videoId: null, title: null, exists: false };
    }

    console.error(`Error fetching metadata for ${playlistId}:`, error.message);
    throw error;
  }
}

/**
 * Send email notification about playlist/channel changes
 */
async function sendNotificationEmail(
  updates: PlaylistChange[],
  removals: Array<{ id: string; title: string }>
): Promise<void> {
  if (!RESEND_API_KEY) {
    console.warn('[email] RESEND_API_KEY not set, skipping');
    return;
  }

  if (updates.length === 0 && removals.length === 0) {
    return;
  }

  const resend = new Resend(RESEND_API_KEY);

  // Build email content
  let updatesHtml = '';
  if (updates.length > 0) {
    updatesHtml = `
      <h3 style="color: #333; margin-top: 20px;">Updated Playlists (${updates.length})</h3>
      <ul style="list-style: none; padding: 0;">
        ${updates
          .map((change) => {
            const changes: string[] = [];

            if (change.newThumbnail && change.oldThumbnail !== change.newThumbnail) {
              changes.push(`Thumbnail updated`);
            }

            if (change.newTitle && change.oldTitle !== change.newTitle) {
              changes.push(`Title: "${change.oldTitle}" → "${change.newTitle}"`);
            }

            return `
            <li style="margin: 15px 0; padding: 15px; background-color: #f5f5f5; border-radius: 5px;">
              <strong>${change.title}</strong> (${change.id})
              <br/>
              <span style="color: #666; font-size: 14px;">${changes.join(' | ')}</span>
              <br/>
              <a href="https://youtube.com/playlist?list=${change.id}" style="color: #0066cc; font-size: 12px;">View Playlist/Channel</a>
              ${change.newThumbnail ? `<br/><a href="${change.newThumbnail}" style="color: #0066cc; font-size: 12px;">View Thumbnail</a>` : ''}
            </li>
          `;
          })
          .join('')}
      </ul>
    `;
  }

  let removalsHtml = '';
  if (removals.length > 0) {
    removalsHtml = `
      <h3 style="color: #d9534f; margin-top: 20px;">Removed Playlists (${removals.length})</h3>
      <ul style="list-style: none; padding: 0;">
        ${removals
          .map(
            ({ id, title }) => `
          <li style="margin: 10px 0; padding: 10px; background-color: #fff3f3; border-radius: 5px;">
            <strong>${title}</strong> (${id})
            <br/>
            <span style="color: #999; font-size: 12px;">Playlist or channel deleted or suspended</span>
          </li>
        `
          )
          .join('')}
      </ul>
    `;
  }

  try {
    await resend.emails.send({
      from: 'Vidopick <hello@vidopick.com>',
      to: 'info@vidopick.com',
      subject: `Vidopick Content Changes Detected - ${updates.length} Updated, ${removals.length} Removed`,
      html: `
      <div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto;">
        <h2 style="color: #333; border-bottom: 2px solid #0066cc; padding-bottom: 10px;">
          Vidopick Metadata Changes
        </h2>

        <p style="color: #666;">
          Detected changes in playlist or channel metadata at ${new Date().toLocaleString()}
        </p>

        ${updatesHtml}
        ${removalsHtml}

        <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;" />

        <p style="color: #999; font-size: 12px;">
          This is an automated notification from Vidopick's content refresh system.
        </p>
      </div>
    `,
    });
    console.log('Notification email sent successfully');
  } catch (error) {
    console.error('Failed to send notification email:', error);
  }
}

export const refreshPlaylistMetadata = onRequest(
  {
    cors: true,
    region: 'us-central1',
    timeoutSeconds: 540, // 9 minutes (allow time for many playlists)
  },
  async (request, response) => {
    if (request.method !== 'POST') {
      response.status(405).json({ error: 'Method not allowed' });
      return;
    }

    // Admin-only: this is a maintenance endpoint that calls the YouTube API and
    // writes/removes scannedPlaylists docs. No app/web client calls it; require a
    // Firebase ID token with the admin claim so it can't be hit anonymously.
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      response.status(401).json({ error: 'Unauthorized' });
      return;
    }
    try {
      const decoded = await admin.auth().verifyIdToken(authHeader.split('Bearer ')[1]);
      if (decoded.role !== 'admin') {
        response.status(403).json({ error: 'Forbidden' });
        return;
      }
    } catch {
      response.status(401).json({ error: 'Invalid token' });
      return;
    }

    const { playlistIds } = request.body as { playlistIds: string[] };

    // Validate input
    if (!playlistIds || !Array.isArray(playlistIds) || playlistIds.length === 0) {
      response.status(400).json({ error: 'Missing or invalid playlistIds array' });
      return;
    }

    // Limit batch size to prevent timeout
    if (playlistIds.length > 50) {
      response.status(400).json({ error: 'Maximum 50 playlists per request' });
      return;
    }

    console.log(`Refreshing metadata for ${playlistIds.length} playlists`);

    const result: RefreshResult = {
      updated: [],
      removed: [],
      unchanged: [],
    };

    const changes: PlaylistChange[] = [];
    const removals: Array<{ id: string; title: string }> = [];

    try {
      // Process playlists sequentially with delays to avoid rate limits
      for (let i = 0; i < playlistIds.length; i++) {
        const playlistId = playlistIds[i];

        try {
          // Fetch existing playlist/channel data from Firestore
          const docRef = db.collection('scannedPlaylists').doc(playlistId);
          const doc = await docRef.get();

          if (!doc.exists) {
            console.log(`Playlist or Channel ${playlistId} not found in database, skipping`);
            continue;
          }

          const existingData = doc.data();
          const existingThumbnail = existingData?.thumbnail;
          const existingTitle = existingData?.title;

          // Step 1: Check if existing thumbnail is still accessible
          if (existingThumbnail) {
            const isAccessible = await isUrlAccessible(existingThumbnail);

            if (isAccessible) {
              console.log(`Thumbnail still valid for ${playlistId}, skipping`);
              result.unchanged.push(playlistId);

              // Add delay before next iteration
              if (i < playlistIds.length - 1) {
                await new Promise((resolve) => setTimeout(resolve, 200));
              }
              continue;
            }
          }

          // Step 2: Thumbnail is broken or missing, fetch from XML feed
          console.log(`Fetching fresh metadata for ${playlistId}`);
          const metadata = await fetchPlaylistMetadata(playlistId);

          // Step 3: Check if playlist was removed
          if (!metadata.exists) {
            console.log(`Playlist or Channel ${playlistId} was removed`);

            // Mark as removed in Firestore
            await docRef.update({
              isRemoved: true,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });

            result.removed.push(playlistId);
            removals.push({
              id: playlistId,
              title: existingTitle || playlistId,
            });

            // Add delay before next iteration
            if (i < playlistIds.length - 1) {
              await new Promise((resolve) => setTimeout(resolve, 200));
            }
            continue;
          }

          // Step 4: Playlist exists, check if metadata changed
          const newThumbnail = metadata.videoId
            ? `https://img.youtube.com/vi/${metadata.videoId}/mqdefault.jpg`
            : existingThumbnail;

          const newTitle = metadata.title || existingTitle;

          // Determine if update is needed
          const thumbnailChanged = newThumbnail !== existingThumbnail;
          const titleChanged = newTitle !== existingTitle;

          if (thumbnailChanged || titleChanged) {
            console.log(`Updating metadata for ${playlistId}`);

            // Create the update object
            const updateData: any = {
              thumbnail: newThumbnail,
              title: newTitle,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            };

            // Only add previousThumbnail if we actually had one to begin with
            if (existingThumbnail) {
              updateData.previousThumbnail = existingThumbnail;
            }

            // Update Firestore
            await docRef.update(updateData);

            result.updated.push({
              id: playlistId,
              thumbnail: newThumbnail,
              oldThumbnail: existingThumbnail,
              title: newTitle,
            });

            changes.push({
              id: playlistId,
              title: newTitle,
              oldThumbnail: existingThumbnail,
              newThumbnail: thumbnailChanged ? newThumbnail : undefined,
              oldTitle: existingTitle,
              newTitle: titleChanged ? newTitle : undefined,
            });
          } else {
            result.unchanged.push(playlistId);
          }
        } catch (error: any) {
          console.error(
            `Error processing playlist or channel with ID ${playlistId}:`,
            error.message
          );
          // Continue with next playlist instead of failing entire batch
        }

        // Add delay between requests to avoid rate limiting
        if (i < playlistIds.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      }

      // Send email notification if there were any changes
      if (changes.length > 0 || removals.length > 0) {
        await sendNotificationEmail(changes, removals);
      }

      console.log('Refresh complete:', {
        updated: result.updated.length,
        removed: result.removed.length,
        unchanged: result.unchanged.length,
      });

      response.status(200).json(result);
    } catch (error: any) {
      console.error('Refresh failed:', error);
      response.status(500).json({
        error: 'Failed to refresh playlists',
        details: error?.message,
      });
    }
  }
);
