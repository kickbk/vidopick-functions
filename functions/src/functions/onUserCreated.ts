import * as admin from 'firebase-admin';
import { auth } from 'firebase-functions/v1';
import { getAffiliateDisplayFields } from '../utils/affiliateDisplay';

if (!admin.apps.length) admin.initializeApp();

export const onUserCreated = auth.user().onCreate(async (user) => {
  const db = admin.firestore();

  await db.doc(`users/${user.uid}`).set(
    {
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      ...(user.email ? { email: user.email.toLowerCase() } : {}),
      ...(user.displayName ? { displayName: user.displayName } : {}),
      allowSandbox: true,
    },
    { merge: true }
  );

  // Auto-grant Pro if this email belongs to a registered affiliate.
  // Require emailVerified to prevent account takeover: an attacker knowing an affiliate's
  // public email could create an unverified account and claim their Pro + authUid.
  // Magic-link and OAuth sign-ins set emailVerified=true immediately, so real affiliates
  // are unaffected. Email+password users must verify first, then call claimAffiliatePro.
  if (user.email && user.emailVerified) {
    const affiliateSnap = await db
      .collection('affiliates')
      .where('email', '==', user.email.toLowerCase())
      .where('type', '==', 'influencer')
      .limit(1)
      .get()
      .catch(() => null);

    if (affiliateSnap && !affiliateSnap.empty) {
      const affiliateDoc = affiliateSnap.docs[0];
      const affiliateRef = affiliateDoc.ref;
      const affiliateName: string =
        (await getAffiliateDisplayFields(db, affiliateDoc.id)).name ??
        'My Profile';

      await Promise.all([
        db.doc(`users/${user.uid}`).set(
          {
            proStatus: 'active',
            proType: 'affiliate',
            affiliateGrantedAt: admin.firestore.FieldValue.serverTimestamp(),
            name: affiliateName,
          },
          { merge: true }
        ),
        affiliateRef.set({ authUid: user.uid }, { merge: true }),
      ]);

      console.log(
        `[onUserCreated] affiliate Pro granted uid=${user.uid} affiliateId=${affiliateDoc.id}`
      );
    }
  }
});
