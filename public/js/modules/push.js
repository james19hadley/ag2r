import { fetchAPI } from './api.js';

function pushDebug(msg) {
  console.debug('[Push]', msg);
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function sendSubscriptionToServer(subscription) {
  await fetchAPI('/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(subscription),
  });
}

async function subscribePush(registration) {
  try {
    const res = await fetchAPI('/push/vapid-public-key');
    const { publicKey } = await res.json();
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
    await sendSubscriptionToServer(subscription);
  } catch (e) {
    pushDebug('Sub error: ' + e.message);
  }
}

export async function initPushNotifications() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    pushDebug('Not supported');
    return;
  }

  try {
    pushDebug('Registering SW...');
    const registration = await navigator.serviceWorker.register('/sw.js');
    pushDebug('SW ok');

    const existing = await registration.pushManager.getSubscription();
    if (existing) {
      pushDebug('Already subscribed, re-sending');
      await sendSubscriptionToServer(existing);
      pushDebug('Done ✓');
      return;
    }

    pushDebug('perm=' + Notification.permission);
    if (Notification.permission === 'denied') {
      pushDebug('Denied, skip');
      return;
    }

    if (Notification.permission === 'granted') {
      pushDebug('Granted, subscribing...');
      await subscribePush(registration);
      pushDebug('Done ✓');
      return;
    }

    // Default permission state (prompt) — auto-prompt on user gesture (first interaction)
    // to avoid unsolicited permission requests
    pushDebug('Waiting gesture...');
    const onGesture = async () => {
      window.removeEventListener('click', onGesture);
      window.removeEventListener('touchstart', onGesture);
      pushDebug('Gesture! Requesting...');
      const result = await Notification.requestPermission();
      pushDebug('Result=' + result);
      if (result === 'granted') {
        await subscribePush(registration);
        pushDebug('Done ✓');
      }
    };
    window.addEventListener('click', onGesture);
    window.addEventListener('touchstart', onGesture);
  } catch (e) {
    pushDebug('Error: ' + e.message);
  }
}
