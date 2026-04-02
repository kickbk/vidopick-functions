# Vidopick Firebase

Cloud Functions and hosting for the Vidopick platform.

## Setup

```bash
cd functions
npm install
npm run build
```

Environment variables go in `functions/.env`. See the required keys below.

### Required Environment Variables

| Variable | Used By | Description |
|---|---|---|
| `EXTENSION_API_KEY` | savePlaylistFromExtension, deletePlaylistFromExtension, getPlaylistIdIndex, backfillPlaylistIdIndex | Shared secret between the Chrome extension and the playlist CFs |
| `OPENAI_API_KEY` | analyzeSharedPlaylist | GPT-4o-mini content analysis |
| `EMAIL_ACCOUNT` | sendSupportEmail, refreshPlaylistMetadata, analyzeSharedPlaylist | Gmail address for outgoing emails |
| `EMAIL_PASS` | sendSupportEmail, refreshPlaylistMetadata, analyzeSharedPlaylist | Gmail app password |
| `ALGOLIA_WRITE_API` | syncAlgolia (script) | Algolia write API key |

---

## Cloud Functions

### Playlist Management

#### `savePlaylistFromExtension`
**Type:** HTTP POST  
**Auth:** `EXTENSION_API_KEY` in request body

Saves a playlist document to the `scannedPlaylists` collection. Called by the Chrome extension after AI analysis. Validates payload size (500KB limit) and requires a playlist `id` field.

```json
POST { "apiKey": "...", "playlistData": { "id": "PLxxx", ... } }
```

---

#### `deletePlaylistFromExtension`
**Type:** HTTP POST  
**Auth:** `EXTENSION_API_KEY` in request body

Deletes a playlist document from `scannedPlaylists` by ID.

```json
POST { "apiKey": "...", "playlistId": "PLxxx" }
```

---

#### `analyzeSharedPlaylist`
**Type:** HTTP POST  
**Auth:** None (public)

Analyzes a YouTube playlist for child-appropriateness using OpenAI GPT-4o-mini. Fetches video metadata from the YouTube XML feed, runs AI analysis, calculates a ranking score, saves the result to `scannedPlaylists`, and emails a moderation alert. Results are cached — re-submitting the same playlist ID returns the cached result.

```json
POST { "playlistId": "PLxxx" }
```

---

#### `refreshPlaylistMetadata`
**Type:** HTTP POST  
**Auth:** None (internal use)

Iterates all playlists in `scannedPlaylists`, fetches their current YouTube XML feed to validate thumbnails and detect removed playlists, and sends email notifications for any changes. Run periodically to keep the database in sync with YouTube.

```json
POST {}
```

---

### Playlist ID Index

These three functions maintain `meta/playlistIdSet` — a single Firestore document where every key is a known playlist ID. The Chrome extension reads this document once on load instead of querying `scannedPlaylists` per playlist.

#### `onPlaylistCreated`
**Type:** Firestore trigger — `scannedPlaylists/{playlistId}` onCreate

Automatically adds the new playlist ID to `meta/playlistIdSet` whenever any playlist document is created, regardless of how it was created (extension, admin console, script, another function).

---

#### `onPlaylistDeleted`
**Type:** Firestore trigger — `scannedPlaylists/{playlistId}` onDelete

Automatically removes the playlist ID from `meta/playlistIdSet` whenever a playlist document is deleted.

---

#### `getPlaylistIdIndex`
**Type:** HTTP POST  
**Auth:** `EXTENSION_API_KEY` in request body

Returns all known playlist IDs as a flat array. Used by the Chrome extension on init. Bypasses App Check since the extension can't obtain an App Check token.

```json
POST  { "apiKey": "..." }
→     { "ids": ["PLxxx", "PLyyy", ...] }
```

---

#### `backfillPlaylistIdIndex`
**Type:** HTTP POST (one-time use)  
**Auth:** `EXTENSION_API_KEY` in request body

Reads all existing `scannedPlaylists` documents and rebuilds `meta/playlistIdSet` from scratch. Run this once after deploying `onPlaylistCreated`/`onPlaylistDeleted` for the first time to populate the index with pre-existing records.

```bash
curl -X POST https://backfillplaylistidindex-<hash>-uc.a.run.app \
  -H "Content-Type: application/json" \
  -d '{"secret": "<EXTENSION_API_KEY>"}'
```

---

### Short Links & Deep Links

#### `createShortLink`
**Type:** HTTP POST (Express)  
**Auth:** Firebase ID token (admin or advertiser)

Creates a `vpk.to/:id` short link. Admins can create links for anyone; advertisers can only create links stamped with their own UID. Supports custom slugs or auto-generated IDs via nanoid.

```json
POST /  { "linkTitle": "...", "redirect": { "ios": "...", "android": "...", "desktop": "..." }, "slug": "optional-custom-slug" }
```

---

#### `handleDeeplink`
**Type:** HTTP GET (Express)  
**Auth:** None (public)

Handles `vpk.to/:id` redirects. Detects bots and serves OG meta tags for social previews; real users are redirected to the iOS App Store, Google Play, or a desktop URL based on their device. Increments click analytics as a fire-and-forget operation.

---

#### `attribute`
**Type:** HTTP POST (Express)  
**Auth:** None (public)

Records a conversion event for a short link. Increments the `conversions` counter on the `shortLinks` document.

```json
POST /  { "linkId": "abc123", "platform": "ios", "method": "qr" }
```

---

### Advertiser & Ad Management

#### `createAdvertiserAccount`
**Type:** Callable  
**Auth:** Admin role required

Creates a Firebase Auth user for an advertiser, sets custom claims (`role: advertiser`, `advertiserId`), and returns a password reset link. Does not log out the calling admin.

```js
functions.httpsCallable('createAdvertiserAccount')({ advertiserId: '...', email: '...' })
```

---

#### `setAdvertiserClaims`
**Type:** Firestore trigger — `advertisers/{advertiserId}` onUpdate

Automatically sets `role: advertiser` and `advertiserId` custom claims on a Firebase Auth user when an `authUid` field is first written to an advertiser document.

---

#### `setAdminClaims`
**Type:** HTTP POST (one-time setup)  
**Auth:** `ADMIN_SETUP_SECRET` env variable (falls back to `'change-me-in-production'`)

Sets `role: admin` custom claims on a Firebase Auth user by UID. Run once during initial setup.

```json
POST { "secret": "...", "uid": "firebase-auth-uid" }
```

---

#### `getNextAdBatch`
**Type:** HTTP POST  
**Auth:** None (public, called by the mobile app)

Returns a curated batch of ads. Allocates 10% of slots to affiliate ads, fills remaining slots with paid ads weighted by tier (tiers 1–5). Platform-aware — pass `platform` to filter ads.

```json
POST { "platform": "ios", "batchSize": 10 }
```

---

#### `trackAdImpression`
**Type:** HTTP POST  
**Auth:** None (public, called by the mobile app)

Records impression and skip events for ads. Increments global counters and platform-specific stats (`platformStats.ios.impressions`, etc.).

```json
POST { "adId": "...", "advertiserId": "...", "platform": "ios", "wasSkipped": false }
```

---

### Invite Management

Four callable functions for managing referral invites. Admins have full access; regular users can only manage their own invites.

| Function | Description |
|---|---|
| `createInvite` | Create a new invite link |
| `updateInvite` | Modify an existing invite |
| `deleteInvite` | Remove an invite |
| `listInvites` | List invites (admins see all, users see their own) |

---

### Image Processing

#### `compressUploadedImage`
**Type:** Storage trigger — `onObjectFinalized`  
**Region:** `us-west1` (2 CPU / 2GiB)

Compresses and resizes images uploaded to Cloud Storage using Sharp. Handles two folder types:
- `ads/` → 1920×1080 WebP
- `invites/` → 1200×630 JPEG with portrait/landscape detection via EXIF

Deletes the original after writing the compressed version.

---

### Communication

#### `sendSupportEmail`
**Type:** HTTP POST  
**Auth:** None (CORS enabled)

Sends a support email to the Vidopick team via Gmail/nodemailer and fires an auto-reply to the user.

```json
POST { "name": "...", "email": "...", "message": "..." }
```

---

## Scripts

### `syncAlgolia`

**Run:** `npm run syncAlgolia` (from `functions/`)  
**Requires:** `ALGOLIA_WRITE_API` in `.env` and a Firebase service account at `functions/integrations/firebase/service-account.json`

Syncs the entire `scannedPlaylists` Firestore collection to Algolia. Clears the existing index first, then re-uploads all records. Run manually whenever you need to force a full re-index (e.g. after a schema migration or bulk edit).

```bash
cd functions
npm run build
npm run syncAlgolia
```

---

## Deployment

```bash
# Deploy all functions
npm run deploy

# Deploy hosting only
npm run deployFirebaseHosting

# View live logs
npm run logs
```

## Firestore Collections

| Collection | Description |
|---|---|
| `scannedPlaylists` | YouTube playlists with AI analysis and ranking |
| `meta/playlistIdSet` | Single document: map of `{ playlistId: true }` for fast ID lookups |
| `advertisers` | Advertiser accounts; each has an `ads` subcollection |
| `shortLinks` | vpk.to short link records with click/conversion analytics |
