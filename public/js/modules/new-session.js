import { state } from './state.js';
import { fetchAPI } from './api.js';
import { closeLeftSidebar } from './sidebar.js';
import { addClickProxyHandlers } from './proxy.js';
import {
  uploadStagedImages,
  clearStagedImages,
  renderImagePreviewsInto,
  createAttachMenu,
  createVoiceInput
} from './attach.js';

export function renderNewSessionPage(container, data) {
  const capturedHtml = data.html;
  let projectName = '';
  const tmpDiv = document.createElement('div');
  tmpDiv.innerHTML = capturedHtml;
  const projectBtn = tmpDiv.querySelector('[aria-haspopup="dialog"] .truncate');
  if (projectBtn) projectName = projectBtn.textContent.trim();

  const modelName = data.modelName || '';
  const environmentName = data.environmentName || '';
  const branchName = data.branchName || '';

  let envBarHtml = '';
  if (environmentName) {
    const envIcon = environmentName === 'Local'
      ? '<span class="material-symbols-rounded" style="font-size:14px">desktop_windows</span>'
      : '<span class="material-symbols-rounded" style="font-size:14px">account_tree</span>';
    envBarHtml = `
      <div class="ag2r-new-session-env-bar">
        <button type="button" class="ag2r-env-chip" data-ag-click-id="env:0" data-ag-click-label="${environmentName}">
          ${envIcon}
          <span>${environmentName}</span>
          <span class="material-symbols-rounded" style="font-size:12px">expand_more</span>
        </button>
        ${branchName ? `
        <button type="button" class="ag2r-env-chip" data-ag-click-id="env:1" data-ag-click-label="${branchName}">
          <span class="material-symbols-rounded" style="font-size:14px">fork_right</span>
          <span>${branchName}</span>
          <span class="material-symbols-rounded" style="font-size:12px">expand_more</span>
        </button>
        ` : ''}
      </div>
    `;
  }

  container.innerHTML = `
    <div class="ag2r-new-session">
      <div class="ag2r-new-session-header">
        ${projectName ? `<button type="button" class="ag2r-new-session-project" data-ag-click-id="project:0" data-ag-click-label="${projectName}">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 -960 960 960" fill="currentColor">
            <path d="M172.31-180Q142-180 121-201t-21-51.31V-707.69Q100-738 121-759t51.31-21H391.92l80,80H787.69Q818-700 839-679t21,51.31v375.38Q860-222 839-201t-51.31,21H172.31Z"/>
          </svg>
          <span>${projectName}</span>
          <span class="material-symbols-rounded" style="font-size:14px;opacity:0.6">expand_more</span>
        </button>` : ''}
      </div>
      <form id="ag2r-new-session-form" class="ag2r-new-session-form ${envBarHtml ? 'has-env-bar' : ''}">
        <div class="ag2r-new-session-inner">
          <div id="ag2r-ns-image-preview" class="image-preview-strip hidden"></div>
          <textarea
            id="ag2r-new-session-input"
            placeholder="Ask anything, @ to mention, / for actions"
            rows="3"
          ></textarea>
          <div class="ag2r-new-session-controls">
            <div class="ag2r-new-session-left">
              <input type="file" id="ag2r-ns-photo-input" accept="image/*" multiple hidden>
              <button type="button" id="ag2r-ns-attach" class="attach-btn" aria-label="Add context">
                <span class="material-symbols-rounded">add</span>
              </button>
              <button type="button" class="ag2r-ns-model-chip model-chip" data-ag-click-id="model:0" data-ag-click-label="${modelName}">
                <span class="model-chip-text">${modelName}</span>
                <span class="material-symbols-rounded model-chip-chevron">expand_more</span>
              </button>
            </div>
            <div class="ag2r-new-session-right">
              <button type="button" id="ag2r-new-session-mic" class="mic-btn" aria-label="Voice input">
                <span class="material-symbols-rounded mic-icon">mic</span>
              </button>
              <button type="submit" id="ag2r-new-session-send" aria-label="Send">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 -960 960 960" fill="currentColor">
                  <path d="M120-160v-640l760,320-760,320Zm60-93 544-227-544-230v168l242,62-242,60v167Zm0,0v-457,457Z"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
        ${envBarHtml}
      </form>
    </div>
  `;

  const form = container.querySelector('#ag2r-new-session-form');
  const input = container.querySelector('#ag2r-new-session-input');
  const sendBtn = container.querySelector('#ag2r-new-session-send');

  const nsAttachBtn = container.querySelector('#ag2r-ns-attach');
  const nsPhotoInput = container.querySelector('#ag2r-ns-photo-input');
  const nsPreviewStrip = container.querySelector('#ag2r-ns-image-preview');

  const nsAttachMenu = createAttachMenu(
    container.querySelector('.ag2r-new-session-left'),
    nsPhotoInput
  );

  nsAttachBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    nsAttachMenu.classList.toggle('hidden');
  });

  nsPhotoInput.addEventListener('change', () => {
    const files = Array.from(nsPhotoInput.files);
    if (!files.length) return;
    const remaining = 3 - state.stagedImages.length;
    for (const file of files.slice(0, remaining)) {
      state.stagedImages.push({ file, objectUrl: URL.createObjectURL(file) });
    }
    renderImagePreviewsInto(nsPreviewStrip, nsAttachBtn);
    nsPhotoInput.value = '';
  });

  let nsIsSending = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    const hasImages = state.stagedImages.length > 0;
    if ((!text && !hasImages) || nsIsSending) return;
    nsIsSending = true;

    if (stopNsMic) stopNsMic();

    input.disabled = true;
    sendBtn.disabled = true;
    sendBtn.classList.add('sending');

    if (hasImages) {
      const uploadOk = await uploadStagedImages();
      if (!uploadOk) {
        console.debug('[NewSession] Some image uploads failed');
        nsIsSending = false;
        input.disabled = false;
        sendBtn.disabled = false;
        sendBtn.classList.remove('sending');
        return;
      }
      clearStagedImages();
      renderImagePreviewsInto(nsPreviewStrip, nsAttachBtn);
      await new Promise(r => setTimeout(r, 300));
    }

    if (text) {
      try {
        const res = await fetchAPI('/send', {
          method: 'POST',
          body: JSON.stringify({ message: text }),
        });
        const result = await res.json();
        console.debug('[NewSession] Send result:', result);
        if (result.ok) {
          input.value = '';
        }
      } catch (err) {
        console.debug('[NewSession] Send error:', err);
      }
    }

    nsIsSending = false;
    input.disabled = false;
    sendBtn.disabled = false;
    sendBtn.classList.remove('sending');
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !state.isMobile) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  const nsMicBtn = container.querySelector('#ag2r-new-session-mic');
  let stopNsMic = null;
  if (nsMicBtn) {
    stopNsMic = createVoiceInput(input, nsMicBtn);
  }

  addClickProxyHandlers(container);
  if (projectName) closeLeftSidebar();
}
