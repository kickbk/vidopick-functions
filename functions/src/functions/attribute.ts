// functions/src/attribute.ts
import express from 'express';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/v2/https';

if (!getApps().length) {
  initializeApp();
}

const db = getFirestore();
const app = express();
app.use(express.json());

const COLLECTION = 'shortLinks';

type AttributeBody = {
  id: string; // shortLinks/:id
  platform: 'ios' | 'android' | string;
  method: 'install_referrer' | 'clipboard' | 'universal_link' | string;
  referrer?: string | null; // raw Play referrer string, optional
  // deviceId?: string | null; // optional idempotency key from client
};

app.post('/attribute', async (req, res): Promise<void> => {
  const body = req.body as Partial<AttributeBody> | undefined;

  // Basic validation
  const id = (body?.id ?? '').toString().trim();
  const platform = (body?.platform ?? '').toString().trim();
  const method = (body?.method ?? '').toString().trim();

  if (!id || !platform || !method) {
    res.status(400).json({ error: 'Missing required fields: id, platform, method.' });
    return;
  }

  try {
    const linkRef = db.collection(COLLECTION).doc(id);
    const linkSnap = await linkRef.get();
    if (!linkSnap.exists) {
      res.status(404).json({ error: 'Unknown link id.' });
      return;
    }

    // Optional idempotency by deviceId+method (best-effort; safe to omit if not needed)
    // if (body?.deviceId) {
    //   const dup = await linkRef
    //     .collection('conversions')
    //     .where('deviceId', '==', body.deviceId)
    //     .where('method', '==', method)
    //     .limit(1)
    //     .get();

    //   if (!dup.empty) {
    //     // Already recorded for this device+method — treat as success
    //     res.status(204).end();
    //     return;
    //   }
    // }

    // Persist conversion event
    const conversion = {
      platform,
      method,
      referrer: body?.referrer ?? null,
      // deviceId: body?.deviceId ?? null,
      at: FieldValue.serverTimestamp(),
      // You may add lightweight context if useful:
      // ua: req.get('user-agent') ?? null,
    };

    await linkRef.collection('conversions').add(conversion);

    // Increment aggregates on parent doc
    await linkRef.set(
      {
        analytics: {
          conversions: {
            total: FieldValue.increment(1),
            byPlatform: { [platform]: FieldValue.increment(1) },
            byMethod: { [method]: FieldValue.increment(1) },
            lastConversionAt: FieldValue.serverTimestamp(),
          },
        },
      },
      { merge: true }
    );

    res.status(204).end();
  } catch (err) {
    console.error('attribute error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export const attribute = onRequest(
  {
    region: 'us-central1',
    cors: true, // allow calls from web/app if needed
  },
  app
);
