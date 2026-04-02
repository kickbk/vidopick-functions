/**
 * Firebase Cloud Function to send support emails
 *
 * Setup:
 * 1. Install dependencies in your functions folder:
 *    npm install nodemailer
 *    npm install @types/nodemailer --save-dev (if using TypeScript)
 *
 * 2. Configure email service credentials using Firebase config:
 *    firebase functions:config:set email.user="your-email@gmail.com" email.pass="your-app-password"
 *
 * 3. If using Gmail, create an App Password:
 *    https://support.google.com/accounts/answer/185833
 *
 * Deploy:
 * firebase deploy --only functions:sendSupportEmail
 */

import * as functions from 'firebase-functions';
import * as nodemailer from 'nodemailer';

const EMAIL_ACCOUNT = process.env.EMAIL_ACCOUNT;
const EMAIL_PASS = process.env.EMAIL_PASS;

// CORS configuration
const cors = require('cors')({ origin: true });

interface ContactFormData {
  name: string;
  email: string;
  message: string;
}

export const sendSupportEmail = functions.https.onRequest((request, response) => {
  // Enable CORS
  cors(request, response, async () => {
    // Only allow POST requests
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

      if (!EMAIL_ACCOUNT || !EMAIL_PASS) {
        console.error('Email configuration missing');
        response.status(500).json({ error: 'Server configuration error' });
        return;
      }

      // Configure nodemailer transporter
      // For Gmail, you'll need to use an App Password
      const transporter = nodemailer.createTransport({
        service: 'gmail', // or 'smtp.gmail.com'
        auth: {
          user: EMAIL_ACCOUNT,
          pass: EMAIL_PASS,
        },
      });

      // Alternative: Use a different SMTP service
      // const transporter = nodemailer.createTransport({
      //   host: 'smtp.example.com',
      //   port: 587,
      //   secure: false,
      //   auth: {
      //     user: emailUser,
      //     pass: emailPass,
      //   },
      // });

      // Email to you (the support team)
      const mailOptions = {
        from: `Vidopick Support <${EMAIL_ACCOUNT}>`,
        to: EMAIL_ACCOUNT, // Your support email
        replyTo: email, // User's email for easy replies
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
      };

      // Auto-reply to user (optional)
      const autoReplyOptions = {
        from: `Vidopick Support <${EMAIL_ACCOUNT}>`,
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
      };

      // Send both emails
      await transporter.sendMail(mailOptions);
      await transporter.sendMail(autoReplyOptions);

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
});
