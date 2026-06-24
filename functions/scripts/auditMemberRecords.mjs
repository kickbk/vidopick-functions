#!/usr/bin/env node
// READ-ONLY diagnostic. Reports whether existing records are compatible with the
// tightened security rules (member self-claim now requires a verified token whose
// email matches the member doc's lowercased `email`). Makes NO writes.
//
// Usage: node scripts/auditMemberRecords.mjs

import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const creds = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../integrations/firebase/service-account.json'), 'utf8')
);
if (!getApps().length) initializeApp({ credential: cert(creds), projectId: creds.project_id });
const db = getFirestore();

const mask = (e) => {
  if (typeof e !== 'string' || !e.includes('@')) return JSON.stringify(e);
  const [local, domain] = e.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
};

const isLower = (s) => typeof s === 'string' && s === s.toLowerCase();

console.log(`\nProject: ${creds.project_id}\n`);

// ── members ────────────────────────────────────────────────────────────────
const membersSnap = await db.collection('members').get();
let claimed = 0;
let unclaimed = 0;
const blocked = []; // unclaimed docs that the NEW rule would prevent from self-claiming
const claimedButOddEmail = []; // already claimed, but email missing/non-lowercase (FYI only)

for (const doc of membersSnap.docs) {
  const d = doc.data();
  const hasAuth = !!d.authUid;
  const email = d.email;
  const emailOk = typeof email === 'string' && email.length > 0 && isLower(email);

  if (hasAuth) {
    claimed++;
    if (!emailOk) claimedButOddEmail.push({ id: doc.id, email: mask(email) });
  } else {
    unclaimed++;
    if (!emailOk) {
      blocked.push({
        id: doc.id,
        reason: typeof email !== 'string' || !email ? 'missing email' : 'email not lowercase',
        email: mask(email),
        org: d.organizationId ?? '(none)',
      });
    }
  }
}

console.log('── members ──────────────────────────────────────────────');
console.log(`total:            ${membersSnap.size}`);
console.log(`claimed (authUid):${claimed}`);
console.log(`unclaimed:        ${unclaimed}`);
console.log(`\nUnclaimed docs that the NEW rule would BLOCK from self-claiming: ${blocked.length}`);
for (const b of blocked) console.log(`  - ${b.id}  [${b.reason}]  email=${b.email}  org=${b.org}`);
console.log(`\nAlready-claimed docs with missing/non-lowercase email (FYI, not blocked): ${claimedButOddEmail.length}`);
for (const c of claimedButOddEmail) console.log(`  - ${c.id}  email=${c.email}`);

// ── quick context counts (no PII) ───────────────────────────────────────────
const [usersCount, affiliatesSnap] = await Promise.all([
  db.collection('users').count().get(),
  db.collection('affiliates').get(),
]);
let affNoEmail = 0;
let affNonLower = 0;
let affType = {};
for (const doc of affiliatesSnap.docs) {
  const d = doc.data();
  affType[d.type ?? '(none)'] = (affType[d.type ?? '(none)'] ?? 0) + 1;
  if (d.type === 'influencer') {
    if (typeof d.email !== 'string' || !d.email) affNoEmail++;
    else if (!isLower(d.email)) affNonLower++;
  }
}
console.log('\n── context ──────────────────────────────────────────────');
console.log(`users collection count:  ${usersCount.data().count}`);
console.log(`affiliates total:        ${affiliatesSnap.size}  byType=${JSON.stringify(affType)}`);
console.log(`  influencer affiliates missing email:        ${affNoEmail}`);
console.log(`  influencer affiliates with non-lowercase email: ${affNonLower}`);

console.log('\nDone (read-only — no writes performed).\n');
process.exit(0);
