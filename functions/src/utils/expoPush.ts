/**
 * Send push notifications to one or more Expo push tokens.
 *
 * registerToken.ts stores Expo push tokens (ExponentPushToken[...]),
 * NOT raw FCM tokens. These must go through Expo's push API, not
 * Firebase Admin's admin.messaging().sendEach().
 *
 * Non-fatal: logs warnings on failure but never throws.
 */

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  badge?: number;
}

export async function sendExpoPushNotifications(
  tokens: string[],
  notification: { title: string; body: string },
  data?: Record<string, string>,
  badge?: number
): Promise<void> {
  if (tokens.length === 0) return;

  const messages: ExpoPushMessage[] = tokens.map((token) => ({
    to: token,
    title: notification.title,
    body: notification.body,
    ...(data ? { data } : {}),
    ...(badge !== undefined ? { badge } : {}),
  }));

  try {
    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(messages),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.warn(`[expoPush] HTTP ${response.status}: ${text}`);
      return;
    }

    const result = (await response.json()) as { data: { status: string; message?: string }[] };
    const failures = result.data?.filter((r) => r.status !== 'ok') ?? [];
    if (failures.length > 0) {
      console.warn('[expoPush] some tokens failed:', JSON.stringify(failures));
    }
  } catch (e) {
    console.warn('[expoPush] request failed:', e);
  }
}
