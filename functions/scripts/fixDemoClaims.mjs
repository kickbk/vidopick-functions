#!/usr/bin/env node
// Removes the admin claim from the demo account (vidopick@gmail.com).
// Restores whatever organization/member claims it had before, if any.
//
// Usage: node scripts/fixDemoClaims.mjs

import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVICE_ACCOUNT_PATH = path.resolve(__dirname, '../integrations/firebase/service-account.json');

if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
  console.error(`Service account not found at: ${SERVICE_ACCOUNT_PATH}`);
  process.exit(1);
}

if (!getApps().length) {
  initializeApp({ credential: cert(SERVICE_ACCOUNT_PATH) });
}

const auth = getAuth();
const user = await auth.getUserByEmail('vidopick@gmail.com');
const current = user.customClaims ?? {};

console.log('Current claims:', current);

if (current.role !== 'admin') {
  console.log('No admin claim found — nothing to do.');
  process.exit(0);
}

// Remove role claim entirely — demo user should have no role
const { role, ...rest } = current;
await auth.setCustomUserClaims(user.uid, Object.keys(rest).length ? rest : null);

console.log('Admin claim removed. Remaining claims:', Object.keys(rest).length ? rest : 'none');
