import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import webpush from 'web-push';

export interface StoredSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushMessage {
  title: string;
  body: string;
  /** The app page opened when the notification is tapped. */
  url: string;
}

/** Delivers notifications through the browser vendors' push services (Apple, Google, Mozilla). */
export interface PushSender {
  publicKey: string;
  /** 'gone' means the device unsubscribed or the app was removed: forget the subscription. */
  send(subscription: StoredSubscription, message: PushMessage): Promise<'sent' | 'gone'>;
}

/** Notifications older than this are dropped if the phone stays offline. */
const TIME_TO_LIVE_SECONDS = 3 * 24 * 3600;

/**
 * The server's push identity (VAPID keys) is generated on first start and kept in the data folder:
 * it is a secret, and changing it would silently cut off every subscribed device.
 */
export function webPushSender(keysFile: string, contact: string): PushSender {
  let keys: { publicKey: string; privateKey: string };
  if (existsSync(keysFile)) {
    keys = JSON.parse(readFileSync(keysFile, 'utf8'));
  } else {
    keys = webpush.generateVAPIDKeys();
    writeFileSync(keysFile, JSON.stringify(keys), { mode: 0o600 });
  }
  const vapidDetails = { subject: contact, publicKey: keys.publicKey, privateKey: keys.privateKey };
  return {
    publicKey: keys.publicKey,
    async send(subscription, message) {
      try {
        await webpush.sendNotification(
          { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
          JSON.stringify(message),
          { vapidDetails, TTL: TIME_TO_LIVE_SECONDS },
        );
        return 'sent';
      } catch (error) {
        if (error instanceof webpush.WebPushError && (error.statusCode === 404 || error.statusCode === 410)) return 'gone';
        throw error;
      }
    },
  };
}
