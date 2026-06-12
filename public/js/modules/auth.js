import { fetchAPI } from './api.js';
import {
  authOverlay,
  authSigninBtn,
  authStatus,
  inputBar,
  authCallbackUrlInput,
  authCallbackSubmitBtn
} from './dom.js';

export function showAuthOverlay(isOnboarding = false) {
  authOverlay.classList.remove('hidden');
  inputBar.classList.add('hidden');
  const qa = document.getElementById('quick-actions');
  if (qa) qa.classList.add('hidden');

  const titleEl = authOverlay.querySelector('.auth-title');
  const subtitleEl = authOverlay.querySelector('.auth-subtitle');
  const signinBtn = document.getElementById('auth-signin-btn');
  const fallbackSec = authOverlay.querySelector('.auth-fallback-section');

  if (isOnboarding) {
    if (titleEl) titleEl.textContent = 'Настройка Antigravity...';
    if (subtitleEl) subtitleEl.textContent = 'Автоматически прохожу этапы настройки сессии на сервере.';
    if (signinBtn) signinBtn.classList.add('hidden');
    if (fallbackSec) fallbackSec.classList.add('hidden');
    
    // Animate status with dots
    const dots = ['.', '..', '...', ''];
    let idx = 0;
    if (!window.authDotInterval) {
      window.authDotInterval = setInterval(() => {
        setAuthStatus('Инициализация рабочего окружения' + dots[idx], 'info');
        idx = (idx + 1) % dots.length;
      }, 500);
    }
  } else {
    // Restore default
    if (titleEl) titleEl.textContent = 'Sign in to Antigravity';
    if (subtitleEl) subtitleEl.textContent = 'Authentication required to use the AI agent.';
    if (signinBtn) signinBtn.classList.remove('hidden');
    if (fallbackSec) fallbackSec.classList.remove('hidden');
    
    if (window.authDotInterval) {
      clearInterval(window.authDotInterval);
      window.authDotInterval = null;
      setAuthStatus('', '');
    }
  }
}

export function hideAuthOverlay() {
  authOverlay.classList.add('hidden');
  inputBar.classList.remove('hidden');
  if (window.authDotInterval) {
    clearInterval(window.authDotInterval);
    window.authDotInterval = null;
    setAuthStatus('', '');
  }
}

export function setAuthStatus(msg, cls) {
  authStatus.textContent = msg;
  authStatus.className = 'auth-status' + (cls ? ' ' + cls : '');
}

export function initAuth() {
  if (authSigninBtn) {
    authSigninBtn.addEventListener('click', async () => {
      authSigninBtn.disabled = true;
      authSigninBtn.classList.add('loading');
      setAuthStatus('Connecting to Antigravity...', 'info');
      try {
        const res = await fetchAPI('/auth/signin', { method: 'POST' });
        const data = await res.json();
        if (!data.ok) {
          setAuthStatus('Error: ' + (data.reason || data.error || 'unknown'), 'error');
          authSigninBtn.disabled = false;
          authSigninBtn.classList.remove('loading');
          return;
        }
        if (data.googleUrl) {
          setAuthStatus('Opening Google sign-in...', 'info');
          window.open(data.googleUrl, '_blank');
          setAuthStatus('Complete sign-in in the opened tab, then return here.', 'info');
        } else {
          setAuthStatus('A browser was opened on the host machine. Complete sign-in there.', 'info');
        }
      } catch (e) {
        setAuthStatus('Network error. Try again.', 'error');
      } finally {
        authSigninBtn.disabled = false;
        authSigninBtn.classList.remove('loading');
      }
    });
  }

  if (authCallbackSubmitBtn) {
    authCallbackSubmitBtn.addEventListener('click', async () => {
      const urlVal = (authCallbackUrlInput.value || '').trim();
      if (!urlVal) {
        setAuthStatus('Please enter a callback URL.', 'error');
        return;
      }
      if (!urlVal.startsWith('http://localhost') && !urlVal.startsWith('http://127.0.0.1')) {
        setAuthStatus('URL must start with http://localhost or http://127.0.0.1', 'error');
        return;
      }
      authCallbackSubmitBtn.disabled = true;
      setAuthStatus('Submitting callback locally...', 'info');
      try {
        const res = await fetchAPI('/auth/callback-proxy', {
          method: 'POST',
          body: JSON.stringify({ url: urlVal }),
        });
        const data = await res.json();
        if (data.ok) {
          setAuthStatus('Successfully sent callback! Re-checking session...', 'info');
          authCallbackUrlInput.value = '';
        } else {
          setAuthStatus('Proxy error: ' + (data.error || 'unknown'), 'error');
        }
      } catch (e) {
        setAuthStatus('Network error sending callback.', 'error');
      } finally {
        authCallbackSubmitBtn.disabled = false;
      }
    });
  }
}
