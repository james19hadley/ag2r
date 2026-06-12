export {
  makeTaskClickScript,
  makeSchedClickScript,
  makeListboxClickScript,
  makeDlgClickScript
} from './click-scripts-basic.js';

export function makeClickScript(clickId, label) {
  const safeClickId = JSON.stringify(String(clickId));
  const safeLabel = JSON.stringify(label || '');
  return `
  (async () => {
    const clickId = ${safeClickId};
    const expectedLabel = ${safeLabel};

    const colonIdx = clickId.indexOf(':');
    if (colonIdx === -1) return { ok: false, reason: 'invalid_click_id' };
    const source = clickId.substring(0, colonIdx);
    const idx = parseInt(clickId.substring(colonIdx + 1), 10);

    let root = null;
    if (source === 'chat') {
      root =
        document.querySelector('.scrollbar-hide[class*="overflow-y-auto"]') ||
        document.querySelector('[data-testid="conversation-view"]') ||
        document.getElementById('conversation') ||
        document.getElementById('chat') ||
        document.getElementById('cascade');
    } else if (source === 'left') {
      const allSidebarsClick = document.querySelectorAll('[class*="bg-sidebar"]');
      let tallest = null, tallestH = 0;
      for (const el of allSidebarsClick) {
        if (el.offsetParent !== null) {
          const h = el.getBoundingClientRect().height;
          if (h > tallestH) { tallestH = h; tallest = el; }
        }
      }
      root = tallest;
    } else if (source === 'right') {
      const tabBtn = document.querySelector('[data-tab-id="overview"], [data-tab-id="review"]');
      const anchor = tabBtn || document.querySelector('[data-testid="close-aux-pane"]');
      if (anchor) {
        let el = anchor;
        for (let i = 0; i < 10 && el; i++) {
          el = el.parentElement;
          const cls = el?.className?.toString?.() || '';
          if (cls.includes('flex') && cls.includes('flex-col') && el.children.length >= 2) {
            root = el;
            break;
          }
        }
      }
    } else if (source === 'dropdown') {
      for (const child of document.body.children) {
        if (child.getAttribute('role') === 'listbox' && child.textContent.trim()) {
          root = child;
          break;
        }
      }
    } else if (source === 'dialog') {
      for (const child of document.body.children) {
        const cls = child.className || '';
        if (cls.includes('fixed') && cls.includes('inset-0')) {
          root = child;
          break;
        }
        if (!root && child.getAttribute('role') === 'dialog') {
          root = child;
        }
      }
    } else if (source === 'settings') {
      const settingsOverlay = document.querySelector('#root .fixed.inset-0[class*="z-[2550]"]');
      if (settingsOverlay) {
        root = settingsOverlay.querySelector('[class*="max-w-5xl"]') ||
               settingsOverlay.querySelector('[class*="rounded-2xl"]') ||
               settingsOverlay;
      }
    } else if (source === 'perm') {
      const radioGroup = document.querySelector('[role="radiogroup"]');
      if (radioGroup) {
        let banner = radioGroup;
        for (let i = 0; i < 10; i++) {
          if (!banner.parentElement || banner.parentElement === document.body) break;
          banner = banner.parentElement;
          if (/allow|permission/i.test(banner.textContent) && banner.querySelectorAll('button').length >= 1) break;
        }
        const permEls = [];
        banner.querySelectorAll('[role="radiogroup"] label').forEach(el => permEls.push(el));
        banner.querySelectorAll('button').forEach(el => permEls.push(el));
        if (idx >= 0 && idx < permEls.length) {
          const target = permEls[idx];
          const actualLabel = (target.textContent || '').trim().substring(0, 50);
          target.click();
          return { ok: true, label: actualLabel, source: 'perm' };
        }
        return { ok: false, reason: 'perm_index_out_of_range', total: permEls.length };
      }
      return { ok: false, reason: 'no_permission_banner' };
    } else if (source === 'env') {
      const selectors = [
        '[aria-label="Select Environment"]',
        '[aria-label="Select Default Branch"]',
      ];
      if (idx >= 0 && idx < selectors.length) {
        const target = document.querySelector(selectors[idx]);
        if (target) {
          const actualLabel = (target.textContent || '').trim().substring(0, 50);
          target.click();
          return { ok: true, label: actualLabel, source: 'env' };
        }
        return { ok: false, reason: 'env_button_not_found', idx };
      }
      return { ok: false, reason: 'env_index_out_of_range' };
    } else if (source === 'model') {
      const target = document.querySelector('[aria-label*="Select model"]');
      if (target) {
        const actualLabel = (target.textContent || '').trim().substring(0, 50);
        target.click();
        return { ok: true, label: actualLabel, source: 'model' };
      }
      return { ok: false, reason: 'model_button_not_found' };
    } else if (source === 'project') {
      const target = document.querySelector('[aria-haspopup="dialog"]');
      if (target) {
        const actualLabel = (target.textContent || '').trim().substring(0, 50);
        target.click();
        return { ok: true, label: actualLabel, source: 'project' };
      }
      return { ok: false, reason: 'project_button_not_found' };
    } else if (source === 'task') {
      const inputBox = document.getElementById('antigravity.agentSidePanelInputBox');
      if (inputBox) {
        const taskSection = inputBox.querySelector('.rounded-t-2xl');
        if (taskSection) {
          const btns = taskSection.querySelectorAll('button');
          if (idx >= 0 && idx < btns.length) {
            const target = btns[idx];
            const actualLabel = (target.textContent || '').trim().substring(0, 80);
            target.click();
            return { ok: true, label: actualLabel, source: 'task' };
          }
          return { ok: false, reason: 'task_index_out_of_range', total: btns.length };
        }
        return { ok: false, reason: 'no_task_section' };
      }
      return { ok: false, reason: 'no_input_box' };
    }

    if (!root) return { ok: false, reason: 'no_root_for_' + source };

    if (source === 'settings') {
      let sIdx = 0;
      root.querySelectorAll('button, a, [role="button"]').forEach(el => {
        el.setAttribute('data-ag-click-id', 'settings:' + sIdx);
        sIdx++;
      });
      const target = root.querySelector('[data-ag-click-id="' + clickId + '"]');
      root.querySelectorAll('[data-ag-click-id]').forEach(el => el.removeAttribute('data-ag-click-id'));
      if (!target) return { ok: false, reason: 'settings_element_not_found', clickId, total: sIdx };
      const actualLabel = (target.textContent || '').trim().substring(0, 50);
      target.click();
      return { ok: true, label: actualLabel, source: 'settings' };
    }

    const skipVis = (source === 'right' || source === 'left' || source === 'settings');
    const maxLen = (source === 'chat') ? 80 : 0;
    const visible = [];
    root.querySelectorAll('button, a, [role="button"]').forEach(el => {
      if (skipVis || el.offsetParent !== null) {
        visible.push(el);
      }
    });
    root.querySelectorAll('[class*="cursor-pointer"]').forEach(el => {
      if ((skipVis || el.offsetParent !== null) && !visible.includes(el)) {
        const hasHandler = typeof el.onclick === 'function';
        if (maxLen && (el.textContent || '').trim().length > maxLen && !hasHandler) return;
        visible.push(el);
      }
    });

    if (idx < 0 || idx >= visible.length) {
      return { ok: false, reason: 'index_out_of_range', total: visible.length };
    }

    const target = visible[idx];
    const actualLabel = (target.textContent || '').trim().substring(0, 50);

    const debugNearby = [];
    for (let d = Math.max(0, idx - 3); d <= Math.min(visible.length - 1, idx + 3); d++) {
      const el = visible[d];
      const txt = (el.textContent || '').trim().substring(0, 60);
      debugNearby.push(d + ':' + el.tagName + ' "' + txt + '"');
    }

    if (expectedLabel && actualLabel !== expectedLabel) {
      return { ok: false, reason: 'label_mismatch', expected: expectedLabel, actual: actualLabel, total: visible.length, debugNearby };
    }

    const getActiveTab = () => {
      for (const t of document.querySelectorAll('[data-tab-id]')) {
        if ((t.className || '').includes('bg-secondary')) return t.getAttribute('data-tab-id');
      }
      return null;
    };
    const tabBefore = getActiveTab();

    target.click();

    await new Promise(r => setTimeout(r, 300));
    const tabAfter = getActiveTab();
    let navigatedToFile = false;
    if (source === 'chat') {
      if (tabAfter && tabAfter !== tabBefore) {
        navigatedToFile = true;
      } else {
        const text = (target.textContent || '').trim();
        const dotIdx = text.indexOf('.');
        if (dotIdx > 0 && dotIdx < text.length - 1) {
          const beforeDot = text.substring(0, dotIdx);
          if (beforeDot.length < 30 && !beforeDot.includes(' ')) {
            navigatedToFile = true;
          }
        }
        if (!navigatedToFile && text.charAt(0) === '+' && text.includes('-')) {
          var isDiffStat = true;
          for (var ci = 0; ci < text.length; ci++) {
            var ch = text.charAt(ci);
            if (ch !== '+' && ch !== '-' && (ch < '0' || ch > '9')) { isDiffStat = false; break; }
          }
          if (isDiffStat) navigatedToFile = true;
        }
      }
    }

    return { ok: true, label: actualLabel, source, navigatedToFile, debugNearby };
  })()
  `;
}
