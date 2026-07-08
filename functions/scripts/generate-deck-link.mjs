#!/usr/bin/env node
import { createRequire } from 'module';
import { createInterface } from 'readline';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });

const ENDPOINT = 'https://us-central1-vidopick-c725d.cloudfunctions.net/generateDeckLink';

async function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function run() {
  const secret = process.env.DECK_ADMIN_SECRET;
  if (!secret) {
    console.error('\nError: DECK_ADMIN_SECRET not found in .env.local or .env');
    process.exit(1);
  }

  const name = await ask('Investor name: ');
  if (!name) { console.error('Error: name required.'); process.exit(1); }

  const email = await ask('Investor email: ');
  if (!email || !email.includes('@')) { console.error('Error: valid email required.'); process.exit(1); }

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
    body: JSON.stringify({ name, email }),
  });

  const json = await res.json();
  if (!res.ok) {
    console.error('Error:', json.error ?? `HTTP ${res.status}`);
    process.exit(1);
  }

  if (json.sent) {
    console.log(`\nEmail sent to ${json.email} — "Hi ${name},"\n`);
  } else {
    console.log('\nDeck link (no email sent — name missing or email not configured)');
    console.log('─'.repeat(64));
    console.log(json.url);
    console.log('─'.repeat(64));
    console.log('Valid once · expires in 24 hours\n');
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
