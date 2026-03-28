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

    console.log('[Copilot] Llamando a Anthropic API...');

    const response = await fetch('https://mi-worker.richardgama.workers.dev', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: 'Eres un asistente experto en comunicación escrita. Reescribes textos según las instrucciones del usuario. Siempre devuelves SOLO el texto reescrito, sin explicaciones, sin comillas, sin prefijos como Aquí está: o Resultado:.',
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

    return { result: data.content[0].text.trim() };

  } catch (err) {
    console.error('[Copilot] Error:', err.message);
    return { error: 'Error: ' + err.message };
  }
}