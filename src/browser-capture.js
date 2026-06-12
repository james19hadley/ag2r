import { TAGGER_SCRIPT } from './browser-tagger.js';
import {
  CLEANUP_CLONE_SCRIPT,
  CSS_CAPTURE_SCRIPT,
  PORTALS_CAPTURE_SCRIPT
} from './browser-capture-parts.js';

export const CAPTURE_SCRIPT = `
(async () => {
  ${TAGGER_SCRIPT}

  let container =
    document.querySelector('.scrollbar-hide[class*="overflow-y-auto"]') ||
    document.querySelector('[data-testid="conversation-view"]') ||
    document.getElementById('conversation') ||
    document.getElementById('chat') ||
    document.getElementById('cascade');

  let isNewSessionPage = false;
  if (!container || container.clientHeight === 0) {
    const inputBox = document.getElementById('antigravity.agentSidePanelInputBox');
    if (inputBox) {
      let newSessionRoot = inputBox;
      for (let i = 0; i < 10; i++) {
        if (!newSessionRoot.parentElement) break;
        newSessionRoot = newSessionRoot.parentElement;
        const cls = newSessionRoot.className?.toString() || '';
        if (cls.includes('animate-fade-in')) break;
      }
      container = newSessionRoot;
      isNewSessionPage = true;
    }
  }

  if (!container) {
    const bodyText = (document.body?.innerText || '').trim();
    const isAuth = bodyText.includes('Authentication Required') || 
                   bodyText.includes('sign in with your Google') ||
                   bodyText.includes('unexpected issue setting up your account') ||
                   bodyText.includes('Continue with different account') ||
                   window.location.href.includes('onboarding');
    if (isAuth) {
      const isOnboarding = window.location.href.includes('onboarding') || bodyText.includes('Security Notice') || bodyText.includes('Select Antigravity Theme') || bodyText.includes('Build with Google');
      if (isOnboarding) {
        const nextBtn = [...document.querySelectorAll('button')].find(
          b => (b.textContent.trim() === 'Next' || b.textContent.trim() === 'Finish') && !b.disabled && !b.getAttribute('data-ag-clicked')
        );
        if (nextBtn) {
          nextBtn.setAttribute('data-ag-clicked', 'true');
          nextBtn.click();
        }
      }

      const btns = [...document.querySelectorAll('button')];
      const signInBtn = btns.find(b => 
        b.textContent.trim() === 'Sign In' || 
        b.textContent.trim() === 'Continue with Google' ||
        b.textContent.trim() === 'Previous'
      );
      if (signInBtn) {
        signInBtn.setAttribute('data-ag-click-id', 'auth:0');
        signInBtn.setAttribute('data-ag-click-label', signInBtn.textContent.trim());
      }
      return {
        html: '', css: '', isAuthRequired: true, agentRunning: false, scrollInfo: null,
        leftSidebarHtml: null, sidebarSignature: null, dropdownHtml: null, dialogHtml: null,
        settingsHtml: null, activeArtifactUri: null, activeFileUri: null, permissionHtml: null,
        environmentName: null, branchName: null, modelName: null, isNewSessionPage: false,
        isOnboarding: isOnboarding,
      };
    }
    return null;
  }

  const stopBtn =
    document.querySelector('[data-tooltip-id="input-send-button-cancel-tooltip"]') ||
    document.querySelector('button svg.lucide-square')?.closest('button');
  const agentRunning = !!(stopBtn && stopBtn.offsetParent !== null);

  const scrollInfo = {
    scrollTop: container.scrollTop,
    scrollHeight: container.scrollHeight,
    clientHeight: container.clientHeight,
  };

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
  const chatTagged = tagInteractives(container, 'chat', false, true, 80);

  const clone = container.cloneNode(true);

  marked.forEach(el => {
    el.removeAttribute('data-ag-remove');
    el.removeAttribute('data-ag-sticky');
  });
  untagAll(chatTagged);

  ${CLEANUP_CLONE_SCRIPT}

  let html = clone.innerHTML;
  html = html.replace(/class="([^"]*)"/g, (match, classes) => {
    if (!classes.includes('[object Object]')) return match;
    const cleaned = classes.replace(/\\\\\\\\[object Object\\\\\\\\]/g, '').replace(/\\\\\\\\s+/g, ' ').trim();
    return 'class="' + cleaned + '"';
  });

  ${CSS_CAPTURE_SCRIPT}

  ${PORTALS_CAPTURE_SCRIPT}

  let settingsHtml = null;
  try {
    const settingsOverlay = document.querySelector('#root .fixed.inset-0[class*="z-[2550]"]');
    if (settingsOverlay && settingsOverlay.getBoundingClientRect().width > 0) {
      const settingsCard = settingsOverlay.querySelector('[class*="max-w-5xl"]') ||
                           settingsOverlay.querySelector('[class*="rounded-2xl"]');
      if (settingsCard) {
        const tagged = tagInteractives(settingsCard, 'settings', true, false);
        const clone = settingsCard.cloneNode(true);
        untagAll(tagged);
        settingsHtml = clone.outerHTML;
      }
    }
  } catch (e) {
    console.debug('[AG2R] Settings capture error:', e.message);
  }

  let activeArtifactUri = null;
  let activeFileUri = null;
  try {
    const activeTab = document.querySelector('[data-tab-id].bg-secondary');
    if (activeTab) {
      const tabId = activeTab.getAttribute('data-tab-id');
      if (tabId !== 'overview' && tabId !== 'review') {
        if (tabId.startsWith('artifact__')) {
          activeArtifactUri = tabId.replace('artifact__', '');
        } else {
          activeFileUri = tabId;
        }
      }
    }
  } catch (e) {
    console.debug('[AG2R] Active tab detection error:', e.message);
  }

  let permissionHtml = null;
  try {
    const radioGroup = document.querySelector('[role="radiogroup"]');
    if (radioGroup) {
      let banner = radioGroup;
      for (let i = 0; i < 10; i++) {
        if (!banner.parentElement || banner.parentElement === document.body) break;
        banner = banner.parentElement;
        if (/allow|permission/i.test(banner.textContent) && banner.querySelectorAll('button').length >= 1) break;
      }
      let permIdx = 0;
      const permTagged = [];
      banner.querySelectorAll('[role="radiogroup"] label').forEach(el => {
        el.setAttribute('data-ag-click-id', 'perm:' + permIdx);
        el.setAttribute('data-ag-click-label', (el.textContent || '').trim().substring(0, 50));
        permIdx++;
        permTagged.push(el);
      });
      banner.querySelectorAll('button').forEach(el => {
        el.setAttribute('data-ag-click-id', 'perm:' + permIdx);
        el.setAttribute('data-ag-click-label', (el.textContent || '').trim().substring(0, 50));
        permIdx++;
        permTagged.push(el);
      });
      const permClone = banner.cloneNode(true);
      permTagged.forEach(el => {
        el.removeAttribute('data-ag-click-id');
        el.removeAttribute('data-ag-click-label');
      });
      permissionHtml = permClone.outerHTML;
    }
  } catch (e) {
    console.debug('[AG2R] Permission banner capture error:', e.message);
  }

  let environmentName = null;
  let branchName = null;
  try {
    const envBtn = document.querySelector('[aria-label="Select Environment"]');
    if (envBtn) {
      const span = envBtn.querySelector('span');
      environmentName = span ? span.textContent.trim() : (envBtn.textContent || '').trim();
    }
    const branchBtn = document.querySelector('[aria-label="Select Default Branch"]');
    if (branchBtn) {
      const span = branchBtn.querySelector('span');
      branchName = span ? span.textContent.trim() : (branchBtn.textContent || '').trim();
    }
  } catch (e) {
    console.debug('[AG2R] Environment/branch extraction error:', e.message);
  }

  let modelName = null;
  try {
    const modelBtn = document.querySelector('[aria-label*="Select model"]');
    if (modelBtn) {
      const span = modelBtn.querySelector('span');
      modelName = span ? span.textContent.trim() : (modelBtn.textContent || '').trim();
    }
  } catch (e) {
    console.debug('[AG2R] Model name extraction error:', e.message);
  }

  return { html, css, agentRunning, scrollInfo, leftSidebarHtml, sidebarSignature, isNewSessionPage, dropdownHtml, dialogHtml, settingsHtml, activeArtifactUri, activeFileUri, permissionHtml, environmentName, branchName, modelName };
})()
`;
