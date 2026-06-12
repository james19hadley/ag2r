export const state = {
  cdpClient: null,
  cdpContexts: [],
  preferredContextId: null,
  cachedSnapshot: null,
  lastSnapshotHash: null,
  pollTimer: null,
  reconnectTimer: null,
  wsClients: new Set(),
  pendingAuthUrl: null,
};
