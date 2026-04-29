import * as admin from 'firebase-admin';
import { onRequest } from 'firebase-functions/v2/https';

if (!admin.apps.length) admin.initializeApp();

/**
 * After email sign-in, migrates Pro data to the authenticated email UID.
 *
 * Searches the users collection for any document with the signed-in email
 * that has a non-none proStatus. This works regardless of which anonymous
 * session was active at sign-in time — the email stored in the source doc
 * is the authoritative link.
 *
 * Also renames orgSponsors subcollection entries so future approve/revoke
 * calls from the dashboard target the correct UID.
 *
 * Auth: Firebase ID token (email auth) in Authorization: Bearer header.
 */
export const linkAnonToEmailAuth = onRequest(
  { region: 'us-central1', memory: '256MiB', timeoutSeconds: 30, invoker: 'public', cors: true },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const authHeader = req.headers.authorization ?? '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!idToken) {
      res.status(401).json({ error: 'Missing auth token' });
      return;
    }

    let decodedToken: admin.auth.DecodedIdToken;
    try {
      decodedToken = await admin.auth().verifyIdToken(idToken);
    } catch {
      res.status(401).json({ error: 'Invalid auth token' });
      return;
    }

    const emailUid = decodedToken.uid;
    const userEmail: string | undefined = decodedToken.email;

    if (!userEmail) {
      res.json({ success: true, migrated: false, reason: 'no email on token' });
      return;
    }

    const db = admin.firestore();

    // Don't overwrite an already-active Pro account on the email UID
    const emailSnap = await db.doc(`users/${emailUid}`).get();
    if (emailSnap.data()?.proStatus === 'active') {
      res.json({ success: true, migrated: false, reason: 'already active' });
      return;
    }

    // Find any user doc with this email that has Pro data under a different UID.
    // This handles the case where Pro was obtained while anonymous (any session).
    const matchingSnap = await db.collection('users').where('email', '==', userEmail).get();
    const sourceDoc = matchingSnap.docs.find(
      (d) => d.id !== emailUid && d.data().proStatus && d.data().proStatus !== 'none'
    );

    if (!sourceDoc) {
      res.json({ success: true, migrated: false });
      return;
    }

    const sourceUid = sourceDoc.id;
    const sourceData = sourceDoc.data();
    const now = admin.firestore.Timestamp.now();

    // Copy Pro-related fields to the email UID doc
    await db.doc(`users/${emailUid}`).set(
      {
        proStatus: sourceData.proStatus,
        proType: sourceData.proType ?? null,
        sponsoredBy: sourceData.sponsoredBy ?? [],
        pendingApprovalFrom: sourceData.pendingApprovalFrom ?? [],
        email: sourceData.email ?? userEmail,
        identities: sourceData.identities ?? {},
        profiles: sourceData.profiles ?? [],
        deviceTokens: sourceData.deviceTokens ?? [],
        ...(sourceData.subscribedViaMemberId ? { subscribedViaMemberId: sourceData.subscribedViaMemberId } : {}),
        ...(sourceData.approvedAt ? { approvedAt: sourceData.approvedAt } : {}),
        ...(sourceData.requestedAt ? { requestedAt: sourceData.requestedAt } : {}),
        ...(sourceData.createdAt ? { createdAt: sourceData.createdAt } : {}),
        migratedFromAnonUid: sourceUid,
        migratedAt: now,
      },
      { merge: true }
    );

    // Update orgSponsors subcollection so revoke/approve target the new UID
    const sponsoredBy: string[] = sourceData.sponsoredBy ?? [];
    for (const orgId of sponsoredBy) {
      try {
        const oldRef = db.doc(`orgSponsors/${orgId}/users/${sourceUid}`);
        const newRef = db.doc(`orgSponsors/${orgId}/users/${emailUid}`);
        const [oldSnap, newSnap] = await Promise.all([oldRef.get(), newRef.get()]);
        if (oldSnap.exists && !newSnap.exists) {
          const batch = db.batch();
          batch.set(newRef, { ...oldSnap.data()!, uid: emailUid, migratedFromAnonUid: sourceUid, updatedAt: now });
          batch.delete(oldRef);
          await batch.commit();
        }
      } catch (e) {
        console.warn(`[linkAnonToEmailAuth] orgSponsors migration failed for org ${orgId}:`, e);
      }
    }

    // Clear Pro fields from the source doc to prevent stale dashboard reads
    await db.doc(`users/${sourceUid}`).update({
      proStatus: 'none',
      proType: null,
      sponsoredBy: admin.firestore.FieldValue.delete(),
      pendingApprovalFrom: admin.firestore.FieldValue.delete(),
      migratedToUid: emailUid,
    });

    console.log(`[linkAnonToEmailAuth] migrated Pro data ${sourceUid} → ${emailUid} (${userEmail})`);

    res.json({ success: true, migrated: true });
  }
);
