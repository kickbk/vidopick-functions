import * as admin from 'firebase-admin';
import { onRequest } from 'firebase-functions/v2/https';

if (!admin.apps.length) admin.initializeApp();

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const revertEmailChange = onRequest(
  { region: 'us-central1', timeoutSeconds: 15, memory: '256MiB', invoker: 'public', cors: false },
  async (req, res) => {
    const token = String((req.query.token as string) ?? '').trim();

    const respond = (ok: boolean, heading: string, body: string) => {
      const color = ok ? '#16a34a' : '#dc2626';
      res.status(ok ? 200 : 400).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${heading} — Vidopick</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;">
  <div style="max-width:480px;width:100%;background:#fff;border-radius:16px;padding:48px 40px;box-shadow:0 4px 6px -1px rgba(0,0,0,0.07);text-align:center;">
    <a href="https://vidopick.com" style="font-family:Arial Black,sans-serif;font-size:32px;font-weight:700;color:#1d4ed8;text-decoration:none;display:block;margin-bottom:32px;">Vidopick</a>
    <div style="width:56px;height:56px;border-radius:50%;background:${color}22;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;">
      <span style="font-size:28px;">${ok ? '✓' : '✕'}</span>
    </div>
    <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#0f172a;">${heading}</h1>
    <p style="margin:0 0 32px;font-size:15px;color:#64748b;line-height:1.6;">${body}</p>
    <a href="https://vidopick.com" style="display:inline-block;background:#1d4ed8;color:#fff;text-decoration:none;padding:13px 32px;border-radius:10px;font-size:15px;font-weight:600;">Go to Vidopick</a>
  </div>
</body>
</html>`);
    };

    if (!token) {
      return respond(false, 'Invalid link', 'This revert link is missing a token. Please use the link from your email exactly as received.');
    }

    const db = admin.firestore();
    const tokenDoc = await db.collection('emailRevertTokens').doc(token).get();

    if (!tokenDoc.exists) {
      return respond(false, 'Link already used', 'This revert link has already been used or does not exist. If you still need help, contact us at vidopickhelp@gmail.com.');
    }

    const { uid, originalEmail, newEmail, expiresAt } = tokenDoc.data()!;

    if (expiresAt.toMillis() < Date.now()) {
      await tokenDoc.ref.delete();
      return respond(false, 'Link expired', `This revert link expired after ${7} days. Please contact us at vidopickhelp@gmail.com if you need help recovering your account.`);
    }

    try {
      await admin.auth().updateUser(uid, { email: originalEmail });
      // Delete ALL revert tokens for this UID — voids any token from a chained attack.
      const allTokens = await db.collection('emailRevertTokens').where('uid', '==', uid).get();
      const affiliateSnap = await db.collection('affiliates').where('authUid', '==', uid).limit(1).get();
      const batch = db.batch();
      allTokens.docs.forEach((doc) => batch.delete(doc.ref));
      if (!affiliateSnap.empty) {
        batch.update(affiliateSnap.docs[0].ref, { email: originalEmail });
      }
      await Promise.all([
        batch.commit(),
        // Revoke all sessions — kicks out whoever is currently using this account.
        admin.auth().revokeRefreshTokens(uid),
        // Clear any pending change so it can't be re-applied with a lingering token.
        db.doc(`users/${uid}`).update({ pendingEmailChange: admin.firestore.FieldValue.delete() }).catch(() => {}),
      ]);
      return respond(
        true,
        'Email reverted',
        `Your Vidopick email address has been restored to <strong>${esc(originalEmail)}</strong>. The change to <strong>${esc(newEmail)}</strong> has been undone. Open the app and sign in with your original address.`
      );
    } catch (e: any) {
      console.error('[revertEmailChange] updateUser failed:', e);
      return respond(false, 'Something went wrong', 'We couldn\'t revert your email change. Please contact us at vidopickhelp@gmail.com and we\'ll sort it out right away.');
    }
  }
);
