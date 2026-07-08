import * as admin from 'firebase-admin';
import { onRequest } from 'firebase-functions/v2/https';
import { Resend } from 'resend';

import { checkRateLimit, escapeHtml, requestIp } from '../utils/rateLimit';

if (!admin.apps.length) admin.initializeApp();

const RESEND_API_KEY = process.env.RESEND_API_KEY;

const MAX_NAME_LEN = 100;
const MAX_EMAIL_LEN = 255;
const MAX_MESSAGE_LEN = 5000;

interface ContactFormData {
  name: string;
  email: string;
  message: string;
}

export const sendSupportEmail = onRequest({ cors: true }, async (request, response) => {
  if (request.method !== 'POST') {
    response.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { name, email, message } = (request.body ?? {}) as ContactFormData;

    // Validate input
    if (
      typeof name !== 'string' ||
      typeof email !== 'string' ||
      typeof message !== 'string' ||
      !name.trim() ||
      !email.trim() ||
      !message.trim()
    ) {
      response.status(400).json({ error: 'Missing required fields' });
      return;
    }

    if (
      name.length > MAX_NAME_LEN ||
      email.length > MAX_EMAIL_LEN ||
      message.length > MAX_MESSAGE_LEN
    ) {
      response.status(400).json({ error: 'Input exceeds maximum length' });
      return;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      response.status(400).json({ error: 'Invalid email address' });
      return;
    }

    // Two rate limits keep this from being abused as a spam relay while still
    // letting the app AND the web contact/data-request forms send a confirmation:
    //  - per IP: caps total volume from any one source
    //  - per recipient: stops the confirmation being used to bomb a single victim
    const ip = requestIp(request);
    if (!(await checkRateLimit(`support_ip_${ip}`, 5))) {
      response.status(429).json({ error: 'Too many requests. Please try again later.' });
      return;
    }
    const autoReplyAllowed = await checkRateLimit(`support_to_${email.trim().toLowerCase()}`, 3);

    if (!RESEND_API_KEY) {
      console.error('Email configuration missing');
      response.status(500).json({ error: 'Server configuration error' });
      return;
    }

    const resend = new Resend(RESEND_API_KEY);

    const safeName = escapeHtml(name.trim());
    const safeEmail = escapeHtml(email.trim());
    const safeMessage = escapeHtml(message.trim());

    // Email to you (the support team)
    await resend.emails.send({
      from: 'Vidopick <noreply@vidopick.com>',
      to: 'support@vidopick.com',
      replyTo: email.trim(),
      subject: `Vidopick Support Request from ${name.trim().replace(/[\r\n]+/g, ' ')}`,
      html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">New Support Request from Vidopick App</h2>

            <div style="background-color: #f5f5f5; padding: 20px; border-radius: 5px; margin: 20px 0;">
              <p style="margin: 10px 0;"><strong>From:</strong> ${safeName}</p>
              <p style="margin: 10px 0;"><strong>Email:</strong> ${safeEmail}</p>
            </div>

            <div style="background-color: #fff; padding: 20px; border: 1px solid #ddd; border-radius: 5px;">
              <h3 style="color: #555; margin-top: 0;">Message:</h3>
              <p style="white-space: pre-wrap; line-height: 1.6;">${safeMessage}</p>
            </div>

            <p style="color: #999; font-size: 12px; margin-top: 20px;">
              This message was sent from the Vidopick mobile app.
            </p>
          </div>
        `,
    });

    // Confirmation to the submitter — sent for app and web (contact / data-request)
    // submissions alike, bounded by the per-recipient limit above.
    if (autoReplyAllowed) {
      await resend.emails.send({
        from: 'Vidopick <noreply@vidopick.com>',
        to: email.trim(),
        subject: 'We received your message - Vidopick Support',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">Thank you for contacting Vidopick!</h2>

            <p>Hi ${safeName},</p>

            <p>We've received your message and will get back to you as soon as possible.</p>

            <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <h3 style="color: #555; margin-top: 0;">Your message:</h3>
              <p style="white-space: pre-wrap; line-height: 1.6;">${safeMessage}</p>
            </div>

            <p>Best regards,<br>The Vidopick Team</p>

            <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;" />

            <p style="color: #999; font-size: 12px;">
              This is an automated response. Please do not reply to this email.
            </p>
          </div>
        `,
      });
    }

    console.log('Support email sent successfully from:', email);

    response.status(200).json({
      success: true,
      message: 'Email sent successfully',
    });
  } catch (error) {
    console.error('Error sending email:', error);
    response.status(500).json({ error: 'Failed to send email' });
  }
});
