// firebase/functions/src/setAdminClaims.ts
// One-time script to set admin claims for existing admin user
// Deploy with: firebase deploy --only functions:setAdminClaims

import * as admin from 'firebase-admin';
import { onRequest } from 'firebase-functions/v2/https';

if (!admin.apps.length) {
  admin.initializeApp();
}

/**
 * HTTP endpoint to set admin claims
 * Accepts either email OR uid
 * Usage:
 * curl -X POST https://your-region-your-project.cloudfunctions.net/setAdminClaims \
 *   -H "Content-Type: application/json" \
 *   -d '{"uid":"YOUR_UID_HERE","secret":"YOUR_SECRET_HERE"}'
 */
export const setAdminClaims = onRequest(async (request, response) => {
  // IMPORTANT: Add a secret to prevent abuse
  const SECRET = process.env.EXTENSION_API_KEY || 'change-me-in-production';

  const { email, uid, secret } = request.body;

  // Verify secret
  if (secret !== SECRET) {
    response.status(403).json({ error: 'Invalid secret' });
    return;
  }

  if (!email && !uid) {
    response.status(400).json({ error: 'Either email or uid is required' });
    return;
  }

  try {
    let user;

    // Get user by email or uid
    if (uid) {
      user = await admin.auth().getUser(uid);
    } else if (email) {
      user = await admin.auth().getUserByEmail(email);
    }

    if (!user) {
      response.status(404).json({ error: 'User not found' });
      return;
    }

    // Set admin claims
    await admin.auth().setCustomUserClaims(user.uid, {
      role: 'admin',
    });

    console.log(`Admin claims set for ${user.email} (uid: ${user.uid})`);

    response.json({
      success: true,
      message: `Admin claims set for ${user.email}. User must log out and back in for changes to take effect.`,
      uid: user.uid,
      email: user.email,
    });
  } catch (error: any) {
    console.error('Error setting admin claims:', error);
    response.status(500).json({
      error: error.message,
      code: error.code,
    });
  }
});
