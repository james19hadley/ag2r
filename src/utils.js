import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import selfsigned from 'selfsigned';
import { APP_PASSWORD, DEBUG_MODE } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function hashString(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

export function authToken() {
  return hashString(APP_PASSWORD + ':ag2r-salt');
}

export function log(prefix, ...args) {
  console.log(`[${prefix}]`, ...args);
}

export function ensureCerts() {
  // Certs directory is in the project root, which is one level up from src/
  const certDir = path.join(__dirname, '..', 'certs');
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

export function debugLog(source, event, detail = '') {
  if (!DEBUG_MODE) return;
  const ts = new Date().toISOString();
  console.log(`[${ts} ${source}] ${event}${detail ? ' ' + detail : ''}`);
}

