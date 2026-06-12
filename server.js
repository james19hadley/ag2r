// server.js — AG2R Server
import express from 'express';
import { createServer as createHttpsServer } from 'https';
import { createServer as createHttpServer } from 'http';
import { WebSocketServer } from 'ws';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  PORT,
  SESSION_SECRET,
  AUTH_ENABLED,
  TUNNEL_ENABLED,
  TUNNEL_URL,
  HTTP_ONLY
} from './src/config.js';
import { state } from './src/state.js';
import { log, ensureCerts, authToken } from './src/utils.js';
import { connectCDP, scheduleReconnect } from './src/cdp.js';
import { startPolling, stopPolling } from './src/snapshot.js';
import { broadcast, broadcastStatus } from './src/broadcast.js';
import { authMiddleware, registerAuthRoutes } from './src/auth.js';
import { registerApiRoutes } from './src/routes-api.js';
import { registerClickRoute } from './src/route-click.js';
import { registerSendRoute } from './src/route-send.js';
import { registerMiscRoutes } from './src/routes-misc.js';
import { track, startSession, endSession } from './src/telemetry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(compression());
app.use(express.json());
app.use(cookieParser(SESSION_SECRET));

// --- Centralized API Error Tracking ---
app.use((req, res, next) => {
  const _json = res.json.bind(res);
  res.json = function (body) {
    if (res.statusCode >= 500) {
      track('api_error', { endpoint: req.path, status: res.statusCode });
    }
    return _json(body);
  };
  next();
});

if (TUNNEL_ENABLED) {
  app.set('trust proxy', true);
}

// Mount Auth Middleware
app.use(authMiddleware);

// Static files (no cache in dev)
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  },
}));

// Fallback for symbols/icons
const EMPTY_SVG = '<svg xmlns="http://www.w3.org/2000/svg"/>';
app.get('/symbols-icons/*', (req, res) => {
  res.type('svg').send(EMPTY_SVG);
});

// Register routes
registerAuthRoutes(app);
registerApiRoutes(app);
registerClickRoute(app);
registerSendRoute(app);
registerMiscRoutes(app);

async function start() {
  let server;
  if (HTTP_ONLY) {
    server = createHttpServer(app);
    log('Server', 'Running in HTTP only mode');
  } else {
    const sslOpts = ensureCerts();
    server = createHttpsServer(sslOpts, app);
  }
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws, req) => {
    if (AUTH_ENABLED) {
      const cookies = parseCookiesFromHeader(req.headers.cookie || '');
      const signed = cookieParser.signedCookie(cookies.ag2r_token || '', SESSION_SECRET);
      if (signed !== authToken()) {
        ws.send(JSON.stringify({ type: 'error', message: 'Unauthorized' }));
        setTimeout(() => ws.close(), 100);
        return;
      }
    }

    state.wsClients.add(ws);
    log('WS', `Client connected (${state.wsClients.size} total)`);

    ws.send(JSON.stringify({
      type: 'connection',
      cdpConnected: !!state.cdpClient,
    }));

    if (state.cachedSnapshot) {
      ws.send(JSON.stringify({
        type: 'snapshot',
        hash: state.cachedSnapshot.hash,
        agentRunning: state.cachedSnapshot.agentRunning,
        timestamp: new Date().toISOString(),
      }));
    }

    ws.on('close', () => {
      state.wsClients.delete(ws);
      log('WS', `Client disconnected (${state.wsClients.size} total)`);
    });

    ws.on('error', () => {
      state.wsClients.delete(ws);
    });
  });

  server.listen(PORT, () => {
    log('Server', `AG2R running on https://localhost:${PORT}`);
    if (TUNNEL_ENABLED && TUNNEL_URL) {
      log('Server', `Tunnel URL: ${TUNNEL_URL}`);
    }
    startSession();
  });

  try {
    await connectCDP();
  } catch (e) {
    log('CDP', `Initial connection failed: ${e.message}`);
    log('CDP', 'Will retry every 3 seconds...');
    scheduleReconnect();
  }

  startPolling();

  const shutdown = () => {
    log('Server', 'Shutting down...');
    endSession();
    stopPolling();
    if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
    if (state.cdpClient) state.cdpClient.close();
    for (const ws of state.wsClients) ws.close();
    wss.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 3000);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function parseCookiesFromHeader(header) {
  const cookies = {};
  header.split(';').forEach(pair => {
    const [name, ...rest] = pair.trim().split('=');
    if (name) cookies[name.trim()] = decodeURIComponent(rest.join('='));
  });
  return cookies;
}

start().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
