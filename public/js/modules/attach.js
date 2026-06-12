import { state } from './state.js';
import { fetchAPI } from './api.js';
import { updateActionButton } from './input.js';

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
export const MAX_STAGED_IMAGES = 3;

export function renderImagePreviewsInto(strip, btn) {
  strip.innerHTML = '';
  if (state.stagedImages.length === 0) {
    strip.classList.add('hidden');
    if (btn) btn.classList.remove('at-limit');
    return;
  }
  strip.classList.remove('hidden');

  state.stagedImages.forEach((item, idx) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'image-preview-item';

    const img = document.createElement('img');
    img.src = item.objectUrl;
    img.alt = item.file.name;
    wrapper.appendChild(img);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.textContent = '×';
    removeBtn.setAttribute('aria-label', 'Remove image');
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      URL.revokeObjectURL(state.stagedImages[idx].objectUrl);
      state.stagedImages.splice(idx, 1);
      renderImagePreviewsInto(strip, btn);
      updateActionButton();
    });
    wrapper.appendChild(removeBtn);

    strip.appendChild(wrapper);
  });

  if (btn) {
    if (state.stagedImages.length >= MAX_STAGED_IMAGES) {
      btn.classList.add('at-limit');
    } else {
      btn.classList.remove('at-limit');
    }
  }
}

export function renderImagePreviews() {
  const imagePreviewStrip = document.getElementById('image-preview-strip');
  const attachBtn = document.getElementById('attach-btn');
  if (imagePreviewStrip) {
    renderImagePreviewsInto(imagePreviewStrip, attachBtn);
  }
}

export function createAttachMenu(parentEl, fileInput) {
  const menu = document.createElement('div');
  menu.className = 'attach-menu hidden';
  menu.innerHTML = `
    <button type="button" class="attach-menu-item" data-action="media">
      <span class="material-symbols-rounded">image</span>
      <span>Media</span>
    </button>
  `;
  parentEl.appendChild(menu);

  menu.querySelector('[data-action="media"]').addEventListener('click', (e) => {
    e.stopPropagation();
    menu.classList.add('hidden');
    if (state.stagedImages.length >= MAX_STAGED_IMAGES) return;
    fileInput.click();
  });

  return menu;
}

export async function uploadStagedImages() {
  if (state.stagedImages.length === 0) return true;

  const imagePreviewStrip = document.getElementById('image-preview-strip');
  const stripToUse = imagePreviewStrip?.classList.contains('hidden')
    ? document.getElementById('ag2r-ns-image-preview')
    : imagePreviewStrip;

  if (stripToUse) {
    stripToUse.querySelectorAll('.image-preview-item').forEach(el => {
      el.classList.add('uploading');
    });
  }

  let allOk = true;
  const items = stripToUse ? stripToUse.querySelectorAll('.image-preview-item') : [];

  for (let i = 0; i < state.stagedImages.length; i++) {
    try {
      const formData = new FormData();
      formData.append('image', state.stagedImages[i].file);

      const res = await fetch('/upload', {
        method: 'POST',
        body: formData,
        headers: { 'ngrok-skip-browser-warning': '1' },
      });

      const result = await res.json();
      console.debug('[Upload] Result:', result);

      if (items[i]) items[i].classList.remove('uploading');

      if (!res.ok || !result.ok) {
        console.debug('[Upload] Error:', result.error || 'Unknown');
        if (items[i]) items[i].classList.add('upload-error');
        allOk = false;
      }
    } catch (e) {
      console.debug('[Upload] Network error:', e.message);
      if (items[i]) {
        items[i].classList.remove('uploading');
        items[i].classList.add('upload-error');
      }
      allOk = false;
    }
  }

  return allOk;
}

export function clearStagedImages() {
  state.stagedImages.forEach(item => URL.revokeObjectURL(item.objectUrl));
  state.stagedImages = [];
  renderImagePreviews();
}

export function createVoiceInput(inputEl, btnEl) {
  if (!SpeechRecognition) {
    btnEl.classList.add('unsupported');
    return null;
  }

  let recognition = null;
  let isRecording = false;
  let baselineText = '';
  let sessionFinals = '';

  function wireHandlers() {
    recognition.onresult = (event) => {
      const latest = event.results[event.results.length - 1];
      const text = latest[0].transcript.trim();

      if (latest.isFinal) {
        sessionFinals = text;
      }

      inputEl.value = baselineText + (text ? (baselineText ? ' ' : '') + text : '');
      inputEl.style.height = 'auto';
      inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
      updateActionButton();
    };

    recognition.onerror = (event) => {
      console.debug('[Voice] Error:', event.error);
      stopRecording();
    };

    recognition.onend = () => {
      if (isRecording) {
        if (sessionFinals) {
          baselineText += (baselineText ? ' ' : '') + sessionFinals;
          sessionFinals = '';
        }
        try { recognition.start(); } catch {}
      }
    };
  }

  function startRecording() {
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || 'en-US';
    wireHandlers();

    baselineText = inputEl.value;
    sessionFinals = '';
    isRecording = true;
    btnEl.classList.add('recording');
    btnEl.setAttribute('aria-label', 'Stop recording');

    try {
      recognition.start();
    } catch (err) {
      console.debug('[Voice] Start error:', err);
      stopRecording();
    }
  }

  function stopRecording() {
    isRecording = false;
    btnEl.classList.remove('recording');
    btnEl.setAttribute('aria-label', 'Voice input');
    if (recognition) {
      recognition.onresult = null;
      recognition.onend = null;
      recognition.onerror = null;
      try { recognition.stop(); } catch {}
      recognition = null;
    }
  }

  btnEl.addEventListener('click', () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  });

  return stopRecording;
}

export function initAttach() {
  const photoInput = document.getElementById('photo-input');
  const attachBtn = document.getElementById('attach-btn');
  const leftActions = document.querySelector('.input-left-actions');
  if (!leftActions) return;

  const mainAttachMenu = createAttachMenu(
    leftActions,
    photoInput
  );

  attachBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    mainAttachMenu.classList.toggle('hidden');
  });

  photoInput?.addEventListener('change', () => {
    const files = Array.from(photoInput.files);
    if (!files.length) return;

    const remaining = MAX_STAGED_IMAGES - state.stagedImages.length;
    const toAdd = files.slice(0, remaining);

    for (const file of toAdd) {
      state.stagedImages.push({ file, objectUrl: URL.createObjectURL(file) });
    }
    renderImagePreviews();
    updateActionButton();
    photoInput.value = '';
  });

  document.addEventListener('click', () => {
    document.querySelectorAll('.attach-menu').forEach(m => m.classList.add('hidden'));
  });
}
