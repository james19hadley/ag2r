// server.js — AG2R Server
// CDP connection, snapshot capture, WebSocket broadcasting, Express, auth
import express from 'express';
import { createServer as createHttpsServer } from 'https';
import { createServer as createHttpServer } from 'http';
import { WebSocketServer } from 'ws';
import CDP from 'chrome-remote-interface';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import selfsigned from 'selfsigned';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// === Configuration (SSoT: .env.example) ===
const PORT = parseInt(process.env.PORT || '3000');
const CDP_HOST = process.env.CDP_HOST || '127.0.0.1';
const CDP_PORT = parseInt(process.env.CDP_PORT || '9000');
const APP_PASSWORD = process.env.APP_PASSWORD || 'antigravity';
const SESSION_SECRET = process.env.SESSION_SECRET || 'ag2r-default-secret';
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_MS || '500');
const TUNNEL_ENABLED = process.env.TUNNEL_ENABLED === 'true';
const TUNNEL_URL = process.env.TUNNEL_URL || '';

// === Mutable State ===
let cdpClient = null;
let cdpContexts = [];
let preferredContextId = null;
let cachedSnapshot = null;
let lastSnapshotHash = null;
let pollTimer = null;
let reconnectTimer = null;
const wsClients = new Set();

// ─────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────

function hashString(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

function authToken() {
  return hashString(APP_PASSWORD + ':ag2r-salt');
}

function isLocalRequest(req) {
  // Local network requests bypass auth (no proxy headers)
  if (req.headers['x-forwarded-for'] || req.headers['cf-connecting-ip']) {
    return false;
  }
  const ip = req.ip || req.connection?.remoteAddress || '';
  return /^(127\.|::1|::ffff:127\.|localhost|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
}

function log(prefix, ...args) {
  console.log(`[${prefix}]`, ...args);
}

// ─────────────────────────────────────────────
// SSL Certificate Generation
// ─────────────────────────────────────────────

function ensureCerts() {
  const certDir = path.join(__dirname, 'certs');
  const keyPath = path.join(certDir, 'server.key');
  const certPath = path.join(certDir, 'server.cert');

  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
  }

  log('SSL', 'Generating self-signed certificate...');
  fs.mkdirSync(certDir, { recursive: true });

  const pems = selfsigned.generate(
    [{ name: 'commonName', value: 'localhost' }],
    {
      days: 365,
      keySize: 2048,
      algorithm: 'sha256',
      extensions: [
        { name: 'subjectAltName', altNames: [
          { type: 2, value: 'localhost' },
          { type: 7, ip: '127.0.0.1' },
        ]},
      ],
    }
  );

  fs.writeFileSync(keyPath, pems.private);
  fs.writeFileSync(certPath, pems.cert);
  log('SSL', 'Certificate saved to certs/');

  return { key: pems.private, cert: pems.cert };
}

// ─────────────────────────────────────────────
// CDP Connection
// ─────────────────────────────────────────────

async function discoverTarget() {
  const ports = [CDP_PORT, CDP_PORT + 1, CDP_PORT + 2, CDP_PORT + 3];

  for (const port of ports) {
    try {
      const targets = await CDP.List({ host: CDP_HOST, port });
      if (!targets || targets.length === 0) continue;

      // Priority 1: Workbench target
      const workbench = targets.find(t =>
        t.url?.includes('workbench.html') || t.title?.includes('workbench')
      );
      if (workbench) return { port, target: workbench };

      // Priority 2: Jetski/Launchpad target
      const jetski = targets.find(t =>
        t.url?.includes('jetski') || t.title === 'Launchpad'
      );
      if (jetski) return { port, target: jetski };

      // Priority 3: Any page target (AG2.0 fallback)
      const page = targets.find(t => t.type === 'page');
      if (page) return { port, target: page };
    } catch {
      // Port not available, try next
    }
  }
  return null;
}

async function connectCDP() {
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

  // Track execution contexts
  cdpContexts = [];
  preferredContextId = null;

  client.Runtime.executionContextCreated(({ context }) => {
    cdpContexts.push(context);
    console.debug('[CDP] Context created:', context.id, context.origin);
  });

  client.Runtime.executionContextDestroyed(({ executionContextId }) => {
    cdpContexts = cdpContexts.filter(c => c.id !== executionContextId);
    if (preferredContextId === executionContextId) {
      preferredContextId = null;
    }
  });

  client.Runtime.executionContextsCleared(() => {
    cdpContexts = [];
    preferredContextId = null;
  });

  await client.Runtime.enable();

  // Wait briefly for context events to arrive
  await new Promise(r => setTimeout(r, 500));

  client.on('disconnect', () => {
    log('CDP', 'Disconnected');
    cdpClient = null;
    cdpContexts = [];
    preferredContextId = null;
    broadcastStatus();
    scheduleReconnect();
  });

  cdpClient = client;
  log('CDP', `Connected. ${cdpContexts.length} execution context(s) available.`);
  broadcastStatus();
  return client;
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    try {
      await connectCDP();
      log('CDP', 'Reconnected successfully');
    } catch (e) {
      console.debug('[CDP] Reconnect failed:', e.message);
      scheduleReconnect();
    }
  }, 3000);
}

// Evaluate JS in the browser, trying contexts in priority order
// Locks to a preferred context to avoid hash oscillation between contexts
async function evaluateInBrowser(expression, opts = {}) {
  if (!cdpClient) throw new Error('CDP not connected');

  const sorted = [...cdpContexts].sort((a, b) => {
    if (a.id === preferredContextId) return -1;
    if (b.id === preferredContextId) return 1;
    const aDefault = a.auxData?.isDefault ? 1 : 0;
    const bDefault = b.auxData?.isDefault ? 1 : 0;
    return bDefault - aDefault;
  });

  for (const ctx of sorted) {
    try {
      const result = await cdpClient.Runtime.evaluate({
        expression,
        contextId: ctx.id,
        awaitPromise: true,
        returnByValue: true,
        ...opts,
      });

      if (result.exceptionDetails) {
        console.debug('[CDP] Eval exception in context', ctx.id, result.exceptionDetails.text);
        continue;
      }

      // Lock to this context on success
      preferredContextId = ctx.id;
      return result.result?.value ?? null;
    } catch (e) {
      console.debug('[CDP] Eval failed in context', ctx.id, e.message);
      continue;
    }
  }

  throw new Error('No valid execution context');
}

// ─────────────────────────────────────────────
// Snapshot Capture
// ─────────────────────────────────────────────

// The capture script runs IN the Antigravity browser context.
// Pattern: mark → clone → unmark original → process clone → return
const CAPTURE_SCRIPT = `
(async () => {
  // 1. Find the chat container
  const container =
    document.querySelector('.scrollbar-hide[class*="overflow-y-auto"]') ||
    document.querySelector('[data-testid="conversation-view"]') ||
    document.getElementById('conversation') ||
    document.getElementById('chat') ||
    document.getElementById('cascade');

  if (!container) return null;

  // 2. Detect if agent is generating (stop button visible)
  const stopBtn =
    document.querySelector('[data-tooltip-id="input-send-button-cancel-tooltip"]') ||
    document.querySelector('button svg.lucide-square')?.closest('button');
  const agentRunning = !!(stopBtn && stopBtn.offsetParent !== null);

  // 3. Scroll info
  const scrollInfo = {
    scrollTop: container.scrollTop,
    scrollHeight: container.scrollHeight,
    clientHeight: container.clientHeight,
  };

  // 4. Mark special positioned elements on the ORIGINAL dom
  const marked = [];
  container.querySelectorAll('*').forEach(el => {
    try {
      const cs = getComputedStyle(el);
      if (cs.position === 'fixed' || cs.position === 'absolute') {
        el.setAttribute('data-ag-remove', '1');
        marked.push(el);
      }
      if (cs.position === 'sticky') {
        el.setAttribute('data-ag-sticky', '1');
        marked.push(el);
      }
    } catch {}
  });

  // 5. Deep clone
  const clone = container.cloneNode(true);

  // 6. Unmark original DOM immediately
  marked.forEach(el => {
    el.removeAttribute('data-ag-remove');
    el.removeAttribute('data-ag-sticky');
  });

  // 7. Clean the clone — remove editor/input area
  const editorSels = [
    '[contenteditable="true"]',
    '[data-lexical-editor]',
    '[role="textbox"]',
    'form',
  ];
  editorSels.forEach(sel => {
    clone.querySelectorAll(sel).forEach(el => {
      // Walk up to a direct child of clone and remove
      let target = el;
      while (target.parentElement && target.parentElement !== clone) {
        // Protect action bars (Allow/Deny/Review buttons)
        const hasActionBtn = target.parentElement.querySelector(
          'button, [role="button"]'
        );
        const actionText = hasActionBtn?.textContent?.trim() || '';
        if (/^(Allow|Deny|Review|Run|Confirm|Accept|Reject)/i.test(actionText)) {
          // Don't walk up past action bars
          break;
        }
        target = target.parentElement;
      }
      if (target.parentElement === clone) {
        target.remove();
      } else {
        el.remove();
      }
    });
  });

  // 8. Remove fixed/absolute overlays (but protect action bars)
  clone.querySelectorAll('[data-ag-remove]').forEach(el => {
    const btns = el.querySelectorAll('button, [role="button"]');
    let isActionBar = false;
    btns.forEach(b => {
      if (/^(Allow|Deny|Review|Run|Confirm)/i.test(b.textContent?.trim())) {
        isActionBar = true;
      }
    });
    if (!isActionBar) el.remove();
    else el.removeAttribute('data-ag-remove');
  });

  // 9. Force solid backgrounds on sticky elements
  clone.querySelectorAll('[data-ag-sticky]').forEach(el => {
    el.style.backgroundColor = '#0f172a';
  });

  // 10. Fix inline div-inside-span/p (AG nests block inside inline)
  clone.querySelectorAll('span > div, p > div').forEach(div => {
    const span = document.createElement('span');
    span.innerHTML = div.innerHTML;
    span.style.display = 'inline-flex';
    span.style.alignItems = 'center';
    for (const attr of div.attributes) {
      if (attr.name !== 'style') span.setAttribute(attr.name, attr.value);
    }
    div.replaceWith(span);
  });

  // 11. Force paragraph display block (AG2.0 uses flex on .animate-markdown)
  clone.querySelectorAll('p').forEach(p => {
    p.style.display = 'block';
  });

  // 12. Get HTML and strip broken [object Object] class names (streaming bug)
  let html = clone.innerHTML;
  html = html.replace(/class="([^"]*)"/g, (match, classes) => {
    if (!classes.includes('[object Object]')) return match;
    const cleaned = classes.replace(/\\[object Object\\]/g, '').replace(/\\s+/g, ' ').trim();
    return 'class="' + cleaned + '"';
  });

  // 13. Collect CSS from all accessible stylesheets
  let css = '';
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) {
        css += rule.cssText + '\\n';
      }
    } catch {}
  }

  // 14. Capture container's own computed styles (lost when we take innerHTML)
  const containerStyles = window.getComputedStyle(container);
  const containerCSS = {
    paddingBottom: containerStyles.paddingBottom,
    paddingTop: containerStyles.paddingTop,
    gap: containerStyles.gap,
  };

  return { html, css, agentRunning, scrollInfo, containerCSS };
})()
`;

async function captureSnapshot() {
  try {
    const result = await evaluateInBrowser(CAPTURE_SCRIPT);
    if (!result) return null;
    return result;
  } catch (e) {
    console.debug('[Snapshot] Capture failed:', e.message);
    return null;
  }
}

// ─────────────────────────────────────────────
// Message Injection (via CDP into Lexical editor)
// ─────────────────────────────────────────────

function buildInjectScript(text) {
  // JSON.stringify safely escapes quotes, newlines, backticks, unicode
  const safeText = JSON.stringify(text);

  return `
(async () => {
  // Find the editor (Lexical or generic contenteditable)
  const editorCandidates = document.querySelectorAll(
    '[data-lexical-editor="true"], [contenteditable="true"][role="textbox"], [contenteditable="true"]'
  );

  // Filter to visible editors, take the last one (usually the input at bottom)
  let editor = null;
  for (const el of editorCandidates) {
    if (el.offsetParent !== null) editor = el;
  }
  if (!editor) return { ok: false, reason: 'no_editor' };

  // Focus and clear
  editor.focus();
  document.execCommand('selectAll', false, null);
  document.execCommand('delete', false, null);

  // Insert text
  const inserted = document.execCommand('insertText', false, ${safeText});
  if (!inserted) {
    // Fallback: direct textContent + synthetic events
    editor.textContent = ${safeText};
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${safeText} }));
    editor.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Brief delay for editor to process
  await new Promise(r => setTimeout(r, 100));

  // Find and click submit button
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

  // Fallback: look for arrow icon button near the editor
  if (!submitBtn) {
    const arrow = document.querySelector('svg.lucide-arrow-right, svg.lucide-arrow-up');
    if (arrow) submitBtn = arrow.closest('button');
  }

  // Fallback: form submit or sibling button
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

  // Last resort: dispatch Enter key
  const enterEvent = new KeyboardEvent('keydown', {
    key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true,
  });
  editor.dispatchEvent(enterEvent);
  return { ok: true, method: 'enter' };
})()
`;
}

async function injectMessage(text) {
  const script = buildInjectScript(text);
  return await evaluateInBrowser(script);
}

// ─────────────────────────────────────────────
// Stop Generation (via CDP)
// ─────────────────────────────────────────────

const STOP_SCRIPT = `
(async () => {
  // Primary: tooltip-based cancel button
  const cancelBtn = document.querySelector('[data-tooltip-id="input-send-button-cancel-tooltip"]');
  if (cancelBtn && cancelBtn.offsetParent !== null) {
    cancelBtn.click();
    return { ok: true, method: 'cancel-tooltip' };
  }

  // Fallback: square stop icon
  const squareIcon = document.querySelector('button svg.lucide-square');
  if (squareIcon) {
    const btn = squareIcon.closest('button');
    if (btn && btn.offsetParent !== null) {
      btn.click();
      return { ok: true, method: 'square-icon' };
    }
  }

  return { ok: false, reason: 'no_stop_button' };
})()
`;

async function stopGeneration() {
  return await evaluateInBrowser(STOP_SCRIPT);
}

// ─────────────────────────────────────────────
// Polling Loop
// ─────────────────────────────────────────────

let errorLogThrottle = 0;

function startPolling() {
  if (pollTimer) return;

  async function poll() {
    if (!cdpClient) {
      pollTimer = setTimeout(poll, POLL_INTERVAL);
      return;
    }

    try {
      const snapshot = await captureSnapshot();

      if (snapshot) {
        const hash = hashString(snapshot.html);

        // Only broadcast and update cache when content actually changes
        if (hash !== lastSnapshotHash) {
          cachedSnapshot = snapshot;
          cachedSnapshot.hash = hash;
          lastSnapshotHash = hash;
          broadcast({
            type: 'snapshot',
            hash,
            agentRunning: snapshot.agentRunning,
            timestamp: new Date().toISOString(),
          });
        } else if (snapshot.agentRunning !== cachedSnapshot?.agentRunning) {
          // Agent status changed but content didn't — still notify
          cachedSnapshot.agentRunning = snapshot.agentRunning;
          broadcast({
            type: 'status',
            agentRunning: snapshot.agentRunning,
          });
        }

        errorLogThrottle = 0;
      }
      // null snapshot = no chat container found. Keep displaying last known content.
      // Never wipe cached content on selector failure.
    } catch (e) {
      const now = Date.now();
      if (now - errorLogThrottle > 10000) {
        console.debug('[Poll] Error:', e.message);
        errorLogThrottle = now;
      }
    }

    pollTimer = setTimeout(poll, POLL_INTERVAL);
  }

  poll();
}

function stopPolling() {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

// ─────────────────────────────────────────────
// WebSocket Broadcasting
// ─────────────────────────────────────────────

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const ws of wsClients) {
    if (ws.readyState === 1) {
      ws.send(msg);
    }
  }
}

function broadcastStatus() {
  broadcast({
    type: 'connection',
    cdpConnected: !!cdpClient,
  });
}

// ─────────────────────────────────────────────
// Express App
// ─────────────────────────────────────────────

const app = express();
app.use(compression());
app.use(express.json());
app.use(cookieParser(SESSION_SECRET));

// Trust proxy for Cloudflare Tunnel
if (TUNNEL_ENABLED) {
  app.set('trust proxy', true);
}

// --- Auth Middleware ---
const PUBLIC_PATHS = ['/login', '/login.html', '/favicon.ico'];

app.use((req, res, next) => {
  // Public paths bypass auth
  if (PUBLIC_PATHS.some(p => req.path === p) || req.path.startsWith('/css/')) {
    return next();
  }

  // Magic link: ?key=password auto-logs in
  if (req.query.key === APP_PASSWORD) {
    res.cookie('ag2r_token', authToken(), {
      signed: true,
      httpOnly: true,
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      sameSite: 'lax',
    });
    // Redirect to strip the key from URL
    const cleanUrl = req.path;
    return res.redirect(cleanUrl);
  }

  // Local network requests bypass auth
  if (isLocalRequest(req)) return next();

  // Check auth cookie
  const token = req.signedCookies?.ag2r_token;
  if (token === authToken()) return next();

  // Unauthorized
  if (req.headers.accept?.includes('text/html')) {
    return res.redirect('/login.html');
  }
  return res.status(401).json({ error: 'Unauthorized' });
});

// --- Static Files (no cache during development) ---
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  },
}));

// --- Catch-all for AG2.0 local asset paths (symbols-icons, etc.) ---
const EMPTY_SVG = '<svg xmlns="http://www.w3.org/2000/svg"/>';
app.get('/symbols-icons/*', (req, res) => {
  res.type('svg').send(EMPTY_SVG);
});

// --- Auth Endpoints ---
app.post('/login', (req, res) => {
  const { password } = req.body;
  if (password !== APP_PASSWORD) {
    return res.status(401).json({ error: 'Invalid password' });
  }

  res.cookie('ag2r_token', authToken(), {
    signed: true,
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60 * 1000,
    sameSite: 'lax',
  });

  res.json({ ok: true });
});

app.post('/logout', (req, res) => {
  res.clearCookie('ag2r_token');
  res.json({ ok: true });
});

// --- Snapshot Endpoint ---
app.get('/snapshot', (req, res) => {
  if (!cachedSnapshot) {
    return res.status(503).json({ error: 'No snapshot available' });
  }

  res.json({
    html: cachedSnapshot.html,
    css: cachedSnapshot.css,
    hash: cachedSnapshot.hash,
    agentRunning: cachedSnapshot.agentRunning,
    scrollInfo: cachedSnapshot.scrollInfo,
  });
});

// --- Send Message ---
let lastSentMessage = { text: '', time: 0 };

app.post('/send', async (req, res) => {
  const { message } = req.body;
  log('Send', `Received: "${message?.substring(0, 50)}"`);

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Message is required' });
  }

  if (!cdpClient) {
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
    log('Send', 'Injecting via CDP...');
    const result = await injectMessage(message);
    log('Send', `Injection result: ${JSON.stringify(result)}`);
    res.json(result || { ok: true });
  } catch (e) {
    log('Send', `Injection error: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

// --- Stop Generation ---
app.post('/stop', async (req, res) => {
  if (!cdpClient) {
    return res.status(503).json({ error: 'CDP not connected' });
  }

  try {
    const result = await stopGeneration();
    res.json(result || { ok: false });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Health ---
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    cdpConnected: !!cdpClient,
    snapshotAvailable: !!cachedSnapshot,
    wsClients: wsClients.size,
  });
});

// ─────────────────────────────────────────────
// Server Startup
// ─────────────────────────────────────────────

async function start() {
  // Generate/load SSL certs
  const sslOpts = ensureCerts();

  // Create HTTPS server
  const server = createHttpsServer(sslOpts, app);

  // WebSocket server on the same HTTPS server
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws, req) => {
    // Authenticate WebSocket connections
    if (!isLocalWsRequest(req)) {
      const cookies = parseCookiesFromHeader(req.headers.cookie || '');
      const signed = cookieParser.signedCookie(cookies.ag2r_token || '', SESSION_SECRET);
      if (signed !== authToken()) {
        ws.send(JSON.stringify({ type: 'error', message: 'Unauthorized' }));
        setTimeout(() => ws.close(), 100);
        return;
      }
    }

    wsClients.add(ws);
    log('WS', `Client connected (${wsClients.size} total)`);

    // Send current state immediately
    ws.send(JSON.stringify({
      type: 'connection',
      cdpConnected: !!cdpClient,
    }));

    if (cachedSnapshot) {
      ws.send(JSON.stringify({
        type: 'snapshot',
        hash: cachedSnapshot.hash,
        agentRunning: cachedSnapshot.agentRunning,
        timestamp: new Date().toISOString(),
      }));
    }

    ws.on('close', () => {
      wsClients.delete(ws);
      log('WS', `Client disconnected (${wsClients.size} total)`);
    });

    ws.on('error', () => {
      wsClients.delete(ws);
    });
  });

  // Start listening
  server.listen(PORT, () => {
    log('Server', `AG2R running on https://localhost:${PORT}`);
    if (TUNNEL_ENABLED && TUNNEL_URL) {
      log('Server', `Tunnel URL: ${TUNNEL_URL}`);
    }
  });

  // Connect to CDP
  try {
    await connectCDP();
  } catch (e) {
    log('CDP', `Initial connection failed: ${e.message}`);
    log('CDP', 'Will retry every 3 seconds...');
    scheduleReconnect();
  }

  // Start polling
  startPolling();

  // Graceful shutdown
  const shutdown = () => {
    log('Server', 'Shutting down...');
    stopPolling();
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (cdpClient) cdpClient.close();
    for (const ws of wsClients) ws.close();
    wss.close();
    server.close(() => process.exit(0));
    // Force exit after 3s
    setTimeout(() => process.exit(1), 3000);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// ─────────────────────────────────────────────
// WebSocket Auth Helpers
// ─────────────────────────────────────────────

function isLocalWsRequest(req) {
  if (req.headers['x-forwarded-for'] || req.headers['cf-connecting-ip']) {
    return false;
  }
  const ip = req.socket?.remoteAddress || '';
  return /^(127\.|::1|::ffff:127\.|localhost|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
}

function parseCookiesFromHeader(header) {
  const cookies = {};
  header.split(';').forEach(pair => {
    const [name, ...rest] = pair.trim().split('=');
    if (name) cookies[name.trim()] = decodeURIComponent(rest.join('='));
  });
  return cookies;
}

// ─────────────────────────────────────────────
// Go
// ─────────────────────────────────────────────

start().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
