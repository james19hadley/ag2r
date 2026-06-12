import { fetchAPI } from './api.js';
import { permissionContent, permissionOverlay } from './dom.js';

export function renderPermissions(data) {
  if (data.permissionHtml) {
    if (data.permissionHtml === permissionContent.dataset.lastHtml) {
      // Cache match, do nothing
    } else {
      permissionContent.dataset.lastHtml = data.permissionHtml;
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = data.permissionHtml;

      const commandEl = tempDiv.querySelector('textarea[aria-label]');
      const commandText = commandEl ? commandEl.value || commandEl.textContent : '';

      const titleEl = tempDiv.querySelector('.text-foreground');
      const title = titleEl ? titleEl.textContent.trim() : 'Permission Required';

      const labels = tempDiv.querySelectorAll('[data-ag-click-id]');
      const options = [];
      const buttons = [];
      labels.forEach(el => {
        const clickId = el.dataset.agClickId;
        const text = el.textContent.trim();
        if (el.tagName === 'LABEL') {
          const numEl = el.querySelector('.font-mono');
          const num = numEl ? numEl.textContent.trim() : '';
          const labelText = text.replace(/^\d+/, '').trim();
          const isSelected = el.classList.contains('bg-secondary');
          const hasWriteIn = !!el.querySelector('textarea');
          const cleanLabel = hasWriteIn ? 'No' : labelText;
          options.push({ clickId, num, labelText: cleanLabel, isSelected, hasWriteIn });
        } else if (el.tagName === 'BUTTON') {
          buttons.push({ clickId, text: text.replace('↵', '').trim() });
        }
      });

      let optionsHtml = options.map(o => {
        const writeInHtml = o.hasWriteIn
          ? `<input type="text" class="permission-writein" placeholder="tell the agent what to do instead" />`
          : '';
        return `
        <button class="permission-option${o.isSelected ? ' selected' : ''}${o.hasWriteIn ? ' has-writein' : ''}"
                data-ag-click-id="${o.clickId}" data-ag-click-label="${o.num}${o.labelText}">
          <span class="permission-option-num">${o.num}</span>
          <span>${o.labelText}</span>
          ${writeInHtml}
        </button>
        `;
      }).join('');

      let actionsHtml = buttons.map(b => {
        const cls = b.text === 'Skip' ? 'perm-skip' : 'perm-submit';
        return `<button class="${cls}" data-ag-click-id="${b.clickId}" data-ag-click-label="${b.text}">${b.text}</button>`;
      }).join('');

      permissionContent.innerHTML = `
        <div class="permission-header">
          <span class="material-symbols-rounded" style="font-size:20px;color:var(--accent)">terminal</span>
          ${title}
        </div>
        <code class="permission-command">${commandText.replace(/</g, '&lt;')}</code>
        <div class="permission-options">${optionsHtml}</div>
        <div class="permission-actions">${actionsHtml}</div>
      `;

      permissionContent.querySelectorAll('.permission-option').forEach(btn => {
        const clickId = btn.dataset.agClickId;
        const clickLabel = btn.dataset.agClickLabel;
        btn.removeAttribute('data-ag-click-id');
        btn.addEventListener('click', async (e) => {
          if (e.target.classList.contains('permission-writein')) return;
          permissionContent.querySelectorAll('.permission-option').forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
          const writeIn = btn.querySelector('.permission-writein');
          if (writeIn) setTimeout(() => writeIn.focus(), 100);
          try {
            await fetchAPI('/click', {
              method: 'POST',
              body: JSON.stringify({ clickId, label: clickLabel }),
            });
          } catch {}
        });
      });

      permissionContent.querySelectorAll('.permission-writein').forEach(input => {
        input.addEventListener('click', (e) => e.stopPropagation());
      });

      permissionContent.querySelectorAll('.permission-actions button').forEach(btn => {
        const clickId = btn.dataset.agClickId;
        const clickLabel = btn.dataset.agClickLabel;
        btn.addEventListener('click', async () => {
          if (clickLabel !== 'Skip') {
            const selectedOption = permissionContent.querySelector('.permission-option.selected');
            const writeIn = selectedOption?.querySelector('.permission-writein');
            if (writeIn && writeIn.value.trim()) {
              try {
                await fetchAPI('/eval', {
                  method: 'POST',
                  body: JSON.stringify({
                    script: `(() => {
                      const rg = document.querySelector('[role="radiogroup"]');
                      if (!rg) return { ok: false, reason: 'no_radiogroup' };
                      const ta = rg.querySelector('textarea');
                      if (!ta) return { ok: false, reason: 'no_textarea' };
                      ta.focus();
                      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
                      nativeSetter.call(ta, ${JSON.stringify(writeIn.value)});
                      ta.dispatchEvent(new Event('input', { bubbles: true }));
                      ta.dispatchEvent(new Event('change', { bubbles: true }));
                      return { ok: true, text: ta.value };
                    })()`
                  }),
                });
              } catch {}
              await new Promise(r => setTimeout(r, 200));
            }
          }
          try {
            await fetchAPI('/click', {
              method: 'POST',
              body: JSON.stringify({ clickId, label: clickLabel }),
            });
          } catch {}
          permissionOverlay.classList.add('hidden');
          permissionContent.dataset.lastHtml = '';
        });
      });
    }
    permissionOverlay.classList.remove('hidden');
  } else {
    permissionOverlay.classList.add('hidden');
    permissionContent.dataset.lastHtml = '';
  }
}
