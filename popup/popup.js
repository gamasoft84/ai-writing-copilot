const apiKeyInput = document.getElementById('apiKey');
const saveBtn = document.getElementById('saveBtn');
const statusEl = document.getElementById('status');
const toggleVis = document.getElementById('toggleVis');

// Cargar key guardada
chrome.storage.sync.get('apiKey', ({ apiKey }) => {
  if (apiKey) apiKeyInput.value = apiKey;
});

// Mostrar/ocultar key
toggleVis.addEventListener('click', () => {
  apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
});

// Guardar
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
  chrome.storage.sync.set({ apiKey: key }, () => {
    showStatus('Guardado correctamente ✓', 'ok');
  });
});

function showStatus(msg, type) {
  statusEl.textContent = msg;
  statusEl.className = `status ${type}`;
  setTimeout(() => {
    statusEl.textContent = '';
    statusEl.className = 'status';
  }, 3000);
}
