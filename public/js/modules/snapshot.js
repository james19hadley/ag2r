import { state } from './state.js';
import { fetchAPI } from './api.js';
import { showAuthOverlay, hideAuthOverlay } from './auth.js';
import { renderNewSessionPage } from './new-session.js';
import { addMobileCopyButtons } from './copy.js';
import { addClickProxyHandlers } from './proxy.js';
import { renderSidebar, fetchRightSidebar } from './sidebar.js';
import { updateModelChip } from './input.js';
import { updateScrollFab } from './scroll.js';
import { renderPermissions } from './snapshot-permissions.js';
import {
  renderNewSessionPageInline,
  renderDropdownDialog,
  renderRunningTasks,
  renderSettingsScheduledTasks
} from './snapshot-renderers.js';
import {
  chatContent,
  cdpStyles,
  leftSidebarCdpStyles,
  rightSidebarCdpStyles,
  chatArea,
  inputBar
} from './dom.js';

export async function loadSnapshot() {
  try {
    const res = await fetchAPI(`/snapshot?t=${Date.now()}`);

    if (res.status === 503) {
      const emptyState = document.getElementById('empty-state');
      if (emptyState && !chatContent.innerHTML.trim()) {
        emptyState.classList.remove('hidden');
      }
      return;
    }

    if (!res.ok) return;

    const data = await res.json();
    state.lastHash = data.hash;

    if (data.isAuthRequired) {
      showAuthOverlay(data.isOnboarding);
      return;
    } else {
      hideAuthOverlay();
    }

    if (data.css) {
      cdpStyles.textContent = data.css;
      leftSidebarCdpStyles.textContent = data.css;
      rightSidebarCdpStyles.textContent = data.css;
    }

    const wasAtBottom = chatArea.scrollHeight - chatArea.scrollTop - chatArea.clientHeight < 80;

    const newSessionInput = document.getElementById('ag2r-new-session-input');
    const skipChatRender = data.isNewSessionPage && newSessionInput;

    if (skipChatRender) {
      renderNewSessionPageInline(chatContent, data);
    } else {
      chatContent.innerHTML = data.html;
      const emptyState = document.getElementById('empty-state');
      if (emptyState) emptyState.classList.add('hidden');

      if (data.isNewSessionPage) {
        renderNewSessionPage(chatContent, data);
        // Dispatch sidebar close custom event or direct call
        const leftSidebar = document.getElementById('left-sidebar');
        if (leftSidebar) leftSidebar.classList.remove('open');
      }

      const hideBottomBar = data.isNewSessionPage;
      inputBar.classList.toggle('hidden', hideBottomBar);
      const quickActions = document.getElementById('quick-actions');
      if (quickActions) {
        if (hideBottomBar) quickActions.classList.add('hidden');
      }

      addMobileCopyButtons();
      addClickProxyHandlers(chatContent);
    }

    updateModelChip(data.modelName);

    state.isRendering = true;
    const leftSidebarContent = document.getElementById('left-sidebar-content');
    renderSidebar(leftSidebarContent, data.leftSidebarHtml);
    addClickProxyHandlers(leftSidebarContent);

    if (data.sidebarSignature !== undefined) {
      const sigChanged = data.sidebarSignature !== state.lastSidebarSignature;
      state.lastSidebarSignature = data.sidebarSignature;
      const rightSidebar = document.getElementById('right-sidebar');
      if (sigChanged && rightSidebar && rightSidebar.classList.contains('open')) {
        fetchRightSidebar();
      }
    }

    renderDropdownDialog(data);
    renderPermissions(data);
    renderRunningTasks(data);
    renderSettingsScheduledTasks(data);

    if (data.activeArtifactUri) {
      state.activeArtifactUri = data.activeArtifactUri;
      state.activeFileUri = null;
    } else if (data.activeFileUri) {
      state.activeFileUri = data.activeFileUri;
      state.activeArtifactUri = null;
    }

    requestAnimationFrame(() => {
      if (wasAtBottom) {
        chatArea.scrollTop = chatArea.scrollHeight;
      }
      requestAnimationFrame(() => {
        state.isRendering = false;
        updateScrollFab();
      });
    });

  } catch (e) {
    console.debug('[Snapshot] Load error:', e.message);
  }
}
