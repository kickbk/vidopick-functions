import * as admin from 'firebase-admin';
import { onRequest } from 'firebase-functions/v2/https';

if (!admin.apps.length) admin.initializeApp();

const ALLOWED_ORIGINS = ['https://vidopick.com', 'http://localhost:5173'];

function applyCors(req: any, res: any): boolean {
  const origin = req.headers.origin as string | undefined;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
  }
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return true;
  }
  return false;
}

export const activateAffiliateJoin = onRequest(
  { region: 'us-central1', invoker: 'public', memory: '256MiB', timeoutSeconds: 30 },
  async (req, res) => {
    if (applyCors(req, res)) return;

    const db = admin.firestore();

    // GET — probe: return lead info without creating anything
    if (req.method === 'GET') {
      const token = ((req.query.t as string) ?? '').trim();
      if (!token) {
        res.status(400).json({ error: 'Missing activation token.' });
        return;
      }

      const snap = await db
        .collection('affiliatesOutreach')
        .where('activationToken', '==', token)
        .limit(1)
        .get();

      if (snap.empty) {
        res.status(404).json({ error: 'Activation link not found or expired.' });
        return;
      }

      const lead = snap.docs[0].data();

      // activationUsed: token consumed but account exists — let them request a new sign-in link
      if (lead.activationUsed || lead.affiliateId) {
        res.status(200).json({
          alreadyActivated: true,
          displayName: (lead.displayName ?? lead.firstName ?? null) as string | null,
        });
        return;
      }

      res.status(200).json({
        needsEmail: !lead.email,
        displayName: (lead.displayName ?? lead.firstName ?? 'there') as string,
        firstName: (lead.firstName ?? lead.displayName ?? null) as string | null,
      });
      return;
    }

    // POST — activate: create affiliate record + return magic link
    if (req.method === 'POST') {
      const body = req.body as { token?: string; email?: string };
      const token = (body.token ?? '').trim();
      if (!token) {
        res.status(400).json({ error: 'Missing activation token.' });
        return;
      }

      const snap = await db
        .collection('affiliatesOutreach')
        .where('activationToken', '==', token)
        .limit(1)
        .get();

      if (snap.empty) {
        res.status(404).json({ error: 'Activation link not found or expired.' });
        return;
      }

      const leadDoc = snap.docs[0];
      const lead = leadDoc.data();

      if (lead.affiliateId) {
        res.status(200).json({ alreadyActivated: true });
        return;
      }

      // Fix 1: lead.email always wins; body.email is only used when no email is on record
      const email =
        (lead.email as string | null) ?? ((body.email ?? '').trim().toLowerCase() || null);

      if (!email) {
        res.status(400).json({ error: 'Email address is required.' });
        return;
      }

      const name: string = (lead.fullName ?? lead.displayName ?? 'Affiliate') as string;

      // Fix 3: if this email already belongs to an existing non-affiliate Vidopick user, refuse
      try {
        const existingAuthUser = await admin.auth().getUserByEmail(email);
        const existingUserDoc = await db.doc(`users/${existingAuthUser.uid}`).get();
        if (existingUserDoc.exists) {
          const userData = existingUserDoc.data()!;
          if (userData.proType && userData.proType !== 'affiliate') {
            res.status(409).json({
              error:
                'This email is linked to an existing Vidopick account. Please use a different email or contact affiliates@vidopick.com.',
            });
            return;
          }
        }
      } catch (err: any) {
        if (err.code !== 'auth/user-not-found') throw err;
        // No existing user — will be created below
      }

      // Fix 2: atomically claim the token so it cannot be replayed
      // The transaction verifies affiliateId is still null, deletes the token, and marks
      // the lead as "pending". If two requests race, only one wins the transaction.
      try {
        await db.runTransaction(async (tx) => {
          const fresh = await tx.get(leadDoc.ref);
          const freshData = fresh.data();
          if (!fresh.exists || freshData?.affiliateId || freshData?.activationUsed) {
            throw new Error('already_activated');
          }
          // Mark used but keep the token so returning users can still find this record
          tx.update(leadDoc.ref, {
            activationUsed: true,
            affiliateId: 'pending',
          });
        });
      } catch (err: any) {
        if (err.message === 'already_activated') {
          res.status(200).json({ alreadyActivated: true });
          return;
        }
        throw err;
      }

      // Create affiliate doc + Auth user. On any failure, restore the lead so it can be retried.
      const affiliateRef = db.collection('affiliates').doc();
      const affiliateId = affiliateRef.id;

      try {
        await affiliateRef.set({
          type: 'influencer',
          name,
          email,
          commissionRate: 0.25,
          publicProfileCommissionRate: 0.1,
          commissionMonthsLimit: 24,
          discountPercent: 20,
          isHidden: false,
          payoutMethod: 'paypal',
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          stats: {
            clicks: 0,
            signups: 0,
            payingCustomers: 0,
            activeSubscribers: 0,
            pendingEarningsCents: 0,
            approvedEarningsCents: 0,
            paidEarningsCents: 0,
          },
        });

        let uid: string;
        try {
          const existing = await admin.auth().getUserByEmail(email);
          uid = existing.uid;
          if (!existing.displayName) {
            await admin.auth().updateUser(uid, { displayName: name });
          }
        } catch (err: any) {
          if (err.code === 'auth/user-not-found') {
            const created = await admin.auth().createUser({ email, displayName: name });
            uid = created.uid;
          } else {
            throw err;
          }
        }

        await Promise.all([
          db.doc(`users/${uid}`).set(
            {
              email,
              proStatus: 'active',
              proType: 'affiliate',
              affiliateGrantedAt: admin.firestore.FieldValue.serverTimestamp(),
              name,
            },
            { merge: true }
          ),
          affiliateRef.set({ authUid: uid }, { merge: true }),
        ]);

        // Finalize lead: replace 'pending' with the real affiliateId
        const leadUpdates: Record<string, unknown> = { affiliateId };
        if (body.email && !lead.email) leadUpdates.email = email;
        await leadDoc.ref.set(leadUpdates, { merge: true });

        const continueUrl = `https://vidopick.com/vp/auth/email-action/?email=${encodeURIComponent(email)}`;
        const magicLink = await admin.auth().generateSignInWithEmailLink(email, {
          url: continueUrl,
          handleCodeInApp: true,
        });

        res.status(200).json({ magicLink });
      } catch (err) {
        // Restore the lead so Ben can retry (re-issue token) or investigate
        await leadDoc.ref
          .set({ affiliateId: null, activationUsed: false }, { merge: true })
          .catch(() => {});
        throw err;
      }
      return;
    }

    res.status(405).json({ error: 'Method not allowed.' });
  }
);
