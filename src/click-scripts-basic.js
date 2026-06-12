export function makeTaskClickScript(taskIdx) {
  return `
  (() => {
    const inputBox = document.getElementById('antigravity.agentSidePanelInputBox');
    if (!inputBox) return { ok: false, reason: 'no_input_box' };
    const taskSection = inputBox.querySelector('.rounded-t-2xl');
    if (!taskSection) return { ok: false, reason: 'no_task_section' };
    const btns = taskSection.querySelectorAll('button');
    const idx = ${taskIdx};
    if (idx < 0 || idx >= btns.length) return { ok: false, reason: 'task_index_out_of_range', total: btns.length };
    const target = btns[idx];
    const actualLabel = (target.textContent || '').trim().substring(0, 80);
    target.click();
    return { ok: true, label: actualLabel, source: 'task' };
  })()
  `;
}

export function makeSchedClickScript(schedIdx) {
  return `
  (() => {
    const newBtn = document.querySelector('[aria-label="Add scheduled task"]');
    if (!newBtn) return { ok: false, reason: 'no_scheduled_tasks_page' };
    let container = newBtn;
    for (let i = 0; i < 15; i++) {
      if (!container.parentElement) break;
      const p = container.parentElement;
      if (p.getBoundingClientRect().x < 10) break;
      container = p;
    }
    const inner = container.querySelector('.flex-1.flex.flex-col.min-w-0.h-full') || container;
    const elements = inner.querySelectorAll('button, a, [role="button"], input, select, textarea');
    const idx = ${schedIdx};
    if (idx < 0 || idx >= elements.length) return { ok: false, reason: 'sched_index_out_of_range', total: elements.length };
    const target = elements[idx];
    const actualLabel = (target.textContent || target.getAttribute('placeholder') || '').trim().substring(0, 80);
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
      target.focus();
    } else {
      target.click();
    }
    return { ok: true, label: actualLabel, source: 'sched' };
  })()
  `;
}

export function makeListboxClickScript(optIdx) {
  return `
  (() => {
    for (const child of document.body.children) {
      if (child.getAttribute('role') === 'listbox' && child.getBoundingClientRect().width > 0) {
        const options = child.querySelectorAll('[role="option"], button, a');
        const idx = ${optIdx};
        if (idx < 0 || idx >= options.length) return { ok: false, reason: 'option_index_out_of_range', total: options.length };
        const target = options[idx];
        target.click();
        return { ok: true, label: target.textContent.trim().substring(0, 50), source: 'scheddlg_listbox' };
      }
    }
    return { ok: false, reason: 'no_listbox' };
  })()
  `;
}

export function makeDlgClickScript(dlgIdx, label) {
  const safeLabel = JSON.stringify(label || '');
  return `
  (() => {
    const overlay = document.querySelector('.fixed.inset-0[class*="z-[2550]"]');
    if (!overlay || overlay.getBoundingClientRect().width <= 0) return { ok: false, reason: 'no_dialog' };
    const elements = [];
    overlay.querySelectorAll('button, a, [role="button"], input, select, textarea, [role="combobox"], [role="switch"]').forEach(el => elements.push(el));
    overlay.querySelectorAll('div.cursor-pointer[aria-expanded]').forEach(el => {
      if (!elements.includes(el)) elements.push(el);
    });

    const idx = ${dlgIdx};
    const expectedLabel = ${safeLabel};

    let target = (idx >= 0 && idx < elements.length) ? elements[idx] : null;

    if (target && expectedLabel) {
      const actualLabel = (target.textContent || target.getAttribute('placeholder') || '').trim().substring(0, 50);
      if (actualLabel !== expectedLabel) {
        target = null;
        for (const el of elements) {
          const elLabel = (el.textContent || el.getAttribute('placeholder') || '').trim().substring(0, 50);
          if (elLabel === expectedLabel) { target = el; break; }
        }
      }
    }

    if (!target) return { ok: false, reason: 'element_not_found', idx: idx, label: expectedLabel, total: elements.length };
    const actualLabel = (target.textContent || target.getAttribute('placeholder') || '').trim().substring(0, 80);
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
      target.focus();
    } else {
      target.click();
    }
    return { ok: true, label: actualLabel, source: 'scheddlg' };
  })()
  `;
}
