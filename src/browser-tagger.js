export const TAGGER_SCRIPT = `
  function tagInteractives(root, prefix, skipVisibilityCheck, includeCursorPointer, maxTextLength) {
    let idx = 0;
    const tagged = [];
    root.querySelectorAll('button, a, [role="button"]').forEach(el => {
      if (skipVisibilityCheck || el.offsetParent !== null) {
        const text = (el.textContent || '').trim();
        el.setAttribute('data-ag-click-id', prefix + ':' + idx);
        el.setAttribute('data-ag-click-label', text.substring(0, 50));
        idx++;
        tagged.push(el);
      }
    });
    if (includeCursorPointer) {
      root.querySelectorAll('[class*="cursor-pointer"]').forEach(el => {
        if ((skipVisibilityCheck || el.offsetParent !== null) && !el.hasAttribute('data-ag-click-id')) {
          const text = (el.textContent || '').trim();
          const hasHandler = typeof el.onclick === 'function';
          if (maxTextLength && text.length > maxTextLength && !hasHandler) return;
          el.setAttribute('data-ag-click-id', prefix + ':' + idx);
          el.setAttribute('data-ag-click-label', text.substring(0, 50));
          idx++;
          tagged.push(el);
        }
      });
    }
    return tagged;
  }

  function untagAll(tagged) {
    tagged.forEach(el => {
      el.removeAttribute('data-ag-click-id');
      el.removeAttribute('data-ag-click-label');
    });
  }
`;
