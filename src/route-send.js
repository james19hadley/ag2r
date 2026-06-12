import { state } from './state.js';
import { log } from './utils.js';
import { evaluateInBrowser } from './cdp.js';
import { track } from './telemetry.js';

export function registerSendRoute(app) {
  let lastSentMessage = { text: '', time: 0 };

  app.post('/send', async (req, res) => {
    const { message } = req.body;
    log('Send', `Received: "${message?.substring(0, 50)}"`);

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message is required' });
    }

    if (!state.cdpClient) {
      return res.status(503).json({ error: 'CDP not connected' });
    }

    const now = Date.now();
    if (message === lastSentMessage.text && now - lastSentMessage.time < 2000) {
      log('Send', 'Duplicate suppressed (same text within 2s)');
      return res.json({ ok: true, method: 'dedup' });
    }
    lastSentMessage = { text: message, time: now };

    try {
      log('Send', 'Injecting via CDP...');
      const script = `
      (async () => {
        const editorCandidates = document.querySelectorAll(
          '[data-lexical-editor="true"], [contenteditable="true"][role="textbox"], [contenteditable="true"]'
        );
        let editor = null;
        for (const el of editorCandidates) {
          if (el.offsetParent !== null) editor = el;
        }
        if (!editor) return { ok: false, reason: 'no_editor' };

        editor.focus();
        document.execCommand('selectAll', false, null);
        document.execCommand('delete', false, null);

        const textVal = ${JSON.stringify(message)};
        const dt = new DataTransfer();
        dt.setData('text/plain', textVal);
        const pasteEvent = new ClipboardEvent('paste', {
          clipboardData: dt, bubbles: true, cancelable: true,
        });
        const notHandled = editor.dispatchEvent(pasteEvent);
        if (notHandled) {
          document.execCommand('insertText', false, textVal);
        }

        await new Promise(r => setTimeout(r, 100));

        const submitSelectors = [
          'button[data-testid="send-button"]',
          'button[aria-label*="send" i]',
          'button[aria-label*="submit" i]',
        ];

        let submitBtn = null;
        for (const sel of submitSelectors) {
          submitBtn = document.querySelector(sel);
          if (submitBtn && submitBtn.offsetParent !== null) break;
          submitBtn = null;
        }

        if (!submitBtn) {
          const arrow = document.querySelector('svg.lucide-arrow-right, svg.lucide-arrow-up');
          if (arrow) submitBtn = arrow.closest('button');
        }

        if (!submitBtn) {
          const form = editor.closest('form');
          if (form) submitBtn = form.querySelector('button[type="submit"], button:last-of-type');
        }
        if (!submitBtn) {
          const parent = editor.parentElement;
          if (parent) submitBtn = parent.querySelector('button');
        }

        if (submitBtn) {
          submitBtn.click();
          return { ok: true, method: 'button' };
        }

        const enterEvent = new KeyboardEvent('keydown', {
          key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true,
        });
        editor.dispatchEvent(enterEvent);
        return { ok: true, method: 'enter' };
      })()
      `;
      const result = await evaluateInBrowser(script);
      log('Send', `Injection result: ${JSON.stringify(result)}`);
      if (result && result.ok) {
        track('message_sent');
      }
      res.json(result || { ok: true });
    } catch (e) {
      log('Send', `Injection error: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });
}
