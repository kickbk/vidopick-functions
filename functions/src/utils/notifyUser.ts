import * as admin from 'firebase-admin';
import { sendExpoPushNotifications } from './expoPush.js';

/**
 * Send a push notification and write the corresponding in-app notification doc,
 * with the iOS/Android app-icon badge set to the recipient's new unread count.
 *
 * Prefer this over calling sendExpoPushNotifications + db.add() directly.
 */
export async function notifyUser(
  db: admin.firestore.Firestore,
  uid: string,
  tokens: string[],
  title: string,
  body: string,
  notifFields: { type: string } & Record<string, unknown>,
  pushData?: Record<string, string>
): Promise<void> {
  const unreadSnap = await db
    .collection(`users/${uid}/notifications`)
    .where('viewedAt', '==', null)
    .select()
    .get();
  const badge = unreadSnap.size + 1;

  await Promise.all([
    sendExpoPushNotifications(tokens, { title, body }, pushData, badge),
    db.collection(`users/${uid}/notifications`).add({
      title,
      body,
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      viewedAt: null,
      ...notifFields,
    }),
  ]);
}
