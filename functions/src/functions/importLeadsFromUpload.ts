import * as admin from 'firebase-admin';
import { randomUUID } from 'crypto';
import { onCall, HttpsError } from 'firebase-functions/v2/https';

if (!admin.apps.length) admin.initializeApp();

const TERMINAL_STATUSES = new Set([
  'sent', 'delivered', 'bounced', 'complained', 'booked', 'send_failed',
]);

interface LeadInput {
  id: string;
  status?: string;
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string;
  displayName?: string;
  email?: string | null;
  openingLine?: string | null;
  primaryPlatform?: string;
  audienceSize?: number;
  audienceTier?: string;
  social?: {
    website?: string | null;
    instagram?: string | null;
    tiktok?: string | null;
    youtube?: string | null;
    facebook?: string | null;
  };
  notes?: string;
  foundVia?: string;
  addedAt?: string;
}

export const importLeadsFromUpload = onCall(
  { region: 'us-central1', timeoutSeconds: 120, memory: '256MiB' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in.');
    const token = request.auth.token as Record<string, unknown>;
    if (token.role !== 'admin') throw new HttpsError('permission-denied', 'Admin only.');

    const raw = request.data?.leads;
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new HttpsError('invalid-argument', '"leads" must be a non-empty array.');
    }

    const db = admin.firestore();
    let newCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;

    for (const lead of raw as LeadInput[]) {
      if (!lead.id) continue;

      const ref = db.collection('outreach_affiliates').doc(lead.id);
      const existing = await ref.get();

      if (existing.exists) {
        const currentStatus = existing.data()?.status as string | undefined;
        if (currentStatus && TERMINAL_STATUSES.has(currentStatus)) {
          // Still patch metadata fields that don't affect delivery status
          const metadataPatch: Record<string, unknown> = {};
          if (lead.openingLine != null) metadataPatch.openingLine = lead.openingLine;
          if (lead.notes != null) metadataPatch.notes = lead.notes;
          if (Object.keys(metadataPatch).length > 0) await ref.set(metadataPatch, { merge: true });
          skippedCount++;
          continue;
        }
      }

      const doc: Record<string, unknown> = {
        status: 'approved',
        firstName: lead.firstName ?? null,
        lastName: lead.lastName ?? null,
        fullName: lead.fullName ?? lead.id,
        displayName: lead.displayName ?? lead.firstName ?? lead.fullName ?? lead.id,
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
      } else {
        // Never overwrite activationToken on existing docs
        const existingToken = existing.data()?.activationToken;
        await ref.set(
          { ...doc, ...(existingToken ? {} : { activationToken: randomUUID() }) },
          { merge: true }
        );
        updatedCount++;
      }
    }

    return { newCount, updatedCount, skippedCount };
  }
);
