import { state } from './state.js';
import { POLL_INTERVAL } from './config.js';
import { evaluateInBrowser, evaluateAcrossContexts } from './cdp.js';
import { CAPTURE_SCRIPT } from './cdp-scripts/capture.js';
import { RUNNING_TASKS_SCRIPT } from './cdp-scripts/running-tasks.js';
import { SCHEDULED_TASKS_SCRIPT } from './cdp-scripts/scheduled-tasks.js';
import { SCHEDULED_TASKS_DIALOG_SCRIPT } from './cdp-scripts/scheduled-tasks-dialog.js';
import { hashString } from './utils.js';
import { broadcast } from './broadcast.js';
import { checkAttentionState } from './routes-push.js';

export async function captureSnapshot() {
  try {
    let result = await evaluateInBrowser(CAPTURE_SCRIPT);
    if (!result) {
      result = { html: '', css: '', agentRunning: false, scrollInfo: null };
    }

    try {
      result.runningTasksHtml = await evaluateAcrossContexts(RUNNING_TASKS_SCRIPT);
    } catch (e) {
      console.debug('[Snapshot] Running tasks eval failed:', e.message);
    }

    try {
      result.scheduledTasksHtml = await evaluateAcrossContexts(SCHEDULED_TASKS_SCRIPT);
    } catch (e) {
      console.debug('[Snapshot] Scheduled tasks eval failed:', e.message);
    }

    if (result.scheduledTasksHtml) {
      try {
        result.scheduledTasksDialogHtml = await evaluateAcrossContexts(SCHEDULED_TASKS_DIALOG_SCRIPT);
      } catch (e) {
        console.debug('[Snapshot] Scheduled tasks dialog eval failed:', e.message);
      }

      if (!result.dropdownHtml) {
        try {
          result.dropdownHtml = await evaluateInBrowser(`
            (() => {
              for (const child of document.body.children) {
                if (child.getAttribute('role') === 'listbox' && child.getBoundingClientRect().width > 0) {
                  let idx = 0;
                  const tagged = [];
                  child.querySelectorAll('[role="option"], button, a').forEach(el => {
                    el.setAttribute('data-ag-click-id', 'scheddlg:' + (100 + idx));
                    el.setAttribute('data-ag-click-label', el.textContent.trim().substring(0, 50));
                    idx++;
                    tagged.push(el);
                  });
                  const clone = child.cloneNode(true);
                  tagged.forEach(el => {
                    el.removeAttribute('data-ag-click-id');
                    el.removeAttribute('data-ag-click-label');
                  });
                  return clone.outerHTML;
                }
              }
              return null;
            })()
          `);
        } catch (e) {
          console.debug('[Snapshot] Scheduled tasks dropdown eval failed:', e.message);
        }
      }
    }

    return result;
  } catch (e) {
    console.debug('[Snapshot] Capture failed:', e.message);
    return null;
  }
}

let errorLogThrottle = 0;

export function startPolling() {
  if (state.pollTimer) return;

  async function poll() {
    if (!state.cdpClient) {
      state.pollTimer = setTimeout(poll, POLL_INTERVAL);
      return;
    }

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
          (snapshot.runningTasksHtml || '') +
          (snapshot.scheduledTasksHtml || '') +
          (snapshot.scheduledTasksDialogHtml || '')
        );

        if (hash !== state.lastSnapshotHash) {
          state.cachedSnapshot = snapshot;
          state.cachedSnapshot.hash = hash;
          state.lastSnapshotHash = hash;
          broadcast({
            type: 'snapshot',
            hash,
            agentRunning: snapshot.agentRunning,
            timestamp: new Date().toISOString(),
          });
        } else if (snapshot.agentRunning !== state.cachedSnapshot?.agentRunning) {
          state.cachedSnapshot.agentRunning = snapshot.agentRunning;
          broadcast({
            type: 'status',
            agentRunning: snapshot.agentRunning,
          });
        }

        checkAttentionState(snapshot);

        errorLogThrottle = 0;
      }
    } catch (e) {
      const now = Date.now();
      if (now - errorLogThrottle > 10000) {
        console.debug('[Poll] Error:', e.message);
        errorLogThrottle = now;
      }
    }

    state.pollTimer = setTimeout(poll, POLL_INTERVAL);
  }

  poll();
}

export function stopPolling() {
  if (state.pollTimer) {
    clearTimeout(state.pollTimer);
    state.pollTimer = null;
  }
}
