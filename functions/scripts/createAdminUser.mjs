#!/usr/bin/env node
// Creates a Firebase Auth user with admin custom claims (role: 'admin').
// If the user already exists, just sets the claims without recreating them.
//
// Usage:
//   node scripts/createAdminUser.mjs --email me@example.com

import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVICE_ACCOUNT_PATH = path.resolve(__dirname, '../integrations/firebase/service-account.json');

if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
  console.error(`Service account not found at: ${SERVICE_ACCOUNT_PATH}`);
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
  },
});

if (!values.email) {
  console.error('Usage: node scripts/createAdminUser.mjs --email <email>');
  process.exit(1);
}

if (!getApps().length) {
  initializeApp({ credential: cert(SERVICE_ACCOUNT_PATH) });
}

const auth = getAuth();
const email = values.email;

let user;
let created = false;

try {
  user = await auth.getUserByEmail(email);
  console.log(`User already exists: ${user.uid}`);
} catch (err) {
  if (err.code !== 'auth/user-not-found') throw err;
  user = await auth.createUser({ email });
  created = true;
  console.log(`Created new user: ${user.uid}`);
}

await auth.setCustomUserClaims(user.uid, { role: 'admin' });

console.log(`\nAdmin claims set for ${email} (uid: ${user.uid})`);
if (created) {
  console.log('Next: request a magic link for this email to log in.');
} else {
  console.log('Next: log out and back in for the admin role to take effect.');
}
