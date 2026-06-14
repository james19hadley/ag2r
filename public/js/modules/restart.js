import { fetchAPI, track } from './api.js';
import {
  restartConfirm,
  restartCancel,
  restartGo,
  refreshBtn
} from './dom.js';

export function showRestartConfirm() {
  restartGo.disabled = false;
  restartGo.textContent = 'Restart';
  restartConfirm.classList.remove('hidden');
}

export function initRestartHandlers() {
  // Refresh button — hard reload
  refreshBtn?.addEventListener('click', () => {
    track('hard_refresh');
    window.location.reload();
  });

  // Cancel restart
  restartCancel?.addEventListener('click', () => {
    restartConfirm.classList.add('hidden');
  });

  // Dismiss on backdrop tap
  const backdrop = restartConfirm?.querySelector('.restart-confirm-backdrop');
  backdrop?.addEventListener('click', () => {
    restartConfirm.classList.add('hidden');
  });

  // Go restart
  restartGo?.addEventListener('click', async () => {
    restartGo.disabled = true;
    restartGo.textContent = 'Restarting...';
    try {
      const res = await fetchAPI('/restart-antigravity', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        // Success — AG will die, CDP disconnects, auto-reconnect kicks in
        // Dismiss modal after a moment so the user sees the state change
        setTimeout(() => {
          restartConfirm.classList.add('hidden');
        }, 2000);
      } else {
        restartGo.textContent = 'Failed — try again';
        restartGo.disabled = false;
      }
    } catch {
      restartGo.textContent = 'Failed — try again';
      restartGo.disabled = false;
    }
  });
}
