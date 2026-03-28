chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'REWRITE') {
    handleRewrite(message.prompt).then(sendResponse);
    return true;
  }
});

async function handleRewrite(prompt) {
  try {
    const { apiKey } = await chrome.storage.sync.get('apiKey');

    console.log('[Copilot] API key encontrada:', !!apiKey);
    if (apiKey) console.log('[Copilot] Prefix:', apiKey.substring(0, 14));

    if (!apiKey || !apiKey.startsWith('sk-ant-')) {
      return { error: 'API key no configurada. Haz clic en el ícono de la extensión para agregarla.' };
    }

    console.log('[Copilot] Llamando al worker...');

    const response = await fetch('https://mi-worker.richardgama.workers.dev', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey
      },
      body: JSON.stringify({ prompt })
    });

    console.log('[Copilot] HTTP status:', response.status);
    const data = await response.json();
    console.log('[Copilot] Response:', JSON.stringify(data));

    if (!response.ok) {
      const msg = data.error?.message || 'Error en la API';
      if (response.status === 401) return { error: 'API key inválida. Verifica tu clave.' };
      if (response.status === 429) return { error: 'Demasiadas solicitudes. Espera un momento.' };
      return { error: msg };
    }

    const text = extractWorkerText(data);
    if (text == null) {
      return { error: 'Respuesta del servidor en formato no reconocido.' };
    }
    return { result: text };

  } catch (err) {
    console.error('[Copilot] Error:', err.message);
    return { error: 'Error: ' + err.message };
  }
}

/** Acepta respuesta tipo Anthropic o JSON plano del worker. */
function extractWorkerText(data) {
  if (typeof data === 'string') return data.trim();
  const fromAnthropic = data.content?.[0]?.text;
  if (typeof fromAnthropic === 'string') return fromAnthropic.trim();
  for (const key of ['text', 'result', 'reply', 'output']) {
    const v = data[key];
    if (typeof v === 'string') return v.trim();
  }
  return null;
}