/** Misma llamada que index.js (worker) pero desde el service worker. */
const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'REWRITE') {
    handleRewrite(message.prompt).then(sendResponse);
    return true;
  }
});

async function handleRewrite(prompt) {
  try {
    let { apiKey } = await chrome.storage.local.get('apiKey');
    if (!apiKey) {
      const sync = await chrome.storage.sync.get('apiKey');
      apiKey = sync.apiKey;
    }

    console.log('[Copilot] API key encontrada:', !!apiKey);
    if (apiKey) console.log('[Copilot] Prefix:', apiKey.substring(0, 14));

    if (!apiKey || !apiKey.startsWith('sk-ant-')) {
      return { error: 'API key no configurada. Haz clic en el ícono de la extensión para agregarla.' };
    }

    console.log('[Copilot] Llamando a Anthropic API...');

    const response = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        // Requerido por Anthropic para peticiones desde entorno de navegador (MV3 service worker).
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system:
          'Eres un asistente experto en comunicación escrita. Devuelve SOLO el texto reescrito, sin explicaciones.',
        messages: [{ role: 'user', content: prompt }]
      })
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

    const text = data.content?.[0]?.text;
    if (typeof text !== 'string') {
      return { error: 'Respuesta de Anthropic en formato inesperado.' };
    }
    return { result: text.trim() };
  } catch (err) {
    console.error('[Copilot] Error:', err.message);
    return { error: 'Error: ' + err.message };
  }
}
