import * as crypto from 'crypto';

import * as admin from 'firebase-admin';
import { Resend } from 'resend';
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';

import { checkRateLimit, requestIp } from '../utils/rateLimit';

if (!admin.apps.length) {
  admin.initializeApp();
}

// Non-ambiguous alphabet (no 0/O, 1/I/L) for the on-screen manual-entry code.
// Independent of the sessionId so showing the code never leaks part of the secret.
const SHORT_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateShortCode(length = 8): string {
  const bytes = crypto.randomBytes(length);
  let code = '';
  for (let i = 0; i < length; i++) {
    code += SHORT_CODE_ALPHABET[bytes[i] % SHORT_CODE_ALPHABET.length];
  }
  return code;
}

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const DEVICE_AUTH_BASE = 'https://vidopick.com/device-auth/';

const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Simple in-memory rate limit: max 5 sessions per IP per 10 minutes
const ipCounts = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 10 * 60 * 1000;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = ipCounts.get(ip);
  if (!entry || now > entry.resetAt) {
    ipCounts.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  if (entry.count >= RATE_LIMIT) return true;
  entry.count++;
  return false;
}

/**
 * Called by the device app (via plain fetch — no Firebase Functions SDK in RN app).
 * Creates a short-lived document in `deviceSessions/{sessionId}`.
 * Returns { sessionId } so the device can construct the QR code URL.
 */
export const createDeviceSession = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 10,
    memory: '256MiB',
    invoker: 'public',
    cors: true,
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() ?? req.ip ?? 'unknown';
    if (isRateLimited(ip)) {
      res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
      return;
    }

    const db = admin.firestore();
    const sessionRef = db.collection('deviceSessions').doc();
    const sessionId = sessionRef.id;

    const shortCode = generateShortCode();

    await sessionRef.set({
      status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      // Shown on device for manual entry at vpk.to/device-auth
      shortCode,
      // App builds prior to the shortCode-in-response change derive the displayed
      // code from the sessionId prefix; keep resolving those until OTA rollout
      // completes, then this field (and its lookup fallback) can be removed.
      legacyShortCode: sessionId.slice(0, 8).toUpperCase(),
    });

    res.json({ sessionId, shortCode });
  }
);

/**
 * Called by the web page on the phone after the user authenticates.
 * Writes confirmation + stores a custom token in the session doc so the TV/mobile device
 * can sign in by reading the doc via its onSnapshot listener.
 */
export const confirmDeviceSession = onCall(
  {
    region: 'us-central1',
    timeoutSeconds: 10,
    memory: '256MiB',
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in to confirm a device session');
    }

    const { sessionId } = (request.data ?? {}) as { sessionId?: string };
    if (!sessionId) {
      throw new HttpsError('invalid-argument', 'sessionId is required');
    }

    const db = admin.firestore();
    const sessionRef = db.doc(`deviceSessions/${sessionId}`);
    const snap = await sessionRef.get();

    if (!snap.exists) {
      throw new HttpsError('not-found', 'Session not found');
    }

    const data = snap.data()!;
    if (data.status !== 'pending') {
      throw new HttpsError('failed-precondition', 'Session already used or expired');
    }

    const expiresAt: admin.firestore.Timestamp = data.expiresAt;
    if (expiresAt && expiresAt.toMillis() < Date.now()) {
      throw new HttpsError('deadline-exceeded', 'Session has expired');
    }

    const uid = request.auth.uid;
    // Short-lived custom token — device reads this from the doc and immediately signs in
    const customToken = await admin.auth().createCustomToken(uid);

    await sessionRef.update({
      status: 'confirmed',
      uid,
      customToken,
      confirmedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { success: true };
  }
);

/**
 * Sends a Firebase email sign-in link to the given email address with a
 * continueUrl that brings the user back to the device auth page with the session
 * already in the URL.  Called from the DeviceAuth web page.
 */
export const sendDeviceAuthLink = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 15,
    memory: '256MiB',
    invoker: 'public',
    cors: true,
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    console.log('[sendDeviceAuthLink] called, body:', JSON.stringify(req.body));

    const { email, sessionId, shortCode } = (req.body ?? {}) as {
      email?: string;
      sessionId?: string;
      shortCode?: string;
    };

    if (!email || (!sessionId && !shortCode)) {
      console.error('[sendDeviceAuthLink] missing email or session identifier');
      res.status(400).json({
        error: 'email and either sessionId or shortCode are required',
      });
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      console.error('[sendDeviceAuthLink] invalid email:', email);
      res.status(400).json({ error: 'Invalid email address' });
      return;
    }

    if (!RESEND_API_KEY) {
      console.error('[sendDeviceAuthLink] RESEND_API_KEY not set');
      res.status(500).json({ error: 'Email not configured' });
      return;
    }

    // Rate limit: this endpoint emails arbitrary addresses and resolves shortCodes,
    // so cap both per-IP volume and per-email volume.
    const ip = requestIp(req);
    const [ipAllowed, emailAllowed] = await Promise.all([
      checkRateLimit(`deviceauth_ip_${ip}`, 10),
      checkRateLimit(`deviceauth_email_${email.toLowerCase()}`, 5),
    ]);
    if (!ipAllowed || !emailAllowed) {
      res.status(429).json({ error: 'Too many requests. Please try again later.' });
      return;
    }

    // If the caller only has the 8-char shortCode, resolve it to a full sessionId here
    // using the admin SDK (bypasses App Check / security rules).
    let resolvedSessionId = sessionId;
    if (!resolvedSessionId && shortCode) {
      const normalizedCode = shortCode.toUpperCase();
      let snap = await admin
        .firestore()
        .collection('deviceSessions')
        .where('shortCode', '==', normalizedCode)
        .where('status', '==', 'pending')
        .limit(1)
        .get();

      // Fallback for sessions displayed by pre-OTA app builds (sessionId-prefix codes)
      if (snap.empty) {
        snap = await admin
          .firestore()
          .collection('deviceSessions')
          .where('legacyShortCode', '==', normalizedCode)
          .where('status', '==', 'pending')
          .limit(1)
          .get();
      }

      if (snap.empty) {
        console.warn('[sendDeviceAuthLink] shortCode not found or already used:', shortCode);
        res.status(404).json({
          error: 'Code not found or already used. Check the code on your device and try again.',
        });
        return;
      }
      resolvedSessionId = snap.docs[0].id;
      console.log('[sendDeviceAuthLink] resolved shortCode to sessionId:', resolvedSessionId);
    }

    const continueUrl = `${DEVICE_AUTH_BASE}?session=${encodeURIComponent(resolvedSessionId!)}&email=${encodeURIComponent(email)}`;
    console.log('[sendDeviceAuthLink] continueUrl:', continueUrl);

    const link = await admin.auth().generateSignInWithEmailLink(email, {
      url: continueUrl,
      handleCodeInApp: true,
    });
    console.log('[sendDeviceAuthLink] link generated, sending email to:', email);

    const resend = new Resend(RESEND_API_KEY);
    await resend.emails.send({
      from: 'Vidopick <hello@vidopick.com>',
      to: email,
      subject: 'Authenticate Vidopick on another device',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 16px;">
          <p style="font-size:28px;font-weight:700;color:#1d4ed8;margin:0 0 24px;">Vidopick</p>
          <p style="font-size:16px;color:#1e293b;margin:0 0 16px;">
            Tap the button below to sign in on another device.
            This link expires in 30 minutes and can only be used once.
          </p>
          <a href="${link}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:14px 28px;border-radius:10px;font-size:16px;font-weight:600;margin-bottom:24px;">
            Authenticate device
          </a>
          <p style="font-size:13px;color:#64748b;">
            If you didn't request this, you can safely ignore this email.
          </p>
        </div>
      `,
    });

    console.log('[sendDeviceAuthLink] email sent successfully to:', email);
    res.json({ success: true });
  }
);
