let activeField = null;
let triggerBtn = null;
let panel = null;
/** WhatsApp y otras apps mueven el foco entre nodos del composer; sin esto focusout borra el botón antes de tiempo. */
let hideTriggerTimer = null;
/** Tras arrastrar el panel, no lo reubica el scroll junto al campo. */
let panelSkipFollowScroll = false;

function isEditable(el) {
  return (
    el.tagName === 'TEXTAREA' ||
    (el.tagName === 'INPUT' && el.type !== 'hidden') ||
    el.getAttribute('contenteditable') === 'true' ||
    el.getAttribute('contenteditable') === ''
  );
}

/** Sube hasta el nodo con contenteditable="true" (WhatsApp enfoca hijos internos). */
function getEditableSurface(el) {
  if (!el || el.nodeType !== 1) return el;
  let n = el;
  for (let i = 0; i < 24 && n; i++) {
    if (
      n.getAttribute('contenteditable') === 'true' ||
      n.getAttribute('contenteditable') === ''
    ) {
      return n;
    }
    n = n.parentElement;
  }
  return el;
}

function getText() {
  if (!activeField) return '';
  if (activeField.tagName === 'TEXTAREA' || activeField.tagName === 'INPUT') {
    return activeField.value;
  }
  const surface = getEditableSurface(activeField);
  return surface.innerText || surface.textContent || '';
}

function normCompare(s) {
  return (s || '').replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim();
}

function selectAllInSurface(surface) {
  surface.focus();
  try {
    const range = document.createRange();
    range.selectNodeContents(surface);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  } catch (_) {
    /* ignore */
  }
}

/** Gmail / Facebook / contenteditables que sí reaccionan a insertText o innerText. */
function replaceContentEditableGeneric(surface, text) {
  selectAllInSurface(surface);

  let ok = false;
  try {
    ok = document.execCommand('insertText', false, text);
  } catch (_) {
    ok = false;
  }

  if (!ok) {
    surface.innerText = text;
    try {
      surface.dispatchEvent(new Event('input', { bubbles: true }));
    } catch (_) {
      /* ignore */
    }
  }

  try {
    surface.dispatchEvent(new Event('change', { bubbles: true }));
  } catch (_) {
    /* ignore */
  }

  return true;
}

/**
 * WhatsApp Web (React): innerText solo no actualiza el estado; hay que verificar
 * y usar portapapeles + paste como respaldo (gesto del usuario en "Reemplazar").
 */
async function replaceWhatsAppComposer(surface, text) {
  const expected = normCompare(text);

  selectAllInSurface(surface);
  try {
    document.execCommand('insertText', false, text);
  } catch (_) {
    /* ignore */
  }

  await new Promise((r) => requestAnimationFrame(r));

  if (normCompare(surface.innerText) === expected) {
    return true;
  }

  try {
    await navigator.clipboard.writeText(text);
  } catch (_) {
    /* sigue con innerText abajo */
  }

  selectAllInSurface(surface);
  try {
    document.execCommand('paste');
  } catch (_) {
    /* ignore */
  }

  await new Promise((r) => requestAnimationFrame(r));
  await new Promise((r) => setTimeout(r, 60));

  if (normCompare(surface.innerText) === expected) {
    return true;
  }

  surface.innerText = text;
  try {
    surface.dispatchEvent(new Event('input', { bubbles: true }));
  } catch (_) {
    /* ignore */
  }

  await new Promise((r) => requestAnimationFrame(r));

  return normCompare(surface.innerText) === expected;
}

/** Usar al pulsar "Reemplazar": devuelve si el cuadro quedó con el texto esperado. */
async function applyReplacementText(text, el) {
  const target = el != null ? el : activeField;
  if (!target || !target.isConnected) return false;

  if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') {
    target.focus();
    target.value = text;
    target.dispatchEvent(new Event('input', { bubbles: true }));
    try {
      target.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (_) {
      /* ignore */
    }
    return true;
  }

  const surface = getEditableSurface(target);
  if (!surface || !surface.isConnected) return false;

  if (location.hostname === 'web.whatsapp.com') {
    return replaceWhatsAppComposer(surface, text);
  }

  return replaceContentEditableGeneric(surface, text);
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

  chrome.storage.local.get(['waResponderEnabled'], ({ waResponderEnabled }) => {
    openPanelWithText(text, waResponderEnabled === true);
  });
}

function openPanelWithText(text, waResponderEnabled) {
  panelSkipFollowScroll = false;

  const lang = detectContentLanguage(text);
  const badge = langBadgeMeta(lang);
  const waSurface = getEditableSurface(activeField);
  const waQuoted =
    waResponderEnabled && isWhatsAppWeb() ? extractWhatsAppQuotedContext(waSurface) : '';

  panel = document.createElement('div');
  panel.className = 'copilot-panel';
  panel.innerHTML = `
    <div class="copilot-header" title="Arrastra para mover el panel">
      <span class="copilot-header-title">✦ AI Writing Co-Pilot</span>
      <button type="button" class="copilot-close" id="copilotClose" aria-label="Cerrar">✕</button>
    </div>
    <div class="copilot-original">
      <div class="copilot-original-head">
        <div class="copilot-label">Tu texto</div>
        <span class="copilot-lang-badge ${badge.cls}">${escapeHtml(badge.text)}</span>
      </div>
      ${waResponderEnabled ? waQuotePreviewHtml(waQuoted) : ''}
      <div class="copilot-text-preview" id="copilotPreview">${escapeHtml(text)}</div>
    </div>
    <div class="copilot-actions-wrap">
      <p class="copilot-smart-hint">${escapeHtml(smartHintForLang(lang, waResponderEnabled))}</p>
      ${buildActionsSectionsHTML(lang, waResponderEnabled)}
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

  /** Campo al abrir el panel (evita activeField obsoleto tras re-render de la página). */
  const targetFieldAtOpen = activeField;

  const $p = (sel) => panel.querySelector(sel);

  $p('#copilotClose').addEventListener('click', (e) => {
    e.stopPropagation();
    closePanel();
  });

  panel.querySelectorAll('.copilot-btn[data-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.querySelectorAll('.copilot-btn[data-action]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      handleAction(btn.dataset.action, text, { waQuoted });
    });
  });

  $p('#copilotReplace').addEventListener('click', async (e) => {
    e.stopPropagation();
    const resultEl = $p('#copilotResultText');
    const result = resultEl ? resultEl.textContent : '';
    const field =
      targetFieldAtOpen && targetFieldAtOpen.isConnected
        ? targetFieldAtOpen
        : activeField && activeField.isConnected
          ? activeField
          : null;
    if (!field) {
      showToast('No se encontró el campo de texto. Prueba de nuevo.');
      closePanel();
      return;
    }
    const ok = await applyReplacementText(result, field);
    if (!ok) {
      showToast('WhatsApp bloqueó el reemplazo. Copia el resultado y pégalo (Ctrl+V).');
      closePanel();
      return;
    }
    closePanel();
    showToast('Texto reemplazado');
  });

  $p('#copilotCopy').addEventListener('click', (e) => {
    e.stopPropagation();
    const result = ($p('#copilotResultText') || {}).textContent || '';
    navigator.clipboard.writeText(result).then(() => {
      const copyBtn = $p('#copilotCopy');
      if (copyBtn) copyBtn.textContent = '¡Copiado!';
      setTimeout(() => {
        const b = panel && panel.querySelector('#copilotCopy');
        if (b) b.textContent = 'Copiar';
      }, 1500);
    });
  });

  attachPanelDrag(panel);
}


function attachPanelDrag(panelEl) {
  const header = panelEl.querySelector('.copilot-header');
  if (!header) return;

  header.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.target.closest('.copilot-close')) return;

    const rect = panelEl.getBoundingClientRect();
    const offsetX = e.clientX + window.scrollX - (rect.left + window.scrollX);
    const offsetY = e.clientY + window.scrollY - (rect.top + window.scrollY);
    const start = { x: e.clientX, y: e.clientY };
    let moved = false;

    header.classList.add('copilot-dragging');

    const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

    const onMove = (ev) => {
      if (Math.abs(ev.clientX - start.x) > 3 || Math.abs(ev.clientY - start.y) > 3) moved = true;

      const w = panelEl.offsetWidth;
      const h = panelEl.offsetHeight;
      const px = ev.clientX + window.scrollX - offsetX;
      const py = ev.clientY + window.scrollY - offsetY;
      const minL = window.scrollX + 4;
      const minT = window.scrollY + 4;
      const maxL = window.scrollX + window.innerWidth - w - 4;
      const maxT = window.scrollY + window.innerHeight - h - 4;
      panelEl.style.left = `${clamp(px, minL, Math.max(minL, maxL))}px`;
      panelEl.style.top = `${clamp(py, minT, Math.max(minT, maxT))}px`;
    };

    const onUp = () => {
      header.classList.remove('copilot-dragging');
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      if (moved) panelSkipFollowScroll = true;
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);

    e.preventDefault();
  });
}

function positionPanel() {
  if (!panel || !activeField || panelSkipFollowScroll) return;
  const rect = activeField.getBoundingClientRect();
  const panelH = 460;
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
  if (panel) {
    panel.remove();
    panel = null;
  }
  panelSkipFollowScroll = false;
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

function isWhatsAppWeb() {
  return location.hostname === 'web.whatsapp.com';
}

/** Texto visible de un subárbol (prioriza spans que WA usa para mensajes/citas). */
function collectSelectableText(root) {
  if (!root) return '';
  const parts = [];
  const spans = root.querySelectorAll('span.selectable-text');
  if (spans.length) {
    spans.forEach((s) => {
      const t = (s.innerText || '').trim();
      if (t) parts.push(t);
    });
    return parts.join('\n').trim();
  }
  return (root.innerText || '').trim();
}

/**
 * WhatsApp: al responder, la cita suele estar en un hermano anterior del bloque del editor.
 */
function extractWhatsAppQuotedContext(surface) {
  if (!isWhatsAppWeb() || !surface || !surface.isConnected) return '';
  const draft = normCompare(surface.innerText || surface.textContent || '');

  let node = surface;
  for (let depth = 0; depth < 22 && node; depth++) {
    let sib = node.previousElementSibling;
    while (sib) {
      const raw = collectSelectableText(sib);
      const n = normCompare(raw);
      if (
        n.length >= 2 &&
        n !== draft &&
        n.length <= 6000 &&
        (!draft || !draft.includes(n) || n.length < draft.length * 0.95)
      ) {
        return raw.slice(0, 8000);
      }
      sib = sib.previousElementSibling;
    }
    node = node.parentElement;
  }
  return '';
}

function waQuotePreviewHtml(quoted) {
  if (!quoted) return '';
  const short = quoted.length > 140 ? `${quoted.slice(0, 140)}…` : quoted;
  return `<div class="copilot-wa-quote" title="${escapeHtml(quoted)}">Respondiendo a: ${escapeHtml(short)}</div>`;
}

/** Heurística local (sin API): suficiente para priorizar botones en el panel. */
function detectContentLanguage(text) {
  const sample = text.slice(0, 2500).toLowerCase();
  const trimmed = sample.trim();
  if (trimmed.length < 10) return 'unknown';

  const esMarks = (sample.match(/[áéíóúüñ¿¡]/g) || []).length;
  const esRe =
    /\b(el|la|los|las|que|qué|cómo|de|y|en|un|una|por|para|con|está|están|tengo|hay|soy|hola|gracias|más|muy|también|este|esta|como|cuando|donde|dónde|porque|usted|señor|señora)\b/g;
  const enRe =
    /\b(the|and|of|to|a|an|in|is|are|was|were|you|your|this|that|with|from|for|they|hello|thanks|what|when|where|how|about|would|could|please|don't|I'm)\b/g;
  const esHits = (sample.match(esRe) || []).length;
  const enHits = (sample.match(enRe) || []).length;

  if (esMarks >= 2 && esHits >= 2 && esHits >= enHits - 1) return 'es';
  if (esHits >= 4 && esHits > enHits + 1) return 'es';
  if (enHits >= 4 && enHits > esHits + 1 && esMarks <= 1) return 'en';
  if (esHits >= 2 && enHits >= 2 && Math.abs(esHits - enHits) <= 3) return 'mixed';
  if (esHits > enHits) return 'es';
  if (enHits > esHits) return 'en';
  return 'unknown';
}

function langBadgeMeta(lang) {
  switch (lang) {
    case 'es':
      return { text: 'Español', cls: '' };
    case 'en':
      return { text: 'English', cls: '' };
    case 'mixed':
      return { text: 'Mixto ES · EN', cls: 'copilot-lang-mixed' };
    default:
      return { text: 'Auto', cls: 'copilot-lang-unknown' };
  }
}

function smartHintForLang(lang, waResponderEnabled) {
  let s = '';
  switch (lang) {
    case 'es':
      s = 'Parece español: opciones de mejora, traducción a inglés y tono.';
      break;
    case 'en':
      s = 'Looks like English: improve, translate to Spanish, and tone.';
      break;
    case 'mixed':
      s = 'Texto mixto: usa la sección que coincida con cada parte.';
      break;
    default:
      s = 'No estamos seguros del idioma; tienes todas las opciones.';
  }
  if (waResponderEnabled && isWhatsAppWeb()) {
    s += ' Usa "Responder a este mensaje" si abriste respuesta con la flecha ↩️ sobre un chat.';
  }
  return s;
}

function buildActionsSectionsHTML(lang, waResponderEnabled) {
  const toneEs = [
    { action: 'profesional', label: 'Profesional' },
    { action: 'casual', label: 'Casual' },
    { action: 'empatico', label: 'Empático' },
    { action: 'persuasivo', label: 'Persuasivo' }
  ];
  const toneEn = [
    { action: 'profesional', label: 'Professional' },
    { action: 'casual', label: 'Casual' },
    { action: 'empatico', label: 'Empathetic' },
    { action: 'persuasivo', label: 'Persuasive' }
  ];
  const smartEs = [
    { action: 'acortar', label: 'Más corto' },
    { action: 'expandir', label: 'Más detalle' }
  ];
  const smartEn = [
    { action: 'acortar', label: 'Shorter' },
    { action: 'expandir', label: 'More detail' }
  ];

  let html = '';
  const section = (title, buttons) => {
    if (!buttons.length) return;
    html += `<div class="copilot-section-label">${escapeHtml(title)}</div><div class="copilot-actions">`;
    for (const b of buttons) {
      html += `<button type="button" class="copilot-btn" data-action="${escapeHtml(b.action)}">${escapeHtml(b.label)}</button>`;
    }
    html += '</div>';
  };

  if (waResponderEnabled && isWhatsAppWeb()) {
    section('WhatsApp', [
      { action: 'responder-wa', label: 'Responder a este mensaje' }
    ]);
  }

  if (lang === 'es') {
    section('Mejorar y traducir', [
      { action: 'mejorar-es', label: 'Mejorar (español)' },
      { action: 'traducir-en', label: 'Traducir a inglés' }
    ]);
    section('Longitud', smartEs);
    section('Tono', toneEs);
  } else if (lang === 'en') {
    section('Improve & translate', [
      { action: 'mejorar-en', label: 'Improve (English)' },
      { action: 'traducir-es', label: 'Translate to Spanish' }
    ]);
    section('Length', smartEn);
    section('Tone', toneEn);
  } else if (lang === 'mixed') {
    section('Español', [
      { action: 'mejorar-es', label: 'Mejorar en español' },
      { action: 'traducir-en', label: 'ES → EN' }
    ]);
    section('English', [
      { action: 'mejorar-en', label: 'Improve in English' },
      { action: 'traducir-es', label: 'EN → ES' }
    ]);
    section('Longitud / Length', smartEs);
    section('Tono (mismo idioma del párrafo)', toneEs);
  } else {
    section('Todas las opciones', [
      { action: 'mejorar-es', label: 'Mejorar (ES)' },
      { action: 'mejorar-en', label: 'Improve (EN)' },
      { action: 'traducir-en', label: 'ES → EN' },
      { action: 'traducir-es', label: 'EN → ES' }
    ]);
    section('Longitud', smartEs);
    section('Tono', toneEs);
  }

  return html;
}

async function handleAction(action, text, opts = {}) {
  if (!panel) return;
  const $p = (sel) => panel.querySelector(sel);

  $p('#copilotLoading').style.display = 'flex';
  $p('#copilotResult').style.display = 'none';
  $p('#copilotError').style.display = 'none';

  const waQuoted = opts.waQuoted || '';

  const responderWaPrompt =
    waQuoted.trim().length > 0
      ? `Eres quien escribe en WhatsApp y RESPONDE a este mensaje previo (lo envió otra persona):\n"""${waQuoted}"""\n\nBorrador actual de tu respuesta:\n"""${text}"""\n\nRedacta el mensaje final para enviar: coherente con lo que te dijeron, natural para chat, mismo idioma que el borrador salvo que el contexto pida otro registro. Solo el texto del mensaje, sin comillas ni "Aquí tienes".`
      : `Estás en WhatsApp pero no se pudo leer el mensaje citado (usa "Responder" en un mensaje para que aparezca arriba del cuadro). Mejora este borrador como respuesta de chat breve y natural. Solo el texto:\n\n${text}`;

  const prompts = {
    'responder-wa': responderWaPrompt,
    'mejorar-es': `Mejora este texto en español. Hazlo más claro, natural y fluido sin cambiar el significado. Devuelve SOLO el texto mejorado, sin explicaciones:\n\n${text}`,
    'mejorar-en': `Improve this text in English. Make it clear, natural and fluent without changing the meaning. Return ONLY the improved text, no explanations:\n\n${text}`,
    'traducir-en': `Traduce este texto al inglés de forma natural y profesional. Devuelve SOLO la traducción, sin notas:\n\n${text}`,
    'traducir-es': `Translate this text into natural Mexican Spanish. Return ONLY the translation, no notes:\n\n${text}`,
    'profesional': `Reescribe este texto con un tono profesional y formal, en el mismo idioma en que está escrito. Devuelve SOLO el texto:\n\n${text}`,
    'casual': `Reescribe este texto con un tono casual, amigable y cercano, en el mismo idioma en que está escrito. Devuelve SOLO el texto:\n\n${text}`,
    'empatico': `Reescribe este texto con un tono empático, cálido y comprensivo, en el mismo idioma en que está escrito. Devuelve SOLO el texto:\n\n${text}`,
    'persuasivo': `Reescribe este texto con un tono persuasivo y convincente, en el mismo idioma en que está escrito. Devuelve SOLO el texto:\n\n${text}`,
    'acortar': `Shorten the text below while keeping the SAME language as the source (do not translate) and the core meaning. Return ONLY the shorter text, no labels:\n\n${text}`,
    'expandir': `Expand the text below slightly with useful detail, same language and similar tone. Return ONLY the expanded text, no labels:\n\n${text}`
  };

  const prompt = prompts[action];
  if (!prompt) {
    $p('#copilotLoading').style.display = 'none';
    $p('#copilotError').style.display = 'block';
    $p('#copilotError').textContent = 'Acción no disponible';
    return;
  }

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'REWRITE',
      prompt
    });

    $p('#copilotLoading').style.display = 'none';

    if (response.error) {
      $p('#copilotError').style.display = 'block';
      $p('#copilotError').textContent = response.error;
      return;
    }

    $p('#copilotResultText').textContent = response.result;
    $p('#copilotResult').style.display = 'block';

  } catch (err) {
    if (!panel) return;
    const $p = (sel) => panel.querySelector(sel);
    $p('#copilotLoading').style.display = 'none';
    $p('#copilotError').style.display = 'block';
    $p('#copilotError').textContent = 'Error al conectar. Revisa tu API key';
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
