import { state } from './state.js';
import { loadSnapshot } from './snapshot.js';
import {
  connectionDot,
  emptyState,
  runningTasksHeader,
  runningTasksList,
  runningTasks,
  inputBar
} from './dom.js';

export function updateConnectionStatus(status) {
  connectionDot.setAttribute('data-status', status);
  const titles = {
    connected: 'Connected',
    reconnecting: 'Reconnecting...',
    disconnected: 'Disconnected',
  };
  connectionDot.title = titles[status] || status;
}

export function showEmptyState() {
  emptyState.classList.remove('hidden');
}

export function hideEmptyState() {
  emptyState.classList.add('hidden');
}

export function updateEmptyState(subtitle) {
  const el = emptyState.querySelector('.empty-subtitle');
  if (el) el.textContent = subtitle;
}

export function initMisc() {
  if (typeof ResizeObserver !== 'undefined') {
    const inputBarObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        const h = entry.borderBoxSize?.[0]?.blockSize ?? entry.target.offsetHeight;
        document.documentElement.style.setProperty('--input-bar-height', h + 'px');
      }
    });
    inputBarObserver.observe(inputBar);
  }

  runningTasksHeader.addEventListener('click', () => {
    state.runningTasksCollapsed = !state.runningTasksCollapsed;
    runningTasksList.classList.toggle('collapsed', state.runningTasksCollapsed);
    runningTasks.querySelector('.running-tasks-arrow')
      ?.classList.toggle('rotated', state.runningTasksCollapsed);
  });

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      document.body.style.height = window.visualViewport.height + 'px';
    });
    window.visualViewport.addEventListener('scroll', () => {
      document.body.style.height = window.visualViewport.height + 'px';
    });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      loadSnapshot();
    }
  });

  setInterval(() => {
    if (document.visibilityState === 'visible') {
      loadSnapshot();
    }
  }, 5000);
}
