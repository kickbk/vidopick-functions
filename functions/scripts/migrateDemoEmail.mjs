#!/usr/bin/env node
// Creates demo@vidopick.com as the new shared demo Firebase Auth user,
// then updates all hardcoded references in source files.
//
// Usage: node scripts/migrateDemoEmail.mjs

import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVICE_ACCOUNT_PATH = path.resolve(__dirname, '../integrations/firebase/service-account.json');
const REPO_ROOT = path.resolve(__dirname, '../../../');

const OLD_EMAIL = 'vidopick@gmail.com';
const NEW_EMAIL = 'demo@vidopick.com';

const SOURCE_FILES = [
  'web/src/context/AdminAuthContext.tsx',
  'web/src/pages/admin/EmailSignInAction.tsx',
  'web/src/pages/admin/Login.tsx',
  'firebase/functions/src/functions/sendDemoInvite.ts',
  'firebase/functions/src/functions/releaseDemoSession.ts',
];

if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
  console.error(`Service account not found at: ${SERVICE_ACCOUNT_PATH}`);
  process.exit(1);
}

if (!getApps().length) {
  initializeApp({ credential: cert(SERVICE_ACCOUNT_PATH) });
}

const auth = getAuth();

// --- 1. Verify old account has no admin claim ---
const oldUser = await auth.getUserByEmail(OLD_EMAIL);
if (oldUser.customClaims?.role === 'admin') {
  console.error(`ERROR: ${OLD_EMAIL} still has admin claim. Run fixDemoClaims.mjs first.`);
  process.exit(1);
}
console.log(`${OLD_EMAIL} claims: ${JSON.stringify(oldUser.customClaims ?? 'none')}`);

// --- 2. Create demo@vidopick.com ---
let newUser;
try {
  newUser = await auth.getUserByEmail(NEW_EMAIL);
  console.log(`${NEW_EMAIL} already exists: ${newUser.uid}`);
} catch (err) {
  if (err.code !== 'auth/user-not-found') throw err;
  newUser = await auth.createUser({ email: NEW_EMAIL });
  console.log(`Created ${NEW_EMAIL}: ${newUser.uid}`);
}

// Copy any existing claims (e.g. organization role for the demo org)
if (oldUser.customClaims && Object.keys(oldUser.customClaims).length) {
  await auth.setCustomUserClaims(newUser.uid, oldUser.customClaims);
  console.log(`Copied claims to ${NEW_EMAIL}:`, oldUser.customClaims);
} else {
  console.log(`No claims to copy.`);
}

// --- 3. Update source files ---
let totalReplacements = 0;

for (const relPath of SOURCE_FILES) {
  const filePath = path.join(REPO_ROOT, relPath);
  if (!fs.existsSync(filePath)) {
    console.warn(`  SKIP (not found): ${relPath}`);
    continue;
  }

  const before = fs.readFileSync(filePath, 'utf8');
  const after = before.replaceAll(OLD_EMAIL, NEW_EMAIL);

  if (before === after) {
    console.log(`  unchanged: ${relPath}`);
    continue;
  }

  const count = (before.match(new RegExp(OLD_EMAIL.replace('@', '\\@'), 'g')) ?? []).length;
  fs.writeFileSync(filePath, after, 'utf8');
  console.log(`  updated (${count} occurrence${count !== 1 ? 's' : ''}): ${relPath}`);
  totalReplacements += count;
}

console.log(`\nDone. ${totalReplacements} reference${totalReplacements !== 1 ? 's' : ''} updated.`);
console.log(`\nNext steps:`);
console.log(`  1. Redeploy functions:  firebase deploy --only functions`);
console.log(`  2. Rebuild web app`);
