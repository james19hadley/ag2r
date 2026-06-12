import CDP from 'chrome-remote-interface';
import { state } from './state.js';
import { CDP_HOST, CDP_PORT } from './config.js';
import { log } from './utils.js';
import { broadcast, broadcastStatus } from './broadcast.js';
import { track } from './telemetry.js';

export async function discoverTarget() {
  const ports = [CDP_PORT, CDP_PORT + 1, CDP_PORT + 2, CDP_PORT + 3];

  for (const port of ports) {
    try {
      const targets = await CDP.List({ host: CDP_HOST, port });
      if (!targets || targets.length === 0) continue;

      const workbench = targets.find(t =>
        t.url?.includes('workbench.html') || t.title?.includes('workbench')
      );
      if (workbench) return { port, target: workbench };

      const jetski = targets.find(t =>
        t.url?.includes('jetski') || t.title === 'Launchpad'
      );
      if (jetski) return { port, target: jetski };

      const page = targets.find(t => t.type === 'page');
      if (page) return { port, target: page };
    } catch {
      // Port not available, try next
    }
  }
  return null;
}

export async function connectCDP() {
  const discovery = await discoverTarget();
  if (!discovery) {
    throw new Error(`No CDP target found on ${CDP_HOST}:${CDP_PORT}`);
  }

  log('CDP', `Connecting to "${discovery.target.title}" on port ${discovery.port}`);

  const client = await CDP({
    host: CDP_HOST,
    port: discovery.port,
    target: discovery.target,
  });

  state.cdpContexts = [];
  state.preferredContextId = null;

  client.Runtime.executionContextCreated(({ context }) => {
    state.cdpContexts.push(context);
    console.debug('[CDP] Context created:', context.id, context.origin);
  });

  client.Runtime.executionContextDestroyed(({ executionContextId }) => {
    state.cdpContexts = state.cdpContexts.filter(c => c.id !== executionContextId);
    if (state.preferredContextId === executionContextId) {
      state.preferredContextId = null;
    }
  });

  client.Runtime.executionContextsCleared(() => {
    state.cdpContexts = [];
    state.preferredContextId = null;
  });

  await client.Runtime.enable();
  await new Promise(r => setTimeout(r, 500));

  client.on('disconnect', () => {
    log('CDP', 'Disconnected');
    track('cdp_disconnected');
    state.cdpClient = null;
    state.cdpContexts = [];
    state.preferredContextId = null;
    broadcastStatus();
    scheduleReconnect();
  });

  state.cdpClient = client;

  try { await client.Emulation.setFocusEmulationEnabled({ enabled: true }); } catch {}

  try {
    await client.Page.enable();
    client.Page.windowOpen(({ url }) => {
      if (url && (url.includes('accounts.google.com') || url.includes('google.com/o/oauth2'))) {
        log('Auth', `Google OAuth URL intercepted: ${url.substring(0, 100)}`);
        state.pendingAuthUrl = url;
        broadcast({ type: 'auth_url', googleUrl: url });
      }
    });
  } catch (e) {
    console.debug('[CDP] Page.windowOpen subscription failed:', e.message);
  }

  log('CDP', `Connected. ${state.cdpContexts.length} execution context(s) available.`);
  broadcastStatus();
  return client;
}

export function scheduleReconnect() {
  if (state.reconnectTimer) return;
  state.reconnectTimer = setTimeout(async () => {
    state.reconnectTimer = null;
    try {
      await connectCDP();
      log('CDP', 'Reconnected successfully');
      track('cdp_reconnected');
    } catch (e) {
      console.debug('[CDP] Reconnect failed:', e.message);
      scheduleReconnect();
    }
  }, 3000);
}

export async function evaluateInBrowser(expression, opts = {}) {
  if (!state.cdpClient) throw new Error('CDP not connected');

  const sorted = [...state.cdpContexts].sort((a, b) => {
    if (a.id === state.preferredContextId) return -1;
    if (b.id === state.preferredContextId) return 1;
    const aDefault = a.auxData?.isDefault ? 1 : 0;
    const bDefault = b.auxData?.isDefault ? 1 : 0;
    return bDefault - aDefault;
  });

  for (const ctx of sorted) {
    try {
      const result = await state.cdpClient.Runtime.evaluate({
        expression,
        contextId: ctx.id,
        awaitPromise: true,
        returnByValue: true,
        ...opts,
      });

      if (result.exceptionDetails) {
        console.debug('[CDP] Eval exception in context', ctx.id, result.exceptionDetails.text, JSON.stringify(result.exceptionDetails.exception || {}).substring(0, 200));
        continue;
      }

      state.preferredContextId = ctx.id;
      return result.result?.value ?? null;
    } catch (e) {
      console.debug('[CDP] Eval failed in context', ctx.id, e.message);
      if (
        e.message && (
          e.message.includes('Promise was collected') ||
          e.message.includes('Execution context was destroyed') ||
          e.message.includes('Execution context was cleared')
        )
      ) {
        log('CDP', `Context ${ctx.id} was destroyed/collected during evaluation. Assuming action succeeded.`);
        return { ok: true, method: 'destroyed' };
      }
      continue;
    }
  }

  throw new Error('No valid execution context');
}

export async function evaluateAcrossContexts(expression, opts = {}) {
  if (!state.cdpClient) throw new Error('CDP not connected');

  for (const ctx of state.cdpContexts) {
    try {
      const result = await state.cdpClient.Runtime.evaluate({
        expression,
        contextId: ctx.id,
        awaitPromise: true,
        returnByValue: true,
        ...opts,
      });

      if (result.exceptionDetails) continue;

      const val = result.result?.value ?? null;
      if (val !== null) return val;
    } catch (e) {
      console.debug('[CDP] Eval across contexts failed in context', ctx.id, e.message);
      if (
        e.message && (
          e.message.includes('Promise was collected') ||
          e.message.includes('Execution context was destroyed') ||
          e.message.includes('Execution context was cleared')
        )
      ) {
        log('CDP', `Context ${ctx.id} was destroyed/collected during evaluation across contexts. Assuming action succeeded.`);
        return { ok: true, method: 'destroyed' };
      }
      continue;
    }
  }

  return null;
}
