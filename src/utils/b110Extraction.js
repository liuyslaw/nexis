// B110 PPE — AI extraction via Groq

const TIMEOUT_MS = 30000;

async function fetchWithRetry(url, options, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);
      if (res.status === 429) {
        const errData = await res.json().catch(() => ({}));
        const waitMatch = (errData?.error?.message || '').match(/try again in ([\d.]+)s/);
        const waitSecs = waitMatch ? Math.ceil(parseFloat(waitMatch[1])) + 2 : 20;
        if (attempt < maxRetries) { await new Promise(r => setTimeout(r, waitSecs * 1000)); continue; }
        return { ok: false, status: 429, json: async () => errData };
      }
      return res;
    } catch (err) {
      clearTimeout(timer);
      if (attempt < maxRetries && err.name !== 'AbortError') { await new Promise(r => setTimeout(r, 3000)); continue; }
      throw err;
    }
  }
}

const B110_SYSTEM_PROMPT = `You are an expert Malaysian audit document analyst extracting data for a B110 PPE (Property, Plant and Equipment) working paper.

Extract PPE information from the document. This may be a fixed asset register, depreciation schedule, purchase invoice, valuation report, or insurance schedule.

Return ONLY valid JSON, no markdown, no explanation:
{
  "asset_class": string|null,
  "asset_description": string|null,
  "asset_code": string|null,
  "location": string|null,
  "acquisition_date": string|null,
  "cost_bf": number|null,
  "additions": number|null,
  "disposals": number|null,
  "transfers": number|null,
  "cost_cf": number|null,
  "acc_dep_bf": number|null,
  "dep_charge": number|null,
  "dep_on_disposals": number|null,
  "acc_dep_cf": number|null,
  "nbv_bf": number|null,
  "nbv_cf": number|null,
  "dep_rate": string|null,
  "dep_method": string|null,
  "useful_life": string|null,
  "revaluation_surplus": number|null,
  "impairment": number|null,
  "insurance_value": number|null,
  "invoice_number": string|null,
  "invoice_date": string|null,
  "supplier": string|null,
  "invoice_amount": number|null,
  "asset_classes_summary": [
    {
      "class": string,
      "cost_bf": number|null,
      "additions": number|null,
      "disposals": number|null,
      "cost_cf": number|null,
      "acc_dep_bf": number|null,
      "dep_charge": number|null,
      "acc_dep_cf": number|null,
      "nbv_cf": number|null
    }
  ],
  "review_notes": string[],
  "confidence": {
    "asset_class": number,
    "cost_bf": number,
    "additions": number,
    "disposals": number,
    "cost_cf": number,
    "acc_dep_bf": number,
    "dep_charge": number,
    "acc_dep_cf": number,
    "nbv_cf": number,
    "dep_rate": number
  },
  "source_snippets": {
    "asset_class": string|null,
    "cost_cf": string|null,
    "nbv_cf": string|null,
    "dep_rate": string|null
  }
}

Rules:
- Extract ONLY what is explicitly stated. Never fabricate.
- Null if not found.
- For fixed asset registers with multiple asset classes, populate asset_classes_summary array.
- For single invoices, populate invoice fields and leave asset_classes_summary empty.
- Confidence: 1.0=explicit, 0.9=clear, 0.75=inferred, 0.0=not found.
- Flag fully depreciated assets, assets with nil NBV still in use, and large additions without invoice reference.
- Malaysian MFRS 116 applies — note any revaluation model usage.`;

export async function extractB110Fields(pageTexts, fileName) {
  const fullText = pageTexts.map(p => `[Page ${p.page}]\n${p.text}`).join('\n\n---\n\n');
  const combinedText = fullText.length > 6000
    ? fullText.slice(0, 4000) + '\n\n[...]\n\n' + fullText.slice(-2000)
    : fullText;

  const messages = [
    { role: 'system', content: B110_SYSTEM_PROMPT },
    { role: 'user', content: `Document: "${fileName}"\n\n${combinedText}` }
  ];

  try {
    const response = await fetchWithRetry('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, temperature: 0.05, max_tokens: 1024, provider: 'anthropic' })
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(`API ${response.status}: ${err?.error || 'failed'}`);
    }
    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content || '';
    const clean = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(clean);
    parsed._source_file = fileName;
    parsed._extraction_model = 'groq/llama-3.1-8b-instant';
    parsed._extracted_at = new Date().toISOString();
    return { success: true, data: parsed };
  } catch (err) {
    return { success: false, error: err.name === 'AbortError' ? 'Request timed out' : err.message };
  }
}

export function classifyB110Document(text, fileName) {
  const name = fileName.toLowerCase();
  const snippet = text.slice(0, 500).toLowerCase();
  if (name.includes('invoice') || name.includes('inv') || snippet.includes('invoice no') || snippet.includes('tax invoice'))
    return { type: 'INVOICE', reason: 'Purchase invoice' };
  if (name.includes('valuation') || name.includes('value') || snippet.includes('valuation report') || snippet.includes('market value'))
    return { type: 'VALUATION', reason: 'Valuation report' };
  if (name.includes('insurance') || snippet.includes('sum insured') || snippet.includes('insurance schedule'))
    return { type: 'INSURANCE', reason: 'Insurance schedule' };
  if (name.includes('depreciation') || name.includes('dep') || snippet.includes('depreciation schedule'))
    return { type: 'DEP_SCHEDULE', reason: 'Depreciation schedule' };
  if (name.includes('register') || name.includes('far') || name.includes('asset') || snippet.includes('fixed asset') || snippet.includes('asset register'))
    return { type: 'ASSET_REGISTER', reason: 'Fixed asset register' };
  return { type: 'ASSET_REGISTER', reason: 'Defaulted to asset register' };
}

export function assessB110Confidence(data) {
  const mandatory = ['asset_class', 'cost_bf', 'cost_cf', 'acc_dep_bf', 'dep_charge', 'acc_dep_cf', 'nbv_cf'];
  const conf = data.confidence || {};
  const scores = mandatory.map(f => conf[f] || 0);
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const missing = mandatory.filter(f => data[f] === null || data[f] === undefined);
  const lowConf = mandatory.filter(f => (conf[f] || 0) < 0.85 && data[f] != null);

  // Cross-checks
  const costCheck = data.cost_bf != null && data.cost_cf != null
    ? Math.abs((data.cost_bf + (data.additions||0) - (data.disposals||0) + (data.transfers||0)) - data.cost_cf) < 1
    : null;
  const depCheck = data.acc_dep_bf != null && data.acc_dep_cf != null
    ? Math.abs((data.acc_dep_bf + (data.dep_charge||0) - (data.dep_on_disposals||0)) - data.acc_dep_cf) < 1
    : null;
  const nbvCheck = data.cost_cf != null && data.acc_dep_cf != null && data.nbv_cf != null
    ? Math.abs(data.cost_cf - data.acc_dep_cf - data.nbv_cf) < 1
    : null;

  return {
    overall: avg,
    level: avg >= 0.90 ? 'high' : avg >= 0.75 ? 'medium' : 'low',
    missing, lowConfidence: lowConf,
    costCheck, depCheck, nbvCheck,
    needsReview: avg < 0.85 || missing.length > 0 || costCheck === false || depCheck === false || nbvCheck === false
  };
}

export async function generateB110Narrative(assets) {
  const hasClasses = assets.some(a => a.asset_classes_summary?.length > 0);
  const summary = hasClasses
    ? assets.flatMap(a => (a.asset_classes_summary || []).map(c =>
        `${c.class}: Cost b/f RM${c.cost_bf?.toLocaleString()||'N/A'} → Cost c/f RM${c.cost_cf?.toLocaleString()||'N/A'} | NBV c/f RM${c.nbv_cf?.toLocaleString()||'N/A'}`
      )).join('\n')
    : assets.map((a,i) =>
        `${i+1}. ${a.asset_class||'Unknown'}: NBV b/f RM${a.nbv_bf?.toLocaleString()||'N/A'} → NBV c/f RM${a.nbv_cf?.toLocaleString()||'N/A'} | Additions RM${a.additions?.toLocaleString()||'0'}`
      ).join('\n');

  const messages = [
    {
      role: 'system',
      content: `You are a senior audit manager writing B110 PPE working paper narratives for Malaysian audits under MFRS 116.
Write 3-4 concise professional paragraphs covering: PPE overview and movement, depreciation policy, significant additions/disposals, and any audit attention items.`
    },
    { role: 'user', content: `Write B110 PPE narrative:\n\n${summary}` }
  ];

  try {
    const response = await fetchWithRetry('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, temperature: 0.3, max_tokens: 800, provider: 'groq' })
    });
    if (!response.ok) throw new Error(`API ${response.status}`);
    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  } catch { return 'Narrative generation failed.'; }
}
