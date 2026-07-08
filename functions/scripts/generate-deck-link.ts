#!/usr/bin/env npx ts-node
/**
 * Generate a one-time investor deck link.
 *
 * Usage:
 *   DECK_ADMIN_SECRET=<secret> npx ts-node scripts/generate-deck-link.ts investor@example.com
 *
 * The DECK_ADMIN_SECRET must match the env var set in Firebase Functions config.
 * Set it in your shell or in a local .env file (never commit it).
 */

const [, , email] = process.argv;

if (!email) {
  console.error('Usage: npx ts-node scripts/generate-deck-link.ts <email>');
  process.exit(1);
}

const secret = process.env.DECK_ADMIN_SECRET;
if (!secret) {
  console.error('Error: DECK_ADMIN_SECRET env var is required.');
  process.exit(1);
}

const ENDPOINT = 'https://us-central1-vidopick-c725d.cloudfunctions.net/generateDeckLink';

async function run() {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({ email }),
  });

  const json = (await res.json()) as { url?: string; error?: string };

  if (!res.ok || !json.url) {
    console.error('Error:', json.error ?? `HTTP ${res.status}`);
    process.exit(1);
  }

  console.log('\nDeck link for', email);
  console.log('─'.repeat(60));
  console.log(json.url);
  console.log('─'.repeat(60));
  console.log('Valid once · expires in 24 hours\n');
}

run().catch((e) => { console.error(e); process.exit(1); });
