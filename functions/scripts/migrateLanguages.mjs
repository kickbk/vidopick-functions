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
 * Fetch video titles from YouTube XML feed
 */
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

/**
 * Ask OpenAI for the languages array for a playlist
 */
async function fetchLanguagesFromAI(playlistId, playlistTitle, videoTitles) {
  if (!openai) throw new Error('OPENAI_API_KEY not set in .env');

  const prompt = `A YouTube playlist titled "${playlistTitle}" contains these videos:\n${videoTitles.map((t, i) => `${i + 1}. ${t}`).join('\n')}\n\nRespond with ONLY a JSON object:\n{"languages": ["English"]}\n\nIMPORTANT: Always return an array of the actual languages spoken in the videos. Never use "Multiple" — list each language: ["English", "Spanish"], ["Hebrew"], etc.`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: 'You detect the spoken language(s) of YouTube videos based on their titles. Return only a JSON object.' },
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
      const titles = await fetchVideoTitles(playlist.docId);
      if (titles.length === 0) {
        console.log('   ⚠️  No video titles found — skipping');
        failed++;
        continue;
      }

      const languages = await fetchLanguagesFromAI(playlist.docId, playlist.title, titles);
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

// CLI — strip any bare `--` separators before parseArgs sees them
// (npm run script -- --flag passes a leading `--` which parseArgs treats
//  as "end of options", causing everything after it to be ignored)
const filteredArgs = process.argv.slice(2).filter((a) => a !== '--');

const { values } = parseArgs({
  args: filteredArgs,
  options: {
    dryRun:      { type: 'boolean', default: false },
    maxRecords:  { type: 'string',  default: '0'    }, // 0 = unlimited
    all:         { type: 'boolean', default: false  },
    id:          { type: 'string',  default: ''     },
    fixReviews:  { type: 'boolean', default: false  },
  },
  strict: false,
});

const maxRecords = parseInt(values.maxRecords, 10);
const task = values.fixReviews
  ? fixReviews({ dryRun: values.dryRun })
  : migrateLanguages({
      dryRun:     values.dryRun,
      maxRecords: maxRecords > 0 ? maxRecords : Infinity,
      all:        values.all,
      id:         values.id || null,
    });

task
  .then(() => {
    console.log('\n✨ Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Error:', error);
    process.exit(1);
  });
