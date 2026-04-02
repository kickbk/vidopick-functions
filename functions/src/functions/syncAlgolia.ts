import { algoliasearch } from 'algoliasearch';
import dotenv from 'dotenv';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const CREDS_PATH = path.resolve(__dirname, '../../integrations/firebase/service-account.json');
const credsJson = JSON.parse(fs.readFileSync(CREDS_PATH, 'utf8'));

if (!getApps().length) {
  initializeApp({ credential: cert(credsJson), projectId: credsJson.project_id });
}

const db = getFirestore();

const ALGOLIA_APP_ID = 'ACLDY9FF4Y';
const ALGOLIA_WRITE_API = process.env.ALGOLIA_WRITE_API;
const INDEX_NAME = 'scannedPlaylists';

const client = algoliasearch(ALGOLIA_APP_ID, ALGOLIA_WRITE_API || '');

async function syncToAlgolia() {
  console.log('🔄 Starting Algolia sync...');

  const snapshot = await db.collection('scannedPlaylists').get();

  const records = snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      objectID: doc.id,
      title: data.title ?? '',
      author: data.author ?? '',
      description: data.description ?? '',
      thumbnail: data.thumbnail ?? '',
      category: data.category ?? '', // legacy string — keep during transition
      categories: data.categories ?? [], // new array field
      languages: data.languages ?? [],
      tags: data.tags ?? [],
      ageMin: data.ageMin ?? 0,
      ageMax: data.ageMax ?? 12,
      isApproved: data.isApproved ?? false,
      channelSubscribers: data.channelSubscribers ?? 0,
      channelVerified: data.channelVerified ?? false,
      rankingScore: data.ranking?.score ?? 0,
      rankingBoost: data.ranking?.boost ?? 0,
      scannedAt: data.scannedAt?.toMillis?.() ?? Date.now(),
      updatedAt: data.updatedAt?.toMillis?.() ?? Date.now(),
    };
  });

  console.log(`📦 Found ${records.length} approved playlists`);

  await client.clearObjects({ indexName: INDEX_NAME });
  console.log('🗑️  Cleared existing index');

  await client.saveObjects({ indexName: INDEX_NAME, objects: records });
  console.log('✅ Successfully synced to Algolia!');

  process.exit(0);
}

syncToAlgolia().catch((error) => {
  console.error('❌ Error syncing to Algolia:', error);
  process.exit(1);
});
