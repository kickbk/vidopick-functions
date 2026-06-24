#!/usr/bin/env node
// Seeds config/affiliates with the default commission rates.
// The stripeWebhook CF reads these as fallbacks when an affiliate doc has no explicit
// rate — without this doc (or per-affiliate rates), commissions are skipped.
//
// Usage: node scripts/createAffiliateRateConfig.mjs

import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CREDS_PATH = path.resolve(__dirname, '../integrations/firebase/service-account.json');

const credsJson = JSON.parse(fs.readFileSync(CREDS_PATH, 'utf8'));
if (!getApps().length) {
  initializeApp({ credential: cert(credsJson), projectId: credsJson.project_id });
}
const db = getFirestore();

await db.doc('config/affiliates').set(
  {
    commissionRate: 0.25, // active marketing shortlinks
    publicProfileCommissionRate: 0.1, // passive profile-page shortlinks
    updatedAt: FieldValue.serverTimestamp(),
  },
  { merge: true }
);

console.log('config/affiliates seeded with default commission rates');
process.exit(0);
