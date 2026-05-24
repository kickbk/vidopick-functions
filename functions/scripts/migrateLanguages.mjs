#!/usr/bin/env node
/**
 * Migration Script: Convert language string to languages array
 *
 * Reads each approved playlist in scannedPlaylists, converts the `language`
 * string field to a `languages` string array, and removes the old field.
 *
 * Handles patterns like:
 *   "English"                           → ["English"]
 *   "English and Spanish"               → ["English", "Spanish"]
 *   "Spanish/English"                   → ["Spanish", "English"]
 *   "English & Spanish"                 → ["English", "Spanish"]
 *   "English, Spanish"                  → ["English", "Spanish"]
 *   "Bilingual (English and Spanish)"   → ["English", "Spanish"]
 *   "Multiple" / "Multiple languages"   → marked for re-analysis
 *   "Bilingual"                         → marked for re-analysis
 *
 * Usage:
 *   node scripts/migrateLanguages.mjs
 *   node scripts/migrateLanguages.mjs --dryRun
 *   node scripts/migrateLanguages.mjs --maxRecords 5
 *   node scripts/migrateLanguages.mjs --all           # include unapproved playlists too
 *   node scripts/migrateLanguages.mjs --fixReviews    # re-ask AI for playlists marked languageNeedsReview
 *   node scripts/migrateLanguages.mjs --fixReviews --dryRun
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
  console.error(`Error: ${e?.message || e}`);
  process.exit(1);
}

if (!getApps().length) {
  initializeApp({
    credential: cert(credsJson),
    projectId: credsJson.project_id,
  });
}

const db = getFirestore();
const COLLECTION_NAME = 'scannedPlaylists';

/**
 * Ambiguous strings that can't be meaningfully split — need AI re-analysis.
 */
const AMBIGUOUS_PATTERNS = [
  /^multiple$/i,
  /^multiple\s+languages?$/i,
  /^multilingual$/i,
  /^bilingual$/i,
  /^various$/i,
  /^mixed$/i,
];

function isAmbiguous(str) {
  return AMBIGUOUS_PATTERNS.some((re) => re.test(str.trim()));
}

/**
 * Split a raw string into individual language names.
 * Handles: " and ", " & ", "/", ", "
 */
function splitLanguageString(str) {
  return str
    .split(/\s+and\s+|\s*&\s*|\s*\/\s*|,\s*/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Parse a language string into an array of language names, or signal
 * that this record needs AI re-analysis.
 *
 * Returns:
 *   { languages: string[], needsReview: false }  — successfully parsed
 *   { languages: null,     needsReview: true  }  — ambiguous, re-analyze
 */
function parseLanguageString(raw) {
  if (!raw || typeof raw !== 'string') {
    return { languages: null, needsReview: true };
  }

  const str = raw.trim();

  // Already clean single ambiguous token
  if (isAmbiguous(str)) {
    return { languages: null, needsReview: true };
  }

  // "Bilingual (English and Spanish)" — extract the parenthesised part
  const bilingualMatch = str.match(/^bilingual\s*\((.+)\)$/i);
  if (bilingualMatch) {
    const parts = splitLanguageString(bilingualMatch[1]);
    if (parts.length > 0) {
      return { languages: parts, needsReview: false };
    }
    return { languages: null, needsReview: true };
  }

  // Try splitting on known separators
  const parts = splitLanguageString(str);
  return { languages: parts, needsReview: false };
}

/**
 * Main migration function
 */
async function migrateLanguages(options = {}) {
  const { dryRun = false, maxRecords = Infinity, all = false, id = null } = options;

  console.log('🚀 Starting language migration...');
  if (dryRun) console.log('🔍 DRY RUN — no changes will be written\n');
  if (id) console.log(`🎯 Targeting single record: ${id}\n`);
  if (maxRecords !== Infinity) console.log(`🔢 Processing at most ${maxRecords} records\n`);

  let playlists;

  if (id) {
    // Single record by ID — skip collection query
    const doc = await db.collection(COLLECTION_NAME).doc(id).get();
    if (!doc.exists) {
      console.error(`❌ No record found with id "${id}"`);
      return;
    }
    playlists = [{ docId: doc.id, ...doc.data() }];
    console.log(`📊 Found 1 playlist\n`);
  } else {
    // Fetch playlists
    let query = db.collection(COLLECTION_NAME);
    if (!all) {
      query = query.where('isApproved', '==', true);
    }
    const snapshot = await query.get();
    playlists = snapshot.docs.map((doc) => ({ docId: doc.id, ...doc.data() }));
    console.log(`📊 Found ${playlists.length} playlist(s) (approved${all ? ' + unapproved' : ' only'})`);
  }

  // Only process records that still have the old string field
  const needsMigration = playlists.filter(
    (p) => typeof p.language === 'string' && !Array.isArray(p.languages)
  );

  console.log(`🔧 ${needsMigration.length} record(s) need migration\n`);

  if (needsMigration.length === 0) {
    console.log('✅ Nothing to migrate!');
    return;
  }

  let converted = 0;
  let markedForReview = 0;
  let failed = 0;
  let processed = 0;

  for (const playlist of needsMigration) {
    if (processed >= maxRecords) {
      console.log(`\n⏹  Reached --maxRecords limit of ${maxRecords}`);
      break;
    }

    const raw = playlist.language;
    console.log(`\n📹 ${playlist.title || playlist.docId}`);
    console.log(`   language (old): "${raw}"`);

    const { languages, needsReview } = parseLanguageString(raw);

    if (needsReview) {
      console.log(`   ⚠️  Ambiguous — marking for re-analysis`);

      if (!dryRun) {
        try {
          await db.collection(COLLECTION_NAME).doc(playlist.docId).update({
            languageNeedsReview: true,
            updatedAt: new Date(),
          });
        } catch (err) {
          console.error(`   ❌ Failed to mark: ${err.message}`);
          failed++;
          processed++;
          continue;
        }
      }
      markedForReview++;
    } else {
      console.log(`   languages (new): ${JSON.stringify(languages)}`);

      if (!dryRun) {
        try {
          await db.collection(COLLECTION_NAME).doc(playlist.docId).update({
            languages,
            language: FieldValue.delete(), // remove the old field
            updatedAt: new Date(),
          });
        } catch (err) {
          console.error(`   ❌ Failed to update: ${err.message}`);
          failed++;
          processed++;
          continue;
        }
      }
      converted++;
    }

    processed++;
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 MIGRATION COMPLETE');
  console.log('='.repeat(60));
  console.log(`✅ Converted:             ${converted}`);
  console.log(`⚠️  Marked for re-review:  ${markedForReview}`);
  if (failed > 0) console.log(`❌ Failed:                ${failed}`);
  if (dryRun) console.log('\n💡 Run without --dryRun to apply changes');
  console.log('='.repeat(60));
}

/**
 * Fetch video titles and first video description from YouTube XML feed
 */
async function fetchPlaylistData(playlistId) {
  try {
    const response = await axios.get(
      `https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistId}`
    );
    const xml = response.data;

    const titles = [];
    for (const match of xml.matchAll(/<media:title>(.*?)<\/media:title>/g)) {
      titles.push(match[1]);
    }

    const descMatch = xml.match(/<media:description>([\s\S]*?)<\/media:description>/);
    const firstVideoDescription = descMatch
      ? descMatch[1].replace(/https?:\/\/\S+/g, '').replace(/\s{2,}/g, ' ').trim().slice(0, 400)
      : '';

    return { titles: titles.slice(0, 10), firstVideoDescription };
  } catch {
    return { titles: [], firstVideoDescription: '' };
  }
}

/**
 * Ask OpenAI for the languages array for a playlist.
 * Uses video titles only — descriptions are excluded because they often contain
 * marketing boilerplate with country-coded links that mislead language detection.
 */
async function fetchLanguagesFromAI(playlistTitle, videoTitles) {
  if (!openai) throw new Error('OPENAI_API_KEY not set in .env');

  const prompt = `A YouTube playlist titled "${playlistTitle}" contains these videos:\n${videoTitles.map((t, i) => `${i + 1}. ${t}`).join('\n')}\n\nRespond with ONLY a JSON object:\n{"languages": ["<detected language>"]}\n\nIMPORTANT: Detect the spoken language from the video titles only. Rules:\n1. Explicit labels like "English Song", "Spanish Version" in a title are definitive for that content.\n2. If the majority of titles share a language label or are in the same language, use that — do not add a second language from SEO keywords appended to one title (e.g. "| de pompier, voiture de" at the end of an otherwise English title).\n3. Non-English words that are the main part of titles (not appended SEO tags) are a strong signal.\n4. Never use "Multiple" — list the actual language names: ["Italian"], ["Spanish"], ["English"], etc.`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: 'You detect the spoken language of YouTube videos from their titles. Return only a JSON object.' },
      { role: 'user', content: prompt },
    ],
    temperature: 0.2,
    response_format: { type: 'json_object' },
  });

  const result = JSON.parse(completion.choices[0].message.content);
  if (!Array.isArray(result.languages) || result.languages.length === 0) {
    throw new Error(`Unexpected AI response: ${JSON.stringify(result)}`);
  }
  return result.languages;
}

/**
 * Fix playlists that were previously marked with languageNeedsReview: true
 */
async function fixReviews(options = {}) {
  const { dryRun = false } = options;

  console.log('🔧 Fixing playlists marked for language re-review...');
  if (dryRun) console.log('🔍 DRY RUN — no changes will be written\n');

  if (!openai) {
    console.error('❌ OPENAI_API_KEY is not set in .env — cannot call AI');
    process.exit(1);
  }

  const snapshot = await db
    .collection(COLLECTION_NAME)
    .where('languageNeedsReview', '==', true)
    .get();

  const playlists = snapshot.docs.map((doc) => ({ docId: doc.id, ...doc.data() }));
  console.log(`📊 Found ${playlists.length} playlist(s) to fix\n`);

  if (playlists.length === 0) {
    console.log('✅ Nothing to fix!');
    return;
  }

  let fixed = 0;
  let failed = 0;

  for (const playlist of playlists) {
    console.log(`\n📹 ${playlist.title || playlist.docId}`);
    console.log(`   old language: "${playlist.language || '(none)'}"`);

    try {
      const { titles, firstVideoDescription } = await fetchPlaylistData(playlist.docId);
      if (titles.length === 0) {
        console.log('   ⚠️  No video titles found — skipping');
        failed++;
        continue;
      }

      const languages = await fetchLanguagesFromAI(playlist.title, titles, firstVideoDescription);
      console.log(`   languages (new): ${JSON.stringify(languages)}`);

      if (!dryRun) {
        await db.collection(COLLECTION_NAME).doc(playlist.docId).update({
          languages,
          language: FieldValue.delete(),
          languageNeedsReview: FieldValue.delete(),
          updatedAt: new Date(),
        });
      }

      fixed++;

      // Small delay to avoid hammering OpenAI
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

/**
 * Re-check and update the languages field for playlists by fetching fresh
 * data from YouTube (including first-video description) and re-running AI.
 *
 * Usage:
 *   node scripts/migrateLanguages.mjs --recheck --id <playlistId>   # single playlist
 *   node scripts/migrateLanguages.mjs --recheck                     # all playlists
 *   node scripts/migrateLanguages.mjs --recheck --dryRun            # preview only
 *   node scripts/migrateLanguages.mjs --recheck --maxRecords 20     # limit batch
 *   node scripts/migrateLanguages.mjs --recheck --all               # include unapproved
 *   node scripts/migrateLanguages.mjs --recheck --delayMs 1000      # custom rate limit
 */
async function recheckLanguages(options = {}) {
  const { dryRun = false, maxRecords = Infinity, skip = 0, all = false, id = null, delayMs = 600 } = options;

  console.log('🔍 Re-checking playlist languages with fresh YouTube data...');
  if (dryRun) console.log('🔍 DRY RUN — no changes will be written\n');

  if (!openai) {
    console.error('❌ OPENAI_API_KEY is not set in .env — cannot call AI');
    process.exit(1);
  }

  let playlists;

  if (id) {
    const doc = await db.collection(COLLECTION_NAME).doc(id).get();
    if (!doc.exists) {
      console.error(`❌ No record found with id "${id}"`);
      return;
    }
    playlists = [{ docId: doc.id, ...doc.data() }];
    console.log(`🎯 Targeting single playlist: ${playlists[0].title || id}\n`);
  } else {
    let query = db.collection(COLLECTION_NAME);
    if (!all) query = query.where('isApproved', '==', true);
    const snapshot = await query.get();
    playlists = snapshot.docs.map((doc) => ({ docId: doc.id, ...doc.data() }));
    console.log(`📊 Found ${playlists.length} playlist(s) (${all ? 'all' : 'approved only'})\n`);
  }

  const toProcess = playlists.slice(skip, maxRecords < Infinity ? skip + maxRecords : undefined);
  if (skip > 0) console.log(`⏭  Skipping first ${skip} record(s)\n`);
  let updated = 0;
  let unchanged = 0;
  let failed = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const playlist = toProcess[i];
    const current = Array.isArray(playlist.languages)
      ? playlist.languages
      : [playlist.language || 'unknown'];

    console.log(`\n[${i + 1}/${toProcess.length}] ${playlist.title || playlist.docId}`);
    console.log(`   current: ${JSON.stringify(current)}`);

    try {
      const { titles, firstVideoDescription } = await fetchPlaylistData(playlist.docId);
      if (titles.length === 0) {
        console.log('   ⚠️  No video titles from YouTube — skipping');
        failed++;
        continue;
      }

      const languages = await fetchLanguagesFromAI(playlist.title, titles, firstVideoDescription);
      console.log(`   proposed: ${JSON.stringify(languages)}`);

      const changed = JSON.stringify(current.slice().sort()) !== JSON.stringify(languages.slice().sort());
      if (!changed) {
        console.log('   ✅ No change');
        unchanged++;
      } else {
        console.log(`   ✏️  Will update`);
        if (!dryRun) {
          await db.collection(COLLECTION_NAME).doc(playlist.docId).update({
            languages,
            updatedAt: new Date().toISOString(),
          });
        }
        updated++;
      }
    } catch (err) {
      console.error(`   ❌ Failed: ${err.message}`);
      failed++;
    }

    if (i < toProcess.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('📊 RECHECK COMPLETE');
  console.log('='.repeat(60));
  console.log(`✏️  Updated:   ${updated}`);
  console.log(`✅ Unchanged: ${unchanged}`);
  if (failed > 0) console.log(`❌ Failed:    ${failed}`);
  if (dryRun) console.log('\n💡 Run without --dryRun to apply changes');
  console.log('='.repeat(60));
}

// CLI — strip any bare `--` separators before parseArgs sees them
// (npm run script -- --flag passes a leading `--` which parseArgs treats
//  as "end of options", causing everything after it to be ignored)
const filteredArgs = process.argv.slice(2).filter((a) => a !== '--');

const { values } = parseArgs({
  args: filteredArgs,
  options: {
    dryRun:      { type: 'boolean', default: false },
    maxRecords:  { type: 'string',  default: '0'   }, // 0 = unlimited
    skip:        { type: 'string',  default: '0'   }, // skip first N records
    all:         { type: 'boolean', default: false },
    id:          { type: 'string',  default: ''    },
    fixReviews:  { type: 'boolean', default: false },
    recheck:     { type: 'boolean', default: false },
    delayMs:     { type: 'string',  default: '600' }, // ms between AI calls
  },
  strict: true,
});

const maxRecords = parseInt(values.maxRecords, 10);
const skip = parseInt(values.skip, 10);
const delayMs = parseInt(values.delayMs, 10);
const sharedOpts = {
  dryRun:     values.dryRun,
  maxRecords: maxRecords > 0 ? maxRecords : Infinity,
  skip:       skip > 0 ? skip : 0,
  all:        values.all,
  id:         values.id || null,
};

const task = values.recheck
  ? recheckLanguages({ ...sharedOpts, delayMs })
  : values.fixReviews
    ? fixReviews({ dryRun: values.dryRun })
    : migrateLanguages(sharedOpts);

task
  .then(() => {
    console.log('\n✨ Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Error:', error);
    process.exit(1);
  });
