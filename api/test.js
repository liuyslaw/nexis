// Diagnostic endpoint — tests both Anthropic and Groq keys
// Hit: nexis-audit.vercel.app/api/test
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const groqKey      = process.env.GROQ_API_KEY;
  const results      = {};

  // ── Test Anthropic ─────────────────────────────────────────────────────────
  if (!anthropicKey) {
    results.anthropic = { status: 'ERROR', problem: 'ANTHROPIC_API_KEY not set' };
  } else {
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 10, messages: [{ role: 'user', content: 'Reply: OK' }] })
      });
      const d = await r.json();
      results.anthropic = r.ok
        ? { status: 'OK', model: 'claude-haiku-4-5-20251001', use: 'Extraction (A420/B110/E100)', response: d.content?.[0]?.text }
        : { status: 'ERROR', problem: d?.error?.message };
    } catch (e) { results.anthropic = { status: 'ERROR', problem: e.message }; }
  }

  // ── Test Groq ──────────────────────────────────────────────────────────────
  if (!groqKey) {
    results.groq = { status: 'ERROR', problem: 'GROQ_API_KEY not set' };
  } else {
    try {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'llama-3.1-8b-instant', max_tokens: 5, messages: [{ role: 'user', content: 'Reply: OK' }] })
      });
      const d = await r.json();
      results.groq = r.ok
        ? { status: 'OK', model: 'llama-3.1-8b-instant', use: 'Narrative generation (free)', response: d.choices?.[0]?.message?.content }
        : { status: 'ERROR', problem: d?.error?.message };
    } catch (e) { results.groq = { status: 'ERROR', problem: e.message }; }
  }

  return res.status(200).json({
    summary: Object.values(results).every(r => r.status === 'OK') ? 'ALL OK' : 'PARTIAL — check details',
    providers: results
  });
}
