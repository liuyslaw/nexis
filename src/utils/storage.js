// ─── Storage utilities — localStorage persistence ─────────────────────────────

const ENGAGEMENTS_KEY = 'nexis_engagements';
const EXTRACTION_PREFIX = 'nexis_extract_';  // prefix for all extraction caches
const FILES_PREFIX      = 'nexis_files_';    // prefix for file metadata + pages

// ── Engagements ───────────────────────────────────────────────────────────────

export function loadEngagements() {
  try {
    const raw = localStorage.getItem(ENGAGEMENTS_KEY);
    if (raw) return JSON.parse(raw);
  } catch(e) {}
  // Seed with mock engagements for demo
  const seed = getMockEngagements();
  saveEngagements(seed);
  return seed;
}

export function saveEngagements(engagements) {
  try { localStorage.setItem(ENGAGEMENTS_KEY, JSON.stringify(engagements)); } catch(e) {}
}

export function upsertEngagement(eng) {
  const all = loadEngagements();
  const idx = all.findIndex(e => e.id === eng.id);
  if (idx >= 0) all[idx] = eng; else all.unshift(eng);
  saveEngagements(all);
  return all;
}

export function newEngagementId() {
  return `eng_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
}

// ── Extraction cache ──────────────────────────────────────────────────────────

export function getCacheKey(engId, fileName) {
  return `${EXTRACTION_PREFIX}${engId}_${fileName.replace(/[^a-zA-Z0-9]/g, '_')}`;
}

// ── File metadata persistence ─────────────────────────────────────────────────
// Stores file metadata + extracted text pages per engagement.
// The actual File object cannot be serialised — only metadata + pages are stored.

export function saveFiles(engId, files) {
  try {
    const serialisable = files.map(f => ({
      id:          f.id,
      name:        f.name,
      size:        f.size,
      status:      f.status === 'classifying' ? 'ready' : f.status,
      docType:     f.docType,
      classReason: f.classReason,
      _pages:      f._pages || null,   // extracted text — survives refresh
      _noFile:     true,               // flag: File object not available
    }));
    localStorage.setItem(
      `${FILES_PREFIX}${engId}`,
      JSON.stringify({ files: serialisable, savedAt: new Date().toISOString() })
    );
  } catch(e) { console.warn('File save failed:', e); }
}

export function loadFiles(engId) {
  try {
    const raw = localStorage.getItem(`${FILES_PREFIX}${engId}`);
    return raw ? JSON.parse(raw).files : [];
  } catch(e) { return []; }
}

export function clearFiles(engId) {
  try { localStorage.removeItem(`${FILES_PREFIX}${engId}`); } catch(e) {}
}

export function saveExtraction(engId, fileName, data) {
  try {
    localStorage.setItem(getCacheKey(engId, fileName), JSON.stringify({
      data, savedAt: new Date().toISOString()
    }));
  } catch(e) { console.warn('Cache save failed:', e); }
}

export function loadExtraction(engId, fileName) {
  try {
    const raw = localStorage.getItem(getCacheKey(engId, fileName));
    return raw ? JSON.parse(raw) : null;
  } catch(e) { return null; }
}

export function clearEngagementCache(engId) {
  try {
    const prefix = `${EXTRACTION_PREFIX}${engId}_`;
    Object.keys(localStorage).filter(k => k.startsWith(prefix)).forEach(k => localStorage.removeItem(k));
  } catch(e) {}
}

export function clearEngagementAll(engId) {
  clearEngagementCache(engId);
  clearFiles(engId);
}

export function clearAllCache() {
  try {
    Object.keys(localStorage).filter(k => k.startsWith(EXTRACTION_PREFIX)).forEach(k => localStorage.removeItem(k));
  } catch(e) {}
}

// ── Working paper completion tracking ────────────────────────────────────────
// A section is "done" if it has at least one extracted result saved

export const WP_SECTIONS = [
  { id: 'a420', label: 'A420 · Borrowings',     cycle: 'A — Funding' },
  { id: 'a310', label: 'A310 · Related Parties', cycle: 'A — Funding' },
  { id: 'a150', label: 'A150 · Share Capital',   cycle: 'A — Funding' },
  { id: 'b110', label: 'B110 · PPE',             cycle: 'B — Investing' },
  { id: 'c200', label: 'C200 · Receivables',     cycle: 'C — Revenue' },
  { id: 'd200', label: 'D200 · Payables',        cycle: 'D — Payables' },
  { id: 'e100', label: 'E100 · Bank Recon',      cycle: 'E — Cash' },
];

export function getEngagementProgress(eng) {
  const done = (eng.completedSections || []);
  return {
    completed: done.length,
    total: WP_SECTIONS.length,
    pct: Math.round((done.length / WP_SECTIONS.length) * 100),
    sections: WP_SECTIONS.map(s => ({ ...s, done: done.includes(s.id) }))
  };
}

// ── Mock seed data for demo ───────────────────────────────────────────────────

function getMockEngagements() {
  return [
    {
      id: 'eng_demo_001',
      client: 'Emerging EPC Sdn. Bhd.',
      regNo: '1234567-K',
      fileRef: 'File 0373',
      fyEnd: '31/12/2024',
      industry: 'Engineering & Construction',
      preparedBy: 'Wai Bin',
      reviewedBy: 'Ka Leung Lam',
      partner: 'Liu Yew Siong',
      status: 'In Progress',
      createdAt: '2025-01-10T08:00:00.000Z',
      updatedAt: new Date().toISOString(),
      completedSections: ['a420'],
      docCount: 11,
    },
    {
      id: 'eng_demo_002',
      client: 'Techvance Solutions Sdn. Bhd.',
      regNo: '987654-W',
      fileRef: 'File 0381',
      fyEnd: '31/12/2024',
      industry: 'Information Technology',
      preparedBy: 'Hui Ling Tan',
      reviewedBy: 'Ka Leung Lam',
      partner: 'Liu Yew Siong',
      status: 'In Progress',
      createdAt: '2025-01-15T09:00:00.000Z',
      updatedAt: '2025-01-20T14:30:00.000Z',
      completedSections: ['a420', 'a150', 'e100'],
      docCount: 24,
    },
    {
      id: 'eng_demo_003',
      client: 'Pristine Manufacturing Bhd.',
      regNo: '456123-P',
      fileRef: 'File 0355',
      fyEnd: '30/09/2024',
      industry: 'Manufacturing',
      preparedBy: 'Jia Wei Ng',
      reviewedBy: 'Mei Ling Chong',
      partner: 'Liu Yew Siong',
      status: 'Completed',
      createdAt: '2024-10-05T08:00:00.000Z',
      updatedAt: '2024-12-18T16:00:00.000Z',
      completedSections: ['a420', 'a310', 'a150', 'b110', 'c200', 'd200', 'e100'],
      docCount: 47,
    },
  ];
}
