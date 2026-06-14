import { state } from './state.js';
import { log } from './utils.js';
import { evaluateInBrowser } from './cdp.js';
import { track } from './telemetry.js';

// CDP scripts from src/cdp-scripts/
import { buildInjectScript } from './cdp-scripts/inject-message.js';
import { CLICK_SEND_BUTTON_SCRIPT } from './cdp-scripts/click-send-button.js';
import { CHECK_EDITOR_IMAGE_SCRIPT } from './cdp-scripts/check-editor-image.js';

// Poll AG's editor until it contains image content (img, decorator nodes).
// Returns true if image found within timeout, false otherwise.
async function waitForEditorImage(maxWaitMs = 3000) {
  const interval = 100;
  const attempts = Math.ceil(maxWaitMs / interval);
  for (let i = 0; i < attempts; i++) {
    try {
      const hasImage = await evaluateInBrowser(CHECK_EDITOR_IMAGE_SCRIPT);
      if (hasImage) {
        log('WaitImage', `Found after ${i * interval}ms`);
        return true;
      }
    } catch { /* ignore eval errors during polling */ }
    await new Promise(r => setTimeout(r, interval));
  }
  return false;
}

export function registerSendRoute(app) {
  let lastSentMessage = { text: '', time: 0 };

  app.post('/send', async (req, res) => {
    const { message, hasImages } = req.body;
    log('Send', `Received: "${message?.substring(0, 50)}"${hasImages ? ' (with images)' : ''}`);

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message is required' });
    }

    if (!state.cdpClient) {
      return res.status(503).json({ error: 'CDP not connected' });
    }

    // Server-side dedup — reject identical message within 2 seconds
    const now = Date.now();
    if (message === lastSentMessage.text && now - lastSentMessage.time < 2000) {
      log('Send', 'Duplicate suppressed (same text within 2s)');
      return res.json({ ok: true, method: 'dedup' });
    }
    lastSentMessage = { text: message, time: now };

    try {
      // When images were just uploaded, wait for AG to process them before injecting text
      if (hasImages) {
        log('Send', 'Waiting for AG to process dropped images...');
        await waitForEditorImage();
      }

      log('Send', 'Injecting via CDP...');
      // When images were just uploaded, use append mode to preserve them in the editor
      const script = buildInjectScript(JSON.stringify(message), !!hasImages);
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

  // --- Send Images Only (no text) ---
  // Waits for AG's editor to process dropped images, then clicks the send button.
  app.post('/send-images', async (req, res) => {
    if (!state.cdpClient) {
      return res.status(503).json({ error: 'CDP not connected' });
    }

    try {
      log('SendImages', 'Waiting 500ms for AG to process dropped images...');
      await new Promise(r => setTimeout(r, 500));

      log('SendImages', 'Clicking send...');
      const result = await evaluateInBrowser(CLICK_SEND_BUTTON_SCRIPT);

      log('SendImages', `Result: ${JSON.stringify(result)}`);
      if (result && result.ok) {
        track('message_sent');
      }
      res.json(result || { ok: false });
    } catch (e) {
      log('SendImages', `Error: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });
}
