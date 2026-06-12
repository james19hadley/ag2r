import { TAGGER_SCRIPT } from './browser-tagger.js';

export const RUNNING_TASKS_SCRIPT = `
(() => {
  const inputBox = document.getElementById('antigravity.agentSidePanelInputBox');
  if (!inputBox) return null;
  const taskSection = inputBox.querySelector('.rounded-t-2xl');
  if (!taskSection || taskSection.getBoundingClientRect().height <= 0) return null;
  let taskIdx = 0;
  const taskTagged = [];
  taskSection.querySelectorAll('button').forEach(btn => {
    btn.setAttribute('data-ag-click-id', 'task:' + taskIdx);
    btn.setAttribute('data-ag-click-label', (btn.textContent || '').trim().substring(0, 80));
    taskIdx++;
    taskTagged.push(btn);
  });
  const taskClone = taskSection.cloneNode(true);
  taskTagged.forEach(el => {
    el.removeAttribute('data-ag-click-id');
    el.removeAttribute('data-ag-click-label');
  });
  return taskClone.outerHTML;
})()
`;

export const SCHEDULED_TASKS_SCRIPT = `
(() => {
  const newBtn = document.querySelector('[aria-label="Add scheduled task"]');
  if (!newBtn) return null;

  let container = newBtn;
  for (let i = 0; i < 15; i++) {
    if (!container.parentElement) break;
    const p = container.parentElement;
    if (p.getBoundingClientRect().x < 10) break;
    container = p;
  }

  const inner = container.querySelector('.flex-1.flex.flex-col.min-w-0.h-full') || container;

  let idx = 0;
  const tagged = [];
  inner.querySelectorAll('button, a, [role="button"], input, select, textarea').forEach(el => {
    el.setAttribute('data-ag-click-id', 'sched:' + idx);
    el.setAttribute('data-ag-click-label', (el.textContent || el.getAttribute('placeholder') || '').trim().substring(0, 50));
    idx++;
    tagged.push(el);
  });
  const pageClone = inner.cloneNode(true);
  tagged.forEach(el => {
    el.removeAttribute('data-ag-click-id');
    el.removeAttribute('data-ag-click-label');
  });

  return pageClone.outerHTML;
})()
`;

export const SCHEDULED_TASKS_DIALOG_SCRIPT = `
(() => {
  const overlay = document.querySelector('.fixed.inset-0[class*="z-[2550]"]');
  if (!overlay || overlay.getBoundingClientRect().width <= 0) return null;
  const text = overlay.textContent || '';
  if (!text.includes('Scheduled Task') && !text.includes('task name')) return null;

  let idx = 0;
  const tagged = [];
  overlay.querySelectorAll('button, a, [role="button"], input, select, textarea, [role="combobox"], [role="switch"]').forEach(el => {
    el.setAttribute('data-ag-click-id', 'scheddlg:' + idx);
    el.setAttribute('data-ag-click-label', (el.textContent || el.getAttribute('placeholder') || '').trim().substring(0, 50));
    idx++;
    tagged.push(el);
  });
  overlay.querySelectorAll('div.cursor-pointer[aria-expanded]').forEach(el => {
    if (el.getAttribute('data-ag-click-id')) return;
    el.setAttribute('data-ag-click-id', 'scheddlg:' + idx);
    el.setAttribute('data-ag-click-label', (el.textContent || '').trim().substring(0, 50));
    idx++;
    tagged.push(el);
  });
  const valuedEls = [];
  overlay.querySelectorAll('input, textarea').forEach(el => {
    const liveVal = el.value || '';
    el.setAttribute('data-ag-value', liveVal);
    valuedEls.push(el);
  });
  const card = overlay.querySelector('[class*="shadow-xl"]') || overlay.firstElementChild || overlay;
  const clone = card.cloneNode(true);
  tagged.forEach(el => {
    el.removeAttribute('data-ag-click-id');
    el.removeAttribute('data-ag-click-label');
  });
  valuedEls.forEach(el => el.removeAttribute('data-ag-value'));
  return clone.outerHTML;
})()
`;

export const RIGHT_SIDEBAR_SCRIPT = `
(() => {
  ${TAGGER_SCRIPT}

  let sidebarRoot = null;
  const tabBtn = document.querySelector('[data-tab-id="overview"], [data-tab-id="review"]');
  if (tabBtn) {
    let el = tabBtn;
    for (let i = 0; i < 10 && el; i++) {
      el = el.parentElement;
      const cls = el?.className?.toString?.() || '';
      if (cls.includes('flex') && cls.includes('flex-col') && el.children.length >= 2) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 100 && rect.height > 200) {
          sidebarRoot = el;
          break;
        }
      }
    }
  }

  if (!sidebarRoot) {
    const closeBtn = document.querySelector('[data-testid="close-aux-pane"]');
    if (closeBtn) {
      let el = closeBtn;
      for (let i = 0; i < 10 && el; i++) {
        el = el.parentElement;
        const cls = el?.className?.toString?.() || '';
        if (cls.includes('flex') && cls.includes('flex-col') && el.children.length >= 2) {
          sidebarRoot = el;
          break;
        }
      }
    }
  }

  if (!sidebarRoot) return null;

  const rightTagged = tagInteractives(sidebarRoot, 'right', true, true);
  const rightClone = sidebarRoot.cloneNode(true);
  untagAll(rightTagged);
  return rightClone.outerHTML;
})()
`;

export const STOP_SCRIPT = `
(async () => {
  const cancelBtn = document.querySelector('[data-tooltip-id="input-send-button-cancel-tooltip"]');
  if (cancelBtn && cancelBtn.offsetParent !== null) {
    cancelBtn.click();
    return { ok: true, method: 'cancel-tooltip' };
  }

  const squareIcon = document.querySelector('button svg.lucide-square');
  if (squareIcon) {
    const btn = squareIcon.closest('button');
    if (btn && btn.offsetParent !== null) {
      btn.click();
      return { ok: true, method: 'square-icon' };
    }
  }

  return { ok: false, reason: 'no_stop_button' };
})()
`;
