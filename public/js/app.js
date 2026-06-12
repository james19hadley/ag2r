import { connectWebSocket } from './modules/ws.js';
import { loadSnapshot } from './modules/snapshot.js';
import { initScroll } from './modules/scroll.js';
import { initSidebar } from './modules/sidebar.js';
import { initInput, updateActionButton } from './modules/input.js';
import { initAttach } from './modules/attach.js';
import { initComment } from './modules/comment.js';
import { initAuth } from './modules/auth.js';
import { initMisc } from './modules/misc.js';
import { initPowerControl } from './modules/power.js';
import { state } from './modules/state.js';
import { fetchAPI, track } from './modules/api.js';
import {
  dropdownBackdrop,
  dropdownOverlay,
  permissionBackdrop,
  permissionOverlay,
  permissionContent,
  settingsBack,
  settingsOverlay,
  scheduledTasksBack,
  scheduledTasksOverlay,
  scheduledTasksContent,
  textInputCancel,
  textInputBackdrop,
  textInputSubmit,
  textInputField,
  textInputModal,
  textInputArea
} from './modules/dom.js';

// Global error tracking
window.addEventListener('error', (e) => {
  track('client_error', { message: (e.message || '').substring(0, 200) });
});
window.addEventListener('unhandledrejection', (e) => {
  const msg = e.reason?.message || String(e.reason || '');
  track('client_error', { message: msg.substring(0, 200) });
});

// Setup backdrop and overlay controls
dropdownBackdrop?.addEventListener('click', () => {
  state.overlayDismissedAt = Date.now();
  dropdownOverlay.classList.add('hidden');
  fetchAPI('/dismiss-portal', { method: 'POST' }).catch(() => {});
});

permissionBackdrop?.addEventListener('click', () => {
  const skipBtn = permissionContent?.querySelector('.perm-skip');
  if (skipBtn) {
    skipBtn.click();
  } else {
    permissionOverlay.classList.add('hidden');
  }
});

settingsBack?.addEventListener('click', () => {
  settingsOverlay.classList.add('hidden');
  fetchAPI('/dismiss-settings', { method: 'POST' }).catch(() => {});
});

scheduledTasksBack?.addEventListener('click', async () => {
  try {
    const resp = await fetchAPI('/dismiss-scheduled-tasks', { method: 'POST' });
    const data = await resp.json();
    if (data.method === 'detail-back') {
      // Went from detail view back to list — keep overlay open, clear cached HTML to force re-render
      scheduledTasksContent._lastHtml = '';
      return;
    }
  } catch (e) {
    // Fall through to dismiss
  }
  scheduledTasksOverlay.classList.add('hidden');
  scheduledTasksContent._lastHtml = '';
});

// Text input modal submit
function closeTextInput() {
  textInputModal.classList.add('hidden');
  textInputField.value = '';
  textInputArea.value = '';
  state.pendingTextInputPlaceholder = null;
  state.pendingTextInputClickId = null;
}

async function submitTextInput() {
  const isTextarea = !textInputArea.classList.contains('hidden');
  const text = isTextarea ? textInputArea.value : textInputField.value;
  const placeholder = state.pendingTextInputPlaceholder;
  const clickId = state.pendingTextInputClickId;

  closeTextInput();

  if (!placeholder && !clickId) return;

  try {
    const res = await fetchAPI('/type-text', {
      method: 'POST',
      body: JSON.stringify({ placeholder, text, clickId }),
    });
    const result = await res.json();
    console.debug('[TypeText] Result:', result);
    setTimeout(loadSnapshot, 300);
    setTimeout(loadSnapshot, 800);
  } catch (err) {
    console.debug('[TypeText] Error:', err.message);
  }
}

textInputCancel?.addEventListener('click', closeTextInput);
textInputBackdrop?.addEventListener('click', closeTextInput);
textInputSubmit?.addEventListener('click', submitTextInput);

textInputField?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    submitTextInput();
  }
});

// Initialize everything
connectWebSocket();
loadSnapshot();
initScroll();
initSidebar();
initInput();
initAttach();
initComment();
initAuth();
initMisc();
initPowerControl();
updateActionButton();
