import { state } from './state.js';
import { fetchAPI } from './api.js';
import { addClickProxyHandlers } from './proxy.js';
import { openRightSidebar } from './sidebar.js';
import { loadSnapshot } from './snapshot.js';
import {
  dropdownContent,
  dropdownOverlay,
  runningTasksCount,
  runningTasksList,
  runningTasks,
  settingsContent,
  settingsOverlay,
  scheduledTasksContent,
  scheduledTasksOverlay,
  scheduledTasksDialog
} from './dom.js';

export function renderNewSessionPageInline(chatContent, data) {
  const newSessionInput = document.getElementById('ag2r-new-session-input');
  if (!newSessionInput) return;

  const tmpDiv = document.createElement('div');
  tmpDiv.innerHTML = data.html;
  const projectBtn = tmpDiv.querySelector('[aria-haspopup="dialog"] .truncate');
  const freshProject = projectBtn ? projectBtn.textContent.trim() : '';
  const projectEl = chatContent.querySelector('.ag2r-new-session-project span:not(.material-symbols-rounded)');
  if (projectEl && freshProject) projectEl.textContent = freshProject;

  const freshModel = data.modelName || '';
  const nsModelChipText = chatContent.querySelector('.ag2r-ns-model-chip .model-chip-text');
  if (nsModelChipText && freshModel) nsModelChipText.textContent = freshModel;

  const envBar = chatContent.querySelector('.ag2r-new-session-env-bar');
  if (envBar && (data.environmentName || data.branchName)) {
    const environmentName = data.environmentName || '';
    const branchName = data.branchName || '';
    const envIcon = environmentName === 'Local'
      ? '<span class="material-symbols-rounded" style="font-size:14px">desktop_windows</span>'
      : '<span class="material-symbols-rounded" style="font-size:14px">account_tree</span>';
    let newEnvHtml = '';
    if (environmentName) {
      newEnvHtml = `
        <button type="button" class="ag2r-env-chip" data-ag-click-id="env:0" data-ag-click-label="${environmentName}">
          ${envIcon}
          <span>${environmentName}</span>
          <span class="material-symbols-rounded" style="font-size:12px">expand_more</span>
        </button>
        ${branchName ? `
        <button type="button" class="ag2r-env-chip" data-ag-click-id="env:1" data-ag-click-label="${branchName}">
          <span class="material-symbols-rounded" style="font-size:14px">fork_right</span>
          <span>${branchName}</span>
          <span class="material-symbols-rounded" style="font-size:12px">expand_more</span>
        </button>` : ''}
      `;
    }
    envBar.innerHTML = newEnvHtml;
    addClickProxyHandlers(envBar);
  }
}

export function renderDropdownDialog(data) {
  const suppressOverlay = Date.now() - state.overlayDismissedAt < 2000;
  if (data.dropdownHtml && !suppressOverlay) {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = data.dropdownHtml;
    const allBtns = tempDiv.querySelectorAll('[data-ag-click-id]');
    if (allBtns.length > 0) {
      const HIDDEN_DROPDOWN_OPTIONS = /^rename$/i;
      let buttonsHtml = '';
      allBtns.forEach(btn => {
        const text = btn.textContent.trim();
        if (HIDDEN_DROPDOWN_OPTIONS.test(text)) return;
        const id = btn.dataset.agClickId;
        const label = btn.dataset.agClickLabel || text;
        const isDestructive = /delete|remove/i.test(text);
        const cls = isDestructive ? 'destructive' : '';
        buttonsHtml += `<button class="${cls}" data-ag-click-id="${id}" data-ag-click-label="${label}">${text}</button>`;
      });
      dropdownContent.innerHTML = buttonsHtml;
      addClickProxyHandlers(dropdownContent);
      dropdownOverlay.classList.remove('hidden');
    }
  } else if (!data.dropdownHtml) {
    dropdownOverlay.classList.add('hidden');
  }

  if (data.dialogHtml && !suppressOverlay) {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = data.dialogHtml;
    const dialogBtns = tempDiv.querySelectorAll('[data-ag-click-id]');
    if (dialogBtns.length > 0) {
      let buttonsHtml = '';
      dialogBtns.forEach(btn => {
        const text = btn.textContent.trim();
        if (!text) return;
        const id = btn.dataset.agClickId;
        const label = btn.dataset.agClickLabel || text;
        const isDestructive = text.toLowerCase().includes('delete');
        const isCancel = text.toLowerCase().includes('cancel');
        const cls = isDestructive ? 'destructive' : (isCancel ? 'cancel' : '');
        buttonsHtml += `<button class="${cls}" data-ag-click-id="${id}" data-ag-click-label="${label}">${text}</button>`;
      });

      const root = tempDiv.firstElementChild;
      const isPopover = root && root.getAttribute('role') === 'dialog';

      if (isPopover) {
        let popoverHtml = '';
        const walker = root.querySelector('[class*="overflow-y-auto"]') || root;
        for (const child of walker.children) {
          if (child.classList.contains('border-t') || child.tagName === 'HR') {
            popoverHtml += '<div class="dropdown-separator"></div>';
            continue;
          }
          const isHeader = child.classList.contains('text-muted-foreground') &&
            child.classList.contains('text-xs') && !child.querySelector('button');
          if (isHeader) {
            popoverHtml += `<div class="dropdown-header">${child.textContent.trim()}</div>`;
            continue;
          }
          const taggedEls = child.querySelectorAll('[data-ag-click-id]');
          const selfTagged = child.dataset?.agClickId ? [child] : [];
          const allTagged = taggedEls.length > 0 ? taggedEls : selfTagged;
          allTagged.forEach(tagged => {
            const text = tagged.textContent.trim();
            const id = tagged.dataset.agClickId;
            const label = tagged.dataset.agClickLabel || text;
            const isDestructive = /delete|remove/i.test(text);
            popoverHtml += `<button class="${isDestructive ? 'destructive' : ''}" data-ag-click-id="${id}" data-ag-click-label="${label}">${text}</button>`;
          });
        }
        dropdownContent.innerHTML = popoverHtml || buttonsHtml;
      } else {
        const cloneForText = tempDiv.cloneNode(true);
        cloneForText.querySelectorAll('[data-ag-click-id]').forEach(el => el.remove());
        const msgText = cloneForText.textContent.trim();
        const lines = msgText.split(/\n/).map(l => l.trim()).filter(Boolean);
        const title = lines[0] || 'Confirm';
        const message = lines.slice(1).join(' ') || '';

        dropdownContent.innerHTML = `
          <div class="dialog-title">${title}</div>
          ${message ? `<div class="dialog-message">${message}</div>` : ''}
          <div class="dialog-buttons">${buttonsHtml}</div>
        `;
      }
      addClickProxyHandlers(dropdownContent);
      dropdownOverlay.classList.remove('hidden');
    }
  }
}

export function renderRunningTasks(data) {
  if (data.runningTasksHtml) {
    if (data.runningTasksHtml !== runningTasks.dataset.lastHtml) {
      runningTasks.dataset.lastHtml = data.runningTasksHtml;
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = data.runningTasksHtml;

      const headerBtn = tempDiv.querySelector('button');
      const headerSpan = headerBtn?.querySelector('span');
      runningTasksCount.textContent = headerSpan ? headerSpan.textContent.trim() : 'Tasks running';

      const allButtons = tempDiv.querySelectorAll('[data-ag-click-id]');
      let rowsHtml = '';
      const buttonArray = Array.from(allButtons);

      for (let i = 1; i < buttonArray.length; i += 2) {
        const nameBtn = buttonArray[i];
        const stopBtn = buttonArray[i + 1];
        const nameClickId = nameBtn?.dataset?.agClickId || '';
        const nameLabel = nameBtn?.dataset?.agClickLabel || '';
        const stopClickId = stopBtn?.dataset?.agClickId || '';
        const stopLabel = stopBtn?.dataset?.agClickLabel || '';

        const monoSpan = nameBtn?.querySelector('.font-mono');
        const taskName = monoSpan ? monoSpan.textContent.trim() : (nameLabel || 'Task');

        rowsHtml += `
          <div class="running-task-row">
            <button class="running-task-name" data-ag-click-id="${nameClickId}" data-ag-click-label="${nameLabel}">
              <div class="running-task-spinner"></div>
              <span>${taskName}</span>
            </button>
            <button class="running-task-stop" data-ag-click-id="${stopClickId}" data-ag-click-label="${stopLabel}" aria-label="Stop task">
              <span class="material-symbols-rounded" style="font-size:18px">stop_circle</span>
            </button>
          </div>
        `;
      }

      runningTasksList.innerHTML = rowsHtml;

      runningTasksList.querySelectorAll('[data-ag-click-id]').forEach(btn => {
        const clickId = btn.dataset.agClickId;
        const clickLabel = btn.dataset.agClickLabel;
        const isNameBtn = btn.classList.contains('running-task-name');
        btn.removeAttribute('data-ag-click-id');
        btn.addEventListener('click', async () => {
          btn.style.opacity = '0.5';
          btn.style.pointerEvents = 'none';
          try {
            await fetchAPI('/click', {
              method: 'POST',
              body: JSON.stringify({ clickId, label: clickLabel }),
            });
          } catch {}
          if (isNameBtn) openRightSidebar();
          setTimeout(() => {
            btn.style.opacity = '';
            btn.style.pointerEvents = '';
          }, 500);
          setTimeout(loadSnapshot, 300);
          setTimeout(loadSnapshot, 1000);
        });
      });

      runningTasksList.classList.toggle('collapsed', state.runningTasksCollapsed);
      runningTasks.querySelector('.running-tasks-arrow')
        ?.classList.toggle('rotated', state.runningTasksCollapsed);
    }
    runningTasks.classList.remove('hidden');
  } else {
    runningTasks.classList.add('hidden');
    runningTasks.dataset.lastHtml = '';
  }
}

export function renderSettingsScheduledTasks(data) {
  if (data.settingsHtml) {
    if (settingsContent._lastHtml !== data.settingsHtml) {
      settingsContent._lastHtml = data.settingsHtml;
      settingsContent.innerHTML = data.settingsHtml;
      addClickProxyHandlers(settingsContent);
    }
    settingsOverlay.classList.remove('hidden');
  } else {
    settingsOverlay.classList.add('hidden');
    settingsContent._lastHtml = '';
  }

  if (data.scheduledTasksHtml) {
    if (scheduledTasksContent._lastHtml !== data.scheduledTasksHtml) {
      scheduledTasksContent._lastHtml = data.scheduledTasksHtml;
      scheduledTasksContent.innerHTML = data.scheduledTasksHtml;
      addClickProxyHandlers(scheduledTasksContent);
    }
    scheduledTasksOverlay.classList.remove('hidden');
  } else {
    scheduledTasksOverlay.classList.add('hidden');
    scheduledTasksContent._lastHtml = '';
  }

  if (data.scheduledTasksDialogHtml) {
    if (scheduledTasksDialog._lastHtml !== data.scheduledTasksDialogHtml) {
      scheduledTasksDialog._lastHtml = data.scheduledTasksDialogHtml;
      scheduledTasksDialog.innerHTML = data.scheduledTasksDialogHtml;
      addClickProxyHandlers(scheduledTasksDialog);
    }
    scheduledTasksDialog.classList.remove('hidden');
  } else {
    scheduledTasksDialog.classList.add('hidden');
    scheduledTasksDialog._lastHtml = '';
  }
}
