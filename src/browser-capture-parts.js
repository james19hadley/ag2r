export const CLEANUP_CLONE_SCRIPT = `
  if (!isNewSessionPage) {
    ['[contenteditable="true"]', '[data-lexical-editor]', '[role="textbox"]', 'form'].forEach(sel => {
      clone.querySelectorAll(sel).forEach(el => {
        let target = el;
        while (target.parentElement && target.parentElement !== clone) {
          const btn = target.parentElement.querySelector('button, [role="button"]');
          if (/^(Allow|Deny|Review|Run|Confirm|Accept|Reject)/i.test(btn?.textContent?.trim() || '')) break;
          target = target.parentElement;
        }
        if (target.parentElement === clone) target.remove();
        else el.remove();
      });
    });
  }

  clone.querySelectorAll('[data-ag-remove]').forEach(el => {
    let isActionBar = false;
    el.querySelectorAll('button, [role="button"]').forEach(b => {
      if (/^(Allow|Deny|Review|Run|Confirm)/i.test(b.textContent?.trim())) isActionBar = true;
    });
    const isMessageAction = el.tagName === 'BUTTON' || 
                            el.getAttribute('aria-label') || 
                            el.querySelector('button, [role="button"], [class*="cursor-pointer"]');
    if (!isActionBar && !isMessageAction) el.remove();
    else el.removeAttribute('data-ag-remove');
  });

  clone.querySelectorAll('[data-ag-sticky]').forEach(el => {
    el.style.backgroundColor = '#101010';
  });

  clone.querySelectorAll('span > div, p > div').forEach(div => {
    const span = document.createElement('span');
    span.innerHTML = div.innerHTML;
    span.style.display = 'inline-flex';
    span.style.alignItems = 'center';
    for (const attr of div.attributes) {
      if (attr.name !== 'style') span.setAttribute(attr.name, attr.value);
    }
    div.replaceWith(span);
  });

  clone.querySelectorAll('p').forEach(p => { p.style.display = 'block'; });
`;

export const CSS_CAPTURE_SCRIPT = `
  let css = '';
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) { css += rule.cssText + '\\n'; }
    } catch {}
  }

  const rootStyle = getComputedStyle(document.documentElement);
  const bodyStyle = document.body ? getComputedStyle(document.body) : null;
  const themeRules = [];
  const seen = new Set();
  for (const source of [rootStyle, bodyStyle]) {
    if (!source) continue;
    for (const name of source) {
      if (name.startsWith('--') && !seen.has(name)) {
        const val = source.getPropertyValue(name).trim();
        if (val) {
          themeRules.push(name + ':' + val);
          seen.add(name);
        }
      }
    }
  }
  if (themeRules.length > 0) {
    css = ':root{' + themeRules.join(';') + '}\\n' + css;
  }
`;

export const PORTALS_CAPTURE_SCRIPT = `
  let leftSidebarHtml = null;
  try {
    const allSidebars = document.querySelectorAll('[class*="bg-sidebar"]');
    let leftRoot = null;
    let maxHeight = 0;
    for (const el of allSidebars) {
      if (el.offsetParent !== null) {
        const h = el.getBoundingClientRect().height;
        if (h > maxHeight) { maxHeight = h; leftRoot = el; }
      }
    }
    if (leftRoot) {
      const leftTagged = tagInteractives(leftRoot, 'left', true, true);
      const leftClone = leftRoot.cloneNode(true);
      untagAll(leftTagged);
      leftSidebarHtml = leftClone.outerHTML;
    }
  } catch (e) {
    console.debug('[AG2R] Left sidebar capture error:', e.message);
  }

  let sidebarSignature = null;
  try {
    const tabBtns = document.querySelectorAll('[data-tab-id]');
    if (tabBtns.length > 0) {
      const tabs = [];
      for (const b of tabBtns) {
        const id = b.getAttribute('data-tab-id');
        const active = (b.className || '').includes('bg-secondary') ? '*' : '';
        tabs.push(id + active);
      }
      sidebarSignature = tabs.join(',');
    }
  } catch (e) {
    console.debug('[AG2R] Sidebar signature error:', e.message);
  }

  let dropdownHtml = null;
  let dialogHtml = null;
  try {
    for (const child of document.body.children) {
      if (child.id || child.tagName === 'SCRIPT' || child.tagName === 'STYLE') continue;
      const text = child.textContent.trim();
      if (!text) continue;

      if (!dropdownHtml && child.getAttribute('role') === 'listbox') {
        const tagged = tagInteractives(child, 'dropdown', true, false);
        const clone = child.cloneNode(true);
        untagAll(tagged);
        dropdownHtml = clone.outerHTML;
      }

      const cls = child.className || '';
      if (!dialogHtml && cls.includes('fixed') && cls.includes('inset-0')) {
        const tagged = tagInteractives(child, 'dialog', true, false);
        const clone = child.cloneNode(true);
        untagAll(tagged);
        dialogHtml = clone.outerHTML;
      }

      if (!dialogHtml && child.getAttribute('role') === 'dialog') {
        const tagged = tagInteractives(child, 'dialog', true, false);
        const clone = child.cloneNode(true);
        untagAll(tagged);
        dialogHtml = clone.outerHTML;
      }
    }
  } catch (e) {
    console.debug('[AG2R] Portal capture error:', e.message);
  }
`;
