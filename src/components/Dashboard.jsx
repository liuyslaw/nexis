import React, { useState } from 'react';
import { Plus, FolderOpen, CheckCircle, Clock, Users, Calendar, ChevronRight, X, Building2 } from 'lucide-react';
import { newEngagementId, upsertEngagement, getEngagementProgress, WP_SECTIONS } from '../utils/storage.js';

// ── Progress ring SVG ─────────────────────────────────────────────────────────
function ProgressRing({ pct, size = 56, stroke = 5 }) {
  const r = (size - stroke * 2) / 2;
  const circ = 2 * Math.PI * r;
  const filled = circ * (pct / 100);
  const color = pct === 100 ? 'var(--green)' : pct >= 50 ? 'var(--gold)' : 'var(--magenta)';
  return (
    <svg width={size} height={size} style={{ flexShrink: 0 }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--border)" strokeWidth={stroke} />
      <circle
        cx={size/2} cy={size/2} r={r} fill="none"
        stroke={color} strokeWidth={stroke}
        strokeDasharray={`${filled} ${circ}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${size/2} ${size/2})`}
        style={{ transition: 'stroke-dasharray 0.5s ease' }}
      />
      <text x={size/2} y={size/2 + 4} textAnchor="middle"
        style={{ fontSize: 12, fontWeight: 700, fill: color, fontFamily: 'Inter, sans-serif' }}>
        {pct}%
      </text>
    </svg>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const map = {
    'In Progress': 'badge-amber',
    'Completed':   'badge-green',
    'On Hold':     'badge-muted',
    'New':         'badge-blue',
  };
  return <span className={`badge ${map[status] || 'badge-muted'}`}>{status}</span>;
}

// ── New Engagement Modal ──────────────────────────────────────────────────────
function NewEngagementModal({ onSave, onClose }) {
  const [form, setForm] = useState({
    client: '', regNo: '', fileRef: '', fyEnd: '', industry: '',
    preparedBy: '', reviewedBy: '', partner: '', status: 'New'
  });
  const [errors, setErrors] = useState({});

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const validate = () => {
    const e = {};
    if (!form.client.trim())    e.client    = 'Required';
    if (!form.fyEnd.trim())     e.fyEnd     = 'Required';
    if (!form.preparedBy.trim()) e.preparedBy = 'Required';
    if (!form.partner.trim())   e.partner   = 'Required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = () => {
    if (!validate()) return;
    const eng = {
      ...form,
      id: newEngagementId(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedSections: [],
      docCount: 0,
    };
    onSave(eng);
  };

  const Field = ({ label, k, placeholder, required }) => (
    <div>
      <label>{label}{required && <span style={{ color: 'var(--red)', marginLeft: 2 }}>*</span>}</label>
      <input
        value={form[k]} onChange={e => set(k, e.target.value)}
        placeholder={placeholder}
        style={{ borderColor: errors[k] ? 'var(--red)' : undefined }}
      />
      {errors[k] && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 2 }}>{errors[k]}</div>}
    </div>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div className="card" style={{ width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto' }}>
        <div className="flex items-center justify-between" style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
          <h2>New Engagement</h2>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={onClose}><X size={14}/></button>
        </div>
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>

          <div style={{ padding: '8px 12px', background: 'rgba(250,168,25,0.06)', borderRadius: 'var(--radius)', borderLeft: '3px solid var(--gold)', fontSize: 12, color: 'var(--muted)' }}>
            Client & Engagement
          </div>
          <Field label="Client Name"     k="client"    placeholder="e.g. Emerging EPC Sdn. Bhd."  required />
          <Field label="Company Reg. No" k="regNo"     placeholder="e.g. 1234567-K" />
          <div className="grid-2">
            <Field label="File Reference" k="fileRef"  placeholder="e.g. File 0373" />
            <Field label="FY End"         k="fyEnd"    placeholder="e.g. 31/12/2024" required />
          </div>
          <Field label="Industry"         k="industry" placeholder="e.g. Manufacturing" />

          <div style={{ padding: '8px 12px', background: 'rgba(250,168,25,0.06)', borderRadius: 'var(--radius)', borderLeft: '3px solid var(--gold)', fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
            Engagement Team
          </div>
          <Field label="Prepared By"    k="preparedBy"  placeholder="Staff name"  required />
          <Field label="Reviewed By"    k="reviewedBy"  placeholder="Manager name" />
          <Field label="Partner"        k="partner"     placeholder="Partner name" required />

          <div>
            <label>Status</label>
            <select value={form.status} onChange={e => set('status', e.target.value)}>
              <option>New</option>
              <option>In Progress</option>
              <option>On Hold</option>
              <option>Completed</option>
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-2" style={{ padding: '12px 20px', borderTop: '1px solid var(--border)' }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave}>Create Engagement</button>
        </div>
      </div>
    </div>
  );
}

// ── Engagement Card ───────────────────────────────────────────────────────────
function EngagementCard({ eng, onOpen }) {
  const prog = getEngagementProgress(eng);
  const updated = new Date(eng.updatedAt).toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' });

  return (
    <div
      className="card"
      style={{ cursor: 'pointer', transition: 'border-color 0.15s' }}
      onClick={() => onOpen(eng)}
      onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--gold)'}
      onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
    >
      <div style={{ padding: '16px 18px' }}>
        {/* Top row */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <StatusBadge status={eng.status} />
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>{eng.fileRef}</span>
          </div>
          <ChevronRight size={14} color="var(--subtle)" />
        </div>

        {/* Client name + industry */}
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 2 }}>{eng.client}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
          {eng.regNo && <span>{eng.regNo} · </span>}
          {eng.industry && <span>{eng.industry} · </span>}
          <span>FY {eng.fyEnd}</span>
        </div>

        {/* Progress ring + section breakdown */}
        <div className="flex items-center gap-4">
          <ProgressRing pct={prog.pct} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>
              {prog.completed} of {prog.total} working paper sections completed
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {prog.sections.map(s => (
                <span key={s.id} style={{
                  fontSize: 10, padding: '2px 6px', borderRadius: 4,
                  background: s.done ? 'rgba(63,185,80,0.12)' : 'var(--panel)',
                  color: s.done ? 'var(--green)' : 'var(--subtle)',
                  border: `1px solid ${s.done ? 'rgba(63,185,80,0.3)' : 'var(--border)'}`,
                }}>
                  {s.done ? '✓ ' : ''}{s.id.toUpperCase()}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="divider" />

        {/* Team + meta */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3" style={{ fontSize: 11, color: 'var(--muted)' }}>
            <span><Users size={10} style={{ marginRight: 3 }}/>{eng.preparedBy}{eng.reviewedBy ? ` · ${eng.reviewedBy}` : ''}{eng.partner ? ` · ${eng.partner}` : ''}</span>
          </div>
          <div className="flex items-center gap-1" style={{ fontSize: 11, color: 'var(--subtle)' }}>
            <Calendar size={10}/> {updated}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
export default function Dashboard({ engagements, onOpen, onAdd }) {
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('All');

  const statuses = ['All', 'New', 'In Progress', 'On Hold', 'Completed'];

  const filtered = engagements.filter(e => {
    const matchSearch = !search || e.client.toLowerCase().includes(search.toLowerCase()) || e.fileRef?.toLowerCase().includes(search.toLowerCase());
    const matchFilter = filter === 'All' || e.status === filter;
    return matchSearch && matchFilter;
  });

  const handleAdd = (eng) => {
    onAdd(eng);
    setShowModal(false);
  };

  // Summary stats
  const inProgress = engagements.filter(e => e.status === 'In Progress').length;
  const completed  = engagements.filter(e => e.status === 'Completed').length;
  const avgPct     = engagements.length
    ? Math.round(engagements.reduce((s, e) => s + getEngagementProgress(e).pct, 0) / engagements.length)
    : 0;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1>Engagements</h1>
          <p className="text-muted mt-1" style={{ fontSize: 13 }}>Select an engagement to begin or continue audit work.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          <Plus size={13}/> New Engagement
        </button>
      </div>

      {/* Summary bar */}
      <div className="grid-3 mb-4">
        {[
          { label: 'Total Engagements', value: engagements.length, color: 'var(--blue)' },
          { label: 'In Progress',       value: inProgress,         color: 'var(--amber)' },
          { label: 'Avg Completion',    value: `${avgPct}%`,       color: avgPct === 100 ? 'var(--green)' : 'var(--gold)' },
        ].map(({ label, value, color }) => (
          <div key={label} className="card card-pad" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 24, fontWeight: 700, color }}>{value}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Search + filter */}
      <div className="flex items-center gap-3 mb-4">
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search client or file ref..."
          style={{ maxWidth: 280 }}
        />
        <div className="flex gap-2">
          {statuses.map(s => (
            <button key={s}
              className={`btn btn-sm ${filter === s ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setFilter(s)}
            >{s}</button>
          ))}
        </div>
      </div>

      {/* Engagement list */}
      {filtered.length === 0 ? (
        <div className="empty-state">
          <FolderOpen size={32}/>
          <div style={{ fontSize: 14, fontWeight: 500, marginTop: 8, marginBottom: 4 }}>No engagements found</div>
          <div style={{ fontSize: 13 }}>Create a new engagement to get started</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: 14 }}>
          {filtered.map(eng => (
            <EngagementCard key={eng.id} eng={eng} onOpen={onOpen} />
          ))}
        </div>
      )}

      {showModal && <NewEngagementModal onSave={handleAdd} onClose={() => setShowModal(false)} />}
    </div>
  );
}
