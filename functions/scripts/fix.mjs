import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load service account credentials
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

// Initialize Firebase Admin
if (!getApps().length) {
  initializeApp({
    credential: cert(credsJson),
    projectId: credsJson.project_id,
  });
}

const db = getFirestore();

function decodeHtmlEntities(text) {
  const entities = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
  };
  return text.replace(/&(?:amp|lt|gt|quot|#39);/g, (match) => entities[match] || match);
}

async function fixHtmlEntities() {
  const snapshot = await db.collection('scannedPlaylists').get();
  let fixed = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const needsUpdate = data.title?.includes('&amp;') || data.author?.includes('&amp;');

    if (needsUpdate) {
      await doc.ref.update({
        title: decodeHtmlEntities(data.title || ''),
        author: decodeHtmlEntities(data.author || ''),
        updatedAt: new Date(),
      });
      console.log(`Fixed: ${data.title}`);
      fixed++;
    }
  }

  console.log(`Fixed ${fixed} playlists`);
}

fixHtmlEntities();
