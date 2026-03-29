const apiKeyInput = document.getElementById('apiKey');
const saveBtn = document.getElementById('saveBtn');
const statusEl = document.getElementById('status');
const toggleVis = document.getElementById('toggleVis');
const waResponderToggle = document.getElementById('waResponderToggle');

function showStatus(msg, type) {
  statusEl.textContent = msg;
  statusEl.className = `status ${type}`;
  setTimeout(() => {
    statusEl.textContent = '';
    statusEl.className = 'status';
  }, 3000);
}

chrome.storage.local.get(['apiKey', 'waResponderEnabled'], (data) => {
  if (data.apiKey) {
    apiKeyInput.value = data.apiKey;
  } else {
    chrome.storage.sync.get('apiKey', (sync) => {
      if (sync.apiKey) {
        apiKeyInput.value = sync.apiKey;
        chrome.storage.local.set({ apiKey: sync.apiKey });
        chrome.storage.sync.remove('apiKey');
      }
    });
  }
  if (waResponderToggle) {
    waResponderToggle.checked = data.waResponderEnabled === true;
  }
});

toggleVis.addEventListener('click', () => {
  apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
});

if (waResponderToggle) {
  waResponderToggle.addEventListener('change', () => {
    chrome.storage.local.set({ waResponderEnabled: waResponderToggle.checked });
  });
}

saveBtn.addEventListener('click', () => {
  const key = apiKeyInput.value.trim();
  if (!key) {
    showStatus('Ingresa tu API key', 'err');
    return;
  }
  if (!key.startsWith('sk-ant-')) {
    showStatus('La key debe empezar con sk-ant-', 'err');
    return;
  }
  const waResponderEnabled = waResponderToggle ? waResponderToggle.checked : false;
  chrome.storage.sync.remove('apiKey');
  chrome.storage.local.set({ apiKey: key, waResponderEnabled }, () => {
    showStatus('Guardado correctamente ✓', 'ok');
  });
});
