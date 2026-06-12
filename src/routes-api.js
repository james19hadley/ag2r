import express from 'express';
import { state } from './state.js';
import { log } from './utils.js';
import { evaluateInBrowser } from './cdp.js';
import { RIGHT_SIDEBAR_SCRIPT, STOP_SCRIPT } from './capture-scripts.js';
import { track } from './telemetry.js';

export function registerApiRoutes(app) {
  app.get('/snapshot', (req, res) => {
    if (!state.cachedSnapshot) {
      return res.status(503).json({ error: 'No snapshot available' });
    }

    res.json({
      html: state.cachedSnapshot.html,
      css: state.cachedSnapshot.css,
      hash: state.cachedSnapshot.hash,
      agentRunning: state.cachedSnapshot.agentRunning,
      scrollInfo: state.cachedSnapshot.scrollInfo,
      leftSidebarHtml: state.cachedSnapshot.leftSidebarHtml || null,
      sidebarSignature: state.cachedSnapshot.sidebarSignature || null,
      isNewSessionPage: state.cachedSnapshot.isNewSessionPage || false,
      dropdownHtml: state.cachedSnapshot.dropdownHtml || null,
      dialogHtml: state.cachedSnapshot.dialogHtml || null,
      settingsHtml: state.cachedSnapshot.settingsHtml || null,
      activeArtifactUri: state.cachedSnapshot.activeArtifactUri || null,
      activeFileUri: state.cachedSnapshot.activeFileUri || null,
      permissionHtml: state.cachedSnapshot.permissionHtml || null,
      environmentName: state.cachedSnapshot.environmentName || null,
      branchName: state.cachedSnapshot.branchName || null,
      modelName: state.cachedSnapshot.modelName || null,
      runningTasksHtml: state.cachedSnapshot.runningTasksHtml || null,
      scheduledTasksHtml: state.cachedSnapshot.scheduledTasksHtml || null,
      scheduledTasksDialogHtml: state.cachedSnapshot.scheduledTasksDialogHtml || null,
      isAuthRequired: state.cachedSnapshot.isAuthRequired || false,
      isOnboarding: state.cachedSnapshot.isOnboarding || false,
    });
  });

  app.post('/stop', async (req, res) => {
    if (!state.cdpClient) {
      return res.status(503).json({ error: 'CDP not connected' });
    }

    try {
      const result = await evaluateInBrowser(STOP_SCRIPT);
      if (result && result.ok) {
        track('generation_stopped');
      }
      res.json(result || { ok: false });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/right-sidebar', async (req, res) => {
    try {
      const html = await evaluateInBrowser(RIGHT_SIDEBAR_SCRIPT);
      res.json({ html: html || null });
    } catch (e) {
      console.debug('[RightSidebar] Error:', e.message);
      res.json({ html: null, error: e.message });
    }
  });

  app.get('/proxy-image', async (req, res) => {
    const src = req.query.src;
    if (!src) return res.status(400).json({ error: 'Missing src parameter' });

    try {
      const script = `
      (() => {
        const targetSrc = ${JSON.stringify(src)};
        const imgs = document.querySelectorAll('img');
        for (const img of imgs) {
          if (img.src !== targetSrc && img.getAttribute('src') !== targetSrc) continue;
          if (!img.complete || img.naturalWidth === 0) continue;

          try {
            const MAX_WIDTH = 800;
            let w = img.naturalWidth;
            let h = img.naturalHeight;
            if (w > MAX_WIDTH) {
              h = Math.round(h * (MAX_WIDTH / w));
              w = MAX_WIDTH;
            }
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            return canvas.toDataURL('image/png');
          } catch (e) {
            return null;
          }
        }
        return null;
      })()
      `;

      const dataUrl = await evaluateInBrowser(script);
      res.json({ dataUrl: dataUrl || null });
    } catch (e) {
      console.debug('[ProxyImage] Error:', e.message);
      res.json({ dataUrl: null, error: e.message });
    }
  });

  app.post('/expand-left-sidebar', async (req, res) => {
    if (!state.cdpClient) {
      return res.status(503).json({ error: 'CDP not connected' });
    }
    try {
      const result = await evaluateInBrowser(`
        (async () => {
          const leftRoot = document.querySelector('[class*="bg-sidebar"]');
          const isCollapsed = !leftRoot || leftRoot.offsetParent === null;
          if (!isCollapsed) return { ok: true, wasCollapsed: false };
          const toggleBtn = document.querySelector('[data-testid="sidebar-toggle"]');
          if (!toggleBtn) return { ok: false, error: 'Toggle button not found' };
          toggleBtn.click();
          return { ok: true, wasCollapsed: true };
        })()
      `);
      log('ExpandLeftSidebar', JSON.stringify(result));
      res.json(result || { ok: false });
    } catch (e) {
      console.debug('[ExpandLeftSidebar] Error:', e.message);
      res.json({ ok: false, error: e.message });
    }
  });

  app.post('/copy-response', async (req, res) => {
    const { clickId } = req.body || {};
    if (!clickId || !state.cdpClient) {
      return res.status(400).json({ error: 'Missing clickId or CDP not connected' });
    }
    try {
      const script = `
      (async () => {
        const clickId = ${JSON.stringify(String(clickId))};
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
        }
        if (!root) return { ok: false, reason: 'no_root' };

        const maxLen = (source === 'chat') ? 80 : 0;
        const visible = [];
        root.querySelectorAll('button, a, [role="button"]').forEach(el => {
          if (el.offsetParent !== null) visible.push(el);
        });
        root.querySelectorAll('[class*="cursor-pointer"]').forEach(el => {
          if (el.offsetParent !== null && !visible.includes(el)) {
            const hasHandler = typeof el.onclick === 'function';
            if (maxLen && (el.textContent || '').trim().length > maxLen && !hasHandler) return;
            visible.push(el);
          }
        });

        const target = visible[idx];
        if (!target) return { ok: false, reason: 'element_not_found', idx, total: visible.length };

        let captured = null;
        const orig = navigator.clipboard.writeText.bind(navigator.clipboard);
        navigator.clipboard.writeText = (text) => {
          captured = text;
          return orig(text);
        };
        try {
          target.click();
          await new Promise(r => setTimeout(r, 300));
        } finally {
          navigator.clipboard.writeText = orig;
        }
        return { ok: true, text: captured || '' };
      })()
      `;
      const result = await evaluateInBrowser(script);
      log('CopyResponse', `clickId=${clickId} text=${(result?.text || '').length} chars`);
      if (result && result.ok) {
        track('code_copied');
      }
      res.json(result || { ok: false });
    } catch (e) {
      log('CopyResponse', `Error: ${e.message}`);
      res.json({ ok: false, error: e.message });
    }
  });
}
