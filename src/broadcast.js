import { state } from './state.js';

export function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const ws of state.wsClients) {
    if (ws.readyState === 1) {
      ws.send(msg);
    }
  }
}

export function broadcastStatus() {
  broadcast({
    type: 'connection',
    cdpConnected: !!state.cdpClient,
  });
}
