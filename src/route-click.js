import { state } from './state.js';
import { log, hashString } from './utils.js';
import { evaluateInBrowser, evaluateAcrossContexts } from './cdp.js';
import { captureSnapshot } from './snapshot.js';
import { broadcast } from './broadcast.js';
import { track } from './telemetry.js';
import {
  makeTaskClickScript,
  makeSchedClickScript,
  makeListboxClickScript,
  makeDlgClickScript,
  makeClickScript
} from './click-scripts.js';

export function registerClickRoute(app) {
  app.post('/click', async (req, res) => {
    const { clickId, label } = req.body;
    log('Click', `Proxying click id=${clickId} label="${label}"`);

    if (!clickId && clickId !== 0) {
      return res.status(400).json({ error: 'clickId is required' });
    }

    // Telemetry: detect meaningful clicks by prefix/label
    const cid = String(clickId || '');
    if (cid.startsWith('left:')) {
      track('conversation_switched');
    } else if (cid.startsWith('sched:')) {
      track('scheduled_task_viewed');
    }
    const trimmedLabel = String(label || '').trim();
    if (/^(Proceed|Approve)/i.test(trimmedLabel)) {
      track('plan_approved');
    }
    if (/^Run$/i.test(trimmedLabel) || /^Accept$/i.test(trimmedLabel)) {
      track('command_accepted');
    }

    if (!state.cdpClient) {
      return res.status(503).json({ error: 'CDP not connected' });
    }

    try {
      if (String(clickId).startsWith('task:')) {
        const taskIdx = parseInt(String(clickId).split(':')[1], 10);
        const result = await evaluateAcrossContexts(makeTaskClickScript(taskIdx));
        log('Click', `Task result: ${JSON.stringify(result)}`);
        return res.json(result || { ok: false, reason: 'null_result' });
      }

      if (String(clickId).startsWith('sched:')) {
        const schedIdx = parseInt(String(clickId).split(':')[1], 10);
        const result = await evaluateAcrossContexts(makeSchedClickScript(schedIdx));
        log('Click', `Sched result: ${JSON.stringify(result)}`);
        return res.json(result || { ok: false, reason: 'null_result' });
      }

      if (String(clickId).startsWith('scheddlg:')) {
        const dlgIdx = parseInt(String(clickId).split(':')[1], 10);

        if (dlgIdx >= 100) {
          const optIdx = dlgIdx - 100;
          const result = await evaluateInBrowser(makeListboxClickScript(optIdx));
          log('Click', `SchedDlgListbox result: ${JSON.stringify(result)}`);
          return res.json(result || { ok: false, reason: 'null_result' });
        }

        const result = await evaluateAcrossContexts(makeDlgClickScript(dlgIdx, label));
        log('Click', `SchedDlg result: ${JSON.stringify(result)}`);
        return res.json(result || { ok: false, reason: 'null_result' });
      }

      const result = await evaluateInBrowser(makeClickScript(clickId, label));
      log('Click', `Result: ${JSON.stringify(result)}`);

      if (result?.ok) {
        const actualLabel = result.label || '';
        const searchStr = `${label} ${actualLabel}`.toLowerCase();
        if (searchStr.includes('undo') || searchStr.includes('revert') || searchStr.includes('up to this point')) {
          await new Promise(r => setTimeout(r, 200));
          try {
            const editorText = await evaluateInBrowser(`(() => {
              const editorCandidates = document.querySelectorAll(
                '[data-lexical-editor="true"], [contenteditable="true"][role="textbox"], [contenteditable="true"]'
              );
              let editor = null;
              for (const el of editorCandidates) {
                if (el.offsetParent !== null) editor = el;
              }
              return editor ? editor.innerText || editor.textContent || '' : '';
            })()`);
            log('Click', `Detected undo/revert, retrieved editor text: "${editorText}"`);
            result.editorText = editorText;
          } catch (err) {
            console.debug('[CDP] Failed to get editor text after undo:', err.message);
          }
        }
      }

      res.json(result || { ok: false, reason: 'null_result' });

      if (result?.ok) {
        const source = result.source || '';
        if (['env', 'model', 'project', 'dropdown', 'dialog', 'left'].includes(source)) {
          const burstCapture = async (delay) => {
            await new Promise(r => setTimeout(r, delay));
            try {
              const snapshot = await captureSnapshot();
              if (snapshot) {
                const hash = hashString(
                  snapshot.html +
                  (snapshot.leftSidebarHtml || '') +
                  (snapshot.sidebarSignature || '') +
                  (snapshot.dropdownHtml || '') +
                  (snapshot.dialogHtml || '') +
                  (snapshot.settingsHtml || '') +
                  (snapshot.permissionHtml || '') +
                  (snapshot.scheduledTasksHtml || '') +
                  (snapshot.scheduledTasksDialogHtml || '')
                );
                if (hash !== state.lastSnapshotHash) {
                  state.cachedSnapshot = snapshot;
                  state.cachedSnapshot.hash = hash;
                  state.lastSnapshotHash = hash;
                  broadcast({ type: 'snapshot', hash, agentRunning: snapshot.agentRunning, timestamp: new Date().toISOString() });
                }
              }
            } catch (e) {
              console.debug('[BurstCapture] Error:', e.message);
            }
          };
          burstCapture(150);
          burstCapture(400);
          burstCapture(700);
        }
      }
    } catch (e) {
      log('Click', `Error: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });
}
