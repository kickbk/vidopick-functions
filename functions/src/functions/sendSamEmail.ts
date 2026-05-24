import { HttpsError, onCall } from 'firebase-functions/v2/https';
import * as nodemailer from 'nodemailer';

const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;

interface SendSamEmailData {
  to: string;
  subject: string;
  html: string;
}

export const sendSamEmail = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in');
  }
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
    throw new HttpsError('internal', 'Email service not configured');
  }

  const { to, subject, html } = request.data as SendSamEmailData;
  if (!to || !subject || !html) {
    throw new HttpsError('invalid-argument', 'Missing to, subject, or html');
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  });

  await transporter.sendMail({
    from: `Ben Kass - Vidopick <${GMAIL_USER}>`,
    to,
    subject,
    html,
  });
});
