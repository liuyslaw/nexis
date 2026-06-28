// A420 extraction — Anthropic Haiku (primary) with Sonnet auto-escalation
// All fixes as of 28 Jun 2026

const TIMEOUT_MS = 45000;

async function fetchWithRetry(url, options, maxRetries = 2) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);
      if (res.status === 429) {
        const errData = await res.json().catch(() => ({}));
        const waitMatch = (errData?.error?.message || '').match(/try again in ([\d.]+)s/);
        const waitSecs = waitMatch ? Math.ceil(parseFloat(waitMatch[1])) + 2 : 15;
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

const A420_SYSTEM_PROMPT = `You extract Malaysian audit data from bank loan offer letters and hire purchase (HP) agreements. Return ONLY valid JSON, no markdown, no preamble.

{"facility_category":"L or HP","bank_name":null,"facility_type":null,"facility_limit_rm":null,"amount_utilised_rm":null,"utilised_source":null,"interest_profit_rate":null,"repayment_terms":null,"maturity_date":null,"security":null,"government_guarantee":null,"covenants":null,"shariah_structure":null,"facility_agreement_date":null,"purpose":null,"review_notes":[],"confidence":{"bank_name":0,"facility_type":0,"facility_limit_rm":0,"amount_utilised_rm":0,"interest_profit_rate":0,"repayment_terms":0,"security":0,"facility_agreement_date":0,"purpose":0},"source_snippets":{"bank_name":null,"facility_type":null,"facility_limit_rm":null,"interest_profit_rate":null,"repayment_terms":null,"security":null,"facility_agreement_date":null}}
If document has multiple facilities, extract the PRIMARY facility (the new/main one) and list others in review_notes.

FIELD RULES:
facility_category: "L" for term loans/BA/overdraft/BNM funds; "HP" for hire purchase.
bank_name: full name from letterhead e.g. "Hong Leong Bank Berhad", "Public Bank Berhad".
facility_type: EXACT name from "Facility/ies Approved" section e.g. "Fixed Term Loan 3 (Fixed TL3)", "FL/BNM SRF (SJPP)". HP: "Hire purchase - [make model reg]".
facility_limit_rm: "Approved Limit (RM)" for loans. HP: net finance amount after deposit. Number only, no RM symbol.
amount_utilised_rm: NULL for offer letters and HP agreements — they do not show FY-end outstanding balance. Only populate from repayment schedules showing "Balance Payable".
interest_profit_rate: SHORT concise form ONLY. CORRECT: "BLR + 0.5%", "BLR - 2.59%", "3.50% p.a. fixed", "2.5% + BNM Funding rate". WRONG: "BLR plus 0.50% per annum on monthly rests (minimum 1.70% per annum on monthly rests)". Strip "per annum", "on monthly rests", "on daily rests", minimum floor clauses. Use "+" and "-" symbols not words.
repayment_terms: tenor + instalment e.g. "120 months, RM1,676/month" or "6 months moratorium then 60 months RM14,810/month".
facility_agreement_date: FORMAT D.M.YYYY with dots e.g. "3.8.2022", "1.11.2021", "15.10.2021". Never "1 November 2021" or "2022-08-03".
purpose: from "Purpose of Facility/ies". HP: "Purchase of [goods description]".
BA (Bankers Acceptance): If document contains a BA facility, extract it as a SEPARATE object with facility_type = "Bankers Acceptance (BA)" or the exact name used e.g. "BA-i", "BA 2". BA facilities typically have: limit = approved BA limit, rate = "BLR + X%" or "X% p.a.", repayment = "On demand / revolving" or tenor in days e.g. "180 days revolving".
covenants: capture if present e.g. "Shall not declare dividend >50% of CY PAT provided debt servicing is current". Else "N/A".
review_notes: always add "Obtain utilised amount from bank confirmation — not in this document" if amount_utilised_rm is null.
confidence: 1.0=explicit, 0.9=clear, 0.75=inferred/amended, 0.0=not found. Never fabricate.

SECURITY EXTRACTION — critical field, often in middle/later pages:
Look for section titled "Securities and Documentation", "Security", or "12. Securities" or "Securities".
It contains: Facilities Agreement (principal sum secured), Properties With Title — Legal Charge (property descriptions with title details), Joint and Several Guarantee (guarantor names and amounts).
IMPORTANT: In multi-facility letters, ALL facilities typically share the SAME security package. Copy the full security block to EACH facility object.
Format for security field: "Facilities Agreement - upstamp to secure RM[X]\nProperties with title - Legal Charge:\n- [property description with title no.]\nJoint and several guarantee of RM[X] by:\n- [Name 1]\n- [Name 2]"
Set confidence to 0.9 if found. If security section not visible in extracted text, set to null and add review_note: "Security section not captured — located in middle/later pages of document. Refer to physical document."

DOCUMENT NOISE — ignore:
1. TICK MARKS: Check marks/slash marks beside figures = client verification ticks, NOT numbers.
2. SIGNATURES: Random character sequences mid-document = signature noise, ignore.
3. RUBBER STAMPS: Circular stamp OCR noise, ignore.
4. XXX PATTERNS: "XXXX" or "XXXXXXX" = masked field or cancelled value. The clean number adjacent to X-pattern is the CORRECT amended value.
5. CROSS-CAST: Same figure twice (left + right column) = verification. Extract once only.

HANDWRITTEN AMENDMENTS:
STYLE 1 — strikethrough line: cancelled figure. Handwritten figure beside/above = correct value.
STYLE 2 — double cross XX: "XXXX 500.00" → 500.00 is valid; "36 XX MONTHS" → 36 is valid.
On amendment: confidence = 0.75, add review note: "Handwritten amendment — extracted [value], original was [original]. Auditor to verify."

AMENDMENT / VARIATION LETTERS:
Signs: titled "Supplemental Letter of Offer", "Variation", "Amendment", contains "revision to existing facilities".
These letters show a table: Existing (RM) | Change +/- (RM) | New Limit (RM)
- facility_limit_rm = the "New Limit (RM)" column — this is the CURRENT approved limit after amendment
- Do NOT use "Existing (RM)" or "Change +/-" as the limit
- Do NOT use outstanding balance figures (e.g. "outstanding amount RM64,415.94" is a balance not a limit)
- facility_type = the facility with a non-zero Change +/- entry (the one being amended)
- facility_agreement_date = date of THIS amendment letter
- Add review note: "Supplementary letter — limit shown is post-amendment New Limit."

HP FIELD MAPPING:
- facility_limit_rm = "Total of Items (i)(iii)(iv)(v) less (ii)" = NET FINANCE after deposit, NOT gross cash price.
- interest_profit_rate = "X.XX% flat p.a."
- FINAL vs MONTHLY: capture both e.g. "36 months; RM3,874/month; final instalment RM3,848"
- facility_agreement_date = "Date on which hiring shall be deemed to have commenced"`;

// ─── Core extraction (single model) ──────────────────────────────────────────
async function runExtraction(messages, model, fileName, pageTexts, declaredCategory) {
  const response = await fetchWithRetry('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, temperature: 0.05, max_tokens: 2048, provider: 'anthropic', model })
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(`API ${response.status}: ${errData?.error || errData?.message || 'failed'}`);
  }

  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content || '';

  // Robust JSON extraction — find outermost { } block, strip any preamble text
  let clean = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const jsonStart = clean.indexOf('{');
  const jsonEnd   = clean.lastIndexOf('}');
  if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
    clean = clean.slice(jsonStart, jsonEnd + 1);
  }
  const parsed = JSON.parse(clean);

  // Apply auditor-declared category — overrides AI inference
  if (declaredCategory && ['L', 'HP'].includes(declaredCategory)) {
    parsed.facility_category = declaredCategory;
  } else if (!['L', 'HP'].includes(parsed.facility_category)) {
    parsed.facility_category = guessCategory(fileName, parsed);
  }

  if (!Array.isArray(parsed.review_notes)) parsed.review_notes = [];
  if (parsed.amount_utilised_rm == null) {
    const hasNote = parsed.review_notes.some(n => n.toLowerCase().includes('utilised'));
    if (!hasNote) parsed.review_notes.push('Obtain utilised amount from bank confirmation — not in this document');
  }

  parsed._source_file      = fileName;
  parsed._extraction_model = model;
  parsed._extracted_at     = new Date().toISOString();
  parsed._page_count       = pageTexts.length;
  parsed._ocr_methods      = [...new Set(pageTexts.map(p => p.method))];

  return parsed;
}

// ─── Confidence average ───────────────────────────────────────────────────────
function avgConfidence(parsed) {
  const conf = parsed.confidence || {};
  const scores = Object.values(conf).filter(v => typeof v === 'number');
  if (!scores.length) return 0;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const HAIKU               = 'claude-haiku-4-5-20251001';
const SONNET              = 'claude-sonnet-4-6';
const CONFIDENCE_THRESHOLD = 0.80;

// ─── Main export — Haiku first, Sonnet if conf < 80% ─────────────────────────
export async function extractA420Fields(pageTexts, fileName, declaredCategory, declaredDocType) {
  declaredCategory = declaredCategory || null;
  declaredDocType  = declaredDocType  || null;

  const fullText = pageTexts.map(p => `[Page ${p.page}]\n${p.text}`).join('\n\n---\n\n');

  // 4-section strategy: start | early-mid (BA/facilities table) | late-mid (security) | end
  // HLB multi-facility letters: facilities table pages 1-3, BA pages 4-6, security pages 8-12
  let combinedText;
  if (fullText.length <= 7000) {
    combinedText = fullText;
  } else {
    const first     = fullText.slice(0, 2500);                                    // cover + facility table
    const earlyMid  = fullText.slice(Math.floor(fullText.length * 0.25), Math.floor(fullText.length * 0.25) + 1500); // BA + additional facilities
    const lateMid   = fullText.slice(Math.floor(fullText.length * 0.55), Math.floor(fullText.length * 0.55) + 2000); // security section
    const last      = fullText.slice(-1000);                                      // end T&C
    combinedText = first + '\n\n[...]\n\n' + earlyMid + '\n\n[...]\n\n' + lateMid + '\n\n[...]\n\n' + last;
  }

  // Clean OCR text — remove chars that break JSON generation
  // Scanned docs produce control chars, null bytes, and broken unicode
  const cleanedText = combinedText
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ') // control chars
    .replace(/\uFFFD/g, '?')      // replacement char from bad OCR encoding
    .replace(/`/g, "'")            // backticks confuse the model
    .replace(/\\/g, '/')          // lone backslashes can break JSON strings
    .replace(/\s+/g, ' ')          // normalise whitespace
    .trim();

  const messages = [
    { role: 'system', content: A420_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Document: "${fileName}"${declaredCategory ? `\nAuditor declared: facility_category="${declaredCategory}", doc_type="${declaredDocType || ''}"` : ''}\n\n${cleanedText}`
    }
  ];

  try {
    const parsed = await runExtraction(messages, HAIKU, fileName, pageTexts, declaredCategory);
    const conf   = avgConfidence(parsed);

    if (conf < CONFIDENCE_THRESHOLD) {
      // Escalate to Sonnet with explicit single-JSON instruction
      const sonnetMessages = [
        messages[0],
        {
          role: 'user',
          content: messages[1].content + '\n\nIMPORTANT: Return exactly ONE valid JSON object. No preamble, no explanation. If multiple facilities exist, extract only the PRIMARY or FIRST facility.'
        }
      ];

      try {
        const sonnetParsed = await runExtraction(sonnetMessages, SONNET, fileName, pageTexts, declaredCategory);
        sonnetParsed._escalated_from    = HAIKU;
        sonnetParsed._haiku_confidence  = conf;
        sonnetParsed.review_notes       = sonnetParsed.review_notes || [];
        sonnetParsed.review_notes.push(`Low confidence (${Math.round(conf * 100)}%) on Haiku — re-extracted with Claude Sonnet`);
        if (conf < 0.5) {
          sonnetParsed.review_notes.push('Very low confidence — document may contain multiple facilities. Consider splitting into separate uploads per facility.');
        }
        return { success: true, data: sonnetParsed, escalated: true };
      } catch (sonnetErr) {
        parsed.review_notes.push(`Sonnet escalation failed (${sonnetErr.message}) — Haiku result kept, manual review required`);
        if (parsed.facility_type && parsed.facility_type.includes(';')) {
          parsed.review_notes.push('Multiple facilities detected in one document — upload one facility letter per file for best results');
        }
        parsed._escalation_failed = true;
        return { success: true, data: parsed, escalated: false };
      }
    }

    return { success: true, data: parsed, escalated: false };
  } catch (err) {
    return {
      success: false,
      error: err.name === 'AbortError' ? 'Request timed out — try again' : err.message
    };
  }
}

// ─── Category guesser ─────────────────────────────────────────────────────────
function guessCategory(fileName, parsed) {
  const name = fileName.toLowerCase();
  const type = (parsed.facility_type || '').toLowerCase();
  if (name.includes('hp') || name.includes('hire') || type.includes('hire purchase')) return 'HP';
  if (name.includes('hitachi') || name.includes('mercedes') || name.includes('benz') || name.includes('pac lease')) return 'HP';
  return 'L';
}

// ─── Document classifier (heuristics, no API) ────────────────────────────────
export function classifyDocument(text, fileName) {
  const name    = fileName.toLowerCase();
  const snippet = (text || '').slice(0, 600).toLowerCase();

  if (name.includes('hp') || name.includes('hire_purchase')) return { type: 'HP_AGREEMENT', confidence: 0.95, reason: 'HP filename', category: 'HP' };
  if (snippet.includes('hire purchase agreement'))           return { type: 'HP_AGREEMENT', confidence: 0.9,  reason: 'HP text',     category: 'HP' };
  if (snippet.includes('repayment plan') || snippet.includes('repayment schedule')) {
    const isHP = snippet.includes('mercedes') || snippet.includes('hitachi') || snippet.includes('pac lease');
    return { type: 'REPAYMENT_SCHEDULE', confidence: 0.9, reason: 'Repayment schedule', category: isHP ? 'HP' : 'L' };
  }
  if (name.includes('confirmation') || name.includes('confirm')) return { type: 'BANK_CONFIRMATION', confidence: 0.95, reason: 'Confirmation filename', category: 'L' };
  if (name.includes('repayment') || name.includes('amort'))      return { type: 'REPAYMENT_SCHEDULE', confidence: 0.9, reason: 'Repayment filename',   category: 'L' };
  if (name.includes('agreement') || name.includes('facility_agreement')) return { type: 'LOAN_AGREEMENT', confidence: 0.9, reason: 'Agreement filename', category: 'L' };
  if (name.includes('offer') || name.includes('letter') || name.match(/^\d{3}_lo/)) return { type: 'OFFER_LETTER', confidence: 0.9, reason: 'Offer letter filename', category: 'L' };
  if (snippet.includes('letter of offer') || snippet.includes('application for credit')) return { type: 'OFFER_LETTER', confidence: 0.85, reason: 'Offer letter text', category: 'L' };
  if (snippet.includes('bank confirmation') || snippet.includes('we confirm'))          return { type: 'BANK_CONFIRMATION', confidence: 0.85, reason: 'Confirmation text', category: 'L' };

  return { type: 'OFFER_LETTER', confidence: 0.6, reason: 'Defaulted to offer letter', category: 'L' };
}

// ─── Narrative generation (Groq — free tier) ─────────────────────────────────
export async function generateNarrative(facilities) {
  const lFacilities  = facilities.filter(f => f.facility_category === 'L');
  const hpFacilities = facilities.filter(f => f.facility_category === 'HP');
  const lSummary  = lFacilities.map((f, i)  => `${i+1}. ${f.bank_name||'?'} — ${f.facility_type||'—'} — Limit: RM${f.facility_limit_rm?.toLocaleString()||'N/A'} — Rate: ${f.interest_profit_rate||'N/A'} — Date: ${f.facility_agreement_date||'N/A'}`).join('\n');
  const hpSummary = hpFacilities.map((f, i) => `${i+1}. ${f.bank_name||'?'} — ${f.facility_type||'—'} — Limit: RM${f.facility_limit_rm?.toLocaleString()||'N/A'} — Rate: ${f.interest_profit_rate||'N/A'}`).join('\n');
  const summary = [lFacilities.length?`LOANS:\n${lSummary}`:'', hpFacilities.length?`HIRE PURCHASE:\n${hpSummary}`:''].filter(Boolean).join('\n\n');

  const messages = [
    { role: 'system', content: 'You are a senior audit manager writing A420 working paper narratives for Malaysian audits. Write 3-4 concise professional paragraphs covering: facility overview, security/guarantees, covenants, and audit attention items.' },
    { role: 'user',   content: `Write A420 narrative for ${facilities.length} facilities:\n\n${summary}` }
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
  } catch { return 'Narrative generation failed. Please review extracted data manually.'; }
}

// ─── Confidence assessment ────────────────────────────────────────────────────
export function assessConfidence(data) {
  const isHP      = data.facility_category === 'HP';
  const mandatory = isHP
    ? ['bank_name', 'facility_type', 'facility_limit_rm', 'interest_profit_rate', 'repayment_terms', 'facility_agreement_date', 'purpose']
    : ['bank_name', 'facility_type', 'facility_limit_rm', 'interest_profit_rate', 'repayment_terms', 'security', 'facility_agreement_date', 'purpose'];

  const conf    = data.confidence || {};
  const scores  = mandatory.map(f => conf[f] || 0);
  const avg     = scores.reduce((a, b) => a + b, 0) / scores.length;
  const missing = mandatory.filter(f => data[f] == null || data[f] === '');
  const lowConf = mandatory.filter(f => (conf[f] || 0) < 0.85 && data[f] != null && data[f] !== '');

  return {
    overall:       avg,
    level:         avg >= 0.90 ? 'high' : avg >= 0.75 ? 'medium' : 'low',
    missing,
    lowConfidence: lowConf,
    needsReview:   avg < 0.85 || missing.filter(f => f !== 'amount_utilised_rm').length > 0 || lowConf.length > 0
  };
}
