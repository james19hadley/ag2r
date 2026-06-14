import express from 'express';
import { state } from './state.js';
import { log } from './utils.js';
import { evaluateInBrowser } from './cdp.js';
import { track } from './telemetry.js';

// CDP scripts from src/cdp-scripts/
import { RIGHT_SIDEBAR_SCRIPT } from './cdp-scripts/right-sidebar.js';
import { STOP_SCRIPT } from './cdp-scripts/stop.js';
import { OPEN_RIGHT_SIDEBAR_SCRIPT } from './cdp-scripts/open-right-sidebar.js';
import { SELECT_OVERVIEW_TAB_SCRIPT } from './cdp-scripts/select-overview-tab.js';
import { buildProxyImageScript } from './cdp-scripts/proxy-image.js';
import { EXPAND_LEFT_SIDEBAR_SCRIPT } from './cdp-scripts/expand-left-sidebar.js';
import { buildCopyResponseScript } from './cdp-scripts/copy-response.js';

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
      isSubagentView: state.cachedSnapshot.isSubagentView || false,
      parentConversationName: state.cachedSnapshot.parentConversationName || null,
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

  // Upstream-aligned robust right-sidebar toggle and capture
  app.get('/right-sidebar', async (req, res) => {
    try {
      let html = await evaluateInBrowser(RIGHT_SIDEBAR_SCRIPT);
      if (html) {
        return res.json({ html });
      }

      // Sidebar is closed in AG — try to open it
      log('RightSidebar', 'Sidebar closed in AG, attempting to open...');
      const opened = await evaluateInBrowser(OPEN_RIGHT_SIDEBAR_SCRIPT);

      if (!opened) {
        // Strategy 2: Keyboard shortcut — Cmd+Option+B
        try {
          await state.cdpClient.Input.dispatchKeyEvent({
            type: 'keyDown',
            key: 'b',
            code: 'KeyB',
            modifiers: 8 + 1, // Meta(8) + Alt(1) = Cmd+Option
            windowsVirtualKeyCode: 66,
          });
          await state.cdpClient.Input.dispatchKeyEvent({
            type: 'keyUp',
            key: 'b',
            code: 'KeyB',
            modifiers: 8 + 1,
            windowsVirtualKeyCode: 66,
          });
          log('RightSidebar', 'Sent Cmd+Option+B keyboard shortcut');
        } catch (e) {
          log('RightSidebar', 'Keyboard shortcut failed:', e.message);
        }
      } else {
        log('RightSidebar', 'Clicked toggle button');
      }

      // Wait for sidebar to render
      await new Promise(r => setTimeout(r, 500));

      // Select the Overview tab if no tab is active
      await evaluateInBrowser(SELECT_OVERVIEW_TAB_SCRIPT);
      await new Promise(r => setTimeout(r, 200));

      // Re-try capture
      html = await evaluateInBrowser(RIGHT_SIDEBAR_SCRIPT);
      res.json({ html: html || null, wasOpened: true });
    } catch (e) {
      console.debug('[RightSidebar] Error:', e.message);
      res.json({ html: null, error: e.message });
    }
  });

  app.get('/proxy-image', async (req, res) => {
    const src = req.query.src;
    if (!src) return res.status(400).json({ error: 'Missing src parameter' });

    try {
      const script = buildProxyImageScript(JSON.stringify(src));
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
      const result = await evaluateInBrowser(EXPAND_LEFT_SIDEBAR_SCRIPT);
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
      const script = buildCopyResponseScript(JSON.stringify(String(clickId)));
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
