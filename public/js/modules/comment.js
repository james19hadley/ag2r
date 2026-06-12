import { state } from './state.js';
import { fetchAPI, track } from './api.js';
import {
  commentFab,
  commentModal,
  commentModalBackdrop,
  commentSelectionPreview,
  commentInput,
  commentCancel,
  commentSubmit,
  rightSidebarContent,
} from './dom.js';

export function hasActiveSelectionInRightSidebar() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.toString().trim()) return false;
  const anchor = sel.anchorNode;
  return anchor && rightSidebarContent.contains(anchor);
}

export function saveComments() {
  localStorage.setItem('ag2r_queued_comments', JSON.stringify(state.queuedComments));
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

export function showCommentFabForSelection() {
  const sel = window.getSelection();
  const text = sel ? sel.toString().trim() : '';

  if (!text || text.length < 2) {
    commentFab.classList.add('hidden');
    return;
  }

  const anchor = sel.anchorNode;
  if (!anchor || !rightSidebarContent.contains(anchor)) {
    commentFab.classList.add('hidden');
    return;
  }

  const activeUri = state.activeArtifactUri || state.activeFileUri;
  if (!activeUri) {
    commentFab.classList.add('hidden');
    return;
  }

  state.pendingCommentSelection = text;
  state.pendingCommentUri = activeUri;

  const range = sel.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  commentFab.style.top = `${rect.bottom + window.scrollY + 8}px`;
  commentFab.style.left = `${rect.left + window.scrollX + rect.width / 2}px`;
  commentFab.classList.remove('hidden');
}

export function closeCommentModal() {
  commentModal.classList.add('hidden');
  commentInput.value = '';
  state.pendingCommentSelection = '';
}

export function updateCommentBadge() {
  let badge = document.getElementById('comment-badge');
  if (state.queuedComments.length === 0) {
    if (badge) badge.remove();
    return;
  }
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'comment-badge';
    document.getElementById('app').appendChild(badge);
  }
  const count = state.queuedComments.length;
  badge.innerHTML = `<span>💬 ${count} comment${count > 1 ? 's' : ''} queued</span><button id="comment-send-btn">Send</button>`;
  badge.onclick = openReviewModal;
  document.getElementById('comment-send-btn').onclick = (e) => {
    e.stopPropagation();
    sendQueuedComments();
  };
}

export async function sendQueuedComments() {
  const fullMessage = drainQueuedComments();
  if (!fullMessage) return;
  try {
    const resp = await fetchAPI('/send', {
      method: 'POST',
      body: JSON.stringify({ message: fullMessage }),
    });
    const result = await resp.json();
    console.debug('[Comment] Send result:', result);
    track('comments_sent', { count: fullMessage.split('* >').length - 1 });
  } catch (e) {
    console.error('[Comment] Send failed:', e);
  }
}

export function formatQueuedComments() {
  if (state.queuedComments.length === 0) return '';
  const grouped = {};
  for (const c of state.queuedComments) {
    if (!grouped[c.uri]) grouped[c.uri] = [];
    grouped[c.uri].push(c);
  }
  const lines = ['Review my comments:'];
  for (const [uri, comments] of Object.entries(grouped)) {
    lines.push(`* Comments on artifact URI: ${uri}`);
    for (const c of comments) {
      lines.push(`  * > ${c.selection}`);
      lines.push(`    * Comment: ${c.comment}`);
    }
  }
  return lines.join('\n');
}

export function drainQueuedComments() {
  if (state.queuedComments.length === 0) return '';
  const block = formatQueuedComments();
  state.queuedComments = [];
  saveComments();
  updateCommentBadge();
  return block;
}

const reviewModal = document.getElementById('comment-review-modal');
const reviewList = document.getElementById('comment-review-list');
const reviewBackdrop = document.getElementById('comment-review-backdrop');
const reviewClose = document.getElementById('comment-review-close');
const reviewClear = document.getElementById('comment-review-clear');
const reviewSend = document.getElementById('comment-review-send');

export function openReviewModal() {
  renderReviewList();
  reviewModal.classList.remove('hidden');
}

export function closeReviewModal() {
  reviewModal.classList.add('hidden');
}

export function renderReviewList() {
  if (state.queuedComments.length === 0) {
    reviewList.innerHTML = '<div style="color:#888;text-align:center;padding:20px">No comments queued</div>';
    return;
  }

  const grouped = {};
  const uriOrder = [];
  for (const [i, c] of state.queuedComments.entries()) {
    if (!grouped[c.uri]) { grouped[c.uri] = []; uriOrder.push(c.uri); }
    grouped[c.uri].push({ ...c, index: i });
  }

  let html = '';
  for (const uri of uriOrder) {
    const basename = uri.split('/').pop();
    html += `<div class="comment-review-file">📄 ${basename}</div>`;
    for (const c of grouped[uri]) {
      html += `
        <div class="comment-review-item" data-idx="${c.index}">
          <div class="comment-review-selection">» ${escapeHtml(c.selection)}</div>
          <div class="comment-review-text">${escapeHtml(c.comment)}</div>
          <div class="comment-review-actions">
            <button class="edit" title="Edit" data-idx="${c.index}"><span class="material-symbols-rounded" style="font-size:16px">edit</span></button>
            <button class="delete" title="Delete" data-idx="${c.index}"><span class="material-symbols-rounded" style="font-size:16px">delete</span></button>
          </div>
        </div>`;
    }
  }
  reviewList.innerHTML = html;

  reviewList.querySelectorAll('.edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx);
      const item = btn.closest('.comment-review-item');
      const textEl = item.querySelector('.comment-review-text');
      const textarea = document.createElement('textarea');
      textarea.className = 'comment-input';
      textarea.value = state.queuedComments[idx].comment;
      textarea.rows = 2;
      textEl.replaceWith(textarea);
      textarea.focus();
      const save = () => {
        const val = textarea.value.trim();
        if (val) {
          state.queuedComments[idx].comment = val;
          saveComments();
          track('comment_edited');
        }
        renderReviewList();
        updateCommentBadge();
      };
      textarea.addEventListener('blur', save);
      textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); }
      });
    });
  });

  reviewList.querySelectorAll('.delete').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx);
      state.queuedComments.splice(idx, 1);
      saveComments();
      track('comment_deleted');
      renderReviewList();
      updateCommentBadge();
      if (state.queuedComments.length === 0) closeReviewModal();
    });
  });
}

export function initComment() {
  rightSidebarContent.addEventListener('mouseup', () => {
    setTimeout(showCommentFabForSelection, 50);
  });

  let selectionChangeTimer = null;
  document.addEventListener('selectionchange', () => {
    clearTimeout(selectionChangeTimer);
    selectionChangeTimer = setTimeout(showCommentFabForSelection, 300);
  });

  rightSidebarContent.addEventListener('contextmenu', (e) => {
    e.preventDefault();
  });

  rightSidebarContent.addEventListener('pointerdown', (e) => {
    if (!commentFab.contains(e.target) && !commentModal.contains(e.target)) {
      commentFab.classList.add('hidden');
    }
  });

  commentFab.addEventListener('click', () => {
    commentFab.classList.add('hidden');
    commentSelectionPreview.textContent = state.pendingCommentSelection;
    commentInput.value = '';
    commentModal.classList.remove('hidden');
    commentInput.focus();
  });

  commentCancel.addEventListener('click', closeCommentModal);
  commentModalBackdrop.addEventListener('click', closeCommentModal);

  commentSubmit.addEventListener('click', () => {
    const commentText = commentInput.value.trim();
    if (!commentText) return;
    if (!(state.activeArtifactUri || state.activeFileUri) || !state.pendingCommentSelection) return;

    state.queuedComments.push({
      uri: state.pendingCommentUri || state.activeArtifactUri || state.activeFileUri,
      selection: state.pendingCommentSelection,
      comment: commentText,
    });
    saveComments();
    track('comment_added');
    closeCommentModal();
    window.getSelection()?.removeAllRanges();
    updateCommentBadge();
  });

  reviewBackdrop.addEventListener('click', closeReviewModal);
  reviewClose.addEventListener('click', closeReviewModal);
  reviewClear.addEventListener('click', () => {
    state.queuedComments = [];
    saveComments();
    updateCommentBadge();
    closeReviewModal();
  });
  reviewSend.addEventListener('click', () => {
    closeReviewModal();
    sendQueuedComments();
  });

  if (state.queuedComments.length > 0) updateCommentBadge();
}
