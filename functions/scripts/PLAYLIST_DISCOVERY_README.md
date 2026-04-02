# Playlist Discovery Script - Integration Guide

## 📁 What Was Added

The playlist discovery system has been integrated into your existing Firebase functions structure:

```
functions/
├── scripts/
│   ├── createInvite.mjs          (existing)
│   ├── discoverPlaylists.mjs     ✨ NEW - Main discovery script
│   ├── knownShows.mjs            ✨ NEW - Shared show list
│   ├── .env.example              ✨ NEW - API keys template
│   └── output/                   ✨ NEW - Will be created for JSON outputs
└── package.json                  📝 UPDATED - Added dependencies & script
```

## 🔧 Setup

### 1. Install New Dependencies

```bash
cd functions
npm install
```

This will install:

- `axios` - For HTTP requests to YouTube API
- `openai` - For GPT-4o Mini analysis

### 2. Configure API Keys

Create a `.env` file in the `functions/scripts/` directory:

```bash
cd scripts
cp .env.example .env
```

Edit `.env` and add your API keys:

```env
YOUTUBE_API_KEY=your_youtube_api_key_here
OPENAI_API_KEY=your_openai_api_key_here
```

### 3. Get API Keys

**YouTube Data API v3:**

- Go to: https://console.cloud.google.com/apis/credentials
- Select your Firebase project (or create new)
- Enable "YouTube Data API v3"
- Create credentials → API key
- Copy the key to `.env`

**OpenAI API:**

- Go to: https://platform.openai.com/api-keys
- Create new secret key
- Add $5-10 credit to your account
- Copy the key to `.env`

## 🚀 Usage

### Basic Discovery

From the `functions` directory:

```bash
# Discover 200 playlists (default)
npm run discoverPlaylists

# Discover 500 playlists with auto-approve threshold of 7
npm run discoverPlaylists -- --totalTarget 500 --autoApproveScore 7
```

### 🎯 Targeted Discovery

**Age Group Discovery:**

```bash
# Only search age group 9-12
npm run discoverPlaylists -- --ageGroup "9-12"

# Valid age groups: "0-2", "3-5", "6-8", "9-12"
npm run discoverPlaylists -- --ageGroup "3-5" --totalTarget 50
```

**Custom Search Queries:**

```bash
# Search for specific topics
npm run discoverPlaylists -- --customQuery "minecraft for kids" --customQuery "cooking with children"

# Multiple custom queries
npm run discoverPlaylists -- --customQuery "spanish songs for kids" --customQuery "yoga for children" --totalTarget 100
```

**Channel Discovery:**

```bash
# Get all playlists from a specific channel (Peppa Pig Official)
npm run discoverPlaylists -- --channelId "UCvtR_Jvp69RLUpCU3P6yPzQ"

# Discover playlists from Bluey channel
npm run discoverPlaylists -- --channelId "UCg9JhbWdqAzxq4w1f7kc7NA" --totalTarget 30
```

**Specific Playlists:**

```bash
# Add specific playlist IDs (comma-separated)
npm run discoverPlaylists -- --playlistIds "PLLwuTjePwg2H_cPO8lXiJcvRdKMQJQv-h,PLzniq2d7RQwqjj4G5k8iOwIlV_CLMtHaY"

# Force add playlists you know are good
npm run discoverPlaylists -- --playlistIds "PLxxx,PLyyy,PLzzz"
```

### Combined Options

You can combine multiple targeting options:

```bash
# Channel search with custom target
npm run discoverPlaylists -- --channelId "UCvtR_Jvp69RLUpCU3P6yPzQ" --totalTarget 20 --autoApproveScore 7

# Age group with custom queries
npm run discoverPlaylists -- --ageGroup "3-5" --customQuery "counting songs" --totalTarget 50
```

### All Options

- `--totalTarget` - Number of playlists to approve (default: 200)
- `--autoApproveScore` - Minimum AI score for auto-approval (default: 8/10)
- `--resultsPerQuery` - YouTube results per search query (default: 20)
- `--saveToFiles` - Save JSON outputs to `scripts/output/` (default: true)
- `--ageGroup` - Target specific age group: "0-2", "3-5", "6-8", "9-12"
- `--customQuery` - Custom search term (can be used multiple times)
- `--channelId` - Discover all playlists from a specific YouTube channel
- `--playlistIds` - Comma-separated list of specific playlist IDs to process

## 🔄 How It Works

### 1. Firebase Integration

The script uses your existing Firebase setup:

- ✅ Loads credentials from `integrations/firebase/service-account.json`
- ✅ Uses same Firebase Admin initialization pattern as `createInvite.mjs`
- ✅ Writes to `scannedPlaylists` collection in Firestore

### 2. Discovery Modes

The script supports five discovery modes:

#### **Full Discovery (Default)**

- Searches all age groups (0-2, 3-5, 6-8, 9-12)
- Uses balanced mix of educational and entertainment queries
- Shuffles queries for diverse results

#### **Age Group Mode**

```bash
npm run discoverPlaylists -- --ageGroup "3-5"
```

- Focuses on specific age range
- Uses age-appropriate search terms
- Great for filling gaps in specific age categories

#### **Custom Query Mode**

```bash
npm run discoverPlaylists -- --customQuery "dinosaur videos"
```

- Searches for exactly what you specify
- Multiple queries can be combined
- Perfect for trending topics or specific requests

#### **Channel Mode**

```bash
npm run discoverPlaylists -- --channelId "UCvtR_Jvp69RLUpCU3P6yPzQ"
```

- Gets ALL playlists from a specific channel
- Great for adding all content from trusted creators
- Bypasses search algorithm limitations

#### **Specific Playlist Mode**

```bash
npm run discoverPlaylists -- --playlistIds "PLxxx,PLyyy"
```

- Processes exact playlist IDs you provide
- Perfect for manually curated additions
- Fastest mode for known good content

### 3. Discovery Process

1. **Check Firebase First** - Skips playlists already in your database
2. **Fetch Playlist Data** - Gets metadata and video feed
3. **AI Analysis** - GPT-4o Mini evaluates each playlist:
   - Age range (0-12)
   - Quality score (1-10)
   - Category (Educational/Entertainment/Music/Creative/Language)
   - Tags (concise, meaningful content themes)
   - Language detection
4. **Auto-Upload** - High-scoring playlists (8+) go directly to Firebase
5. **Save Results** - JSON files for review in `scripts/output/`

### 4. Firestore Document Structure

Each playlist is stored in the `scannedPlaylists` collection:

```javascript
scannedPlaylists/{playlistId} = {
  id: "PLxxx...",
  title: "Learn ABCs with Elmo",
  thumbnail: "https://i.ytimg.com/...",
  author: "Sesame Street",
  authorUrl: "https://youtube.com/channel/...",
  ageMin: 2,
  ageMax: 5,
  tags: ["Sesame Street", "songs", "alphabet", "counting"],
  category: "Educational",
  language: "English",
  description: "Educational playlist teaching letters...",
  sourceUrl: "https://youtube.com/playlist?list=PLxxx...",

  // Ranking system
  ranking: {
    score: 8.5,
    boost: 0,
    factors: {
      aiScore: 9.0,
      channelAuthority: 8.2,
      engagement: 7.8,
      freshness: 7.0
    }
  },

  // Channel metadata
  channelSubscribers: 5000000,
  channelVerified: true,

  // Status
  isApproved: true,         // Auto-approved if score >= 8
  isAppropriate: true,      // AI content safety check

  // Tracking
  reviewedBy: "ai",
  reviewedAt: Timestamp,
  scannedAt: Timestamp,
  updatedAt: Timestamp,
  scannedBy: "ai",

  // Analytics
  importCount: 0,
  likes: 0
}
```

## 📊 Output Files

The script creates JSON files in `scripts/output/`:

1. **`discovered-YYYY-MM-DD.json`** - All playlists found (with AI analysis)
2. **`approved-YYYY-MM-DD.json`** - Auto-approved playlists (uploaded to Firebase)
3. **`needs-review-YYYY-MM-DD.json`** - Good content but needs manual review
4. **`rejected-YYYY-MM-DD.json`** - Rejected playlists (inappropriate content)

## 💰 Cost Estimates

**YouTube API:**

- Free tier: 10,000 units/day
- Each search: ~100 units
- Channel search: ~1 unit
- Specific playlist: ~1 unit
- Can discover ~2,000 playlists/day for free

**OpenAI GPT-4o Mini:**

- $0.150 per 1M input tokens
- ~1,000 tokens per analysis
- 1,000 playlists ≈ **$0.15**

**Total for 1,000 playlists: ~$0.15** (plus free YouTube quota)

## 🎯 Common Use Cases

### Weekly Content Updates

```bash
# Discover 50 new playlists weekly
npm run discoverPlaylists -- --totalTarget 50
```

### Adding Popular Channels

```bash
# Add all Peppa Pig content
npm run discoverPlaylists -- --channelId "UCvtR_Jvp69RLUpCU3P6yPzQ"

# Add all Bluey content
npm run discoverPlaylists -- --channelId "UCBbqkdR7Ff-c0RMBF6BxQWw"

# Add all CoComelon content
npm run discoverPlaylists -- --channelId "UCbCmjCuTUZos6Inko4u57UQ"
```

### Filling Age Gaps

```bash
# Need more toddler content
npm run discoverPlaylists -- --ageGroup "0-2" --totalTarget 100

# Focus on older kids
npm run discoverPlaylists -- --ageGroup "9-12" --totalTarget 50
```

### Trending Topics

```bash
# Kids are asking for specific content
npm run discoverPlaylists -- --customQuery "minecraft for kids" --customQuery "among us kid friendly"

# Holiday content
npm run discoverPlaylists -- --customQuery "christmas songs for kids" --customQuery "halloween videos children"
```

### Manual Curation

```bash
# Someone sent you specific good playlists
npm run discoverPlaylists -- --playlistIds "PLxxx,PLyyy,PLzzz"
```

## 🔐 Security Notes

**No Private Data Exposed** ✅

The script:

- Loads credentials from the existing file
- Never exposes credentials in output files
- Only stores public playlist data in Firestore

**API Keys:**

- Store in `scripts/.env` (add to `.gitignore` if not already)
- Never commit `.env` to version control

## 🐛 Troubleshooting

**"Missing API keys" error:**

- Ensure `scripts/.env` exists with both API keys
- Check no extra spaces or quotes

**"Unable to read credentials" error:**

- The script looks for `../integrations/firebase/service-account.json`
- Verify the file exists and has valid JSON

**"Channel not found" error:**

- Verify the channel ID is correct
- Some channels may have restricted their playlist API access

**YouTube quota exceeded:**

- Wait 24 hours for quota reset
- Or enable billing for higher limits

**OpenAI errors:**

- Verify account has credit
- Check API key is active

## 📝 Example Runs

### Targeted Age Group Discovery

```bash
$ npm run discoverPlaylists -- --ageGroup "3-5" --totalTarget 50

🚀 Starting Playlist Discovery...
📊 Target: 50 playlists
✅ Auto-approve threshold: 8/10
🎯 Mode: Age group (3-5)

🔍 [1/8] Searching: "preschool educational playlist" (3-5)
   Found 20 playlists
...
=============================================================
📊 DISCOVERY COMPLETE
=============================================================
✅ Approved (isApproved: true): 50 playlists
⏳ Needs Review (isApproved: false): 8 playlists
⏭️  Already Existed: 3 playlists
❌ Rejected (not uploaded): 2 playlists
=============================================================
```

### Channel Discovery

```bash
$ npm run discoverPlaylists -- --channelId "UCvtR_Jvp69RLUpCU3P6yPzQ"

🚀 Starting Playlist Discovery...
📊 Target: 200 playlists
✅ Auto-approve threshold: 8/10
🎯 Mode: Channel search (UCvtR_Jvp69RLUpCU3P6yPzQ)

🔍 Searching channel: UCvtR_Jvp69RLUpCU3P6yPzQ
   Found 25 playlists from channel

📹 [1] Peppa Pig Episodes
      Channel: Peppa Pig Official
      👥 Subscribers: 10,500,000 ✓
      🤖 AI Score: 9/10
      🏷️  Tags: Peppa Pig, stories, family adventures, preschool
      ✅ AUTO-APPROVED & UPLOADED (isApproved: true)
...
```

### Specific Playlist Addition

```bash
$ npm run discoverPlaylists -- --playlistIds "PLLwuTjePwg2H_cPO8lXiJcvRdKMQJQv-h"

🚀 Starting Playlist Discovery...
📊 Target: 200 playlists
✅ Auto-approve threshold: 8/10
🎯 Mode: Specific playlists (1 IDs)

🔍 Fetching 1 specific playlists...

📹 [1/1] Fetching: PLLwuTjePwg2H_cPO8lXiJcvRdKMQJQv-h
      Title: Kids Educational Videos
      Channel: Learning Station
      🤖 AI Score: 8/10
      ✅ AUTO-APPROVED & UPLOADED (isApproved: true)
=============================================================
```

## 🔄 Running Regularly

Set up different discovery patterns:

```bash
# Daily: Small targeted updates
npm run discoverPlaylists -- --totalTarget 25

# Weekly: Focus on specific age groups
npm run discoverPlaylists -- --ageGroup "0-2" --totalTarget 50

# Monthly: Large discovery runs
npm run discoverPlaylists -- --totalTarget 500

# As needed: Add popular channels
npm run discoverPlaylists -- --channelId "CHANNEL_ID"

# Manual: Add specific playlists from recommendations
npm run discoverPlaylists -- --playlistIds "PLxxx,PLyyy"
```

The script automatically skips playlists already in Firebase, so you can run it safely multiple times.

---

Ready to discover playlists! 🚀
