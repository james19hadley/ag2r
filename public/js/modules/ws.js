import { state } from './state.js';
import { loadSnapshot } from './snapshot.js';
import { updateConnectionStatus } from './misc.js';
import { updateActionButton } from './input.js';

let wsReconnectDelay = 1000;

export function connectWebSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${location.host}`;

  state.ws = new WebSocket(wsUrl);

  state.ws.onopen = () => {
    console.debug('[WS] Connected');
    wsReconnectDelay = 1000;
    updateConnectionStatus('connected');
  };

  state.ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case 'snapshot':
          // Only reload if content actually changed
          if (data.hash !== state.lastHash) {
            loadSnapshot();
          }
          if (data.agentRunning !== undefined) {
            state.agentRunning = data.agentRunning;
            updateActionButton();
            // Don't show quick actions on new session page (it has its own input)
            const isOnNewSession = !!document.getElementById('ag2r-new-session-input');
            const quickActions = document.getElementById('quick-actions');
            quickActions?.classList.toggle('hidden', state.agentRunning || isOnNewSession);
          }
          break;

        case 'status':
          if (data.agentRunning !== undefined) {
            state.agentRunning = data.agentRunning;
            updateActionButton();
            const isOnNewSession = !!document.getElementById('ag2r-new-session-input');
            const quickActions = document.getElementById('quick-actions');
            quickActions?.classList.toggle('hidden', state.agentRunning || isOnNewSession);
          }
          break;

        case 'connection':
          state.cdpConnected = data.cdpConnected;
          updateConnectionStatus(state.cdpConnected ? 'connected' : 'reconnecting');
          if (!state.cdpConnected) {
            const emptySub = document.querySelector('#empty-state .empty-subtitle');
            if (emptySub) emptySub.textContent = 'Waiting for Antigravity connection...';
          }
          break;

        case 'error':
          if (data.message === 'Unauthorized') {
            window.location.href = '/login.html';
          }
          break;

        case 'auth_url':
          if (data.googleUrl) {
            const authStatus = document.getElementById('auth-status');
            if (authStatus) {
              authStatus.textContent = 'Opening Google sign-in...';
              authStatus.className = 'auth-status info';
            }
            window.open(data.googleUrl, '_blank');
          }
          break;
      }
    } catch (e) {
      console.debug('[WS] Parse error:', e);
    }
  };

  state.ws.onclose = () => {
    console.debug('[WS] Disconnected, reconnecting in', wsReconnectDelay, 'ms');
    updateConnectionStatus('disconnected');
    state.ws = null;
    setTimeout(connectWebSocket, wsReconnectDelay);
    wsReconnectDelay = Math.min(wsReconnectDelay * 1.5, 10000);
  };

  state.ws.onerror = () => {
    // onclose will fire after this
  };
}
