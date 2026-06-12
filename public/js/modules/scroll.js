import { state } from './state.js';
import { chatArea, scrollFab } from './dom.js';

const SCROLL_THRESHOLD = 10; // px from bottom to count as "near bottom"

export function isNearBottom() {
  const { scrollTop, scrollHeight, clientHeight } = chatArea;
  return scrollHeight - scrollTop - clientHeight < SCROLL_THRESHOLD;
}

export function scrollToBottom() {
  chatArea.scrollTop = chatArea.scrollHeight;
}

export function updateScrollFab() {
  const distFromBottom = chatArea.scrollHeight - chatArea.scrollTop - chatArea.clientHeight;
  if (distFromBottom > 100) {
    scrollFab.classList.add('visible');
  } else {
    scrollFab.classList.remove('visible');
  }
}

export function initScroll() {
  chatArea.addEventListener('scroll', () => {
    updateScrollFab();
    if (state.isRendering) return;
    const nearBottom = chatArea.scrollHeight - chatArea.scrollTop - chatArea.clientHeight < 50;
    state.userScrolledAway = !nearBottom;
  }, { passive: true });

  scrollFab.addEventListener('click', () => {
    state.userScrolledAway = false;
    scrollToBottom();
    updateScrollFab();
  });
}
