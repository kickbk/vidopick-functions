import { onRequest } from 'firebase-functions/v2/https';
import { Resend } from 'resend';

const RESEND_API_KEY = process.env.RESEND_API_KEY;

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
    const { name, email, message } = request.body as ContactFormData;

    // Validate input
    if (!name || !email || !message) {
      response.status(400).json({ error: 'Missing required fields' });
      return;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      response.status(400).json({ error: 'Invalid email address' });
      return;
    }

    // Get email configuration from Firebase config
    // const emailUser = functions.config().email?.user;
    // const emailPass = functions.config().email?.pass;

    if (!RESEND_API_KEY) {
      console.error('Email configuration missing');
      response.status(500).json({ error: 'Server configuration error' });
      return;
    }

    const resend = new Resend(RESEND_API_KEY);

    // Email to you (the support team)
    await resend.emails.send({
      from: 'Vidopick <hello@vidopick.com>',
      to: 'hello@vidopick.com',
      replyTo: email,
      subject: `Vidopick Support Request from ${name}`,
      html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">New Support Request from Vidopick App</h2>

            <div style="background-color: #f5f5f5; padding: 20px; border-radius: 5px; margin: 20px 0;">
              <p style="margin: 10px 0;"><strong>From:</strong> ${name}</p>
              <p style="margin: 10px 0;"><strong>Email:</strong> ${email}</p>
            </div>

            <div style="background-color: #fff; padding: 20px; border: 1px solid #ddd; border-radius: 5px;">
              <h3 style="color: #555; margin-top: 0;">Message:</h3>
              <p style="white-space: pre-wrap; line-height: 1.6;">${message}</p>
            </div>

            <p style="color: #999; font-size: 12px; margin-top: 20px;">
              This message was sent from the Vidopick mobile app.
            </p>
          </div>
        `,
    });

    // Auto-reply to user
    await resend.emails.send({
      from: 'Vidopick <hello@vidopick.com>',
      to: email,
      subject: 'We received your message - Vidopick Support',
      html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">Thank you for contacting Vidopick!</h2>

            <p>Hi ${name},</p>

            <p>We've received your message and will get back to you as soon as possible.</p>

            <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <h3 style="color: #555; margin-top: 0;">Your message:</h3>
              <p style="white-space: pre-wrap; line-height: 1.6;">${message}</p>
            </div>

            <p>Best regards,<br>The Vidopick Team</p>

            <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;" />

            <p style="color: #999; font-size: 12px;">
              This is an automated response. Please do not reply to this email.
            </p>
          </div>
        `,
    });

    console.log('Support email sent successfully from:', email);

    response.status(200).json({
      success: true,
      message: 'Email sent successfully',
    });
  } catch (error) {
    console.error('Error sending email:', error);
    response.status(500).json({
      error: 'Failed to send email',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});
