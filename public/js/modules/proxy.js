import { state } from './state.js';
import { fetchAPI } from './api.js';
import {
  dropdownOverlay,
  rightSidebarContent
} from './dom.js';
import { closeLeftSidebar, openRightSidebar, fetchRightSidebar } from './sidebar.js';
import { loadSnapshot } from './snapshot.js';

function showTextInput(label, placeholder, isTextarea, currentValue, clickId) {
  const textInputModal = document.getElementById('text-input-modal');
  const textInputLabel = document.getElementById('text-input-label');
  const textInputField = document.getElementById('text-input-field');
  const textInputArea = document.getElementById('text-input-area');

  textInputLabel.textContent = label;
  state.pendingTextInputPlaceholder = placeholder;
  state.pendingTextInputClickId = clickId || null;

  if (isTextarea) {
    textInputField.classList.add('hidden');
    textInputArea.classList.remove('hidden');
    textInputArea.value = currentValue || '';
    textInputArea.placeholder = placeholder;
  } else {
    textInputArea.classList.add('hidden');
    textInputField.classList.remove('hidden');
    textInputField.value = currentValue || '';
    textInputField.placeholder = placeholder;
  }

  textInputModal.classList.remove('hidden');
  requestAnimationFrame(() => {
    (isTextarea ? textInputArea : textInputField).focus();
  });
}

function extractMessageText(buttonEl) {
  const messageBlock = buttonEl.closest('[class*="group/message"]') || 
                       buttonEl.closest('.group') || 
                       buttonEl.closest('[data-testid*="message"]') ||
                       buttonEl.parentElement?.parentElement;
  
  if (!messageBlock) return '';
  
  const prose = messageBlock.querySelector('.prose, [class*="prose"], [class*="message-content"]');
  if (prose) {
    const clone = prose.cloneNode(true);
    clone.querySelectorAll('button, .mobile-copy-btn, style').forEach(b => b.remove());
    return clone.innerText.trim();
  }
  
  const actionsContainer = buttonEl.parentElement;
  if (actionsContainer && actionsContainer.previousElementSibling) {
    const clone = actionsContainer.previousElementSibling.cloneNode(true);
    clone.querySelectorAll('button, .mobile-copy-btn, style').forEach(b => b.remove());
    return clone.innerText.trim();
  }
  
  const clone = messageBlock.cloneNode(true);
  clone.querySelectorAll('button, [role="button"], [class*="mobile-copy-btn"], style').forEach(b => b.remove());
  return clone.innerText.trim();
}

export function addClickProxyHandlers(container) {
  container.querySelectorAll('[data-ag-click-id]').forEach(el => {
    if (el.dataset.agClickWired) return;
    el.dataset.agClickWired = '1';

    // Ensure non-interactive elements (DIVs) are tappable on iOS Safari.
    const tag = el.tagName;
    if (tag !== 'BUTTON' && tag !== 'A' && tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'TEXTAREA') {
      el.style.cursor = 'pointer';
    }

    el.addEventListener('mousedown', e => e.preventDefault());

    el.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const clickId = el.dataset.agClickId;
      const label = el.dataset.agClickLabel || '';

      console.debug('[Click] id=' + clickId, 'label="' + label + '"');

      // Intercept "Edit task title" pencil icon — single-click name editing
      if (clickId.startsWith('sched:') && el.getAttribute('aria-label') === 'Edit task title') {
        const nameContainer = el.closest('[class*="flex"]');
        const currentName = nameContainer?.querySelector('.truncate')?.textContent?.trim() || '';

        fetchAPI('/click', {
          method: 'POST',
          body: JSON.stringify({ clickId, label }),
        });

        const tryAutoOpen = () => {
          const nameInput = document.querySelector(
            '#scheduled-tasks-content input:not([placeholder*="earch"]):not([type="hidden"]):not([role="switch"])'
          );
          if (nameInput && nameInput.dataset.agClickId) {
            showTextInput('Task name', '', false, nameInput.getAttribute('data-ag-value') || currentName, nameInput.dataset.agClickId);
            return true;
          }
          return false;
        };
        setTimeout(() => { if (!tryAutoOpen()) setTimeout(tryAutoOpen, 600); }, 600);
        return;
      }

      if (clickId.startsWith('scheddlg:') || clickId.startsWith('sched:')) {
        const origTag = el.tagName;
        const origPlaceholder = el.getAttribute('placeholder') || '';
        if (origTag === 'INPUT' || origTag === 'TEXTAREA') {
          const currentValue = el.getAttribute('data-ag-value') || '';
          showTextInput(
            origPlaceholder || (origTag === 'TEXTAREA' ? 'Enter text' : 'Enter value'),
            origPlaceholder,
            origTag === 'TEXTAREA',
            currentValue,
            clickId
          );
          return;
        }
      }

      if (clickId.startsWith('chat:')) {
        const text = (el.textContent || '').trim();
        const ariaLabel = el.getAttribute('aria-label') || '';
        const searchStr = `${label} ${text} ${ariaLabel}`.toLowerCase();
        if (searchStr.includes('undo') || searchStr.includes('revert') || searchStr.includes('up to this point')) {
          try {
            const extractedText = extractMessageText(el);
            if (extractedText) {
              const messageInput = document.getElementById('message-input');
              if (messageInput) {
                messageInput.value = extractedText;
                messageInput.style.height = 'auto';
                messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
                messageInput.focus();
                messageInput.dispatchEvent(new Event('input', { bubbles: true }));
              }
            }
          } catch (err) {
            console.debug('[UndoClient] Local extraction failed:', err.message);
          }
        }
      }

      if (el.getAttribute('aria-label') === 'Copy') {
        try {
          const res = await fetchAPI('/copy-response', {
            method: 'POST',
            body: JSON.stringify({ clickId }),
          });
          const result = await res.json();
          if (result.ok && result.text) {
            await navigator.clipboard.writeText(result.text);
            const origHTML = el.innerHTML;
            el.innerHTML = '<span style="font-size:12px;color:#4ade80">✓</span>';
            setTimeout(() => { el.innerHTML = origHTML; }, 1500);
          }
        } catch (err) {
          console.debug('[Copy] Error:', err.message);
        }
        return;
      }
      el.classList.add('ag-clicking');
      let result = null;
      try {
        const res = await fetchAPI('/click', {
          method: 'POST',
          body: JSON.stringify({ clickId, label }),
        });
        result = await res.json();
      } catch (err) {
        console.debug('[Click] Error:', err.message);
      }
      el.classList.remove('ag-clicking');

      if (result?.editorText !== undefined) {
        const messageInput = document.getElementById('message-input');
        if (messageInput) {
          messageInput.value = result.editorText;
          messageInput.style.height = 'auto';
          messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
          messageInput.focus();
          messageInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }

      if (clickId.startsWith('left:')) {
        const elClass = (el.className || '').toString();
        const isConversationRow = elClass.includes('min-h-[32px]');
        const isScheduledTasks = label === 'Scheduled Tasks';
        if (isConversationRow || isScheduledTasks) closeLeftSidebar();
      }

      if (clickId.startsWith('dropdown:') || clickId.startsWith('dialog:')) {
        state.overlayDismissedAt = Date.now();
        dropdownOverlay.classList.add('hidden');
      }

      if (/^Review$/i.test(label.trim())) {
        openRightSidebar();
      }

      if (result?.navigatedToFile) {
        openRightSidebar();
      }

      if (clickId.startsWith('chat:') && !result?.navigatedToFile) {
        const elClass = (el.className || '').toString();
        const isExpandable = /\d+\s+files?\s+changed/i.test(label);
        if (el.tagName === 'DIV' && elClass.includes('cursor-pointer') && !isExpandable) {
          openRightSidebar();
        }
      }

      if (clickId.startsWith('right:')) {
        setTimeout(fetchRightSidebar, 300);
        setTimeout(fetchRightSidebar, 800);
      }

      setTimeout(loadSnapshot, 300);
      setTimeout(loadSnapshot, 800);
      setTimeout(loadSnapshot, 2000);
    });
  });
}
