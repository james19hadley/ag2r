import { chatContent } from './dom.js';

function getCodeBlockText(pre) {
  const code = pre.querySelector('code') || pre;

  const lineContents = code.querySelectorAll('.line-content');
  if (lineContents.length > 0) {
    return Array.from(lineContents).map(lc => lc.textContent).join('\n');
  }

  const clone = code.cloneNode(true);
  clone.querySelectorAll('style, button, .mobile-copy-btn').forEach(el => el.remove());
  return clone.innerText;
}

export function addMobileCopyButtons() {
  chatContent.querySelectorAll('pre').forEach(pre => {
    if (pre.querySelector('.mobile-copy-btn')) return;

    const lines = pre.textContent.trim().split('\n');
    if (lines.length <= 1) {
      pre.classList.add('single-line-pre');
      return;
    }

    pre.style.position = 'relative';
    const btn = document.createElement('button');
    btn.className = 'mobile-copy-btn';
    btn.textContent = 'Copy';
    btn.addEventListener('mousedown', e => e.preventDefault());
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        const text = getCodeBlockText(pre);
        await navigator.clipboard.writeText(text);
        btn.textContent = 'Copied!';
        btn.classList.add('copied');
        setTimeout(() => {
          btn.textContent = 'Copy';
          btn.classList.remove('copied');
        }, 2000);
      } catch {
        btn.textContent = 'Failed';
        setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
      }
    });
    pre.appendChild(btn);
  });
}
