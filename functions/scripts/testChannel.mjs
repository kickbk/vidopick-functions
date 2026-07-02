#!/usr/bin/env node
/**
 * Quick test: fetch channel metadata + uploads via YouTube Data API v3
 * Usage: node scripts/testChannel.mjs <channelId>
 * Example: node scripts/testChannel.mjs UCE9PvJqbA-muu5D3sIDQ7Rw
 */

import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const API_KEY = process.env.YOUTUBE_API_KEY;
const channelId = process.argv[2];

if (!channelId) {
  console.error('Usage: node scripts/testChannel.mjs <channelId>');
  process.exit(1);
}

async function get(url) {
  const res = await fetch(url);
  const json = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(json.error, null, 2));
  return json;
}

// 1. Channel metadata
console.log('\n── channels.list ──────────────────────────────────────');
const channel = await get(
  `https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails,statistics&id=${channelId}&key=${API_KEY}`
);
console.log(JSON.stringify(channel, null, 2));

const uploadsPlaylistId = channel.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
console.log('\n── uploads playlist ID:', uploadsPlaylistId);

if (!uploadsPlaylistId) {
  console.log('No uploads playlist found — channel may be private or have no uploads.');
  process.exit(0);
}

// 2. Videos in the uploads playlist
console.log('\n── playlistItems.list (uploads) ───────────────────────');
const items = await get(
  `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${uploadsPlaylistId}&maxResults=10&key=${API_KEY}`
);
console.log(JSON.stringify(items, null, 2));
