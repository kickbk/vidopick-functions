#!/usr/bin/env node
/**
 * Migration Script: Convert category string to categories array
 *
 * Reads each approved playlist in scannedPlaylists, maps the `category`
 * string to a `categories` string array using rule-based pattern matching,
 * then falls back to AI reclassification for ambiguous cases.
 *
 * Rule-based mapping examples:
 *   "Music"                       → ["Music"]
 *   "Educational"                 → ["Educational"]
 *   "Educational/Entertainment"   → ["Educational", "Entertainment"]
 *   "Children's Music"            → ["Music"]
 *   "Animated Series"             → ["Animation"]
 *   "Kids Yoga"                   → ["Dance & Fitness"]
 *   Unmatched                     → categoryNeedsReview: true
 *
 * Usage:
 *   node scripts/migrateCategories.mjs
 *   node scripts/migrateCategories.mjs --dryRun
 *   node scripts/migrateCategories.mjs --maxRecords 10
 *   node scripts/migrateCategories.mjs --id <playlistId>
 *   node scripts/migrateCategories.mjs --fixReviews          # AI pass for unmatched records
 *   node scripts/migrateCategories.mjs --fixReviews --dryRun
 */

import axios from 'axios';
import dotenv from 'dotenv';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import OpenAI from 'openai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

const CREDS_PATH = path.resolve(__dirname, '../integrations/firebase/service-account.json');

let credsJson;
try {
  const raw = fs.readFileSync(CREDS_PATH, 'utf8');
  credsJson = JSON.parse(raw);
} catch (e) {
  console.error(`❌ Unable to read credentials at ${CREDS_PATH}`);
  process.exit(1);
}

if (!getApps().length) {
  initializeApp({ credential: cert(credsJson), projectId: credsJson.project_id });
}

const db = getFirestore();
const COLLECTION_NAME = 'scannedPlaylists';

const KNOWN_CATEGORIES = [
  'Educational',
  'Music',
  'Stories',
  'Animation',
  'Art & Crafts',
  'Dance & Fitness',
  'Health & Wellness',
  'Language',
  'Entertainment',
];

// ---------------------------------------------------------------------------
// Rule-based mapping
// ---------------------------------------------------------------------------

/**
 * Rules are evaluated in order. Each rule maps a regex (tested against the
 * raw category string, case-insensitive) to one or more target categories.
 * The FIRST matching rule wins for each segment when splitting compounds.
 */
const RULES = [
  // Music
  { pattern: /music|song|nursery|lullaby|rhyme|sing.?along|chant/i, category: 'Music' },
  // Educational
  { pattern: /educat|learning|science|stem|school|math|alphabet|short.?film/i, category: 'Educational' },
  // Animation
  { pattern: /anim|cartoon/i, category: 'Animation' },
  // Stories
  { pattern: /stor|fairy|bedtime|storytime|tale|literature/i, category: 'Stories' },
  // Art & Crafts
  { pattern: /art|craft|creative|cook|draw|diy|humanit/i, category: 'Art & Crafts' },
  // Dance & Fitness
  { pattern: /dance|gymnastics/i, category: 'Dance & Fitness' },
  // Health & Wellness
  { pattern: /yoga|fitness|wellness|mindful|meditat|relaxa|health|calm|breathe|zen/i, category: 'Health & Wellness' },
  // Language learning
  { pattern: /language\s+learn|bilingual|learn.*spanish|learn.*french|learn.*chinese|learn.*hebrew/i, category: 'Language' },
  // Entertainment — broad catch-all patterns go last so more specific rules win first
  { pattern: /entertainment|action|adventure|comedy|family|kids.*family|toy|game|superhero|ninjago|transformer|racing|sport/i, category: 'Entertainment' },
];

/**
 * Map a single segment to a known category, or return null if unmatched.
 */
function mapSegment(segment) {
  const s = segment.trim();
  // Exact match first (case-insensitive)
  const exact = KNOWN_CATEGORIES.find((c) => c.toLowerCase() === s.toLowerCase());
  if (exact) return exact;
  // Rule-based match
  for (const rule of RULES) {
    if (rule.pattern.test(s)) return rule.category;
  }
  return null;
}

/**
 * Split a compound category string on common separators and map each segment.
 * Returns { categories, needsReview }.
 */
function mapCategoryString(raw) {
  if (!raw || typeof raw !== 'string') return { categories: null, needsReview: true };

  // Split on "/" or " and " (but not within words)
  const segments = raw.split(/\s*\/\s*|\s+and\s+/i).map((s) => s.trim()).filter(Boolean);

  const mapped = new Set();

  for (const seg of segments) {
    const result = mapSegment(seg);
    if (result) mapped.add(result);
  }

  if (mapped.size === 0) {
    return { categories: null, needsReview: true };
  }

  // If some segments matched and some didn't, still use what we got
  // (AI can clean up later if needed)
  return { categories: [...mapped], needsReview: false };
}

// ---------------------------------------------------------------------------
// Main migration
// ---------------------------------------------------------------------------

async function migrateCategories(options = {}) {
  const { dryRun = false, maxRecords = Infinity, all = false, id = null, unapprovedOnly = false } = options;

  console.log('🚀 Starting category migration...');
  if (dryRun) console.log('🔍 DRY RUN — no changes will be written\n');
  if (id) console.log(`🎯 Targeting single record: ${id}\n`);
  if (unapprovedOnly) console.log('🔒 Processing unapproved playlists only\n');
  if (maxRecords !== Infinity) console.log(`🔢 Processing at most ${maxRecords} records\n`);

  let playlists;

  if (id) {
    const doc = await db.collection(COLLECTION_NAME).doc(id).get();
    if (!doc.exists) { console.error(`❌ No record found with id "${id}"`); return; }
    playlists = [{ docId: doc.id, ...doc.data() }];
    console.log(`📊 Found 1 playlist\n`);
  } else {
    let query = db.collection(COLLECTION_NAME);
    if (unapprovedOnly) query = query.where('isApproved', '==', false);
    else if (!all) query = query.where('isApproved', '==', true);
    const snapshot = await query.get();
    const label = unapprovedOnly ? 'unapproved only' : all ? 'approved + unapproved' : 'approved only';
    playlists = snapshot.docs.map((doc) => ({ docId: doc.id, ...doc.data() }));
    console.log(`📊 Found ${playlists.length} playlist(s) (${label})`);
  }

  // Only process records that still have the old string field
  const needsMigration = playlists.filter(
    (p) => typeof p.category === 'string' && !Array.isArray(p.categories)
  );
  console.log(`🔧 ${needsMigration.length} record(s) need migration\n`);

  if (needsMigration.length === 0) { console.log('✅ Nothing to migrate!'); return; }

  let converted = 0;
  let markedForReview = 0;
  let failed = 0;
  let processed = 0;

  for (const playlist of needsMigration) {
    if (processed >= maxRecords) {
      console.log(`\n⏹  Reached --maxRecords limit of ${maxRecords}`);
      break;
    }

    const raw = playlist.category;
    console.log(`\n📹 ${playlist.title || playlist.docId}`);
    console.log(`   category (old): "${raw}"`);

    const { categories: fromCategory, needsReview } = mapCategoryString(raw);

    // Also scan title + tags to catch additional categories the old string missed
    // e.g. old category "Educational" but title contains "Arts and Crafts"
    const titleAndTags = [playlist.title || '', ...(playlist.tags || [])].join(' ');
    const fromTitle = new Set(
      RULES.map((r) => (r.pattern.test(titleAndTags) ? r.category : null)).filter(Boolean)
    );

    const categoriesSet = new Set([...(fromCategory || []), ...fromTitle]);
    // If nothing at all matched, mark for AI review
    const categories = categoriesSet.size > 0 ? [...categoriesSet] : null;

    if (needsReview) {
      console.log(`   ⚠️  Unmatched — marking for AI review`);
      if (!dryRun) {
        try {
          await db.collection(COLLECTION_NAME).doc(playlist.docId).update({
            categoryNeedsReview: true,
            updatedAt: new Date(),
          });
        } catch (err) {
          console.error(`   ❌ Failed: ${err.message}`);
          failed++;
          processed++;
          continue;
        }
      }
      markedForReview++;
    } else {
      console.log(`   categories (new): ${JSON.stringify(categories)}`);
      if (!dryRun) {
        try {
          await db.collection(COLLECTION_NAME).doc(playlist.docId).update({
            categories,
            category: FieldValue.delete(),
            updatedAt: new Date(),
          });
        } catch (err) {
          console.error(`   ❌ Failed: ${err.message}`);
          failed++;
          processed++;
          continue;
        }
      }
      converted++;
    }
    processed++;
  }

  console.log('\n' + '='.repeat(60));
  console.log('📊 MIGRATION COMPLETE');
  console.log('='.repeat(60));
  console.log(`✅ Converted:             ${converted}`);
  console.log(`⚠️  Marked for AI review:  ${markedForReview}`);
  if (failed > 0) console.log(`❌ Failed:                ${failed}`);
  if (dryRun) console.log('\n💡 Run without --dryRun to apply changes');
  if (markedForReview > 0) console.log(`\n💡 Run --fixReviews to reclassify the ${markedForReview} unmatched record(s) via AI`);
  console.log('='.repeat(60));
}

// ---------------------------------------------------------------------------
// AI fix-reviews pass
// ---------------------------------------------------------------------------

async function fetchVideoTitles(playlistId) {
  try {
    const response = await axios.get(
      `https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistId}`
    );
    const titles = [];
    for (const match of response.data.matchAll(/<media:title>(.*?)<\/media:title>/g)) {
      titles.push(match[1]);
    }
    return titles.slice(0, 10);
  } catch {
    return [];
  }
}

async function fetchCategoriesFromAI(playlistTitle, tags, videoTitles) {
  if (!openai) throw new Error('OPENAI_API_KEY not set in .env');

  const titlesText = videoTitles.length > 0
    ? videoTitles.map((t, i) => `${i + 1}. ${t}`).join('\n')
    : '(not available)';

  const prompt = `A YouTube children's playlist is titled "${playlistTitle}".
Tags: ${(tags || []).join(', ') || '(none)'}
First video titles:\n${titlesText}

Choose one or more categories from this list:
${KNOWN_CATEGORIES.map((c) => `- ${c}`).join('\n')}

Rules:
- Prefer existing categories — use a new value only if none of the above fits.
- 1 category is ideal; 2 if the content genuinely spans both equally.
- Return ONLY a JSON object: {"categories": ["Category1"]}

Known patterns to guide you:
- Action, Adventure, Action/Adventure, Superhero, Ninjago, Transformers, Racing → Entertainment
- Kids & Family, Family & Friendship → Entertainment
- Toys & Games → Entertainment
- Short Films → Educational
- Mindfulness, Meditation, Relaxation, Health & Wellness, Yoga for Kids → Health & Wellness
- Arts, Crafts, Humanities → Art & Crafts
- Comedy → Entertainment`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: 'You categorise kids YouTube playlists. Return only JSON.' },
      { role: 'user', content: prompt },
    ],
    temperature: 0.2,
    response_format: { type: 'json_object' },
  });

  const result = JSON.parse(completion.choices[0].message.content);
  if (!Array.isArray(result.categories) || result.categories.length === 0) {
    throw new Error(`Unexpected AI response: ${JSON.stringify(result)}`);
  }
  return result.categories;
}

async function fixReviews(options = {}) {
  const { dryRun = false } = options;

  console.log('🔧 Fixing playlists marked for category re-review...');
  if (dryRun) console.log('🔍 DRY RUN — no changes will be written\n');

  if (!openai) {
    console.error('❌ OPENAI_API_KEY is not set in .env — cannot call AI');
    process.exit(1);
  }

  const snapshot = await db
    .collection(COLLECTION_NAME)
    .where('categoryNeedsReview', '==', true)
    .get();

  const playlists = snapshot.docs.map((doc) => ({ docId: doc.id, ...doc.data() }));
  console.log(`📊 Found ${playlists.length} playlist(s) to fix\n`);

  if (playlists.length === 0) { console.log('✅ Nothing to fix!'); return; }

  let fixed = 0;
  let failed = 0;

  for (const playlist of playlists) {
    console.log(`\n📹 ${playlist.title || playlist.docId}`);
    console.log(`   old category: "${playlist.category || '(none)'}"`);

    try {
      const videoTitles = await fetchVideoTitles(playlist.docId);
      const categories = await fetchCategoriesFromAI(
        playlist.title,
        playlist.tags,
        videoTitles
      );
      console.log(`   categories (new): ${JSON.stringify(categories)}`);

      if (!dryRun) {
        await db.collection(COLLECTION_NAME).doc(playlist.docId).update({
          categories,
          category: FieldValue.delete(),
          categoryNeedsReview: FieldValue.delete(),
          updatedAt: new Date(),
        });
      }
      fixed++;
      await new Promise((resolve) => setTimeout(resolve, 500));
    } catch (err) {
      console.error(`   ❌ Failed: ${err.message}`);
      failed++;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('📊 FIX REVIEWS COMPLETE');
  console.log('='.repeat(60));
  console.log(`✅ Fixed:   ${fixed}`);
  if (failed > 0) console.log(`❌ Failed:  ${failed}`);
  if (dryRun) console.log('\n💡 Run without --dryRun to apply changes');
  console.log('='.repeat(60));
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const filteredArgs = process.argv.slice(2).filter((a) => a !== '--');
const { values } = parseArgs({
  args: filteredArgs,
  options: {
    dryRun:         { type: 'boolean', default: false },
    maxRecords:     { type: 'string',  default: '0' },
    all:            { type: 'boolean', default: false },
    id:             { type: 'string',  default: '' },
    fixReviews:     { type: 'boolean', default: false },
    unapprovedOnly: { type: 'boolean', default: false },
  },
  strict: false,
});

const maxRecords = parseInt(values.maxRecords, 10);
const task = values.fixReviews
  ? fixReviews({ dryRun: values.dryRun })
  : migrateCategories({
      dryRun:         values.dryRun,
      maxRecords:     maxRecords > 0 ? maxRecords : Infinity,
      all:            values.all,
      id:             values.id || null,
      unapprovedOnly: values.unapprovedOnly,
    });

task
  .then(() => { console.log('\n✨ Done!'); process.exit(0); })
  .catch((err) => { console.error('\n💥 Error:', err); process.exit(1); });
