import { request } from './api.ts';
import { getLang } from './i18n.ts';

/** Where this device stands with Reminders, from "cannot have them" to "on". */
export type PushState = 'insecure' | 'needsInstall' | 'unsupported' | 'blocked' | 'off' | 'on';

/** The user said no to the browser's permission prompt. */
export class PushRefused extends Error {}

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const installed = () => matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration();
  return registration ? registration.pushManager.getSubscription() : null;
}

export async function pushState(): Promise<PushState> {
  if (!window.isSecureContext) return 'insecure';
  // iPhones only offer notifications to apps added to the Home Screen.
  if (!supported()) return isIos() && !installed() ? 'needsInstall' : 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  return (await currentSubscription()) ? 'on' : 'off';
}

/** The server's key, in the form the browser wants it. */
async function serverKey(): Promise<Uint8Array<ArrayBuffer>> {
  const { publicKey } = await request<{ publicKey: string }>('GET', '/api/push');
  const base64 = (publicKey + '='.repeat((4 - (publicKey.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
}

function save(subscription: PushSubscription): Promise<void> {
  return request('PUT', '/api/push/subscription', { ...subscription.toJSON(), lang: getLang() });
}

async function subscribe(key: Uint8Array<ArrayBuffer>): Promise<void> {
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await save(subscription);
}

export async function turnOn(): Promise<void> {
  if ((await Notification.requestPermission()) !== 'granted') throw new PushRefused();
  await subscribe(await serverKey());
}

export async function turnOff(): Promise<void> {
  const subscription = await currentSubscription();
  if (!subscription) return;
  await request('POST', '/api/push/unsubscribe', { endpoint: subscription.endpoint });
  await subscription.unsubscribe();
}

export async function sendTest(): Promise<void> {
  const subscription = await currentSubscription();
  if (subscription) await request('POST', '/api/push/test', { endpoint: subscription.endpoint });
}

function sameKey(a: ArrayBuffer | null, b: Uint8Array): boolean {
  const bytes = a ? new Uint8Array(a) : new Uint8Array();
  return bytes.length === b.length && bytes.every((v, i) => v === b[i]);
}

/**
 * Tells the server again about this device, in the current language. Keeps it in step if the server lost the
 * subscription, and subscribes again if the server's key changed (the old subscription would never deliver).
 */
export async function refreshPushSubscription(): Promise<void> {
  try {
    if (!window.isSecureContext || !supported() || Notification.permission !== 'granted') return;
    const subscription = await currentSubscription();
    if (!subscription) return;
    const key = await serverKey();
    if (sameKey(subscription.options.applicationServerKey, key)) return await save(subscription);
    await subscription.unsubscribe();
    await subscribe(key);
  } catch {
    // Offline or server unreachable: try again next time the app opens.
  }
}
