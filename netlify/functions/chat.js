// netlify/functions/chat.js
// Utilise Google Gemini (gratuit — 1500 req/jour)
exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const geminiKey   = process.env.GeminiAPI;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  try {
    const body     = JSON.parse(event.body);
    const messages = body.messages || [];
    const system   = body.system || '';

    // ── Essaie Anthropic si crédits disponibles ──
    if (anthropicKey) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: body.model || 'claude-sonnet-4-20250514',
          max_tokens: body.max_tokens || 1000,
          system, messages
        })
      });
      const data = await res.json();
      if (res.ok) return { statusCode: 200, headers, body: JSON.stringify(data) };
      // Tombe sur Gemini si pas de crédits
      if (!data.error?.message?.includes('credit') && !data.error?.message?.includes('balance')) {
        return { statusCode: res.status, headers, body: JSON.stringify(data) };
      }
    }

    // ── Gemini (gratuit) ──
    if (!geminiKey) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Clé GeminiAPI manquante dans Netlify' }) };
    }

    // Convertir messages au format Gemini
    let geminiContents = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: typeof m.content === 'string'
        ? m.content
        : (m.content || []).filter(c => c.type === 'text').map(c => c.text).join('') }]
    }));

    // Injecter system prompt dans le premier message
    if (system && geminiContents.length > 0) {
      geminiContents[0].parts[0].text = system + '\n\n' + geminiContents[0].parts[0].text;
    }

    // Gérer les images
    const lastMsg = messages[messages.length - 1];
    if (Array.isArray(lastMsg?.content)) {
      const parts = [];
      lastMsg.content.forEach(c => {
        if (c.type === 'image' && c.source?.data) {
          parts.push({ inline_data: { mime_type: c.source.media_type, data: c.source.data } });
        } else if (c.type === 'text') {
          parts.push({ text: (system ? system + '\n\n' : '') + c.text });
        }
      });
      if (parts.length > 0) {
        geminiContents[geminiContents.length - 1].parts = parts;
      }
    }

    const gRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: geminiContents })
      }
    );

    const gData = await gRes.json();
    if (!gRes.ok) {
      return { statusCode: gRes.status, headers, body: JSON.stringify({ error: gData.error?.message || 'Gemini error' }) };
    }

    const text = gData.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Retourner dans le format Anthropic pour compatibilité frontend
    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        content: [{ type: 'text', text }],
        model: 'gemini-1.5-flash'
      })
    };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server error: ' + err.message }) };
  }
};
