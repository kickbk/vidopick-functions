import * as admin from 'firebase-admin';
import { onRequest } from 'firebase-functions/v2/https';

if (!admin.apps.length) admin.initializeApp();

const ADMIN_BASE_URL = process.env.FUNCTIONS_EMULATOR
  ? 'http://localhost:5173'
  : 'https://vidopick.com';

/**
 * Called by the app user to withdraw their own pending Pro sponsorship request.
 * Clears proStatus back to 'none', empties pendingApprovalFrom, and notifies
 * the relevant org admin and member by email.
 *
 * Auth: Firebase ID token in Authorization: Bearer header.
 */
export const cancelSponsorshipRequest = onRequest(
  { region: 'us-central1', memory: '256MiB', timeoutSeconds: 15, invoker: 'public', cors: true },
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

    const uid = decodedToken.uid;
    const db = admin.firestore();

    const userSnap = await db.doc(`users/${uid}`).get();
    if (!userSnap.exists) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const userData = userSnap.data()!;

    if (userData.proStatus !== 'pending') {
      res.json({ success: true });
      return;
    }

    const pendingOrgIds: string[] = userData.pendingApprovalFrom ?? [];
    const memberId: string | undefined = userData.subscribedViaMemberId;

    await db.doc(`users/${uid}`).update({
      proStatus: 'none',
      pendingApprovalFrom: [],
    });

    console.log(`[cancelSponsorshipRequest] uid=${uid} cancelled pending orgs=${pendingOrgIds.join(',')}`);

    const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
    const SENDER_EMAIL = 'vidopickhelp@gmail.com';

    for (const orgId of pendingOrgIds) {
      const subscriberName: string =
        (userData.identities as Record<string, string> | undefined)?.[orgId] ??
        userData.email ??
        'A user';

      try {
        const orgSnap = await db.doc(`organizations/${orgId}`).get();
        if (!orgSnap.exists) continue;

        const orgData = orgSnap.data()!;
        const orgName: string = orgData.name ?? orgId;
        const dashboardUrl = `${ADMIN_BASE_URL}/admin/organizations/${orgId}/pro-approvals/`;

        if (!GMAIL_APP_PASSWORD) continue;

        const nodemailer = await import('nodemailer');
        const { buildSponsorshipCancelledEmail } = await import('../utils/emailTemplates.js');
        const transporter = nodemailer.default.createTransport({
          service: 'gmail',
          auth: { user: SENDER_EMAIL, pass: GMAIL_APP_PASSWORD },
        });

        const subject = `${subscriberName} cancelled their Pro request`;

        // Notify the member if the invite came via a specific member
        if (memberId) {
          try {
            const memberSnap = await db.doc(`members/${memberId}`).get();
            if (memberSnap.exists && memberSnap.data()?.email) {
              const memberData = memberSnap.data()!;
              await transporter.sendMail({
                from: `"Vidopick" <${SENDER_EMAIL}>`,
                to: memberData.email as string,
                subject,
                html: buildSponsorshipCancelledEmail(
                  memberData.name ?? 'there',
                  subscriberName,
                  orgName,
                  dashboardUrl,
                ),
              });
              console.log(`[cancelSponsorshipRequest] member notified: ${memberData.email}`);
            }
          } catch (e) {
            console.warn('[cancelSponsorshipRequest] member email failed:', e);
          }
        }

        // Notify the org admin
        try {
          const authUid: string | undefined = orgData.authUid;
          if (authUid) {
            const orgAuthUser = await admin.auth().getUser(authUid);
            if (orgAuthUser.email) {
              await transporter.sendMail({
                from: `"Vidopick" <${SENDER_EMAIL}>`,
                to: orgAuthUser.email,
                subject,
                html: buildSponsorshipCancelledEmail(
                  orgName,
                  subscriberName,
                  orgName,
                  dashboardUrl,
                ),
              });
              console.log(`[cancelSponsorshipRequest] org notified: ${orgAuthUser.email}`);
            }
          }
        } catch (e) {
          console.warn('[cancelSponsorshipRequest] org email failed:', e);
        }
      } catch (e) {
        console.warn(`[cancelSponsorshipRequest] failed for org=${orgId}:`, e);
      }
    }

    res.json({ success: true });
  },
);
