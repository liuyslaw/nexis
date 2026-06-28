import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  Upload, FileText, Sparkles, CheckCircle, AlertTriangle,
  X, ChevronDown, ChevronUp, RefreshCw, FileSpreadsheet,
  FolderOpen, Banknote, Users, Receipt, Building2,
  Landmark, Package, Lock, BookOpen, Trash2, ArrowLeft, Info
} from 'lucide-react';
import Dashboard from './components/Dashboard.jsx';
import { extractFileText } from './utils/extractor.js';
import { extractA420Fields, classifyDocument, generateNarrative, assessConfidence } from './utils/a420Extraction.js';
import { extractE100Fields, classifyE100Document, assessE100Confidence, generateE100Narrative } from './utils/e100Extraction.js';
import { exportE100Excel } from './utils/e100Export.js';
import { extractB110Fields, classifyB110Document, assessB110Confidence, generateB110Narrative } from './utils/b110Extraction.js';
import { exportB110Excel } from './utils/b110Export.js';
import { exportA420Excel } from './utils/a420Export.js';
import {
  loadEngagements, upsertEngagement, getEngagementProgress,
  saveExtraction, loadExtraction, clearEngagementCache, clearAllCache,
  saveFiles, loadFiles, clearFiles, clearEngagementAll
} from './utils/storage.js';

// ─── Toast ────────────────────────────────────────────────────────────────────
function useToast() {
  const [toasts, setToasts] = useState([]);
  const add = (msg, type = 'info') => {
    const id = Date.now();
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000);
  };
  return { toasts, success: m => add(m, 'success'), error: m => add(m, 'error'), info: m => add(m, 'info') };
}
function Toasts({ toasts }) {
  const icons = { success: <CheckCircle size={13}/>, error: <AlertTriangle size={13}/>, info: <Info size={13}/> };
  return (
    <div className="toast-container">
      {toasts.map(t => <div key={t.id} className={`toast toast-${t.type}`}>{icons[t.type]}{t.msg}</div>)}
    </div>
  );
}

// ─── Sidebar nav ──────────────────────────────────────────────────────────────
const NAV = [
  { section: 'Engagement', items: [
    { id: 'documents', label: 'Documents',   icon: FolderOpen },
    { id: 'insights',  label: 'AI Insights', icon: Sparkles },
  ]},
  { section: 'A — Funding Cycle', items: [
    { id: 'a420', label: 'A420 · Borrowings',      icon: Banknote, live: true },
    { id: 'a310', label: 'A310 · Related Parties',  icon: Users,    coming: true },
    { id: 'a150', label: 'A150 · Share Capital',    icon: Receipt,  coming: true },
  ]},
  { section: 'B — Investing', items: [
    { id: 'b110', label: 'B110 · PPE', icon: Building2, live: true },
  ]},
  { section: 'C — Revenue & Receivables', items: [
    { id: 'c200', label: 'C200 · Receivables', icon: Receipt, coming: true },
  ]},
  { section: 'D — Payables', items: [
    { id: 'd200', label: 'D200 · Payables', icon: Package, coming: true },
  ]},
  { section: 'E — Cash & Bank', items: [
    { id: 'e100', label: 'E100 · Bank Recon', icon: Landmark, live: true },
  ]},
];

function Sidebar({ active, onSelect, onBack, engagement, docCount, completedSections }) {
  const prog = getEngagementProgress(engagement);
  return (
    <nav className="sidebar">
      {/* Logo */}
      <div className="sidebar-logo">
        <svg width="26" height="26" viewBox="0 0 28 28" fill="none">
          <polygon points="14,2 20,10 14,10" fill="#FAA819"/>
          <polygon points="14,10 20,10 20,18" fill="#B84480"/>
          <polygon points="14,10 14,18 8,18" fill="#FAA819"/>
          <polygon points="14,18 20,18 14,26" fill="#B84480"/>
          <polygon points="8,10 14,10 8,18" fill="#B84480"/>
          <polygon points="14,18 8,18 14,26" fill="#FAA819"/>
        </svg>
        <div>
          <div className="sidebar-logo-text">Nexis Audit</div>
          <div className="sidebar-logo-sub">by SynerGrowth</div>
        </div>
      </div>

      {/* Back to dashboard */}
      <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>
        <button className="sidebar-item" onClick={onBack} style={{ color: 'var(--muted)', fontSize: 12 }}>
          <ArrowLeft size={12}/> All Engagements
        </button>
      </div>

      {/* Engagement info + progress */}
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 2, lineHeight: 1.3 }}>{engagement.client}</div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>FY {engagement.fyEnd} · {engagement.fileRef}</div>
        {/* Mini progress bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div className="progress-bar" style={{ flex: 1 }}>
            <div className="progress-fill" style={{ width: `${prog.pct}%` }}/>
          </div>
          <span style={{ fontSize: 11, color: 'var(--gold)', fontWeight: 600, minWidth: 28 }}>{prog.pct}%</span>
        </div>
        <div style={{ fontSize: 10, color: 'var(--subtle)', marginTop: 3 }}>{prog.completed}/{prog.total} sections</div>
      </div>

      {/* Nav items */}
      {NAV.map(group => (
        <div key={group.section} className="sidebar-section">
          <h3>{group.section}</h3>
          <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {group.items.map(item => {
              const done = completedSections.includes(item.id);
              return (
                <button
                  key={item.id}
                  className={`sidebar-item${active === item.id ? ' active' : ''}${item.coming ? ' coming' : ''}`}
                  onClick={() => !item.coming && onSelect(item.id)}
                >
                  <item.icon size={14}/>
                  <span style={{ flex: 1 }}>{item.label}</span>
                  {item.id === 'documents' && docCount > 0 && (
                    <span className="badge badge-muted item-badge">{docCount}</span>
                  )}
                  {item.live && !item.coming && (
                    <span className="badge badge-gold item-badge">Live</span>
                  )}
                  {done && <CheckCircle size={11} color="var(--green)"/>}
                  {item.coming && <Lock size={10} style={{ opacity: 0.4 }}/>}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {/* Team footer */}
      <div style={{ flex: 1 }}/>
      <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--subtle)', lineHeight: 1.8 }}>
        {engagement.preparedBy && <div>Prep: {engagement.preparedBy}</div>}
        {engagement.reviewedBy && <div>Review: {engagement.reviewedBy}</div>}
        {engagement.partner    && <div>Partner: {engagement.partner}</div>}
      </div>
    </nav>
  );
}

// ─── Doc type helpers ─────────────────────────────────────────────────────────
// ─── Document type definitions ───────────────────────────────────────────────
// Tabs: L (Loans) → 3 sub-types | HP (Hire Purchase) → 2 sub-types
// Auditor declares type at upload — no auto-classification needed (instant, no OCR delay)

const UPLOAD_TABS = {
  L: {
    label: 'Loans',
    color: 'var(--gold)',
    badge: 'badge-gold',
    category: 'L',
    subTypes: [
      { id: 'OFFER_LETTER',       label: 'Offer Letter / Facility Letter', desc: 'Bank letter offering credit facility', badge: 'badge-gold' },
      { id: 'BANK_CONFIRMATION',  label: 'Bank Confirmation',              desc: 'Bank confirmation of outstanding balance', badge: 'badge-green' },
      { id: 'REPAYMENT_SCHEDULE', label: 'Repayment Schedule',             desc: 'Loan repayment / amortisation schedule', badge: 'badge-blue' },
    ]
  },
  HP: {
    label: 'Hire Purchase',
    color: 'var(--magenta)',
    badge: 'badge-magenta',
    category: 'HP',
    subTypes: [
      { id: 'HP_AGREEMENT',       label: 'HP Agreement',      desc: 'Hire purchase agreement / schedule of payments', badge: 'badge-magenta' },
      { id: 'HP_REPAYMENT',       label: 'HP Repayment Plan', desc: 'HP repayment plan / outstanding balance schedule', badge: 'badge-blue' },
    ]
  }
};

const DOC_LABELS = {
  OFFER_LETTER: 'Offer Letter', LOAN_AGREEMENT: 'Offer Letter',
  BANK_CONFIRMATION: 'Bank Confirmation', REPAYMENT_SCHEDULE: 'Repayment Schedule',
  HP_AGREEMENT: 'HP Agreement', HP_REPAYMENT: 'HP Repayment Plan',
  LEAD_SCHEDULE: 'Lead Schedule', PERMANENT_FILE: 'Permanent File', UNKNOWN: 'Unknown'
};
const DOC_BADGE = {
  OFFER_LETTER: 'badge-gold', LOAN_AGREEMENT: 'badge-gold',
  BANK_CONFIRMATION: 'badge-green', REPAYMENT_SCHEDULE: 'badge-blue',
  HP_AGREEMENT: 'badge-magenta', HP_REPAYMENT: 'badge-blue',
  LEAD_SCHEDULE: 'badge-muted', PERMANENT_FILE: 'badge-muted', UNKNOWN: 'badge-amber'
};

// ─── Upload Zone (shared) ─────────────────────────────────────────────────────
function UploadZone({ onFiles, accept=".pdf,.jpg,.jpeg,.png" }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef();
  const onDrop = e => { e.preventDefault(); setDragging(false); onFiles(e.dataTransfer.files); };
  return (
    <div
      onDragOver={e=>{e.preventDefault();setDragging(true);}}
      onDragLeave={()=>setDragging(false)}
      onDrop={onDrop}
      onClick={()=>inputRef.current.click()}
      style={{ border:`2px dashed ${dragging?'var(--gold)':'var(--border2)'}`, borderRadius:'var(--radius-lg)', padding:'20px', textAlign:'center', cursor:'pointer', background:dragging?'rgba(250,168,25,0.04)':'transparent', transition:'all 0.12s' }}
    >
      <Upload size={20} color="var(--muted)" style={{marginBottom:6}}/>
      <div style={{fontSize:13,fontWeight:500,marginBottom:2}}>Drop files here or click to browse</div>
      <div className="text-muted" style={{fontSize:12}}>PDF · JPG · PNG</div>
      <input ref={inputRef} type="file" multiple accept={accept} style={{display:'none'}} onChange={e=>onFiles(e.target.files)}/>
    </div>
  );
}

// ─── Documents module — tabbed upload by facility category ────────────────────
function DocumentsModule({ files, setFiles, toast }) {
  const [mainTab, setMainTab]   = useState('L');   // 'L' | 'HP'
  const [subType, setSubType]   = useState('OFFER_LETTER');

  // When main tab changes, default sub-type to first option
  const switchMain = tab => {
    setMainTab(tab);
    setSubType(UPLOAD_TABS[tab].subTypes[0].id);
  };

  const addFiles = useCallback(async (newFiles, docType, category) => {
    const valid = Array.from(newFiles).filter(f => {
      const ext = f.name.split('.').pop().toLowerCase();
      return ['pdf','jpg','jpeg','png'].includes(ext);
    });
    if (!valid.length) { toast.error('Unsupported file type — PDF, JPG or PNG only.'); return; }

    // Add immediately as 'reading' — no classification needed, type already declared
    const entries = valid.map(f => ({
      id: `${Date.now()}-${Math.random()}`, file: f,
      name: f.name, size: f.size, status: 'ready',
      docType, facility_category: category, classReason: 'User selected', _pages: null
    }));
    setFiles(p => [...p, ...entries]);

    // Mark ready immediately — text extraction happens at extraction time, not upload time
    // This makes upload instant regardless of file size
    setFiles(p => p.map(f =>
      entries.find(e => e.id === f.id) ? { ...f, status: 'ready', _noFile: false } : f
    ));
    toast.success(`${valid.length} file${valid.length!==1?'s':''} added as ${DOC_LABELS[docType]}`);
  }, [setFiles, toast]);

  const removeFile   = id => setFiles(p => p.filter(f => f.id !== id));
  const reassignFile = (id, category, docType) =>
    setFiles(p => p.map(f => f.id === id ? { ...f, facility_category: category, docType } : f));

  const tabDef   = UPLOAD_TABS[mainTab];
  const subDef   = tabDef.subTypes.find(s => s.id === subType) || tabDef.subTypes[0];

  // Files for current view
  const lFiles        = files.filter(f => f.facility_category === 'L');
  const hpFiles       = files.filter(f => f.facility_category === 'HP');
  const uncategorised = files.filter(f => !f.facility_category);
  const needReUpload  = files.filter(f => f._noFile && f.status === 'ready');

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1>Documents</h1>
          <p className="text-muted mt-1" style={{fontSize:13}}>Select the document category, then upload. No auto-classification — instant processing.</p>
        </div>
      </div>

      {/* Re-upload warning banner */}
      {needReUpload.length > 0 && (
        <div style={{padding:'10px 14px',background:'rgba(227,179,65,0.08)',border:'1px solid rgba(227,179,65,0.3)',borderRadius:'var(--radius)',marginBottom:16,display:'flex',alignItems:'center',gap:10}}>
          <AlertTriangle size={14} color="var(--amber)"/>
          <div style={{fontSize:13}}>
            <strong style={{color:'var(--amber)'}}>{needReUpload.length} file{needReUpload.length>1?'s':''} need re-uploading</strong>
            <span className="text-muted"> — file data was lost after page refresh. Re-upload to extract.</span>
          </div>
        </div>
      )}

      {/* Main tabs: L / HP */}
      <div className="flex gap-2 mb-4">
        {Object.entries(UPLOAD_TABS).map(([key, tab]) => (
          <button key={key}
            className={`btn ${mainTab===key ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => switchMain(key)}
            style={mainTab===key ? {background: tab.color === 'var(--gold)' ? undefined : tab.color, borderColor: tab.color} : {}}
          >
            {key === 'L' ? <Banknote size={13}/> : <FileText size={13}/>}
            {tab.label}
            {(key==='L' ? lFiles : hpFiles).length > 0 &&
              <span className={`badge ${tab.badge}`} style={{marginLeft:4,fontSize:10}}>
                {(key==='L' ? lFiles : hpFiles).length}
              </span>
            }
          </button>
        ))}
      </div>

      {/* Sub-type tabs */}
      <div className="flex gap-2 mb-4" style={{borderBottom:'1px solid var(--border)',paddingBottom:10}}>
        {tabDef.subTypes.map(st => (
          <button key={st.id}
            className={`btn btn-sm ${subType===st.id ? 'btn-secondary' : 'btn-ghost'}`}
            style={subType===st.id ? {borderColor: tabDef.color, color: tabDef.color} : {}}
            onClick={() => setSubType(st.id)}
          >
            {st.label}
          </button>
        ))}
      </div>

      {/* Description + upload zone */}
      <div className="card card-pad mb-4" style={{borderColor: subType === subDef.id ? tabDef.color : undefined, borderOpacity: 0.4}}>
        <div className="flex items-center gap-2 mb-3">
          <span className={`badge ${subDef.badge}`}>{subDef.label}</span>
          <span className="text-muted" style={{fontSize:12}}>{subDef.desc}</span>
        </div>
        <UploadZone onFiles={fs => addFiles(fs, subDef.id, tabDef.category)}/>
      </div>

      {/* File list — Loans */}
      {lFiles.length > 0 && (
        <div style={{marginBottom:16}}>
          <h3 style={{marginBottom:8}}>L — Loans · {lFiles.length} file{lFiles.length!==1?'s':''}</h3>
          <FileTable files={lFiles} onRemove={removeFile} onReassign={reassignFile}/>
        </div>
      )}

      {/* File list — Hire Purchase */}
      {hpFiles.length > 0 && (
        <div style={{marginBottom:16}}>
          <h3 style={{marginBottom:8}}>HP — Hire Purchase · {hpFiles.length} file{hpFiles.length!==1?'s':''}</h3>
          <FileTable files={hpFiles} onRemove={removeFile} onReassign={reassignFile}/>
        </div>
      )}

      {/* Uncategorised (legacy / restored from cache) */}
      {uncategorised.length > 0 && (
        <div style={{marginBottom:16}}>
          <h3 style={{marginBottom:8}}>Uncategorised · {uncategorised.length} file{uncategorised.length!==1?'s':''}</h3>
          <FileTable files={uncategorised} onRemove={removeFile} onReassign={reassignFile}/>
        </div>
      )}

      {files.length === 0 && (
        <div className="empty-state">
          <FolderOpen size={32}/>
          <div style={{fontSize:14,fontWeight:500,marginTop:8,marginBottom:4}}>No documents uploaded</div>
          <div style={{fontSize:13}}>Select Loans or Hire Purchase above, then upload files</div>
        </div>
      )}
    </div>
  );
}

// ─── File table (shared) ──────────────────────────────────────────────────────
// All reassignable options — flat list for the dropdown
const REASSIGN_OPTIONS = [
  { category:'L',  docType:'OFFER_LETTER',       label:'L — Offer Letter / Facility Letter' },
  { category:'L',  docType:'BANK_CONFIRMATION',  label:'L — Bank Confirmation' },
  { category:'L',  docType:'REPAYMENT_SCHEDULE', label:'L — Repayment Schedule' },
  { category:'HP', docType:'HP_AGREEMENT',       label:'HP — HP Agreement' },
  { category:'HP', docType:'HP_REPAYMENT',       label:'HP — HP Repayment Plan' },
];

function FileTable({ files, onRemove, onReassign }) {
  return (
    <div className="card">
      <table className="tbl">
        <thead><tr><th>File</th><th>Type</th><th>Size</th><th>Status</th><th style={{width:36}}></th></tr></thead>
        <tbody>
          {files.map(f => (
            <tr key={f.id}>
              <td><div className="flex items-center gap-2"><FileText size={13} color="var(--muted)"/><span style={{fontSize:13}}>{f.name}</span></div></td>
              <td>
                {/* Type badge — click to open reassign dropdown */}
                <select
                  value={`${f.facility_category||'L'}|${f.docType||'OFFER_LETTER'}`}
                  onChange={e => {
                    const [category, docType] = e.target.value.split('|');
                    onReassign(f.id, category, docType);
                  }}
                  style={{
                    fontSize:11, fontWeight:600, padding:'2px 6px', borderRadius:20,
                    background:'transparent', border:'1px solid var(--border2)',
                    color: f.facility_category==='HP' ? 'var(--magenta)' : 'var(--gold)',
                    cursor:'pointer', maxWidth:160
                  }}
                >
                  {REASSIGN_OPTIONS.map(o => (
                    <option key={o.docType} value={`${o.category}|${o.docType}`}>{o.label}</option>
                  ))}
                </select>
              </td>
              <td className="text-muted" style={{fontSize:12}}>{(f.size/1024).toFixed(0)} KB</td>
              <td>
                {f.status==='ready'    && !f._noFile && <span className="badge badge-green"><CheckCircle size={10}/> Ready</span>}
                {f.status==='ready'    && f._noFile  && (
                  <div className="flex items-center gap-2">
                    <span className="badge badge-amber" title="File lost after page refresh — please re-upload this document">
                      <AlertTriangle size={9}/> Re-upload needed
                    </span>
                  </div>
                )}
                {f.status==='error'    && <span className="badge badge-red"><AlertTriangle size={10}/> Error</span>}
              </td>
              <td><button className="btn btn-ghost btn-sm btn-icon" onClick={()=>onRemove(f.id)}><X size={13}/></button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── A420 Module ──────────────────────────────────────────────────────────────
function FieldEditor({ label, field, value, onChange, conf, snippet, multiline }) {
  return (
    <div style={{marginBottom:14}}>
      <div className="flex items-center gap-2 mb-1">
        <label style={{margin:0}}>{label}</label>
        {conf != null && (<><span className={`conf-dot ${conf>=0.9?'conf-high':conf>=0.75?'conf-medium':'conf-low'}`}/><span style={{fontSize:10,color:'var(--muted)'}}>{Math.round(conf*100)}%</span></>)}
      </div>
      {multiline ? <textarea rows={3} value={value||''} onChange={e=>onChange(field,e.target.value)} style={{resize:'vertical'}}/> : <input value={value||''} onChange={e=>onChange(field,e.target.value)}/>}
      {snippet && <div className="snippet">Source: "{snippet.slice(0,130)}{snippet.length>130?'...':''}"</div>}
    </div>
  );
}

function FacilityCard({ facility, index, onChange }) {
  const [open, setOpen] = useState(false);
  const a = facility._assessment || {};
  const cat = facility.facility_category || 'L';
  const catLabel = cat === 'HP' ? 'Hire Purchase' : 'Loan';
  const catColor = cat === 'HP' ? 'var(--magenta)' : 'var(--gold)';
  const utilisedMissing = facility.amount_utilised_rm == null;

  return (
    <div className="card" style={{marginBottom:10}}>
      <div className="flex items-center justify-between" style={{padding:'12px 14px',cursor:'pointer',borderBottom:open?'1px solid var(--border)':'none'}} onClick={()=>setOpen(o=>!o)}>
        <div className="flex items-center gap-3">
          <span style={{fontSize:11,fontWeight:700,color:'var(--muted)',minWidth:22}}>#{index+1}</span>
          <div>
            <div className="flex items-center gap-2">
              <span style={{fontSize:11,fontWeight:700,padding:'1px 6px',borderRadius:4,background:`rgba(0,0,0,0.3)`,color:catColor,border:`1px solid ${catColor}`,letterSpacing:'0.5px'}}>{cat}</span>
              <span style={{fontSize:13,fontWeight:600}}>{facility.bank_name||'Unknown Bank'}</span>
              {facility._from_cache && <span className="badge badge-blue" style={{fontSize:10}}>⚡ cached</span>}
              {facility._escalated_from && <span className="badge badge-magenta" style={{fontSize:10}} title={`Low confidence on Haiku (${Math.round((facility._haiku_confidence||0)*100)}%) — re-extracted with Sonnet`}>⬆ Sonnet</span>}
              {facility._escalation_failed && <span className="badge badge-amber" style={{fontSize:10}}>⚠ Escalation failed</span>}
            </div>
            <div style={{fontSize:11,color:'var(--muted)'}}>{facility.facility_type||'—'} · Limit: RM {facility.facility_limit_rm?.toLocaleString()||'—'}{utilisedMissing ? ' · Utilised: obtain from bank' : ` · Utilised: RM ${(facility.amount_utilised_rm||0).toLocaleString()}`}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {utilisedMissing && <span className="badge badge-amber" title="Utilised amount not in source doc — obtain from bank confirmation"><AlertTriangle size={9}/> No balance</span>}
          {a.needsReview ? <span className="badge badge-amber"><AlertTriangle size={9}/> Review</span> : <span className="badge badge-green"><CheckCircle size={9}/> OK</span>}
          <span style={{fontSize:11,color:'var(--muted)'}}>{Math.round((a.overall||0)*100)}%</span>
          {open?<ChevronUp size={13} color="var(--muted)"/>:<ChevronDown size={13} color="var(--muted)"/>}
        </div>
      </div>
      {open && (
        <div style={{padding:16}}>
          {/* Utilised-missing callout — always shown when utilised is null */}
          {utilisedMissing && (
            <div style={{padding:'8px 12px',background:'rgba(88,166,255,0.08)',border:'1px solid rgba(88,166,255,0.25)',borderRadius:'var(--radius)',marginBottom:12,fontSize:12,color:'var(--blue)'}}>
              <strong>Outstanding balance not in source document.</strong> Offer letters and HP agreements contain the facility limit, not the FY-end outstanding balance. Obtain from bank confirmation letter or loan account statement as at FY end, then enter below.
            </div>
          )}
          {(a.missing?.filter(f=>f!=='amount_utilised_rm').length>0||a.lowConfidence?.length>0||facility.review_notes?.length>0) && (
            <div className="review-box mb-4">
              <div className="flex items-center gap-2 mb-2" style={{color:'var(--amber)',fontSize:12,fontWeight:600}}><AlertTriangle size={12}/> Review Notes</div>
              {a.missing?.filter(f=>f!=='amount_utilised_rm').map(f=><div key={f} style={{fontSize:12,color:'var(--amber)',marginBottom:2}}>· Missing: {f}</div>)}
              {a.lowConfidence?.map(f=><div key={f} style={{fontSize:12,color:'var(--amber)',marginBottom:2}}>· Low confidence: {f}</div>)}
              {facility.review_notes?.filter(n=>!n.toLowerCase().includes('utilised amount not available')).map((n,i)=><div key={i} style={{fontSize:12,color:'var(--muted)',marginBottom:2}}>· {n}</div>)}
            </div>
          )}
          <div className="grid-2">
            <div>
              <label style={{fontSize:12,fontWeight:500,color:'var(--muted)',display:'block',marginBottom:4}}>Category</label>
              <select value={facility.facility_category||'L'} onChange={e=>onChange('facility_category',e.target.value)} style={{fontSize:13}}>
                <option value="L">L — Bank Loan / BA / Term Loan</option>
                <option value="HP">HP — Hire Purchase</option>
              </select>
            </div>
            <FieldEditor label="Agreement Date" field="facility_agreement_date" value={facility.facility_agreement_date} onChange={onChange} conf={facility.confidence?.facility_agreement_date} snippet={facility.source_snippets?.facility_agreement_date}/>
            <FieldEditor label="Bank / Finance Company Name" field="bank_name" value={facility.bank_name} onChange={onChange} conf={facility.confidence?.bank_name} snippet={facility.source_snippets?.bank_name}/>
            <FieldEditor label="Facility Type" field="facility_type" value={facility.facility_type} onChange={onChange} conf={facility.confidence?.facility_type} snippet={facility.source_snippets?.facility_type}/>
            <FieldEditor label="Facility Limit (RM)" field="facility_limit_rm" value={facility.facility_limit_rm} onChange={onChange} conf={facility.confidence?.facility_limit_rm} snippet={facility.source_snippets?.facility_limit_rm}/>
            <div>
              <FieldEditor label="Amount Utilised (RM) — FY end outstanding" field="amount_utilised_rm" value={facility.amount_utilised_rm} onChange={onChange} conf={facility.confidence?.amount_utilised_rm}/>
              {facility.utilised_source && <div style={{fontSize:11,color:'var(--muted)',marginTop:2}}>Source: {facility.utilised_source}</div>}
            </div>
            <FieldEditor label="Interest / Profit Rate" field="interest_profit_rate" value={facility.interest_profit_rate} onChange={onChange} conf={facility.confidence?.interest_profit_rate} snippet={facility.source_snippets?.interest_profit_rate}/>
            <FieldEditor label="Shariah Structure" field="shariah_structure" value={facility.shariah_structure} onChange={onChange} conf={facility.confidence?.shariah_structure}/>
            {cat === 'L' && <FieldEditor label="Government Guarantee" field="government_guarantee" value={facility.government_guarantee} onChange={onChange} conf={facility.confidence?.government_guarantee}/>}
          </div>
          <FieldEditor label="Repayment Terms" field="repayment_terms" value={facility.repayment_terms} onChange={onChange} conf={facility.confidence?.repayment_terms} snippet={facility.source_snippets?.repayment_terms} multiline/>
          {cat === 'L' && <FieldEditor label="Security / Collateral" field="security" value={facility.security} onChange={onChange} conf={facility.confidence?.security} snippet={facility.source_snippets?.security} multiline/>}
          {cat === 'L' && <FieldEditor label="Loan Covenants" field="covenants" value={facility.covenants} onChange={onChange} conf={facility.confidence?.covenants} snippet={facility.source_snippets?.covenants} multiline/>}
          <FieldEditor label="Purpose" field="purpose" value={facility.purpose} onChange={onChange} conf={facility.confidence?.purpose} snippet={facility.source_snippets?.purpose}/>
          <div className="divider"/>
          <div className="text-muted mono">Source: {facility._source_file} · {facility._extraction_model} · {facility._extracted_at?new Date(facility._extracted_at).toLocaleString('en-MY'):''}</div>
        </div>
      )}
    </div>
  );
}

function A420Module({ files, engagement, onMarkComplete, toast, phase, setPhase, progress, setProgress, results, setResults }) {
  const [exporting, setExporting]       = useState(false);
  const [narrative, setNarrative]       = useState('');
  const [genNarrative, setGenNarrative] = useState(false);
  const [signoff, setSignoff]           = useState(() => {
    // Pre-fill from engagement team
    return {
      preparedBy: '', preparedDate: '',
      reviewedBy: '', reviewedDate: '',
      partner:    '', partnerDate:  ''
    };
  });

  // Auto-load cached results on mount if results empty and files are ready
  useEffect(() => {
    if (results.length > 0 || phase !== 'idle') return;
    const eligible = files.filter(f => f.status==='ready' && (f.facility_category || ['OFFER_LETTER','LOAN_AGREEMENT','BANK_CONFIRMATION','REPAYMENT_SCHEDULE','HP_AGREEMENT','HP_REPAYMENT','UNKNOWN'].includes(f.docType)));
    if (!eligible.length) return;
    const cached = eligible.map(f => {
      const c = loadExtraction(engagement.id, f.name);
      if (!c) return null;
      const assessment = assessConfidence(c.data);
      return { ...c.data, _assessment: assessment, _file_id: f.id, _from_cache: true };
    }).filter(Boolean);
    if (cached.length > 0) {
      setResults(cached);
      setProgress(eligible.map(f => {
        const hit = cached.find(c => c._file_id === f.id);
        return { id: f.id, name: f.name, status: hit ? 'cached' : 'queued', conf: hit?._assessment?.overall ?? null };
      }));
      setPhase('done');
    }
  }, [engagement.id, files]);

  const eligibleFiles = files.filter(f => f.status==='ready' && (f.facility_category || ['OFFER_LETTER','LOAN_AGREEMENT','BANK_CONFIRMATION','REPAYMENT_SCHEDULE','HP_AGREEMENT','HP_REPAYMENT','UNKNOWN'].includes(f.docType)));

  const clearFileCache = (fileName) => {
    // Remove this file's extraction cache so it re-extracts on next run
    try {
      const key = `nexis_extract_${engagement.id}_${fileName.replace(/[^a-zA-Z0-9]/g,'_')}`;
      localStorage.removeItem(key);
    } catch(e) {}
  };

  const runExtraction = async () => {
    if (!eligibleFiles.length) { toast.error('No eligible documents found.'); return; }
    setPhase('running'); setResults([]);
    const prog = eligibleFiles.map(f=>({id:f.id,name:f.name,status:'queued',conf:null}));
    setProgress(prog);
    const extracted = [];
    for (let fi=0; fi<eligibleFiles.length; fi++) {
      const f = eligibleFiles[fi];
      const cached = loadExtraction(engagement.id, f.name);
      if (cached) {
        const assessment = assessConfidence(cached.data);
        extracted.push({...cached.data,_assessment:assessment,_file_id:f.id,_from_cache:true});
        setProgress(p=>p.map(x=>x.id===f.id?{...x,status:'cached',conf:assessment.overall}:x));
        toast.info(`Cached: ${f.name}`);
        continue;
      }
      setProgress(p=>p.map(x=>x.id===f.id?{...x,status:'extracting'}:x));
      try {
        // f.file is undefined for files restored from cache after page refresh (_noFile=true)
        // In that case _pages should exist; if neither available, skip with error
        let pages = f._pages || null;
        if (!pages) {
          if (!f.file) {
            setProgress(p=>p.map(x=>x.id===f.id?{...x,status:'error',error:'File not available — please re-upload this document'}:x));
            continue;
          }
          pages = await extractFileText(f.file, ()=>{});
        }
        const result = await extractA420Fields(pages,f.name,f.facility_category||null,f.docType||null);
        if (result.success) {
          // Handle multiple facilities returned from one document
          const allFacilities = result.facilities || [result.data];
          allFacilities.forEach(facilityData => {
            const assessment = assessConfidence(facilityData);
            const enriched = {...facilityData,_assessment:assessment,_file_id:f.id};
            extracted.push(enriched);
          });
          saveExtraction(engagement.id, f.name, result.data);
          const firstAssessment = assessConfidence(result.data);
          setProgress(p=>p.map(x=>x.id===f.id?{...x,status:'done',conf:firstAssessment.overall,escalated:!!result.escalated,escalation_failed:!!result.data._escalation_failed}:x));
        } else {
          setProgress(p=>p.map(x=>x.id===f.id?{...x,status:'error',error:result.error}:x));
        }
      } catch(err) {
        setProgress(p=>p.map(x=>x.id===f.id?{...x,status:'error',error:err.message}:x));
      }
    }
    setResults(extracted);
    setPhase('done');
    if (extracted.length>0) { toast.success(`Done — ${extracted.length} facilit${extracted.length===1?'y':'ies'} extracted`); }
  };

  const updateFacility = (i,field,value) => setResults(r=>r.map((f,j)=>j===i?{...f,[field]:value}:f));

  const handleExport = async () => {
    setExporting(true);
    try {
      const filename = await exportA420Excel(results, engagement, narrative, signoff);
      onMarkComplete('a420');
      toast.success(`Exported: ${filename}`);
    } catch(err) { toast.error(`Export failed: ${err.message}`); }
    setExporting(false);
  };

  const totalLimit = results.reduce((s,f)=>s+(parseFloat(f.facility_limit_rm)||0),0);
  const reviewCount = results.filter(f=>f._assessment?.needsReview).length;
  const avgConf = results.length ? Math.round(results.reduce((s,f)=>s+(f._assessment?.overall||0),0)/results.length*100) : 0;
  const doneCount = progress.filter(p=>p.status==='done'||p.status==='cached'||p.status==='error').length;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1>A420 · Loan Facilities & Covenants</h1>
          <p className="text-muted mt-1" style={{fontSize:13}}>Extract borrowing data → generate working paper → export Excel for CCH upload.</p>
        </div>
        <div className="flex gap-2">
          {results.length>0 && <button className="btn btn-ghost btn-sm" onClick={()=>{ if(window.confirm('Clear cache and re-extract all?')){clearEngagementCache(engagement.id);setResults([]);setProgress([]);setPhase('idle');toast.info('Cache cleared — run extraction again');}}} disabled={phase==='running'}><Trash2 size={13}/> Clear Cache</button>}
          {results.length>0 && <button className="btn btn-secondary" onClick={runExtraction} disabled={phase==='running'}><RefreshCw size={13}/> Re-run</button>}
          <button className="btn btn-secondary" onClick={handleExport} disabled={exporting||results.length===0}>
            {exporting?<><div className="spinner"/> Exporting...</>:<><FileSpreadsheet size={13}/> Export A420.xlsx</>}
          </button>
          <button className="btn btn-primary" onClick={runExtraction} disabled={phase==='running'||!eligibleFiles.length}>
            {phase==='running'?<><div className="spinner"/> Extracting...</>:<><Sparkles size={13}/> Run AI Extraction</>}
          </button>
        </div>
      </div>

      {phase==='idle' && (
        <div className="card card-pad mb-4">
          <div className="flex items-center gap-3">
            <div style={{width:40,height:40,borderRadius:'var(--radius)',background:'rgba(250,168,25,0.1)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><Banknote size={18} color="var(--gold)"/></div>
            <div>
              <div style={{fontSize:13,fontWeight:600}}>{eligibleFiles.length>0?`${eligibleFiles.length} document${eligibleFiles.length!==1?'s':''} ready for extraction`:'No documents ready — upload bank offer letters or confirmations first'}</div>
              <div className="text-muted" style={{fontSize:12}}>{eligibleFiles.length>0?eligibleFiles.map(f=>f.name).join(' · '):'Go to Documents to upload files'}</div>
            </div>
          </div>
        </div>
      )}

      {progress.length>0 && (
        <div className="card mb-4">
          <div style={{padding:'10px 14px',borderBottom:'1px solid var(--border)'}}>
            <div className="flex items-center justify-between">
              <h3>Extraction Progress</h3>
              {phase==='running' && <div className="flex items-center gap-2 text-muted" style={{fontSize:12}}><div className="spinner"/> {doneCount}/{progress.length}</div>}
            </div>
          </div>
          {phase==='running' && <div style={{padding:'6px 14px'}}><div className="progress-bar"><div className="progress-fill" style={{width:`${progress.length?doneCount/progress.length*100:0}%`}}/></div></div>}
          <table className="tbl">
            <thead><tr><th>Document</th><th>Status</th><th>Confidence</th><th style={{width:32}}></th></tr></thead>
            <tbody>
              {progress.map(p=>(
                <tr key={p.id}>
                  <td style={{fontSize:13}}>{p.name}</td>
                  <td>
                    {p.status==='queued'     && <span className="badge badge-muted">Queued</span>}
                    {p.status==='cached'     && <span className="badge badge-blue">⚡ From cache</span>}
                    {p.status==='extracting' && <div className="flex items-center gap-2"><div className="spinner"/><span style={{fontSize:12}}>Extracting</span></div>}
                    {p.status==='done'       && (
                      <div className="flex items-center gap-2">
                        <span className="badge badge-green"><CheckCircle size={9}/> Done</span>
                        {p.escalated && <span className="badge badge-magenta" title="Low confidence on Haiku — re-extracted with Claude Sonnet">⬆ Sonnet</span>}
                        {p.escalation_failed && <span className="badge badge-amber" title="Sonnet escalation failed — manual review required">⚠ Review</span>}
                      </div>
                    )}
                    {p.status==='error'      && <span className="badge badge-red"><AlertTriangle size={9}/> {p.error||'Error'}</span>}
                  </td>
                  <td>{p.conf!=null?<span className={`badge ${p.conf>=0.9?'badge-green':p.conf>=0.75?'badge-amber':'badge-red'}`}>{Math.round(p.conf*100)}%</span>:'—'}</td>
                  <td>
                    {(p.status==='cached'||p.status==='done') && (
                      <button className="btn btn-ghost btn-sm btn-icon" title="Clear cache for this file — will re-extract on next run"
                        onClick={()=>{
                          clearFileCache(p.name);
                          setProgress(prev=>prev.map(x=>x.id===p.id?{...x,status:'queued',conf:null}:x));
                          setResults(prev=>prev.filter(r=>r._source_file!==p.name));
                        }}>
                        <Trash2 size={11} color="var(--muted)"/>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {results.length>0 && (
        <div className="grid-4 mb-4">
          {[
            {label:'Loans (L)',value:results.filter(f=>f.facility_category==='L').length,color:'var(--gold)'},
            {label:'Hire Purchase (HP)',value:results.filter(f=>f.facility_category==='HP').length,color:'var(--magenta)'},
            {label:'Need Review',value:reviewCount,color:reviewCount>0?'var(--amber)':'var(--green)'},
            {label:'Avg Confidence',value:`${avgConf}%`,color:avgConf>=90?'var(--green)':avgConf>=75?'var(--amber)':'var(--red)'}
          ].map(({label,value,color})=>(
            <div key={label} className="card card-pad" style={{textAlign:'center'}}>
              <div style={{fontSize:20,fontWeight:700,color}}>{value}</div>
              <div style={{fontSize:11,color:'var(--muted)',marginTop:2}}>{label}</div>
            </div>
          ))}
        </div>
      )}

      {results.length>0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2>Extracted Facilities</h2>
            <span className="text-muted" style={{fontSize:12}}>Click to expand · Edit any field · Export when ready</span>
          </div>
          {results.map((f,i)=><FacilityCard key={f._file_id||i} facility={f} index={i} onChange={(field,val)=>updateFacility(i,field,val)}/>)}
          <div className="card card-pad mt-4" style={{borderLeft:'3px solid var(--gold)'}}>
            <div style={{fontSize:12,color:'var(--muted)'}}>⚠ AI-generated draft. Auditor review and sign-off required before use in audit files or upload to CCH.</div>
          </div>
        </div>
      )}

      {/* ── Narrative ── */}
      {results.length>0 && (
        <div className="card card-pad mt-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2>Working Paper Narrative</h2>
              <p className="text-muted mt-1" style={{fontSize:12}}>AI-drafted narrative for the A420 working paper. Review and amend before use.</p>
            </div>
            <button className="btn btn-secondary btn-sm" onClick={async()=>{
              setGenNarrative(true);
              const text = await generateNarrative(results);
              setNarrative(text);
              setGenNarrative(false);
              toast.success('Narrative generated');
            }} disabled={genNarrative}>
              {genNarrative?<><div className="spinner"/> Generating...</>:<><Sparkles size={12}/> Generate Narrative</>}
            </button>
          </div>
          <textarea
            rows={8}
            value={narrative}
            onChange={e=>setNarrative(e.target.value)}
            placeholder="Click 'Generate Narrative' to draft an AI working paper narrative, or type manually..."
            style={{resize:'vertical'}}
          />
        </div>
      )}

      {/* ── Sign-off ── */}
      {results.length>0 && (
        <div className="card card-pad mt-4">
          <div className="mb-3">
            <h2>Sign-off</h2>
            <p className="text-muted mt-1" style={{fontSize:12}}>Complete before export. Printed in the working paper footer.</p>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:16}}>
            {[
              {role:'Prepared By',    pk:'preparedBy', dk:'preparedDate', default: engagement.preparedBy||''},
              {role:'Reviewed By',    pk:'reviewedBy', dk:'reviewedDate', default: engagement.reviewedBy||''},
              {role:'Partner',        pk:'partner',    dk:'partnerDate',  default: engagement.partner||''},
            ].map(({role,pk,dk,default:def})=>(
              <div key={pk} style={{background:'var(--panel)',borderRadius:'var(--radius)',padding:'12px 14px',border:'1px solid var(--border)'}}>
                <div style={{fontSize:11,fontWeight:600,color:'var(--muted)',marginBottom:8,textTransform:'uppercase',letterSpacing:'0.5px'}}>{role}</div>
                <input
                  value={signoff[pk]||(signoff[pk]===''&&def?def:'')}
                  onChange={e=>setSignoff(s=>({...s,[pk]:e.target.value}))}
                  placeholder={def||'Name / Initials'}
                  style={{marginBottom:8,fontSize:12}}
                />
                <input
                  type="date"
                  value={signoff[dk]||new Date().toISOString().slice(0,10)}
                  onChange={e=>setSignoff(s=>({...s,[dk]:e.target.value}))}
                  style={{fontSize:12}}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


// ─── E100 Bank Reconciliation Module ─────────────────────────────────────────
function E100AccountCard({ account, index, onChange }) {
  const [open, setOpen] = useState(false);
  const a = account._assessment || {};

  const Field = ({ label, field, type='text' }) => (
    <div style={{marginBottom:12}}>
      <div className="flex items-center gap-2 mb-1">
        <label style={{margin:0}}>{label}</label>
        {account.confidence?.[field] != null && (
          <><span className={`conf-dot ${account.confidence[field]>=0.9?'conf-high':account.confidence[field]>=0.75?'conf-medium':'conf-low'}`}/>
          <span style={{fontSize:10,color:'var(--muted)'}}>{Math.round(account.confidence[field]*100)}%</span></>
        )}
      </div>
      <input type={type} value={account[field]??''} onChange={e=>onChange(field,e.target.value)}/>
      {account.source_snippets?.[field] && <div className="snippet">Source: "{account.source_snippets[field].slice(0,120)}..."</div>}
    </div>
  );

  const bankBal  = parseFloat(account.balance_per_bank_statement)||0;
  const outChq   = parseFloat(account.outstanding_cheques)||0;
  const deposits = parseFloat(account.deposits_in_transit)||0;
  const other    = parseFloat(account.other_reconciling_items)||0;
  const adjusted = bankBal - outChq + deposits + other;
  const bookBal  = parseFloat(account.balance_per_book)||0;
  const diff     = adjusted - bookBal;

  return (
    <div className="card" style={{marginBottom:10}}>
      <div className="flex items-center justify-between" style={{padding:'12px 14px',cursor:'pointer',borderBottom:open?'1px solid var(--border)':'none'}} onClick={()=>setOpen(o=>!o)}>
        <div className="flex items-center gap-3">
          <span style={{fontSize:11,fontWeight:700,color:'var(--muted)',minWidth:22}}>#{index+1}</span>
          <div>
            <div className="flex items-center gap-2">
              <span style={{fontSize:13,fontWeight:600}}>{account.bank_name||'Unknown Bank'}</span>
              {account._from_cache && <span className="badge badge-blue" style={{fontSize:10}}>⚡ cached</span>}
            </div>
            <div style={{fontSize:11,color:'var(--muted)'}}>{account.account_number||'—'} · {account.currency||'MYR'}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {a.isReconciled
            ? <span className="badge badge-green"><CheckCircle size={9}/> Reconciled</span>
            : <span className="badge badge-amber"><AlertTriangle size={9}/> Difference: RM{Math.abs(diff).toLocaleString()}</span>
          }
          {open?<ChevronUp size={13} color="var(--muted)"/>:<ChevronDown size={13} color="var(--muted)"/>}
        </div>
      </div>

      {open && (
        <div style={{padding:16}}>
          {(a.missing?.length>0||a.needsReview) && (
            <div className="review-box mb-4">
              <div className="flex items-center gap-2 mb-2" style={{color:'var(--amber)',fontSize:12,fontWeight:600}}><AlertTriangle size={12}/> Review Notes</div>
              {a.missing?.map(f=><div key={f} style={{fontSize:12,color:'var(--amber)',marginBottom:2}}>· Missing: {f}</div>)}
              {account.review_notes?.map((n,i)=><div key={i} style={{fontSize:12,color:'var(--muted)',marginBottom:2}}>· {n}</div>)}
            </div>
          )}

          <div className="grid-2">
            <Field label="Bank Name"       field="bank_name"/>
            <Field label="Account Name"    field="account_name"/>
            <Field label="Account Number"  field="account_number"/>
            <Field label="Account Type"    field="account_type"/>
            <Field label="Currency"        field="currency"/>
            <Field label="Statement Date"  field="statement_date"/>
          </div>

          {/* Live reconciliation calculator */}
          <div style={{background:'var(--panel)',borderRadius:'var(--radius)',padding:'14px 16px',marginBottom:14,border:'1px solid var(--border)'}}>
            <h3 style={{marginBottom:10}}>Bank Reconciliation</h3>
            <div style={{display:'grid',gridTemplateColumns:'1fr auto',gap:'6px 16px',fontSize:13}}>
              <div>
                <label style={{fontSize:11}}>Balance per Bank Statement (RM)</label>
                <input value={account.balance_per_bank_statement??''} onChange={e=>onChange('balance_per_bank_statement',e.target.value)} style={{marginTop:2}}/>
              </div>
              <div/>
              <div>
                <label style={{fontSize:11}}>Less: Outstanding Cheques (RM)</label>
                <input value={account.outstanding_cheques??''} onChange={e=>onChange('outstanding_cheques',e.target.value)} style={{marginTop:2}}/>
              </div>
              <div/>
              <div>
                <label style={{fontSize:11}}>Add: Deposits in Transit (RM)</label>
                <input value={account.deposits_in_transit??''} onChange={e=>onChange('deposits_in_transit',e.target.value)} style={{marginTop:2}}/>
              </div>
              <div/>
              <div>
                <label style={{fontSize:11}}>Add/(Less): Other Reconciling Items (RM)</label>
                <input value={account.other_reconciling_items??''} onChange={e=>onChange('other_reconciling_items',e.target.value)} style={{marginTop:2}}/>
              </div>
              <div/>
            </div>
            <div style={{borderTop:'1px solid var(--border)',marginTop:10,paddingTop:10,display:'grid',gridTemplateColumns:'1fr auto',gap:6,fontSize:13}}>
              <div style={{fontWeight:600}}>Adjusted Bank Balance</div>
              <div style={{fontWeight:700,color:'var(--gold)',textAlign:'right'}}>RM {adjusted.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
              <div>
                <label style={{fontSize:11}}>Balance per Book / TB (RM)</label>
                <input value={account.balance_per_book??''} onChange={e=>onChange('balance_per_book',e.target.value)} style={{marginTop:2}}/>
              </div>
              <div/>
              <div style={{fontWeight:600}}>Difference</div>
              <div style={{fontWeight:700,color:Math.abs(diff)<1?'var(--green)':'var(--red)',textAlign:'right'}}>
                RM {diff.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}
                {Math.abs(diff)<1?' ✓':''}
              </div>
            </div>
          </div>

          <div className="grid-2">
            <div style={{marginBottom:12}}>
              <label>Outstanding Cheques Details</label>
              <textarea rows={2} value={account.outstanding_cheques_details||''} onChange={e=>onChange('outstanding_cheques_details',e.target.value)} style={{resize:'vertical'}}/>
            </div>
            <div style={{marginBottom:12}}>
              <label>Deposits in Transit Details</label>
              <textarea rows={2} value={account.deposits_in_transit_details||''} onChange={e=>onChange('deposits_in_transit_details',e.target.value)} style={{resize:'vertical'}}/>
            </div>
          </div>
          <div style={{marginBottom:12}}>
            <label>Other Reconciling Items Details</label>
            <textarea rows={2} value={account.other_reconciling_items_details||''} onChange={e=>onChange('other_reconciling_items_details',e.target.value)} style={{resize:'vertical'}}/>
          </div>

          <div className="divider"/>
          <div className="text-muted mono">Source: {account._source_file} · {account._extraction_model} · {account._extracted_at?new Date(account._extracted_at).toLocaleString('en-MY'):''}</div>
        </div>
      )}
    </div>
  );
}

function E100Module({ files, engagement, onMarkComplete, toast, phase, setPhase, progress, setProgress, results, setResults }) {
  const [exporting, setExporting]       = useState(false);
  const [narrative, setNarrative]       = useState('');
  const [genNarrative, setGenNarrative] = useState(false);
  const [signoff, setSignoff]           = useState({
    preparedBy: engagement.preparedBy||'', preparedDate: new Date().toISOString().slice(0,10),
    reviewedBy: engagement.reviewedBy||'', reviewedDate: '',
    partner:    engagement.partner||'',    partnerDate:  ''
  });

  useEffect(() => {
    if (results.length>0 || phase!=='idle') return;
    const eligible = files.filter(f=>f.status==='ready');
    if (!eligible.length) return;
    const cached = eligible.map(f=>{
      const c = loadExtraction(engagement.id, 'e100_'+f.name);
      if (!c) return null;
      const assessment = assessE100Confidence(c.data);
      return {...c.data,_assessment:assessment,_file_id:f.id,_from_cache:true};
    }).filter(Boolean);
    if (cached.length>0) {
      setResults(cached);
      setProgress(eligible.map(f=>({id:f.id,name:f.name,status:'cached',conf:cached.find(c=>c._file_id===f.id)?._assessment?.overall??null})));
      setPhase('done');
    }
  }, [engagement.id, files]);

  const eligibleFiles = files.filter(f=>f.status==='ready');

  const clearFileCache = (fileName) => {
    // Remove this file's extraction cache so it re-extracts on next run
    try {
      const key = `nexis_extract_${engagement.id}_${fileName.replace(/[^a-zA-Z0-9]/g,'_')}`;
      localStorage.removeItem(key);
    } catch(e) {}
  };

  const runExtraction = async () => {
    if (!eligibleFiles.length) { toast.error('No documents found. Upload bank statements first.'); return; }
    setPhase('running'); setResults([]);
    setProgress(eligibleFiles.map(f=>({id:f.id,name:f.name,status:'queued',conf:null})));
    const extracted = [];
    for (const f of eligibleFiles) {
      const cached = loadExtraction(engagement.id, 'e100_'+f.name);
      if (cached) {
        const assessment = assessE100Confidence(cached.data);
        extracted.push({...cached.data,_assessment:assessment,_file_id:f.id,_from_cache:true});
        setProgress(p=>p.map(x=>x.id===f.id?{...x,status:'cached',conf:assessment.overall}:x));
        toast.info(`Cached: ${f.name}`);
        continue;
      }
      setProgress(p=>p.map(x=>x.id===f.id?{...x,status:'extracting'}:x));
      try {
        const pages = f._pages||await extractFileText(f.file,()=>{});
        const result = await extractE100Fields(pages,f.name);
        if (result.success) {
          const assessment = assessE100Confidence(result.data);
          const enriched = {...result.data,_assessment:assessment,_file_id:f.id};
          extracted.push(enriched);
          saveExtraction(engagement.id,'e100_'+f.name,result.data);
          setProgress(p=>p.map(x=>x.id===f.id?{...x,status:'done',conf:assessment.overall}:x));
        } else {
          setProgress(p=>p.map(x=>x.id===f.id?{...x,status:'error',error:result.error}:x));
        }
      } catch(err) {
        setProgress(p=>p.map(x=>x.id===f.id?{...x,status:'error',error:err.message}:x));
      }
    }
    setResults(extracted);
    setPhase('done');
    if (extracted.length>0) toast.success(`Done — ${extracted.length} account(s) extracted`);
  };

  const updateAccount = (i,field,value) => setResults(r=>r.map((a,j)=>j===i?{...a,[field]:value,_assessment:assessE100Confidence({...a,[field]:value})}:a));

  const handleExport = async () => {
    setExporting(true);
    try {
      const filename = await exportE100Excel(results, engagement, narrative, signoff);
      onMarkComplete('e100');
      toast.success(`Exported: ${filename}`);
    } catch(err) { toast.error(`Export failed: ${err.message}`); }
    setExporting(false);
  };

  const reconciledCount = results.filter(a=>a._assessment?.isReconciled).length;
  const doneCount = progress.filter(p=>p.status==='done'||p.status==='cached'||p.status==='error').length;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1>E100 · Bank Reconciliation</h1>
          <p className="text-muted mt-1" style={{fontSize:13}}>Extract bank balances → reconcile → generate working paper → export Excel.</p>
        </div>
        <div className="flex gap-2">
          {results.length>0 && <button className="btn btn-ghost btn-sm" onClick={()=>{if(window.confirm('Clear cache?')){eligibleFiles.forEach(f=>localStorage.removeItem('nexis_a420_'+engagement.id+'_e100_'+f.name.replace(/[^a-zA-Z0-9]/g,'_')));setResults([]);setProgress([]);setPhase('idle');toast.info('Cache cleared');}}}><Trash2 size={13}/> Clear Cache</button>}
          {results.length>0 && <button className="btn btn-secondary" onClick={runExtraction} disabled={phase==='running'}><RefreshCw size={13}/> Re-run</button>}
          <button className="btn btn-secondary" onClick={handleExport} disabled={exporting||results.length===0}>
            {exporting?<><div className="spinner"/> Exporting...</>:<><FileSpreadsheet size={13}/> Export E100.xlsx</>}
          </button>
          <button className="btn btn-primary" onClick={runExtraction} disabled={phase==='running'||!eligibleFiles.length}>
            {phase==='running'?<><div className="spinner"/> Extracting...</>:<><Sparkles size={13}/> Run AI Extraction</>}
          </button>
        </div>
      </div>

      {phase==='idle' && (
        <div className="card card-pad mb-4">
          <div className="flex items-center gap-3">
            <div style={{width:40,height:40,borderRadius:'var(--radius)',background:'rgba(88,166,255,0.1)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><Landmark size={18} color="var(--blue)"/></div>
            <div>
              <div style={{fontSize:13,fontWeight:600}}>{eligibleFiles.length>0?`${eligibleFiles.length} document${eligibleFiles.length!==1?'s':''} ready`:'No documents — upload bank statements first'}</div>
              <div className="text-muted" style={{fontSize:12}}>{eligibleFiles.length>0?eligibleFiles.map(f=>f.name).join(' · '):'Go to Documents to upload bank statements'}</div>
            </div>
          </div>
        </div>
      )}

      {progress.length>0 && (
        <div className="card mb-4">
          <div style={{padding:'10px 14px',borderBottom:'1px solid var(--border)'}}>
            <div className="flex items-center justify-between">
              <h3>Extraction Progress</h3>
              {phase==='running' && <div className="flex items-center gap-2 text-muted" style={{fontSize:12}}><div className="spinner"/> {doneCount}/{progress.length}</div>}
            </div>
          </div>
          {phase==='running' && <div style={{padding:'6px 14px'}}><div className="progress-bar"><div className="progress-fill" style={{width:`${progress.length?doneCount/progress.length*100:0}%`}}/></div></div>}
          <table className="tbl">
            <thead><tr><th>Document</th><th>Status</th><th>Confidence</th><th style={{width:32}}></th></tr></thead>
            <tbody>
              {progress.map(p=>(
                <tr key={p.id}>
                  <td style={{fontSize:13}}>{p.name}</td>
                  <td>
                    {p.status==='queued'     && <span className="badge badge-muted">Queued</span>}
                    {p.status==='cached'     && <span className="badge badge-blue">⚡ From cache</span>}
                    {p.status==='extracting' && <div className="flex items-center gap-2"><div className="spinner"/><span style={{fontSize:12}}>Extracting</span></div>}
                    {p.status==='done'       && (
                      <div className="flex items-center gap-2">
                        <span className="badge badge-green"><CheckCircle size={9}/> Done</span>
                        {p.escalated && <span className="badge badge-magenta" title="Low confidence on Haiku — re-extracted with Claude Sonnet">⬆ Sonnet</span>}
                        {p.escalation_failed && <span className="badge badge-amber" title="Sonnet escalation failed — manual review required">⚠ Review</span>}
                      </div>
                    )}
                    {p.status==='error'      && <span className="badge badge-red"><AlertTriangle size={9}/> {p.error||'Error'}</span>}
                  </td>
                  <td>{p.conf!=null?<span className={`badge ${p.conf>=0.9?'badge-green':p.conf>=0.75?'badge-amber':'badge-red'}`}>{Math.round(p.conf*100)}%</span>:'—'}</td>
                  <td>
                    {(p.status==='cached'||p.status==='done') && (
                      <button className="btn btn-ghost btn-sm btn-icon" title="Clear cache for this file — will re-extract on next run"
                        onClick={()=>{
                          clearFileCache(p.name);
                          setProgress(prev=>prev.map(x=>x.id===p.id?{...x,status:'queued',conf:null}:x));
                          setResults(prev=>prev.filter(r=>r._source_file!==p.name));
                        }}>
                        <Trash2 size={11} color="var(--muted)"/>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {results.length>0 && (
        <div className="grid-3 mb-4">
          {[
            {label:'Accounts',    value:results.length,         color:'var(--blue)'},
            {label:'Reconciled',  value:`${reconciledCount}/${results.length}`, color:reconciledCount===results.length?'var(--green)':'var(--amber)'},
            {label:'Differences', value:results.filter(a=>!a._assessment?.isReconciled).length, color:results.filter(a=>!a._assessment?.isReconciled).length>0?'var(--red)':'var(--green)'},
          ].map(({label,value,color})=>(
            <div key={label} className="card card-pad" style={{textAlign:'center'}}>
              <div style={{fontSize:20,fontWeight:700,color}}>{value}</div>
              <div style={{fontSize:11,color:'var(--muted)',marginTop:2}}>{label}</div>
            </div>
          ))}
        </div>
      )}

      {results.length>0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2>Bank Accounts</h2>
            <span className="text-muted" style={{fontSize:12}}>Click to expand · Edit fields · Reconciliation calculates live</span>
          </div>
          {results.map((a,i)=><E100AccountCard key={a._file_id||i} account={a} index={i} onChange={(field,val)=>updateAccount(i,field,val)}/>)}
        </div>
      )}

      {results.length>0 && (
        <div className="card card-pad mt-4">
          <div className="flex items-center justify-between mb-3">
            <div><h2>Working Paper Narrative</h2><p className="text-muted mt-1" style={{fontSize:12}}>AI-drafted E100 narrative. Review and amend before use.</p></div>
            <button className="btn btn-secondary btn-sm" onClick={async()=>{setGenNarrative(true);const t=await generateE100Narrative(results);setNarrative(t);setGenNarrative(false);toast.success('Narrative generated');}} disabled={genNarrative}>
              {genNarrative?<><div className="spinner"/> Generating...</>:<><Sparkles size={12}/> Generate Narrative</>}
            </button>
          </div>
          <textarea rows={6} value={narrative} onChange={e=>setNarrative(e.target.value)} placeholder="Click 'Generate Narrative' or type manually..." style={{resize:'vertical'}}/>
        </div>
      )}

      {results.length>0 && (
        <div className="card card-pad mt-4">
          <div className="mb-3"><h2>Sign-off</h2><p className="text-muted mt-1" style={{fontSize:12}}>Complete before export.</p></div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:16}}>
            {[
              {role:'Prepared By', pk:'preparedBy', dk:'preparedDate'},
              {role:'Reviewed By', pk:'reviewedBy', dk:'reviewedDate'},
              {role:'Partner',     pk:'partner',    dk:'partnerDate'},
            ].map(({role,pk,dk})=>(
              <div key={pk} style={{background:'var(--panel)',borderRadius:'var(--radius)',padding:'12px 14px',border:'1px solid var(--border)'}}>
                <div style={{fontSize:11,fontWeight:600,color:'var(--muted)',marginBottom:8,textTransform:'uppercase',letterSpacing:'0.5px'}}>{role}</div>
                <input value={signoff[pk]||''} onChange={e=>setSignoff(s=>({...s,[pk]:e.target.value}))} placeholder="Name / Initials" style={{marginBottom:8,fontSize:12}}/>
                <input type="date" value={signoff[dk]||''} onChange={e=>setSignoff(s=>({...s,[dk]:e.target.value}))} style={{fontSize:12}}/>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


// ─── B110 PPE Module ──────────────────────────────────────────────────────────
const DOC_TYPE_B110_BADGE = {
  ASSET_REGISTER: 'badge-gold', INVOICE: 'badge-blue',
  DEP_SCHEDULE: 'badge-green', VALUATION: 'badge-magenta', INSURANCE: 'badge-muted'
};
const DOC_TYPE_B110_LABEL = {
  ASSET_REGISTER: 'Asset Register', INVOICE: 'Invoice',
  DEP_SCHEDULE: 'Dep Schedule', VALUATION: 'Valuation', INSURANCE: 'Insurance'
};

function B110AssetCard({ asset, index, onChange }) {
  const [open, setOpen] = useState(false);
  const a = asset._assessment || {};
  const hasClasses = asset.asset_classes_summary?.length > 0;

  const Field = ({ label, field, type='text' }) => (
    <div style={{marginBottom:10}}>
      <div className="flex items-center gap-2 mb-1">
        <label style={{margin:0,fontSize:11}}>{label}</label>
        {asset.confidence?.[field] != null && (
          <><span className={`conf-dot ${asset.confidence[field]>=0.9?'conf-high':asset.confidence[field]>=0.75?'conf-medium':'conf-low'}`}/>
          <span style={{fontSize:10,color:'var(--muted)'}}>{Math.round(asset.confidence[field]*100)}%</span></>
        )}
      </div>
      <input type={type} value={asset[field]??''} onChange={e=>onChange(field,e.target.value)} style={{fontSize:12}}/>
      {asset.source_snippets?.[field] && <div className="snippet">Source: "{asset.source_snippets[field].slice(0,100)}..."</div>}
    </div>
  );

  const docType = asset._doc_type || 'ASSET_REGISTER';
  const title = hasClasses
    ? `${asset.asset_classes_summary.length} asset class${asset.asset_classes_summary.length!==1?'es':''}`
    : (asset.asset_class || 'Unknown Asset');

  return (
    <div className="card" style={{marginBottom:10}}>
      <div className="flex items-center justify-between" style={{padding:'12px 14px',cursor:'pointer',borderBottom:open?'1px solid var(--border)':'none'}} onClick={()=>setOpen(o=>!o)}>
        <div className="flex items-center gap-3">
          <span style={{fontSize:11,fontWeight:700,color:'var(--muted)',minWidth:22}}>#{index+1}</span>
          <div>
            <div className="flex items-center gap-2">
              <span style={{fontSize:13,fontWeight:600}}>{title}</span>
              <span className={`badge ${DOC_TYPE_B110_BADGE[docType]||'badge-muted'}`} style={{fontSize:10}}>{DOC_TYPE_B110_LABEL[docType]||docType}</span>
              {asset._from_cache && <span className="badge badge-blue" style={{fontSize:10}}>⚡ cached</span>}
            </div>
            <div style={{fontSize:11,color:'var(--muted)'}}>
              {asset.invoice_number ? `Invoice ${asset.invoice_number} · RM${asset.invoice_amount?.toLocaleString()||'—'}` : `NBV c/f: RM${asset.nbv_cf?.toLocaleString()||'—'}`}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {a.needsReview ? <span className="badge badge-amber"><AlertTriangle size={9}/> Review</span> : <span className="badge badge-green"><CheckCircle size={9}/> OK</span>}
          {open?<ChevronUp size={13} color="var(--muted)"/>:<ChevronDown size={13} color="var(--muted)"/>}
        </div>
      </div>

      {open && (
        <div style={{padding:16}}>
          {a.needsReview && (
            <div className="review-box mb-4">
              <div className="flex items-center gap-2 mb-2" style={{color:'var(--amber)',fontSize:12,fontWeight:600}}><AlertTriangle size={12}/> Review Notes</div>
              {a.missing?.map(f=><div key={f} style={{fontSize:12,color:'var(--amber)',marginBottom:2}}>· Missing: {f}</div>)}
              {a.costCheck===false && <div style={{fontSize:12,color:'var(--red)',marginBottom:2}}>· Cost movement does not balance: b/f + additions − disposals ≠ c/f</div>}
              {a.depCheck===false  && <div style={{fontSize:12,color:'var(--red)',marginBottom:2}}>· Accumulated depreciation movement does not balance</div>}
              {a.nbvCheck===false  && <div style={{fontSize:12,color:'var(--red)',marginBottom:2}}>· NBV ≠ Cost c/f − Acc dep c/f</div>}
              {asset.review_notes?.map((n,i)=><div key={i} style={{fontSize:12,color:'var(--muted)',marginBottom:2}}>· {n}</div>)}
            </div>
          )}

          {/* Asset class summary table */}
          {hasClasses && (
            <div style={{marginBottom:16,overflowX:'auto'}}>
              <h3 style={{marginBottom:8}}>Asset Class Movement Schedule</h3>
              <table className="tbl" style={{minWidth:700}}>
                <thead>
                  <tr>
                    <th>Asset Class</th>
                    <th style={{textAlign:'right'}}>Cost b/f (RM)</th>
                    <th style={{textAlign:'right'}}>Additions</th>
                    <th style={{textAlign:'right'}}>Disposals</th>
                    <th style={{textAlign:'right'}}>Cost c/f</th>
                    <th style={{textAlign:'right'}}>Acc Dep b/f</th>
                    <th style={{textAlign:'right'}}>Dep charge</th>
                    <th style={{textAlign:'right'}}>Acc Dep c/f</th>
                    <th style={{textAlign:'right'}}>NBV c/f</th>
                  </tr>
                </thead>
                <tbody>
                  {asset.asset_classes_summary.map((c,i)=>(
                    <tr key={i}>
                      <td style={{fontSize:12}}>{c.class}</td>
                      {[c.cost_bf,c.additions,c.disposals,c.cost_cf,c.acc_dep_bf,c.dep_charge,c.acc_dep_cf,c.nbv_cf].map((v,j)=>(
                        <td key={j} style={{textAlign:'right',fontSize:12,fontFamily:'var(--mono)'}}>{v!=null?Number(v).toLocaleString():'—'}</td>
                      ))}
                    </tr>
                  ))}
                  <tr style={{borderTop:'2px solid var(--border)'}}>
                    <td style={{fontWeight:700,fontSize:12}}>TOTAL</td>
                    {['cost_bf','additions','disposals','cost_cf','acc_dep_bf','dep_charge','acc_dep_cf','nbv_cf'].map(k=>(
                      <td key={k} style={{textAlign:'right',fontSize:12,fontWeight:700,fontFamily:'var(--mono)'}}>
                        {asset.asset_classes_summary.reduce((s,c)=>s+(c[k]||0),0).toLocaleString()}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* Invoice fields */}
          {docType === 'INVOICE' && (
            <div className="grid-2">
              <Field label="Asset Class"     field="asset_class"/>
              <Field label="Asset Description" field="asset_description"/>
              <Field label="Invoice Number"  field="invoice_number"/>
              <Field label="Invoice Date"    field="invoice_date"/>
              <Field label="Supplier"        field="supplier"/>
              <Field label="Invoice Amount (RM)" field="invoice_amount"/>
            </div>
          )}

          {/* Single asset fields */}
          {!hasClasses && docType !== 'INVOICE' && (
            <>
              <div className="grid-2">
                <Field label="Asset Class"    field="asset_class"/>
                <Field label="Dep Rate"       field="dep_rate"/>
                <Field label="Dep Method"     field="dep_method"/>
                <Field label="Useful Life"    field="useful_life"/>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12,marginBottom:12,background:'var(--panel)',padding:'12px',borderRadius:'var(--radius)',border:'1px solid var(--border)'}}>
                <div><div style={{fontSize:10,color:'var(--muted)',marginBottom:4}}>COST B/F</div><input value={asset.cost_bf??''} onChange={e=>onChange('cost_bf',e.target.value)} style={{fontSize:12}}/></div>
                <div><div style={{fontSize:10,color:'var(--muted)',marginBottom:4}}>ADDITIONS</div><input value={asset.additions??''} onChange={e=>onChange('additions',e.target.value)} style={{fontSize:12}}/></div>
                <div><div style={{fontSize:10,color:'var(--muted)',marginBottom:4}}>DISPOSALS</div><input value={asset.disposals??''} onChange={e=>onChange('disposals',e.target.value)} style={{fontSize:12}}/></div>
                <div><div style={{fontSize:10,color:'var(--muted)',marginBottom:4}}>COST C/F</div><input value={asset.cost_cf??''} onChange={e=>onChange('cost_cf',e.target.value)} style={{fontSize:12}}/></div>
                <div><div style={{fontSize:10,color:'var(--muted)',marginBottom:4}}>ACC DEP B/F</div><input value={asset.acc_dep_bf??''} onChange={e=>onChange('acc_dep_bf',e.target.value)} style={{fontSize:12}}/></div>
                <div><div style={{fontSize:10,color:'var(--muted)',marginBottom:4}}>DEP CHARGE</div><input value={asset.dep_charge??''} onChange={e=>onChange('dep_charge',e.target.value)} style={{fontSize:12}}/></div>
                <div><div style={{fontSize:10,color:'var(--muted)',marginBottom:4}}>ACC DEP C/F</div><input value={asset.acc_dep_cf??''} onChange={e=>onChange('acc_dep_cf',e.target.value)} style={{fontSize:12}}/></div>
                <div><div style={{fontSize:10,color:'var(--muted)',marginBottom:4,color:'var(--gold)',fontWeight:600}}>NBV C/F</div><input value={asset.nbv_cf??''} onChange={e=>onChange('nbv_cf',e.target.value)} style={{fontSize:12,borderColor:'var(--gold)'}}/></div>
                <div><div style={{fontSize:10,color:'var(--muted)',marginBottom:4}}>INSURANCE VALUE</div><input value={asset.insurance_value??''} onChange={e=>onChange('insurance_value',e.target.value)} style={{fontSize:12}}/></div>
              </div>
            </>
          )}

          <div className="divider"/>
          <div className="text-muted mono">Source: {asset._source_file} · {asset._extraction_model} · {asset._extracted_at?new Date(asset._extracted_at).toLocaleString('en-MY'):''}</div>
        </div>
      )}
    </div>
  );
}

function B110Module({ files, engagement, onMarkComplete, toast, phase, setPhase, progress, setProgress, results, setResults }) {
  const [exporting, setExporting]       = useState(false);
  const [narrative, setNarrative]       = useState('');
  const [genNarrative, setGenNarrative] = useState(false);
  const [signoff, setSignoff]           = useState({
    preparedBy: engagement.preparedBy||'', preparedDate: new Date().toISOString().slice(0,10),
    reviewedBy: engagement.reviewedBy||'', reviewedDate: '',
    partner:    engagement.partner||'',    partnerDate:  ''
  });

  useEffect(() => {
    if (results.length>0 || phase!=='idle') return;
    const eligible = files.filter(f=>f.status==='ready');
    if (!eligible.length) return;
    const cached = eligible.map(f=>{
      const c = loadExtraction(engagement.id,'b110_'+f.name);
      if (!c) return null;
      const assessment = assessB110Confidence(c.data);
      return {...c.data,_assessment:assessment,_file_id:f.id,_from_cache:true};
    }).filter(Boolean);
    if (cached.length>0) {
      setResults(cached);
      setProgress(eligible.map(f=>({id:f.id,name:f.name,status:'cached',conf:cached.find(c=>c._file_id===f.id)?._assessment?.overall??null})));
      setPhase('done');
    }
  }, [engagement.id, files]);

  const eligibleFiles = files.filter(f=>f.status==='ready');

  const clearFileCache = (fileName) => {
    // Remove this file's extraction cache so it re-extracts on next run
    try {
      const key = `nexis_extract_${engagement.id}_${fileName.replace(/[^a-zA-Z0-9]/g,'_')}`;
      localStorage.removeItem(key);
    } catch(e) {}
  };

  const runExtraction = async () => {
    if (!eligibleFiles.length) { toast.error('No documents. Upload PPE files first.'); return; }
    setPhase('running'); setResults([]);
    setProgress(eligibleFiles.map(f=>({id:f.id,name:f.name,status:'queued',conf:null})));
    const extracted = [];
    for (const f of eligibleFiles) {
      const cached = loadExtraction(engagement.id,'b110_'+f.name);
      if (cached) {
        const assessment = assessB110Confidence(cached.data);
        const docType = classifyB110Document(cached.data._raw_text||'', f.name).type;
        extracted.push({...cached.data,_assessment:assessment,_file_id:f.id,_from_cache:true,_doc_type:docType});
        setProgress(p=>p.map(x=>x.id===f.id?{...x,status:'cached',conf:assessment.overall}:x));
        continue;
      }
      setProgress(p=>p.map(x=>x.id===f.id?{...x,status:'extracting'}:x));
      try {
        const pages = f._pages||await extractFileText(f.file,()=>{});
        const text = pages.map(p=>p.text).join(' ');
        const docType = classifyB110Document(text, f.name).type;
        const result = await extractB110Fields(pages,f.name);
        if (result.success) {
          const assessment = assessB110Confidence(result.data);
          const enriched = {...result.data,_assessment:assessment,_file_id:f.id,_doc_type:docType};
          extracted.push(enriched);
          saveExtraction(engagement.id,'b110_'+f.name,result.data);
          setProgress(p=>p.map(x=>x.id===f.id?{...x,status:'done',conf:assessment.overall}:x));
        } else {
          setProgress(p=>p.map(x=>x.id===f.id?{...x,status:'error',error:result.error}:x));
        }
      } catch(err) {
        setProgress(p=>p.map(x=>x.id===f.id?{...x,status:'error',error:err.message}:x));
      }
    }
    setResults(extracted);
    setPhase('done');
    if (extracted.length>0) toast.success(`Done — ${extracted.length} document${extracted.length!==1?'s':''} extracted`);
  };

  const updateAsset = (i,field,value) => setResults(r=>r.map((a,j)=>j===i?{...a,[field]:value,_assessment:assessB110Confidence({...a,[field]:value})}:a));

  const handleExport = async () => {
    setExporting(true);
    try {
      const filename = await exportB110Excel(results,engagement,narrative,signoff);
      onMarkComplete('b110');
      toast.success(`Exported: ${filename}`);
    } catch(err) { toast.error(`Export failed: ${err.message}`); }
    setExporting(false);
  };

  const doneCount = progress.filter(p=>p.status==='done'||p.status==='cached'||p.status==='error').length;
  const totalNBV  = results.reduce((s,a)=>s+(parseFloat(a.nbv_cf)||0),0);
  const reviewCount = results.filter(a=>a._assessment?.needsReview).length;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1>B110 · Property, Plant & Equipment</h1>
          <p className="text-muted mt-1" style={{fontSize:13}}>Extract PPE data → full movement schedule → export Excel for CCH upload.</p>
        </div>
        <div className="flex gap-2">
          {results.length>0 && <button className="btn btn-ghost btn-sm" onClick={()=>{if(window.confirm('Clear B110 cache?')){eligibleFiles.forEach(f=>localStorage.removeItem('nexis_extract_'+engagement.id+'_b110_'+f.name.replace(/[^a-zA-Z0-9]/g,'_')));setResults([]);setProgress([]);setPhase('idle');toast.info('Cache cleared');}}}><Trash2 size={13}/> Clear Cache</button>}
          {results.length>0 && <button className="btn btn-secondary" onClick={runExtraction} disabled={phase==='running'}><RefreshCw size={13}/> Re-run</button>}
          <button className="btn btn-secondary" onClick={handleExport} disabled={exporting||results.length===0}>
            {exporting?<><div className="spinner"/> Exporting...</>:<><FileSpreadsheet size={13}/> Export B110.xlsx</>}
          </button>
          <button className="btn btn-primary" onClick={runExtraction} disabled={phase==='running'||!eligibleFiles.length}>
            {phase==='running'?<><div className="spinner"/> Extracting...</>:<><Sparkles size={13}/> Run AI Extraction</>}
          </button>
        </div>
      </div>

      {phase==='idle' && (
        <div className="card card-pad mb-4">
          <div className="flex items-center gap-3">
            <div style={{width:40,height:40,borderRadius:'var(--radius)',background:'rgba(184,68,128,0.1)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><Building2 size={18} color="var(--magenta)"/></div>
            <div>
              <div style={{fontSize:13,fontWeight:600}}>{eligibleFiles.length>0?`${eligibleFiles.length} document${eligibleFiles.length!==1?'s':''} ready`:'No documents — upload asset register, invoices or depreciation schedule'}</div>
              <div className="text-muted" style={{fontSize:12}}>{eligibleFiles.length>0?eligibleFiles.map(f=>f.name).join(' · '):'Go to Documents to upload PPE files'}</div>
            </div>
          </div>
        </div>
      )}

      {progress.length>0 && (
        <div className="card mb-4">
          <div style={{padding:'10px 14px',borderBottom:'1px solid var(--border)'}}>
            <div className="flex items-center justify-between">
              <h3>Extraction Progress</h3>
              {phase==='running' && <div className="flex items-center gap-2 text-muted" style={{fontSize:12}}><div className="spinner"/> {doneCount}/{progress.length}</div>}
            </div>
          </div>
          {phase==='running' && <div style={{padding:'6px 14px'}}><div className="progress-bar"><div className="progress-fill" style={{width:`${progress.length?doneCount/progress.length*100:0}%`}}/></div></div>}
          <table className="tbl">
            <thead><tr><th>Document</th><th>Status</th><th>Confidence</th><th style={{width:32}}></th></tr></thead>
            <tbody>
              {progress.map(p=>(
                <tr key={p.id}>
                  <td style={{fontSize:13}}>{p.name}</td>
                  <td>
                    {p.status==='queued'     && <span className="badge badge-muted">Queued</span>}
                    {p.status==='cached'     && <span className="badge badge-blue">⚡ From cache</span>}
                    {p.status==='extracting' && <div className="flex items-center gap-2"><div className="spinner"/><span style={{fontSize:12}}>Extracting</span></div>}
                    {p.status==='done'       && (
                      <div className="flex items-center gap-2">
                        <span className="badge badge-green"><CheckCircle size={9}/> Done</span>
                        {p.escalated && <span className="badge badge-magenta" title="Low confidence on Haiku — re-extracted with Claude Sonnet">⬆ Sonnet</span>}
                        {p.escalation_failed && <span className="badge badge-amber" title="Sonnet escalation failed — manual review required">⚠ Review</span>}
                      </div>
                    )}
                    {p.status==='error'      && <span className="badge badge-red"><AlertTriangle size={9}/> {p.error||'Error'}</span>}
                  </td>
                  <td>{p.conf!=null?<span className={`badge ${p.conf>=0.9?'badge-green':p.conf>=0.75?'badge-amber':'badge-red'}`}>{Math.round(p.conf*100)}%</span>:'—'}</td>
                  <td>
                    {(p.status==='cached'||p.status==='done') && (
                      <button className="btn btn-ghost btn-sm btn-icon" title="Clear cache for this file — will re-extract on next run"
                        onClick={()=>{
                          clearFileCache(p.name);
                          setProgress(prev=>prev.map(x=>x.id===p.id?{...x,status:'queued',conf:null}:x));
                          setResults(prev=>prev.filter(r=>r._source_file!==p.name));
                        }}>
                        <Trash2 size={11} color="var(--muted)"/>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {results.length>0 && (
        <div className="grid-3 mb-4">
          {[
            {label:'Documents',     value:results.length,          color:'var(--blue)'},
            {label:'Total NBV c/f', value:`RM ${totalNBV.toLocaleString()}`, color:'var(--magenta)'},
            {label:'Need Review',   value:reviewCount,             color:reviewCount>0?'var(--amber)':'var(--green)'},
          ].map(({label,value,color})=>(
            <div key={label} className="card card-pad" style={{textAlign:'center'}}>
              <div style={{fontSize:20,fontWeight:700,color}}>{value}</div>
              <div style={{fontSize:11,color:'var(--muted)',marginTop:2}}>{label}</div>
            </div>
          ))}
        </div>
      )}

      {results.length>0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2>Extracted PPE Documents</h2>
            <span className="text-muted" style={{fontSize:12}}>Click to expand · Edit fields · Cross-checks run automatically</span>
          </div>
          {results.map((a,i)=><B110AssetCard key={a._file_id||i} asset={a} index={i} onChange={(field,val)=>updateAsset(i,field,val)}/>)}
        </div>
      )}

      {results.length>0 && (
        <div className="card card-pad mt-4">
          <div className="flex items-center justify-between mb-3">
            <div><h2>Working Paper Narrative</h2><p className="text-muted mt-1" style={{fontSize:12}}>AI-drafted B110 narrative under MFRS 116. Review and amend before use.</p></div>
            <button className="btn btn-secondary btn-sm" onClick={async()=>{setGenNarrative(true);const t=await generateB110Narrative(results);setNarrative(t);setGenNarrative(false);toast.success('Narrative generated');}} disabled={genNarrative}>
              {genNarrative?<><div className="spinner"/> Generating...</>:<><Sparkles size={12}/> Generate Narrative</>}
            </button>
          </div>
          <textarea rows={7} value={narrative} onChange={e=>setNarrative(e.target.value)} placeholder="Click 'Generate Narrative' or type manually..." style={{resize:'vertical'}}/>
        </div>
      )}

      {results.length>0 && (
        <div className="card card-pad mt-4">
          <div className="mb-3"><h2>Sign-off</h2></div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:16}}>
            {[{role:'Prepared By',pk:'preparedBy',dk:'preparedDate'},{role:'Reviewed By',pk:'reviewedBy',dk:'reviewedDate'},{role:'Partner',pk:'partner',dk:'partnerDate'}].map(({role,pk,dk})=>(
              <div key={pk} style={{background:'var(--panel)',borderRadius:'var(--radius)',padding:'12px 14px',border:'1px solid var(--border)'}}>
                <div style={{fontSize:11,fontWeight:600,color:'var(--muted)',marginBottom:8,textTransform:'uppercase',letterSpacing:'0.5px'}}>{role}</div>
                <input value={signoff[pk]||''} onChange={e=>setSignoff(s=>({...s,[pk]:e.target.value}))} placeholder="Name / Initials" style={{marginBottom:8,fontSize:12}}/>
                <input type="date" value={signoff[dk]||''} onChange={e=>setSignoff(s=>({...s,[dk]:e.target.value}))} style={{fontSize:12}}/>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── AI Insights module ───────────────────────────────────────────────────────
function InsightsModule({ files, engagement, toast }) {
  const [query, setQuery]     = useState('');
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState([]);
  const readyFiles = files.filter(f=>f.status==='ready');
  const QUICK = ['Summarise all uploaded documents','List all banks and facility types','Identify any high-risk covenants','What documents are missing for a complete A420?','Highlight any Islamic finance facilities'];
  const ask = async (q) => {
    const question = q||query;
    if (!question.trim()) return;
    setLoading(true); setQuery('');
    const docCtx = readyFiles.map(f=>`- ${f.name} (${DOC_LABELS[f.docType]||f.docType})`).join('\n');
    try {
      const res = await fetch('/api/ai',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:[{role:'system',content:`You are a senior Malaysian audit assistant. Engagement: ${engagement.client}, FY ${engagement.fyEnd}.\nUploaded documents:\n${docCtx||'None yet.'}\nBe concise and professional.`},...history.map(h=>[{role:'user',content:h.q},{role:'assistant',content:h.a}]).flat(),{role:'user',content:question}],temperature:0.2})});
      const data = await res.json();
      const answer = data.choices?.[0]?.message?.content||'No response.';
      setResponse(answer);
      setHistory(h=>[...h.slice(-4),{q:question,a:answer}]);
    } catch(err) { toast.error('AI failed: '+err.message); }
    setLoading(false);
  };
  return (
    <div>
      <div className="mb-4"><h1>AI Insights</h1><p className="text-muted mt-1" style={{fontSize:13}}>Ask questions about uploaded documents or request narrative drafts.</p></div>
      <div className="card card-pad mb-4">
        <h3 className="mb-3">Quick Prompts</h3>
        <div style={{display:'flex',flexWrap:'wrap',gap:8}}>{QUICK.map(q=><button key={q} className="btn btn-secondary btn-sm" onClick={()=>ask(q)} disabled={loading}>{q}</button>)}</div>
      </div>
      <div className="card card-pad mb-4">
        <div className="flex gap-2">
          <input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==='Enter'&&!e.shiftKey&&ask()} placeholder="Ask anything about the audit documents..." style={{flex:1}} disabled={loading}/>
          <button className="btn btn-primary" onClick={()=>ask()} disabled={loading||!query.trim()}>{loading?<div className="spinner"/>:<Sparkles size={13}/>}</button>
        </div>
      </div>
      {loading && <div className="card card-pad flex items-center gap-3"><div className="spinner"/><span className="text-muted" style={{fontSize:13}}>Generating...</span></div>}
      {response && !loading && (
        <div className="card card-pad">
          <div className="flex items-center gap-2 mb-3"><Sparkles size={13} color="var(--gold)"/><span style={{fontSize:13,fontWeight:600,color:'var(--gold)'}}>AI Response</span><span className="badge badge-muted">Groq</span></div>
          <div style={{fontSize:13,lineHeight:1.8,whiteSpace:'pre-wrap'}}>{response}</div>
        </div>
      )}
      {readyFiles.length===0 && <div className="empty-state mt-6"><BookOpen size={32}/><div style={{fontSize:14,fontWeight:500,marginTop:8,marginBottom:4}}>No documents uploaded</div><div style={{fontSize:13}}>Upload documents first</div></div>}
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [view, setView]                 = useState('dashboard'); // 'dashboard' | 'engagement'
  const [engagements, setEngagements]   = useState(() => loadEngagements());
  const [activeEng, setActiveEng]       = useState(null);
  const [activeModule, setActiveModule] = useState('documents');
  const [files, setFiles]               = useState([]);
  const [a420Phase, setA420Phase]       = useState('idle');
  const [a420Progress, setA420Progress] = useState([]);
  const [a420Results, setA420Results]   = useState([]);
  const [e100Phase, setE100Phase]       = useState('idle');
  const [e100Progress, setE100Progress] = useState([]);
  const [e100Results, setE100Results]   = useState([]);
  const [b110Phase, setB110Phase]       = useState('idle');
  const [b110Progress, setB110Progress] = useState([]);
  const [b110Results, setB110Results]   = useState([]);
  const toast = useToast();

  const openEngagement = (eng) => {
    if (!activeEng || activeEng.id !== eng.id) {
      // Restore persisted files for this engagement
      const persisted = loadFiles(eng.id);
      setFiles(persisted);
      setA420Phase('idle');
      setA420Progress([]);
      setA420Results([]);
      setE100Phase('idle');
      setE100Progress([]);
      setE100Results([]);
      setB110Phase('idle');
      setB110Progress([]);
      setB110Results([]);
    }
    setActiveEng(eng);
    setActiveModule('documents');
    setView('engagement');
  };

  const addEngagement = (eng) => {
    const updated = upsertEngagement(eng);
    setEngagements(updated);
    openEngagement(eng);
    toast.success(`Engagement created: ${eng.client}`);
  };

  // Refresh engagements from storage (called after any update)
  const refreshEngagements = () => setEngagements(loadEngagements());

  // Auto-save files to localStorage whenever they change
  useEffect(() => {
    if (activeEng && files.length > 0) {
      saveFiles(activeEng.id, files);
      // Update doc count on engagement
      const readyCount = files.filter(f => f.status === 'ready').length;
      if (readyCount !== activeEng.docCount) {
        const updated = { ...activeEng, docCount: readyCount, updatedAt: new Date().toISOString() };
        setActiveEng(updated);
        upsertEngagement(updated);
        setEngagements(loadEngagements());
      }
    }
  }, [files]);

  const markComplete = (sectionId) => {
    if (!activeEng) return;
    const already = (activeEng.completedSections || []).includes(sectionId);
    if (already) return;
    const updated = { ...activeEng, completedSections: [...(activeEng.completedSections||[]), sectionId], updatedAt: new Date().toISOString(), status: 'In Progress' };
    setActiveEng(updated);
    const all = upsertEngagement(updated);
    setEngagements(all);
    const labels = { a420: 'A420 Borrowings', e100: 'E100 Bank Recon', b110: 'B110 PPE', c200: 'C200 Receivables', d200: 'D200 Payables', a310: 'A310 Related Parties', a150: 'A150 Share Capital' };
    toast.success(`${labels[sectionId] || sectionId} marked complete ✓`);
  };

  const renderModule = () => {
    if (!activeEng) return null;
    switch(activeModule) {
      case 'documents': return <DocumentsModule files={files} setFiles={setFiles} toast={toast}/>;
      case 'insights':  return <InsightsModule files={files} engagement={activeEng} toast={toast}/>;
      case 'a420':      return <A420Module files={files} engagement={activeEng} onMarkComplete={markComplete} toast={toast} phase={a420Phase} setPhase={setA420Phase} progress={a420Progress} setProgress={setA420Progress} results={a420Results} setResults={setA420Results}/>;
      case 'e100':      return <E100Module files={files} engagement={activeEng} onMarkComplete={markComplete} toast={toast} phase={e100Phase} setPhase={setE100Phase} progress={e100Progress} setProgress={setE100Progress} results={e100Results} setResults={setE100Results}/>;
      case 'b110':      return <B110Module files={files} engagement={activeEng} onMarkComplete={markComplete} toast={toast} phase={b110Phase} setPhase={setB110Phase} progress={b110Progress} setProgress={setB110Progress} results={b110Results} setResults={setB110Results}/>;
      default: return (
        <div className="empty-state" style={{paddingTop:80}}>
          <Lock size={32}/>
          <div style={{fontSize:16,fontWeight:600,marginTop:12,marginBottom:6}}>{activeModule.toUpperCase()} — Coming Soon</div>
          <div style={{fontSize:13}}>This working paper module will be available in a future phase.</div>
        </div>
      );
    }
  };

  if (view === 'dashboard') {
    return (
      <div style={{height:'100vh',display:'flex',flexDirection:'column'}}>
        {/* Top bar */}
        <div style={{background:'var(--ink2)',borderBottom:'1px solid var(--border)',padding:'0 20px',height:46,display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0}}>
          <div className="flex items-center gap-3">
            <svg width="22" height="22" viewBox="0 0 28 28" fill="none">
              <polygon points="14,2 20,10 14,10" fill="#FAA819"/>
              <polygon points="14,10 20,10 20,18" fill="#B84480"/>
              <polygon points="14,10 14,18 8,18" fill="#FAA819"/>
              <polygon points="14,18 20,18 14,26" fill="#B84480"/>
              <polygon points="8,10 14,10 8,18" fill="#B84480"/>
              <polygon points="14,18 8,18 14,26" fill="#FAA819"/>
            </svg>
            <span style={{fontSize:14,fontWeight:700}}>Nexis Audit</span>
            <span style={{fontSize:12,color:'var(--muted)'}}>by SynerGrowth</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="badge badge-gold"><Sparkles size={9}/> Groq AI</span>
            <span className="badge badge-muted">Phase 1</span>
          </div>
        </div>
        <div style={{flex:1,overflow:'auto',padding:24}}>
          <Dashboard engagements={engagements} onOpen={openEngagement} onAdd={addEngagement}/>
        </div>
        <Toasts toasts={toast.toasts}/>
      </div>
    );
  }

  // Engagement view
  return (
    <div style={{height:'100vh',display:'flex',flexDirection:'column'}}>
      <div style={{background:'var(--ink2)',borderBottom:'1px solid var(--border)',padding:'0 20px',height:46,display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0}}>
        <div style={{fontSize:13,color:'var(--muted)'}}>
          <span style={{color:'var(--text)',fontWeight:500}}>{activeEng?.client}</span>
          <span style={{margin:'0 8px'}}>·</span><span>{activeEng?.fyEnd}</span>
          {activeEng?.fileRef && <><span style={{margin:'0 8px'}}>·</span><span>{activeEng?.fileRef}</span></>}
        </div>
        <div className="flex items-center gap-2">
          <span className="badge badge-gold"><Sparkles size={9}/> Groq AI</span>
          <span className="badge badge-muted">Phase 1</span>
        </div>
      </div>
      <div style={{flex:1,display:'flex',overflow:'hidden'}}>
        <Sidebar
          active={activeModule}
          onSelect={setActiveModule}
          onBack={() => setView('dashboard')}
          engagement={activeEng}
          docCount={files.filter(f=>f.status==='ready').length}
          completedSections={activeEng?.completedSections||[]}
        />
        <div style={{flex:1,overflow:'auto',padding:20}}>
          {renderModule()}
        </div>
      </div>
      <Toasts toasts={toast.toasts}/>
    </div>
  );
}
