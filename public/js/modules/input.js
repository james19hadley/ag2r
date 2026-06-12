import { state } from './state.js';
import { fetchAPI } from './api.js';
import { messageInput, actionBtn, actionIcon } from './dom.js';
import { uploadStagedImages, clearStagedImages } from './attach.js';
import { drainQueuedComments } from './comment.js';
import { loadSnapshot } from './snapshot.js';

export async function sendMessage() {
  const text = messageInput.value.trim();
  const hasImages = state.stagedImages.length > 0;
  if ((!text && !hasImages) || state.isSending) return;

  state.isSending = true;

  if (state.stopMainMic) state.stopMainMic();

  messageInput.value = '';
  messageInput.style.height = 'auto';
  messageInput.disabled = true;
  actionBtn.disabled = true;
  messageInput.blur();
  updateActionButton();

  if (hasImages) {
    const uploadOk = await uploadStagedImages();
    if (!uploadOk) {
      console.debug('[Send] Some image uploads failed');
      state.isSending = false;
      messageInput.disabled = false;
      actionBtn.disabled = false;
      return;
    }
    clearStagedImages();
    await new Promise(r => setTimeout(r, 300));
  }

  if (text || !hasImages) {
    const commentBlock = drainQueuedComments();
    const fullMessage = commentBlock ? commentBlock + '\n' + text : text;

    try {
      const res = await fetchAPI('/send', {
        method: 'POST',
        body: JSON.stringify({ message: fullMessage }),
      });

      const result = await res.json();
      console.debug('[Send] Result:', result);
    } catch (e) {
      console.debug('[Send] Error:', e.message);
    }
  }

  state.userScrolledAway = false;

  setTimeout(loadSnapshot, 300);
  setTimeout(loadSnapshot, 800);
  setTimeout(loadSnapshot, 2000);

  state.isSending = false;
  messageInput.disabled = false;
  actionBtn.disabled = false;
}

export async function stopGeneration() {
  try {
    const res = await fetchAPI('/stop', { method: 'POST' });
    const result = await res.json();

    if (!result.ok) {
      console.debug('[Stop] No active generation found');
    }

    setTimeout(loadSnapshot, 300);
    setTimeout(loadSnapshot, 1000);
  } catch (e) {
    console.debug('[Stop] Error:', e.message);
  }
}

export function updateActionButton() {
  if (!actionBtn || !actionIcon) return;
  const hasText = messageInput.value.trim().length > 0;
  const hasImages = state.stagedImages.length > 0;

  if (state.agentRunning && !hasText && !hasImages) {
    actionBtn.setAttribute('data-action', 'stop');
    actionBtn.setAttribute('aria-label', 'Stop generation');
    actionIcon.textContent = 'stop';
    actionBtn.classList.remove('disabled');
  } else {
    actionBtn.setAttribute('data-action', 'send');
    actionBtn.setAttribute('aria-label', 'Send message');
    actionIcon.textContent = 'arrow_upward';

    if (hasText || hasImages) {
      actionBtn.classList.remove('disabled');
    } else {
      actionBtn.classList.add('disabled');
    }
  }
}

export function updateModelChip(modelName) {
  const chipText = document.querySelector('#model-chip .model-chip-text');
  if (chipText && modelName) {
    chipText.textContent = modelName;
  }
}

export function initInput() {
  if (!messageInput || !actionBtn) return;
  
  const modelChip = document.getElementById('model-chip');
  if (modelChip) {
    modelChip.addEventListener('click', async () => {
      const clickId = modelChip.getAttribute('data-ag-click-id') || 'model:0';
      const label = modelChip.getAttribute('data-ag-click-label') || '';
      try {
        await fetchAPI('/click', {
          method: 'POST',
          body: JSON.stringify({ clickId, label }),
        });
      } catch (err) {
        console.debug('[ModelClick] Error:', err.message);
      }
      setTimeout(loadSnapshot, 300);
      setTimeout(loadSnapshot, 800);
    });
  }

  actionBtn.addEventListener('click', () => {
    const action = actionBtn.getAttribute('data-action');
    if (action === 'stop') {
      stopGeneration();
    } else if (action === 'send') {
      sendMessage();
    }
  });

  document.querySelectorAll('.quick-action-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const msg = chip.dataset.message;
      if (msg) {
        messageInput.value = msg;
        sendMessage();
      }
    });
  });

  messageInput.addEventListener('input', () => {
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
    updateActionButton();
  });

  let lastEnterSend = 0;
  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !state.isMobile) {
      e.preventDefault();
      const now = Date.now();
      if (now - lastEnterSend < 500) return;
      lastEnterSend = now;
      if (messageInput.value.trim()) {
        sendMessage();
      }
    }
  });
}
