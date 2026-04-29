import * as admin from 'firebase-admin';
import { onRequest } from 'firebase-functions/v2/https';

if (!admin.apps.length) admin.initializeApp();

const ADMIN_BASE_URL = process.env.FUNCTIONS_EMULATOR
  ? 'http://localhost:5173'
  : 'https://vidopick.com';

/**
 * Mobile-callable endpoint: authenticated user requests Pro sponsorship from an org.
 * Creates (or merges into) the users/{uid} document with proStatus: 'pending'.
 *
 * Auth: Firebase ID token in Authorization: Bearer header.
 */
export const requestSponsorship = onRequest(
  { region: 'us-central1', memory: '256MiB', timeoutSeconds: 15, invoker: 'public', cors: true },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    // Verify Firebase ID token
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
    const tokenEmail = decodedToken.email ?? '';
    const { organizationId, memberId, displayName, notificationEmail } = (req.body ?? {}) as {
      organizationId?: string;
      memberId?: string;
      displayName?: string;
      notificationEmail?: string;
    };
    // Prefer email provided by the user (anonymous users have no token email)
    const email = notificationEmail?.trim() || tokenEmail;

    if (!organizationId) {
      res.status(400).json({ error: 'organizationId is required' });
      return;
    }

    const db = admin.firestore();

    // Verify org exists and sponsors Pro
    const orgSnap = await db.doc(`organizations/${organizationId}`).get();
    if (!orgSnap.exists) {
      res.status(404).json({ error: 'Organization not found' });
      return;
    }
    if (!orgSnap.data()?.isSponsoring) {
      res.status(400).json({ error: 'This organization does not sponsor Pro accounts' });
      return;
    }

    // Check user isn't already Pro
    const userSnap = await db.doc(`users/${uid}`).get();
    const currentStatus = userSnap.data()?.proStatus;
    if (currentStatus === 'active') {
      res.json({ success: true, alreadyPro: true });
      return;
    }

    // Create/update user doc.
    // dot-notation for nested fields (e.g. identities.orgId) only works in update(),
    // not in set() — set() treats dots as literal field name characters.
    // Branch on doc existence so we can use set() for new docs and update() for existing.
    const subscriberName = displayName?.trim() || 'Anonymous';
    const userRef = db.doc(`users/${uid}`);
    if (userSnap.exists) {
      await userRef.update({
        email,
        [`identities.${organizationId}`]: subscriberName,
        proStatus: 'pending',
        proType: 'sponsored',
        pendingApprovalFrom: admin.firestore.FieldValue.arrayUnion(organizationId),
        ...(memberId ? { subscribedViaMemberId: memberId } : {}),
        requestedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } else {
      await userRef.set({
        email,
        identities: { [organizationId]: subscriberName },
        proStatus: 'pending',
        proType: 'sponsored',
        pendingApprovalFrom: admin.firestore.FieldValue.arrayUnion(organizationId),
        ...(memberId ? { subscribedViaMemberId: memberId } : {}),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        requestedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    console.log(`[requestSponsorship] uid=${uid} → org=${organizationId} member=${memberId ?? 'none'}`);

    const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
    const SENDER_EMAIL = 'vidopickhelp@gmail.com';
    const orgData = orgSnap.data()!;
    const orgName: string = orgData.name ?? 'your organization';
    const dashboardUrl = `${ADMIN_BASE_URL}/admin/organizations/${organizationId}/pro-approvals/`;

    // Notify member by email if the invite came from a specific member (non-fatal)
    if (memberId) {
      try {
        const memberSnap = await db.doc(`members/${memberId}`).get();
        if (memberSnap.exists && memberSnap.data()?.email && GMAIL_APP_PASSWORD) {
          const nodemailer = await import('nodemailer');
          const { buildMemberSubscriberNotificationEmail } = await import('../utils/emailTemplates.js');
          const memberData = memberSnap.data()!;
          const transporter = nodemailer.default.createTransport({
            service: 'gmail',
            auth: { user: SENDER_EMAIL, pass: GMAIL_APP_PASSWORD },
          });
          await transporter.sendMail({
            from: `"Vidopick" <${SENDER_EMAIL}>`,
            to: memberData.email as string,
            subject: `New Pro request for ${orgName}`,
            html: buildMemberSubscriberNotificationEmail(
              memberData.name ?? 'there',
              subscriberName,
              email || undefined,
              orgName,
              dashboardUrl
            ),
          });
          console.log(`[requestSponsorship] member notification sent to ${memberData.email}`);
        }
      } catch (e) {
        console.warn('[requestSponsorship] member notification failed:', e);
      }
    }

    // Notify org admin by email (non-fatal)
    try {
      const authUid: string | undefined = orgData.authUid;
      if (authUid && GMAIL_APP_PASSWORD) {
        const orgAuthUser = await admin.auth().getUser(authUid);
        if (orgAuthUser.email) {
          const nodemailer = await import('nodemailer');
          const { buildOrgSubscriberNotificationEmail } = await import('../utils/emailTemplates.js');
          const transporter = nodemailer.default.createTransport({
            service: 'gmail',
            auth: { user: SENDER_EMAIL, pass: GMAIL_APP_PASSWORD },
          });
          await transporter.sendMail({
            from: `"Vidopick" <${SENDER_EMAIL}>`,
            to: orgAuthUser.email,
            subject: `New Pro request for ${orgName}`,
            html: buildOrgSubscriberNotificationEmail(
              orgName,
              subscriberName,
              email || undefined,
              dashboardUrl
            ),
          });
          console.log(`[requestSponsorship] org notification sent to ${orgAuthUser.email}`);
        }
      }
    } catch (e) {
      console.warn('[requestSponsorship] org notification failed:', e);
    }

    res.json({ success: true });
  }
);
