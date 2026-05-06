// netlify/functions/chat.js
// Utilise OpenAI (crédits gratuits offerts) avec fallback Gemini
exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const openaiKey    = process.env.OpenAI_API_Key;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  try {
    const body     = JSON.parse(event.body);
    const messages = body.messages || [];
    const system   = body.system || '';

    // ── Anthropic si crédits dispo ──
    if (anthropicKey) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type':'application/json', 'x-api-key':anthropicKey, 'anthropic-version':'2023-06-01' },
        body: JSON.stringify({ model:'claude-sonnet-4-20250514', max_tokens:body.max_tokens||1000, system, messages })
      });
      const data = await res.json();
      if (res.ok) return { statusCode:200, headers, body:JSON.stringify(data) };
      if (!data.error?.message?.includes('credit') && !data.error?.message?.includes('balance')) {
        return { statusCode:res.status, headers, body:JSON.stringify(data) };
      }
    }

    // ── OpenAI ──
    if (!openaiKey) {
      return { statusCode:500, headers, body:JSON.stringify({ error:'Ajoutez OPENAI_API_KEY dans Netlify' }) };
    }

    // Convertir messages + images au format OpenAI
    const openaiMessages = [];
    if (system) openaiMessages.push({ role:'system', content: system });

    messages.forEach(m => {
      if (typeof m.content === 'string') {
        openaiMessages.push({ role: m.role, content: m.content });
      } else if (Array.isArray(m.content)) {
        const parts = m.content.map(c => {
          if (c.type === 'text') return { type:'text', text:c.text };
          if (c.type === 'image' && c.source?.data) {
            return { type:'image_url', image_url:{ url:`data:${c.source.media_type};base64,${c.source.data}` } };
          }
          return null;
        }).filter(Boolean);
        openaiMessages.push({ role: m.role, content: parts });
      }
    });

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'Authorization':'Bearer '+openaiKey },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: body.max_tokens || 1000,
        messages: openaiMessages
      })
    });

    const data = await res.json();
    if (!res.ok) return { statusCode:res.status, headers, body:JSON.stringify({ error:data.error?.message||'OpenAI error' }) };

    const text = data.choices?.[0]?.message?.content || '';

    // Retourner au format Anthropic pour compatibilité frontend
    return {
      statusCode: 200, headers,
      body: JSON.stringify({ content:[{ type:'text', text }], model:'gpt-4o-mini' })
    };

  } catch (err) {
    return { statusCode:500, headers, body:JSON.stringify({ error:'Server error: '+err.message }) };
  }
};
