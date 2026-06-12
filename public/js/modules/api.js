export async function fetchAPI(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      // Skip ngrok browser warning if tunneled
      'ngrok-skip-browser-warning': '1',
      ...opts.headers,
    },
  });

  if (res.status === 401) {
    window.location.href = '/login.html';
    throw new Error('Unauthorized');
  }

  return res;
}

export function track(event, payload = {}) {
  try {
    fetch('/telemetry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, ...payload }),
    });
  } catch {}
}
