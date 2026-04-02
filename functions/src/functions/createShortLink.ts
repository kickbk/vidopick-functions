import express from 'express';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { nanoid } from 'nanoid';

if (!getApps().length) {
  initializeApp();
}

const db = getFirestore();
const app = express();
app.use(express.json());

type RedirectSpec = {
  ios?: string | null;
  android?: string | null;
  desktop: string;
  webOnly?: boolean; // If we want the link to open web even if the app is installed
};

type Playlist = { title: string; id: string };

// See https://help.branch.io/docs/deep-link-reference for references on values branch.io accepts
type CreateBody = {
  linkTitle: string;
  slug?: string; // If none passed, we use nanoid to generate
  redirect: RedirectSpec;
  params?: Record<string, any>; // Link data
  analytics?: Record<string, any>;
  meta?: Record<string, any>;
  ttl?: string | number | Date | null; // optional expiration date/time
  playlists?: Playlist[];
  advertiserId?: string;
};

const COLLECTION = 'shortLinks';
const RANDOM_ID_LENGTH = 10;
const MAX_TRIES = 5;

const makeDocData = (b: CreateBody) => ({
  linkTitle: b.linkTitle,
  createdAt: FieldValue.serverTimestamp(),
  ttl: b.ttl ? new Date(b.ttl) : null,
  redirect: {
    ios: b.redirect.ios ?? null,
    android: b.redirect.android ?? null,
    desktop: b.redirect.desktop,
    webOnly: b.redirect.webOnly ?? false,
  },
  params: {
    ...(b.params ?? {}),
    ...(b.playlists ? { playlists: b.playlists } : {}),
    // Ensure advertiserId is in params for Firestore queries
    ...(b.advertiserId ? { advertiserId: b.advertiserId } : {}),
  },
  analytics: b.analytics ?? {},
  meta: b.meta ?? {},
  // Store advertiserId at top level too (for your script's needs)
  ...(b.advertiserId ? { advertiserId: b.advertiserId } : {}),
});

app.post('/', async (req, res): Promise<void> => {
  // ========================================
  // AUTHENTICATION & AUTHORIZATION
  // ========================================

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized - Missing authorization header' });
    return;
  }

  const token = authHeader.split('Bearer ')[1];
  let decodedToken;

  try {
    const auth = getAuth();
    decodedToken = await auth.verifyIdToken(token);
  } catch (error) {
    console.error('Token verification failed:', error);
    res.status(401).json({ error: 'Unauthorized - Invalid token' });
    return;
  }

  // Check if user is admin or advertiser
  const isAdmin = decodedToken.role === 'admin';
  const isAdvertiser = decodedToken.role === 'advertiser';

  if (!isAdmin && !isAdvertiser) {
    res.status(403).json({
      error: 'Forbidden - Only admins and advertisers can create short links',
    });
    return;
  }

  // ========================================
  // VALIDATION & PROCESSING
  // ========================================

  const body = req.body as Partial<CreateBody> | undefined;

  // Basic validation
  if (!body || !body.linkTitle || !body.redirect?.desktop) {
    res.status(400).json({ error: 'Missing required fields: link title and desktop redirect.' });
    return;
  }

  // SECURITY: If advertiser (not admin), force their advertiserId
  // This prevents advertisers from spoofing other advertisers' IDs
  if (isAdvertiser && !isAdmin) {
    const advertiserId = decodedToken.advertiserId;

    if (!advertiserId) {
      res.status(403).json({
        error: 'Advertiser account not properly configured - missing advertiserId',
      });
      return;
    }

    // Override any advertiserId in the request with the authenticated user's ID
    body.advertiserId = advertiserId;

    // Ensure params object exists and has correct advertiserId
    if (!body.params) {
      body.params = {};
    }
    body.params.advertiserId = advertiserId;

    console.log(`Advertiser ${advertiserId} creating short link: ${body.linkTitle}`);
  } else {
    // Admin can create links with any advertiserId (or none)
    console.log(
      `Admin creating short link: ${body.linkTitle}`,
      body.advertiserId ? `for advertiser ${body.advertiserId}` : '(no advertiser)'
    );
  }

  // ========================================
  // CREATE SHORT LINK
  // ========================================

  try {
    // If user supplies a slug, try to create with that exact id.
    if (body.slug) {
      const id = body.slug;
      const docRef = db.collection(COLLECTION).doc(id);
      try {
        await docRef.create(makeDocData(body as CreateBody));
        res.status(201).json({ shortLink: `https://vpk.to/${id}`, id });
        return;
      } catch (e: any) {
        // Firestore Admin error code for "already exists" is 6; sometimes "already-exists"
        if (e?.code === 6 || e?.code === 'already-exists') {
          res.status(409).json({ error: 'Slug already exists. Please choose another.' });
          return;
        }
        throw e;
      }
    }

    // Otherwise, generate a random id and retry on rare collision.
    for (let i = 0; i < MAX_TRIES; i++) {
      const id = nanoid(RANDOM_ID_LENGTH);
      const docRef = db.collection(COLLECTION).doc(id);
      try {
        await docRef.create(makeDocData(body as CreateBody));
        res.status(201).json({ shortLink: `https://vpk.to/${id}`, id });
        return;
      } catch (e: any) {
        if (e?.code === 6 || e?.code === 'already-exists') {
          // Try again with a fresh id
          continue;
        }
        throw e;
      }
    }

    // Extremely unlikely with 10 chars
    res.status(503).json({ error: 'Could not allocate a unique ID, please retry.' });
  } catch (err) {
    console.error('Error creating short link:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export const createShortLink = onRequest(
  {
    region: 'us-central1',
    cors: true, // Enable CORS for web requests
    maxInstances: 10, // Limit concurrent instances
  },
  app
);
