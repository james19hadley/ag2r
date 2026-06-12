import { fetchAPI } from './api.js';
import { agPowerBtn } from './dom.js';

let isPowerActive = false;
let isPendingRequest = false;

export async function checkPowerStatus() {
  if (!agPowerBtn || isPendingRequest) return;
  try {
    const res = await fetchAPI('/api/antigravity/status');
    if (!res.ok) return;
    const data = await res.json();
    isPowerActive = !!data.running;

    agPowerBtn.classList.remove('loading');
    if (isPowerActive) {
      agPowerBtn.classList.add('active');
      agPowerBtn.classList.remove('inactive');
      agPowerBtn.title = 'Put Antigravity to Sleep';
    } else {
      agPowerBtn.classList.add('inactive');
      agPowerBtn.classList.remove('active');
      agPowerBtn.title = 'Wake up Antigravity';
    }
  } catch (err) {
    console.debug('[Power] Status check error:', err.message);
  }
}

export function initPowerControl() {
  if (!agPowerBtn) return;

  // Initial check
  checkPowerStatus();

  // Poll status every 5 seconds
  setInterval(checkPowerStatus, 5000);

  agPowerBtn.addEventListener('click', async () => {
    if (isPendingRequest) return;

    const action = isPowerActive ? 'sleep' : 'wakeup';
    console.debug(`[Power] Triggering action: ${action}`);

    isPendingRequest = true;
    agPowerBtn.classList.add('loading');
    agPowerBtn.classList.remove('active', 'inactive');

    try {
      const res = await fetchAPI(`/api/antigravity/${action}`, { method: 'POST' });
      const data = await res.json();
      if (!data.ok) {
        console.error('[Power] Action failed:', data.error || 'unknown');
      }
    } catch (err) {
      console.error('[Power] Request error:', err.message);
    } finally {
      isPendingRequest = false;
      // Immediately refresh status
      await checkPowerStatus();
    }
  });
}
