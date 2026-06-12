import fs from 'fs';
import cookieParser from 'cookie-parser';
import { state } from './state.js';
import { APP_PASSWORD, SESSION_SECRET, AUTH_ENABLED } from './config.js';
import { authToken, log } from './utils.js';
import { broadcast } from './broadcast.js';
import { evaluateInBrowser } from './cdp.js';
import { track } from './telemetry.js';

const PUBLIC_PATHS = ['/login', '/login.html', '/favicon.ico', '/internal/auth-url', '/health'];

export function authMiddleware(req, res, next) {
  if (!AUTH_ENABLED) return next();

  if (PUBLIC_PATHS.some(p => req.path === p) || req.path.startsWith('/css/')) {
    return next();
  }

  if (req.query.key === APP_PASSWORD) {
    res.cookie('ag2r_token', authToken(), {
      signed: true,
      httpOnly: true,
      maxAge: 30 * 24 * 60 * 60 * 1000,
      sameSite: 'lax',
    });
    return res.redirect(req.path);
  }

  const token = req.signedCookies?.ag2r_token;
  if (token === authToken()) return next();

  if (req.headers.accept?.includes('text/html')) {
    return res.redirect('/login.html');
  }
  return res.status(401).json({ error: 'Unauthorized' });
}

export function registerAuthRoutes(app) {
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

    track('login');
    res.json({ ok: true });
  });

  app.post('/logout', (req, res) => {
    res.clearCookie('ag2r_token');
    res.json({ ok: true });
  });

  app.post('/auth/signin', async (req, res) => {
    try {
      if (!state.cdpClient) return res.status(503).json({ ok: false, error: 'CDP not connected' });

      state.pendingAuthUrl = null;

      let pageState = await evaluateInBrowser(`
        (() => {
          const bodyText = (document.body?.innerText || '').trim();
          const btns = [...document.querySelectorAll('button')];
          return {
            isAuthPage:    bodyText.includes('Authentication Required'),
            isAwaiting:    bodyText.includes('Awaiting Authentication'),
            isErrorPage:   bodyText.includes('unexpected issue setting up your account') || bodyText.includes('context deadline exceeded'),
            isOnboarding:  window.location.href.includes('onboarding') || bodyText.includes('Security Notice') || bodyText.includes('Select Antigravity Theme') || bodyText.includes('Build with Google'),
            hasSignIn:     !!btns.find(b => b.textContent.trim() === 'Sign In'),
            hasGoogle:     !!btns.find(b => b.textContent.trim() === 'Continue with Google' && !b.disabled),
            hasPrevious:   !!btns.find(b => b.textContent.trim() === 'Previous'),
            hasNext:       !!btns.find(b => b.textContent.trim() === 'Next' && !b.disabled),
            hasFinish:     !!btns.find(b => b.textContent.trim() === 'Finish' && !b.disabled),
            bodySnippet:   bodyText.substring(0, 80),
          };
        })()
      `);

      log('Auth', 'Page state: ' + JSON.stringify(pageState));

      // Auto-click through onboarding pages if present
      let attempts = 0;
      while (pageState?.isOnboarding && (pageState?.hasNext || pageState?.hasFinish) && attempts < 5) {
        log('Auth', `Onboarding page detected — clicking ${pageState.hasNext ? 'Next' : 'Finish'}`);
        await evaluateInBrowser(`
          (() => {
            const btn = [...document.querySelectorAll('button')].find(
              b => (b.textContent.trim() === 'Next' || b.textContent.trim() === 'Finish') && !b.disabled
            );
            if (btn) btn.click();
          })()
        `);
        await new Promise(r => setTimeout(r, 1500));

        pageState = await evaluateInBrowser(`
          (() => {
            const bodyText = (document.body?.innerText || '').trim();
            const btns = [...document.querySelectorAll('button')];
            return {
              isAuthPage:    bodyText.includes('Authentication Required'),
              isAwaiting:    bodyText.includes('Awaiting Authentication'),
              isErrorPage:   bodyText.includes('unexpected issue setting up your account') || bodyText.includes('context deadline exceeded'),
              isOnboarding:  window.location.href.includes('onboarding') || bodyText.includes('Security Notice') || bodyText.includes('Select Antigravity Theme') || bodyText.includes('Build with Google'),
              hasSignIn:     !!btns.find(b => b.textContent.trim() === 'Sign In'),
              hasGoogle:     !!btns.find(b => b.textContent.trim() === 'Continue with Google' && !b.disabled),
              hasPrevious:   !!btns.find(b => b.textContent.trim() === 'Previous'),
              hasNext:       !!btns.find(b => b.textContent.trim() === 'Next' && !b.disabled),
              hasFinish:     !!btns.find(b => b.textContent.trim() === 'Finish' && !b.disabled),
              bodySnippet:   bodyText.substring(0, 80),
            };
          })()
        `);
        log('Auth', 'Fresh page state after onboarding click: ' + JSON.stringify(pageState));
        attempts++;
      }

      if (!pageState?.isAuthPage && !pageState?.isAwaiting && !pageState?.isOnboarding) {
        log('Auth', 'Page does not require authentication or onboarding. Returning success.');
        return res.json({ ok: true, googleUrl: null });
      }

      if ((pageState?.isAwaiting || pageState?.isErrorPage) && (pageState?.hasPrevious || pageState?.bodySnippet?.includes('unexpected') || pageState?.bodySnippet?.includes('deadline'))) {
        log('Auth', 'Awaiting/Error state detected — attempting reset');
        await evaluateInBrowser(`
          (() => {
            const diffBtn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Continue with different account'));
            if (diffBtn && !diffBtn.disabled) {
              diffBtn.click();
              return { clicked: 'diff' };
            }
            const prevBtn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Previous');
            if (prevBtn && !prevBtn.disabled) {
              prevBtn.click();
              return { clicked: 'previous' };
            }
            return { clicked: 'none' };
          })()
        `);
        await new Promise(r => setTimeout(r, 1500));

        pageState = await evaluateInBrowser(`
          (() => {
            const bodyText = (document.body?.innerText || '').trim();
            const btns = [...document.querySelectorAll('button')];
            return {
              isAuthPage:    bodyText.includes('Authentication Required'),
              isAwaiting:    bodyText.includes('Awaiting Authentication'),
              isErrorPage:   bodyText.includes('unexpected issue setting up your account') || bodyText.includes('context deadline exceeded'),
              isOnboarding:  window.location.href.includes('onboarding') || bodyText.includes('Security Notice') || bodyText.includes('Select Antigravity Theme') || bodyText.includes('Build with Google'),
              hasSignIn:     !!btns.find(b => b.textContent.trim() === 'Sign In'),
              hasGoogle:     !!btns.find(b => b.textContent.trim() === 'Continue with Google' && !b.disabled),
              hasPrevious:   !!btns.find(b => b.textContent.trim() === 'Previous'),
              hasNext:       !!btns.find(b => b.textContent.trim() === 'Next' && !b.disabled),
              hasFinish:     !!btns.find(b => b.textContent.trim() === 'Finish' && !b.disabled),
              bodySnippet:   bodyText.substring(0, 80),
            };
          })()
        `);
        log('Auth', 'Fresh page state: ' + JSON.stringify(pageState));
      }

      if (pageState?.isAuthPage && pageState?.hasSignIn) {
        log('Auth', 'Auth page detected — clicking Sign In');
        await evaluateInBrowser(`
          (() => {
            const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Sign In');
            if (btn) btn.click();
          })()
        `);
        await new Promise(r => setTimeout(r, 1500));
      }

      const authUrlFile = '/tmp/ag2r_pending_auth_url';
      try { fs.unlinkSync(authUrlFile); } catch {}

      const clickResult = await evaluateInBrowser(`
        (() => {
          const btn = [...document.querySelectorAll('button')].find(
            b => b.textContent.trim() === 'Continue with Google' && !b.disabled
          );
          if (btn) { btn.click(); return { ok: true }; }
          const disabledBtn = [...document.querySelectorAll('button')].find(
            b => b.textContent.includes('Continue with Google')
          );
          if (disabledBtn) return { ok: false, reason: 'button_disabled' };
          return { ok: false, reason: 'no_continue_google_button' };
        })()
      `);

      log('Auth', 'Click result: ' + JSON.stringify(clickResult));

      if (!clickResult?.ok) {
        return res.json({ ok: false, reason: clickResult?.reason || 'click_failed' });
      }

      for (let i = 0; i < 80 && !state.pendingAuthUrl; i++) {
        await new Promise(r => setTimeout(r, 100));
        try {
          if (fs.existsSync(authUrlFile)) {
            const url = fs.readFileSync(authUrlFile, 'utf8').trim();
            if (url && url.startsWith('http')) {
              state.pendingAuthUrl = url;
              try { fs.unlinkSync(authUrlFile); } catch {}
              log('Auth', 'Got Google URL from xdg-open file: ' + url.substring(0, 60));
            }
          }
        } catch {}
      }

      if (state.pendingAuthUrl) {
        const url = state.pendingAuthUrl;
        state.pendingAuthUrl = null;
        log('Auth', 'Returning Google OAuth URL to client');
        broadcast({ type: 'auth_url', googleUrl: url });
        return res.json({ ok: true, googleUrl: url });
      }

      res.json({ ok: true, googleUrl: null });
    } catch (e) {
      log('Auth', 'Error: ' + e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/internal/auth-url', (req, res) => {
    const { url } = req.body || {};
    if (url && typeof url === 'string' && url.startsWith('http')) {
      log('Auth', 'Received Google URL from xdg-open interceptor: ' + url.substring(0, 80));
      state.pendingAuthUrl = url;
      broadcast({ type: 'auth_url', googleUrl: url });
    }
    res.json({ ok: true });
  });

  app.post('/auth/callback-proxy', async (req, res) => {
    try {
      const { url } = req.body || {};
      if (!url || typeof url !== 'string') {
        return res.status(400).json({ ok: false, error: 'URL is required' });
      }

      // Allow localhost or 127.0.0.1 on http
      const allowedRegex = /^http:\/\/(?:localhost|127\.0\.0\.1):\d+\/auth\/callback\b/;
      if (!allowedRegex.test(url)) {
        return res.status(400).json({ ok: false, error: 'Invalid callback URL. Only localhost is allowed.' });
      }

      log('Auth', 'Proxying Google Auth callback URL locally: ' + url.substring(0, 80));

      const resp = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'AG2R-Callback-Proxy/1.0',
        }
      });

      const bodyText = await resp.text();
      log('Auth', `Local callback request completed with status ${resp.status}`);

      res.json({ ok: true, status: resp.status, snippet: bodyText.substring(0, 100) });
    } catch (err) {
      log('Auth', 'Callback proxy failed: ' + err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });
}
