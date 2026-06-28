// E100 Bank Reconciliation — AI extraction via Groq

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

const E100_SYSTEM_PROMPT = `You are an expert Malaysian audit document analyst extracting data for an E100 Bank Reconciliation working paper.

Extract bank reconciliation information from the provided document. This may be a bank statement, bank confirmation letter, or client-prepared reconciliation schedule.

Return ONLY valid JSON, no markdown, no explanation:
{
  "bank_name": string|null,
  "account_name": string|null,
  "account_number": string|null,
  "account_type": string|null,
  "currency": string|null,
  "statement_date": string|null,
  "balance_per_bank_statement": number|null,
  "outstanding_cheques": number|null,
  "outstanding_cheques_details": string|null,
  "deposits_in_transit": number|null,
  "deposits_in_transit_details": string|null,
  "other_reconciling_items": number|null,
  "other_reconciling_items_details": string|null,
  "balance_per_book": number|null,
  "unreconciled_difference": number|null,
  "last_cheque_number": string|null,
  "bank_charges_not_in_book": number|null,
  "interest_not_in_book": number|null,
  "review_notes": string[],
  "confidence": {
    "bank_name": number,
    "account_number": number,
    "statement_date": number,
    "balance_per_bank_statement": number,
    "outstanding_cheques": number,
    "deposits_in_transit": number,
    "balance_per_book": number
  },
  "source_snippets": {
    "bank_name": string|null,
    "account_number": string|null,
    "balance_per_bank_statement": string|null,
    "statement_date": string|null
  }
}

Rules:
- Extract ONLY what is explicitly stated. Never fabricate.
- Null if not found.
- Confidence: 1.0=explicit, 0.9=clear, 0.75=inferred, 0.0=not found.
- For bank statements, balance_per_bank_statement is the closing/ending balance.
- Flag any unusual items, large reconciling items, or stale cheques in review_notes.
- If document contains multiple accounts, extract the primary/first account only and note others in review_notes.`;

export async function extractE100Fields(pageTexts, fileName) {
  const fullText = pageTexts.map(p => `[Page ${p.page}]\n${p.text}`).join('\n\n---\n\n');
  const combinedText = fullText.length > 6000
    ? fullText.slice(0, 4000) + '\n\n[...]\n\n' + fullText.slice(-2000)
    : fullText;

  const messages = [
    { role: 'system', content: E100_SYSTEM_PROMPT },
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

export function classifyE100Document(text, fileName) {
  const name = fileName.toLowerCase();
  const snippet = text.slice(0, 500).toLowerCase();

  if (name.includes('statement') || snippet.includes('bank statement') || snippet.includes('account statement'))
    return { type: 'BANK_STATEMENT', reason: 'Bank statement' };
  if (name.includes('recon') || snippet.includes('reconciliation') || snippet.includes('outstanding cheque'))
    return { type: 'RECON_SCHEDULE', reason: 'Reconciliation schedule' };
  if (name.includes('confirmation') || snippet.includes('we confirm') || snippet.includes('bank confirmation'))
    return { type: 'BANK_CONFIRMATION', reason: 'Bank confirmation letter' };

  return { type: 'BANK_STATEMENT', reason: 'Defaulted to bank statement' };
}

export function assessE100Confidence(data) {
  const mandatory = ['bank_name', 'account_number', 'statement_date', 'balance_per_bank_statement', 'balance_per_book'];
  const conf = data.confidence || {};
  const scores = mandatory.map(f => conf[f] || 0);
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const missing = mandatory.filter(f => data[f] === null || data[f] === undefined);
  const lowConf = mandatory.filter(f => (conf[f] || 0) < 0.85 && data[f] != null);

  // Calculate reconciliation
  const bankBal  = parseFloat(data.balance_per_bank_statement) || 0;
  const outChq   = parseFloat(data.outstanding_cheques) || 0;
  const deposits = parseFloat(data.deposits_in_transit) || 0;
  const other    = parseFloat(data.other_reconciling_items) || 0;
  const bookBal  = parseFloat(data.balance_per_book) || 0;
  const adjusted = bankBal - outChq + deposits + other;
  const diff     = Math.abs(adjusted - bookBal);

  return {
    overall: avg,
    level: avg >= 0.90 ? 'high' : avg >= 0.75 ? 'medium' : 'low',
    missing,
    lowConfidence: lowConf,
    adjustedBankBalance: adjusted,
    difference: diff,
    isReconciled: diff < 1, // tolerance RM1
    needsReview: avg < 0.85 || missing.length > 0 || diff >= 1
  };
}

export async function generateE100Narrative(accounts) {
  const summary = accounts.map((a, i) =>
    `Account ${i+1}: ${a.bank_name} ${a.account_number || ''} — Balance per bank: RM${a.balance_per_bank_statement?.toLocaleString() || 'N/A'} — Balance per book: RM${a.balance_per_book?.toLocaleString() || 'N/A'} — Reconciled: ${a._assessment?.isReconciled ? 'Yes' : 'No'}`
  ).join('\n');

  const messages = [
    {
      role: 'system',
      content: `You are a senior audit manager writing E100 bank reconciliation working paper narratives for Malaysian audits.
Write 2-3 concise professional paragraphs covering: accounts reviewed, reconciliation status, any unreconciled differences, and audit conclusions.`
    },
    { role: 'user', content: `Write E100 narrative for ${accounts.length} bank account(s):\n\n${summary}` }
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
  } catch {
    return 'Narrative generation failed. Please review extracted data manually.';
  }
}
