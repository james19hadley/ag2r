import { state } from './state.js';
import { fetchAPI } from './api.js';
import { addClickProxyHandlers } from './proxy.js';
import {
  leftSidebar,
  leftSidebarContent,
  leftSidebarOverlay,
  rightSidebar,
  rightSidebarContent,
  rightSidebarOverlay,
  sidebarToggle,
  reviewToggle
} from './dom.js';
import { hasActiveSelectionInRightSidebar } from './comment.js';

export function openLeftSidebar() {
  leftSidebar.classList.add('open');
  leftSidebar.inert = false;
  leftSidebarOverlay.classList.add('visible');
  if (!leftSidebarContent.innerHTML.trim()) {
    fetchAPI('/expand-left-sidebar', { method: 'POST' }).catch(() => {});
  }
}

export function closeLeftSidebar() {
  leftSidebar.classList.remove('open');
  leftSidebar.inert = true;
  leftSidebarOverlay.classList.remove('visible');
}

export function proxySidebarImages(container) {
  const imgs = container.querySelectorAll('img');
  for (const img of imgs) {
    const src = img.getAttribute('src') || '';
    if (!src || src.startsWith('data:') || src.startsWith('http')) continue;

    if (src.startsWith('blob:') || src.startsWith('file:') ||
        src.startsWith('vscode-file:') || (src.startsWith('/') && !src.startsWith('/symbols-icons'))) {

      const cached = state.imageProxyCache.get(src);
      if (cached) {
        img.src = cached;
        img.style.display = '';
        continue;
      }

      img.dataset.originalSrc = src;

      fetchAPI(`/proxy-image?src=${encodeURIComponent(src)}`)
        .then(r => r.json())
        .then(({ dataUrl }) => {
          if (dataUrl) {
            state.imageProxyCache.set(src, dataUrl);
            img.src = dataUrl;
            img.style.display = '';
          } else {
            img.style.display = 'none';
          }
        })
        .catch(() => {
          img.style.display = 'none';
        });
    }
  }
}

export async function fetchRightSidebar() {
  if (hasActiveSelectionInRightSidebar()) return;
  if (state.sidebarFetchInFlight) return;
  state.sidebarFetchInFlight = true;
  try {
    const res = await fetchAPI('/right-sidebar');
    if (!res.ok) return;
    const data = await res.json();
    if (data.html) {
      renderSidebar(rightSidebarContent, data.html);
      addClickProxyHandlers(rightSidebarContent);
      proxySidebarImages(rightSidebarContent);
    }
  } catch (e) {
    console.debug('[RightSidebar] Fetch error:', e.message);
  } finally {
    state.sidebarFetchInFlight = false;
  }
}

export function openRightSidebar() {
  rightSidebar.classList.add('open');
  rightSidebar.inert = false;
  rightSidebarOverlay.classList.add('visible');
  fetchRightSidebar();
}

export function closeRightSidebar() {
  rightSidebar.classList.remove('open');
  rightSidebar.inert = true;
  rightSidebarOverlay.classList.remove('visible');
}

export function toggleRightSidebar() {
  if (rightSidebar.classList.contains('open')) closeRightSidebar();
  else openRightSidebar();
}

export function renderSidebar(container, html) {
  if (html) {
    html = html.replace(
      /<button(\s+(?:type="button"\s+)?class="hidden group-hover:flex[^"]*"[^>]*)>([\s\S]*?)<\/button>/g,
      '<span$1>$2</span>'
    );
    container.innerHTML = html;
    container.querySelectorAll('.h-full').forEach(el => {
      el.classList.remove('h-full');
    });

    container.querySelectorAll('button[data-tab-id]').forEach(btn => {
      btn.classList.remove('overflow-hidden');
    });
    const scrollableBar = container.querySelector('.overflow-x-auto');
    if (scrollableBar) {
      scrollableBar.style.flexWrap = 'nowrap';
    }

    const topBar = container.querySelector('[style*="app-region: drag"]');
    if (topBar) topBar.remove();

    container.querySelectorAll('[data-ag-click-label="New Conversation"], [data-ag-click-label="Conversation History"]').forEach(el => el.remove());

    container.querySelectorAll('.mt-3.mx-2.h-px').forEach(el => el.remove());

    container.querySelectorAll('*').forEach(el => {
      const cls = el.className;
      if (typeof cls !== 'string') return;

      if (cls.includes('hidden') && cls.includes('group-hover/section:flex')) {
        el.classList.remove('hidden');
        el.style.display = 'flex';
      }

      if (cls.includes('invisible') && cls.includes('group-hover:visible')) {
        el.classList.remove('invisible');
        el.style.visibility = 'visible';
      }
    });
  }
}

export function initSidebar() {
  sidebarToggle.addEventListener('click', () => {
    if (leftSidebar.classList.contains('open')) {
      closeLeftSidebar();
    } else {
      openLeftSidebar();
    }
  });
  leftSidebarOverlay.addEventListener('click', closeLeftSidebar);
  reviewToggle.addEventListener('click', toggleRightSidebar);
  rightSidebarOverlay.addEventListener('click', closeRightSidebar);
}
