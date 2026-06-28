// Dual-provider AI proxy
// provider='anthropic' → Anthropic Messages API (extraction — accuracy critical)
// provider='groq' (default) → Groq OpenAI-compat API (narrative, lightweight — free tier)
// Both return OpenAI-compatible shape: { choices: [{ message: { content } }] }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    messages,
    max_tokens = 1024,
    temperature = 0.1,
    provider = 'groq',  // callers set 'anthropic' for extraction
    model = null        // optional model override; defaults handled per-provider
  } = req.body || {};

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array required' });
  }

  if (provider === 'anthropic') {
    return callAnthropic(req, res, messages, max_tokens, temperature, model);
  } else {
    return callGroq(req, res, messages, max_tokens, temperature, model);
  }
}

// ── Anthropic (extraction) ────────────────────────────────────────────────────
async function callAnthropic(req, res, messages, max_tokens, temperature, model) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured in Vercel environment variables.' });
  }

  const systemMsg = messages.find(m => m.role === 'system');
  const turns     = messages.filter(m => m.role !== 'system');
  const resolvedModel = model || 'claude-haiku-4-5-20251001';

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: resolvedModel,
        max_tokens,
        temperature,
        system: systemMsg?.content || '',
        messages: turns
      })
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error?.message || `Anthropic API error ${response.status}`
      });
    }

    // Translate to OpenAI-compatible shape
    return res.status(200).json({
      choices: [{ message: { role: 'assistant', content: data.content?.[0]?.text || '' } }],
      model: data.model,
      usage: data.usage
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// ── Groq (narrative / lightweight) ───────────────────────────────────────────
async function callGroq(req, res, messages, max_tokens, temperature, model) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GROQ_API_KEY not configured in Vercel environment variables.' });
  }

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model || 'llama-3.1-8b-instant',
        messages,
        temperature,
        max_tokens
      })
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error?.message || 'Groq API error'
      });
    }

    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
