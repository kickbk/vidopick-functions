import * as admin from 'firebase-admin';
import * as nodemailer from 'nodemailer';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { buildMemberSubscriberNotificationEmail } from '../utils/emailTemplates';

if (!admin.apps.length) admin.initializeApp();

const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
const SENDER_EMAIL = 'vidopickhelp@gmail.com';
const ADMIN_BASE_URL = process.env.FUNCTIONS_EMULATOR
  ? 'http://localhost:5173'
  : 'https://vidopick.com';

/**
 * Notify a member by email when a new user requests Pro sponsorship
 * via one of their invites.
 *
 * Called internally by requestSponsorship when a memberId is known.
 * Callable by org admins and the platform.
 */
export const notifyMemberNewSubscriber = onCall(
  { region: 'us-central1', memory: '256MiB' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Not authenticated');

    const { memberId, subscriberEmail, organizationId } = (request.data ?? {}) as {
      memberId?: string;
      subscriberEmail?: string;
      organizationId?: string;
    };

    if (!memberId || !subscriberEmail || !organizationId) {
      throw new HttpsError('invalid-argument', 'memberId, subscriberEmail, and organizationId are required');
    }

    if (!GMAIL_APP_PASSWORD) {
      throw new HttpsError('internal', 'Email configuration missing');
    }

    const db = admin.firestore();

    const [memberSnap, orgSnap] = await Promise.all([
      db.doc(`members/${memberId}`).get(),
      db.doc(`organizations/${organizationId}`).get(),
    ]);

    if (!memberSnap.exists) throw new HttpsError('not-found', 'Member not found');

    const memberData = memberSnap.data()!;
    const memberEmail: string | undefined = memberData.email;
    const memberName: string = memberData.name ?? 'there';

    if (!memberEmail) {
      console.warn(`[notifyMemberNewSubscriber] member ${memberId} has no email, skipping`);
      return { success: true, skipped: true };
    }

    const orgName: string = orgSnap.data()?.name ?? 'your organization';
    const dashboardUrl = `${ADMIN_BASE_URL}/admin/organizations/${organizationId}/pro-approvals/`;

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: SENDER_EMAIL, pass: GMAIL_APP_PASSWORD },
    });

    await transporter.sendMail({
      from: `"Vidopick" <${SENDER_EMAIL}>`,
      to: memberEmail,
      subject: `New Pro request for ${orgName}`,
      html: buildMemberSubscriberNotificationEmail(memberName, subscriberEmail, undefined, orgName, dashboardUrl),
    });

    console.log(
      `[notifyMemberNewSubscriber] notified member=${memberId} (${memberEmail}) about subscriber=${subscriberEmail}`
    );

    return { success: true };
  }
);
