import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import webpush from 'web-push';
import { log } from './utils.js';
import { TUNNEL_ENABLED, TUNNEL_URL, PORT } from './config.js';
import { track } from './telemetry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VAPID_KEYS_PATH = path.join(__dirname, '..', 'vapid-keys.json');

const pushSubscriptions = new Map(); // endpoint -> PushSubscription
let lastPermissionState = false;
let publicOrigin = '';

function initVapid() {
  let keys;
  try {
    keys = JSON.parse(fs.readFileSync(VAPID_KEYS_PATH, 'utf-8'));
  } catch {
    keys = webpush.generateVAPIDKeys();
    fs.writeFileSync(VAPID_KEYS_PATH, JSON.stringify(keys, null, 2));
    log('Push', 'Generated new VAPID keys');
  }
  const email = process.env.VAPID_EMAIL || 'mailto:ag2r@omercanyy.com';
  webpush.setVapidDetails(email, keys.publicKey, keys.privateKey);
  return keys;
}

const vapidKeys = initVapid();

export async function sendPushToAll(payload) {
  if (pushSubscriptions.size === 0) return;
  const body = JSON.stringify(payload);
  const stale = [];
  for (const [endpoint, sub] of pushSubscriptions) {
    try {
      await webpush.sendNotification(sub, body);
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        stale.push(endpoint);
      } else {
        console.debug(`[Push] Send error: ${err.statusCode || 'N/A'} — ${err.body || err.message}`);
      }
    }
  }
  stale.forEach(ep => pushSubscriptions.delete(ep));
  log('Push', `Sent to ${pushSubscriptions.size} subscriber(s), removed ${stale.length} stale`);
}

export function checkAttentionState(snapshot) {
  const hasPermission = !!snapshot.permissionHtml;
  if (hasPermission && !lastPermissionState) {
    const url = publicOrigin || (TUNNEL_ENABLED && TUNNEL_URL ? TUNNEL_URL : `https://localhost:${PORT}`);
    sendPushToAll({
      title: 'AG2R — Permission needed',
      body: 'Session is waiting for your approval',
      url,
      tag: 'ag2r-permission',
    });
    track('push_notification_sent', { reason: 'permission' });
  }
  lastPermissionState = hasPermission;
}

export function registerPushRoutes(app) {
  app.get('/push/vapid-public-key', (req, res) => {
    res.json({ publicKey: vapidKeys.publicKey });
  });

  app.post('/push/subscribe', (req, res) => {
    const subscription = req.body;
    if (!subscription?.endpoint) {
      return res.status(400).json({ error: 'Invalid subscription' });
    }
    pushSubscriptions.set(subscription.endpoint, subscription);
    const origin = req.get('origin') || req.get('referer');
    if (origin) publicOrigin = origin.replace(/\/$/, '');
    log('Push', `Subscribed (${pushSubscriptions.size} total)`);
    res.json({ ok: true });
  });

  app.post('/push/unsubscribe', (req, res) => {
    const { endpoint } = req.body;
    if (endpoint) pushSubscriptions.delete(endpoint);
    log('Push', `Unsubscribed (${pushSubscriptions.size} total)`);
    res.json({ ok: true });
  });
}
