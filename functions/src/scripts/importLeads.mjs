/**
 * Import leads.json into Firestore outreach_affiliates collection.
 *
 * Usage:
 *   node firebase/functions/src/scripts/importLeads.mjs [path/to/leads.json]
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS env var pointing to a Firebase
 * service account JSON, or run after `gcloud auth application-default login`.
 *
 * Re-running is always safe: entries already past "approved" are skipped.
 */

import admin from 'firebase-admin';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';

admin.initializeApp({ projectId: 'vidopick-c725d' });
const db = admin.firestore();

const TERMINAL_STATUSES = new Set(['sent', 'delivered', 'bounced', 'complained', 'booked', 'send_failed']);

const filePath = process.argv[2] ? resolve(process.argv[2]) : resolve(process.cwd(), 'leads.json');
console.log(`Reading leads from: ${filePath}`);

const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
const leads = Array.isArray(parsed) ? parsed : parsed?.leads;
if (!Array.isArray(leads)) {
  console.error('leads.json must be a JSON array or an object with a "leads" array');
  process.exit(1);
}

let newCount = 0;
let updatedCount = 0;
let skippedCount = 0;

for (const lead of leads) {
  if (!lead.id) {
    console.warn('Skipping entry with no id:', lead);
    continue;
  }

  const ref = db.collection('outreach_affiliates').doc(lead.id);
  const existing = await ref.get();

  if (existing.exists) {
    const currentStatus = existing.data()?.status;
    if (TERMINAL_STATUSES.has(currentStatus)) {
      // Still patch metadata fields that don't affect delivery status
      const metadataPatch = {};
      if (lead.openingLine != null) metadataPatch.openingLine = lead.openingLine;
      if (lead.notes != null) metadataPatch.notes = lead.notes;
      if (Object.keys(metadataPatch).length > 0) await ref.set(metadataPatch, { merge: true });
      skippedCount++;
      continue;
    }
  }

  const doc = {
    status: 'approved',
    firstName: lead.firstName ?? null,
    lastName: lead.lastName ?? null,
    fullName: lead.fullName ?? lead.name ?? lead.id,
    displayName: lead.displayName ?? lead.firstName ?? lead.fullName ?? lead.name ?? lead.id,
    email: lead.email ?? null,
    openingLine: lead.openingLine ?? null,
    primaryPlatform: lead.primaryPlatform ?? 'instagram',
    audienceSize: lead.audienceSize ?? 0,
    audienceTier: lead.audienceTier ?? 'nano',
    social: {
      website: lead.social?.website ?? null,
      instagram: lead.social?.instagram ?? null,
      tiktok: lead.social?.tiktok ?? null,
      youtube: lead.social?.youtube ?? null,
      facebook: lead.social?.facebook ?? null,
    },
    notes: lead.notes ?? '',
    foundVia: lead.foundVia ?? '',
    addedAt: lead.addedAt
      ? admin.firestore.Timestamp.fromDate(new Date(lead.addedAt))
      : admin.firestore.FieldValue.serverTimestamp(),
  };

  if (!existing.exists) {
    await ref.set({
      ...doc,
      activationToken: randomUUID(),
      affiliateId: null,
      emailedAt: null,
      resendMessageId: null,
      lastError: null,
      bookedAt: null,
    });
    newCount++;
    console.log(`  NEW     ${lead.id}`);
  } else {
    // Never overwrite activationToken on existing docs
    const existingToken = existing.data()?.activationToken;
    await ref.set(
      { ...doc, ...(existingToken ? {} : { activationToken: randomUUID() }) },
      { merge: true }
    );
    updatedCount++;
    console.log(`  UPDATED ${lead.id}`);
  }
}

console.log(`\nDone. New: ${newCount}, Updated: ${updatedCount}, Skipped (past approved): ${skippedCount}`);
process.exit(0);
