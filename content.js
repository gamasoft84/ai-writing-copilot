let activeField = null;
let triggerBtn = null;
let panel = null;
/** WhatsApp y otras apps mueven el foco entre nodos del composer; sin esto focusout borra el botón antes de tiempo. */
let hideTriggerTimer = null;

function isEditable(el) {
  return (
    el.tagName === 'TEXTAREA' ||
    (el.tagName === 'INPUT' && el.type !== 'hidden') ||
    el.getAttribute('contenteditable') === 'true' ||
    el.getAttribute('contenteditable') === ''
  );
}

function getText() {
  if (!activeField) return '';
  if (activeField.tagName === 'TEXTAREA' || activeField.tagName === 'INPUT') {
    return activeField.value;
  }
  return activeField.innerText || activeField.textContent || '';
}

function setText(text) {
  if (!activeField) return;
  if (activeField.tagName === 'TEXTAREA' || activeField.tagName === 'INPUT') {
    activeField.value = text;
    activeField.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    activeField.innerText = text;
    activeField.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function createTriggerBtn(field) {
  removeTriggerBtn();
  const rect = field.getBoundingClientRect();
  triggerBtn = document.createElement('div');
  triggerBtn.className = 'copilot-trigger';
  triggerBtn.innerHTML = '✦';
  triggerBtn.title = 'AI Writing Co-Pilot (Ctrl+Shift+W)';
  triggerBtn.style.top = `${rect.top + window.scrollY + rect.height - 32}px`;
  triggerBtn.style.left = `${rect.right + window.scrollX - 36}px`;
  triggerBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  triggerBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openPanel();
  });
  document.body.appendChild(triggerBtn);
}

function removeTriggerBtn() {
  if (triggerBtn) { triggerBtn.remove(); triggerBtn = null; }
}

function openPanel() {
  closePanel();
  const text = getText();
  if (!text.trim()) {
    showToast('Escribe algo primero');
    return;
  }

  panel = document.createElement('div');
  panel.className = 'copilot-panel';
  panel.innerHTML = `
    <div class="copilot-header">
      <span>✦ AI Writing Co-Pilot</span>
      <button class="copilot-close" id="copilotClose">✕</button>
    </div>
    <div class="copilot-original">
      <div class="copilot-label">Tu texto</div>
      <div class="copilot-text-preview" id="copilotPreview">${escapeHtml(text)}</div>
    </div>
    <div style="padding: 10px 14px 6px">
      <div class="copilot-label" style="margin-bottom:8px">¿Qué quieres hacer?</div>
      <div class="copilot-actions">
        <button class="copilot-btn" data-action="mejorar-es">Mejorar en español</button>
        <button class="copilot-btn" data-action="mejorar-en">Mejorar en inglés</button>
        <button class="copilot-btn" data-action="traducir-en">ES → EN</button>
        <button class="copilot-btn" data-action="traducir-es">EN → ES</button>
        <button class="copilot-btn" data-action="profesional">Profesional</button>
        <button class="copilot-btn" data-action="casual">Casual</button>
        <button class="copilot-btn" data-action="empatico">Empático</button>
        <button class="copilot-btn" data-action="persuasivo">Persuasivo</button>
      </div>
    </div>
    <div class="copilot-loading" id="copilotLoading" style="display:none">
      <div class="copilot-spinner"></div>
      <span>Reescribiendo...</span>
    </div>
    <div class="copilot-result" id="copilotResult" style="display:none">
      <div class="copilot-label">Resultado</div>
      <div class="copilot-result-text" id="copilotResultText"></div>
      <div class="copilot-result-actions">
        <button class="copilot-btn-primary" id="copilotReplace">Reemplazar texto</button>
        <button class="copilot-btn-secondary" id="copilotCopy">Copiar</button>
      </div>
    </div>
    <div class="copilot-error" id="copilotError" style="display:none"></div>
  `;

  document.body.appendChild(panel);
  positionPanel();

  document.getElementById('copilotClose').onclick = closePanel;

  panel.querySelectorAll('.copilot-btn[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      panel.querySelectorAll('.copilot-btn[data-action]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      handleAction(btn.dataset.action, text);
    });
  });

  document.getElementById('copilotReplace').onclick = () => {
    const result = document.getElementById('copilotResultText').innerText;
    setText(result);
    closePanel();
    showToast('Texto reemplazado');
  };

  document.getElementById('copilotCopy').onclick = () => {
    const result = document.getElementById('copilotResultText').innerText;
    navigator.clipboard.writeText(result).then(() => {
      document.getElementById('copilotCopy').textContent = '¡Copiado!';
      setTimeout(() => {
        if (document.getElementById('copilotCopy')) {
          document.getElementById('copilotCopy').textContent = 'Copiar';
        }
      }, 1500);
    });
  };
}

function positionPanel() {
  if (!panel || !activeField) return;
  const rect = activeField.getBoundingClientRect();
  const panelH = 400;
  const margin = 8;
  let top = rect.bottom + window.scrollY + margin;
  if (rect.bottom + panelH + margin > window.innerHeight) {
    top = rect.top + window.scrollY - panelH - margin;
  }
  let left = rect.left + window.scrollX;
  if (left + 320 > window.innerWidth) left = window.innerWidth - 328;
  if (left < 8) left = 8;
  panel.style.top = `${Math.max(top, window.scrollY + 8)}px`;
  panel.style.left = `${left}px`;
}

function closePanel() {
  if (panel) { panel.remove(); panel = null; }
}

function showToast(msg) {
  const t = document.createElement('div');
  t.className = 'copilot-toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

async function handleAction(action, text) {
  document.getElementById('copilotLoading').style.display = 'flex';
  document.getElementById('copilotResult').style.display = 'none';
  document.getElementById('copilotError').style.display = 'none';

  const prompts = {
    'mejorar-es': `Mejora este texto en español. Hazlo más claro, natural y fluido sin cambiar el significado. Devuelve SOLO el texto mejorado, sin explicaciones:\n\n${text}`,
    'mejorar-en': `Improve this text in English. Make it clear, natural and fluent without changing the meaning. Return ONLY the improved text, no explanations:\n\n${text}`,
    'traducir-en': `Traduce este texto al inglés de forma natural y profesional. Si ya está en inglés, mejóralo. Devuelve SOLO la traducción:\n\n${text}`,
    'traducir-es': `Traduce este texto al español mexicano de forma natural. Si ya está en español, mejóralo. Devuelve SOLO la traducción:\n\n${text}`,
    'profesional': `Reescribe este texto con un tono profesional y formal, en el mismo idioma en que está escrito. Devuelve SOLO el texto:\n\n${text}`,
    'casual': `Reescribe este texto con un tono casual, amigable y cercano, en el mismo idioma en que está escrito. Devuelve SOLO el texto:\n\n${text}`,
    'empatico': `Reescribe este texto con un tono empático, cálido y comprensivo, en el mismo idioma en que está escrito. Devuelve SOLO el texto:\n\n${text}`,
    'persuasivo': `Reescribe este texto con un tono persuasivo y convincente, en el mismo idioma en que está escrito. Devuelve SOLO el texto:\n\n${text}`
  };

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'REWRITE',
      prompt: prompts[action]
    });

    document.getElementById('copilotLoading').style.display = 'none';

    if (response.error) {
      document.getElementById('copilotError').style.display = 'block';
      document.getElementById('copilotError').textContent = response.error;
      return;
    }

    document.getElementById('copilotResultText').textContent = response.result;
    document.getElementById('copilotResult').style.display = 'block';

  } catch (err) {
    document.getElementById('copilotLoading').style.display = 'none';
    document.getElementById('copilotError').style.display = 'block';
    document.getElementById('copilotError').textContent = 'Error al conectar. Revisa tu API key';
  }
}

function scheduleRemoveTriggerBtn() {
  if (panel) return;
  if (hideTriggerTimer) clearTimeout(hideTriggerTimer);
  hideTriggerTimer = setTimeout(() => {
    hideTriggerTimer = null;
    if (panel) return;
    const ae = document.activeElement;
    const stillInside =
      activeField &&
      activeField.isConnected &&
      (activeField === ae || activeField.contains(ae));
    if (!stillInside && ae !== triggerBtn) {
      removeTriggerBtn();
    }
  }, 450);
}

// Eventos (capture: true para captar foco dentro de shadow DOM / estructuras como WhatsApp Web)
document.addEventListener(
  'focusin',
  (e) => {
    if (hideTriggerTimer) {
      clearTimeout(hideTriggerTimer);
      hideTriggerTimer = null;
    }
    if (isEditable(e.target) && !e.target.closest('.copilot-panel')) {
      activeField = e.target;
      createTriggerBtn(e.target);
    }
  },
  true
);

document.addEventListener(
  'focusout',
  () => {
    scheduleRemoveTriggerBtn();
  },
  true
);

document.addEventListener('click', (e) => {
  if (panel && !panel.contains(e.target) && e.target !== triggerBtn) {
    closePanel();
  }
});

document.addEventListener('scroll', () => {
  if (triggerBtn && activeField) createTriggerBtn(activeField);
  if (panel) positionPanel();
});

// Shortcut Ctrl+Shift+W
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && e.key === 'W') {
    e.preventDefault();
    if (panel) closePanel();
    else if (activeField) openPanel();
  }
});
