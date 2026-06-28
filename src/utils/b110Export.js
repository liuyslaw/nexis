// B110 PPE — Excel export with full movement schedule

export async function exportB110Excel(assets, engagementInfo, narrative, signoff = {}) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();

  const fmt = (n) => n != null ? Number(n) : '';
  const pct = (v) => v != null ? `${Math.round(v * 100)}%` : '';

  // ── Sheet 1: B110 Movement Schedule ─────────────────────────────────────────
  const rows = [];
  rows.push(['CLIENT:', engagementInfo.client || '', '', '', '', '', '', '', '', '']);
  rows.push(['PERIOD:', engagementInfo.fyEnd || '', '', '', '', '', '', '', '', '']);
  rows.push(['SUBJECT:', 'Property, Plant and Equipment — Movement Schedule (B110)', '', '', '', '', '', '', '', '']);
  rows.push(['PREPARED BY:', signoff.preparedBy||'', 'DATE:', signoff.preparedDate||'', '', 'REVIEWED BY:', signoff.reviewedBy||'', 'DATE:', signoff.reviewedDate||'']);
  rows.push(['PARTNER:', signoff.partner||'', 'DATE:', signoff.partnerDate||'', '', '', '', '', '']);
  rows.push([]);
  rows.push(['WORK STEPS:']);
  rows.push(['1', 'Agree opening balances to prior year audited financial statements.']);
  rows.push(['2', 'Verify additions — agree to invoices, delivery orders, and board approvals.']);
  rows.push(['3', 'Verify disposals — agree to sales proceeds, gain/loss on disposal.']);
  rows.push(['4', 'Recompute depreciation charge for the year.']);
  rows.push(['5', 'Perform physical verification of major assets.']);
  rows.push(['6', 'Agree closing NBV to lead schedule and trial balance.']);
  rows.push([]);

  // ── Main movement schedule ────────────────────────────────────────────────
  // Try to build consolidated class-level schedule
  const classMap = {};
  for (const a of assets) {
    if (a.asset_classes_summary?.length > 0) {
      for (const c of a.asset_classes_summary) {
        if (!classMap[c.class]) classMap[c.class] = { ...c };
        else {
          const m = classMap[c.class];
          ['cost_bf','additions','disposals','cost_cf','acc_dep_bf','dep_charge','acc_dep_cf','nbv_cf'].forEach(k => {
            if (c[k] != null) m[k] = (m[k] || 0) + c[k];
          });
        }
      }
    } else if (a.asset_class) {
      const key = a.asset_class;
      if (!classMap[key]) classMap[key] = {
        class: key,
        cost_bf: a.cost_bf, additions: a.additions, disposals: a.disposals,
        cost_cf: a.cost_cf, acc_dep_bf: a.acc_dep_bf, dep_charge: a.dep_charge,
        acc_dep_cf: a.acc_dep_cf, nbv_cf: a.nbv_cf
      };
    }
  }

  const classes = Object.values(classMap);

  if (classes.length > 0) {
    // COST section
    rows.push(['COST', '', 'Balance b/f (RM)', 'Additions (RM)', 'Disposals (RM)', 'Transfers (RM)', 'Balance c/f (RM)', '', '', '']);
    for (const c of classes) {
      rows.push([c.class||'', '', fmt(c.cost_bf), fmt(c.additions), fmt(c.disposals), '', fmt(c.cost_cf), '', '', '']);
    }
    const totCostBf  = classes.reduce((s,c) => s+(c.cost_bf||0),0);
    const totAdd     = classes.reduce((s,c) => s+(c.additions||0),0);
    const totDis     = classes.reduce((s,c) => s+(c.disposals||0),0);
    const totCostCf  = classes.reduce((s,c) => s+(c.cost_cf||0),0);
    rows.push(['TOTAL COST', '', totCostBf, totAdd, totDis, '', totCostCf, '', '', '']);
    rows.push([]);

    // ACCUMULATED DEPRECIATION section
    rows.push(['ACCUMULATED DEPRECIATION', '', 'Balance b/f (RM)', 'Charge for year (RM)', 'On Disposals (RM)', '', 'Balance c/f (RM)', '', '', '']);
    for (const c of classes) {
      rows.push([c.class||'', '', fmt(c.acc_dep_bf), fmt(c.dep_charge), '', '', fmt(c.acc_dep_cf), '', '', '']);
    }
    const totDepBf   = classes.reduce((s,c) => s+(c.acc_dep_bf||0),0);
    const totDepChg  = classes.reduce((s,c) => s+(c.dep_charge||0),0);
    const totDepCf   = classes.reduce((s,c) => s+(c.acc_dep_cf||0),0);
    rows.push(['TOTAL ACCUMULATED DEPRECIATION', '', totDepBf, totDepChg, '', '', totDepCf, '', '', '']);
    rows.push([]);

    // NET BOOK VALUE section
    rows.push(['NET BOOK VALUE', '', 'NBV b/f (RM)', '', '', '', 'NBV c/f (RM)', 'AI Confidence', 'Check', '']);
    for (const c of classes) {
      const nbvBf = (c.cost_bf||0) - (c.acc_dep_bf||0);
      const nbvCf = c.nbv_cf != null ? c.nbv_cf : (c.cost_cf||0) - (c.acc_dep_cf||0);
      const check = Math.abs(((c.cost_cf||0)-(c.acc_dep_cf||0)) - nbvCf) < 1 ? '✓' : '⚠ Check';
      rows.push([c.class||'', '', fmt(nbvBf), '', '', '', fmt(nbvCf), '', check, '']);
    }
    const totNbvCf = classes.reduce((s,c) => s+(c.nbv_cf||(c.cost_cf||0)-(c.acc_dep_cf||0)||0),0);
    rows.push(['TOTAL NET BOOK VALUE', '', totCostBf-totDepBf, '', '', '', totNbvCf, '', '', '']);
    rows.push([]);
  }

  // Individual asset/invoice entries
  const invoices = assets.filter(a => a.invoice_number || a.invoice_amount);
  if (invoices.length > 0) {
    rows.push(['ADDITIONS — INVOICE VERIFICATION']);
    rows.push(['Asset Class', 'Description', 'Invoice No.', 'Invoice Date', 'Supplier', 'Amount (RM)', 'Confidence', 'Source File']);
    for (const a of invoices) {
      rows.push([a.asset_class||'', a.asset_description||'', a.invoice_number||'', a.invoice_date||'', a.supplier||'', fmt(a.invoice_amount), pct(a.confidence?.cost_cf), a._source_file||'']);
    }
    rows.push([]);
  }

  // Review notes
  const allNotes = assets.flatMap((a,i) => [
    ...(a._assessment?.missing||[]).map(f => [`Asset ${i+1}`, 'MISSING', f, 'Obtain from source document']),
    ...(a.review_notes||[]).map(n => [`Asset ${i+1}`, 'AI NOTE', n, 'Auditor to review']),
    ...(a._assessment?.costCheck===false ? [[`Asset ${i+1}`,'CROSS-CHECK','Cost movement does not balance (b/f + additions - disposals ≠ c/f)','Investigate']] : []),
    ...(a._assessment?.depCheck===false  ? [[`Asset ${i+1}`,'CROSS-CHECK','Accumulated depreciation movement does not balance','Investigate']] : []),
    ...(a._assessment?.nbvCheck===false  ? [[`Asset ${i+1}`,'CROSS-CHECK','NBV ≠ Cost c/f − Acc dep c/f','Investigate']] : []),
  ]);
  if (allNotes.length > 0) {
    rows.push(['REVIEW NOTES']);
    rows.push(['Reference', 'Type', 'Issue', 'Action Required']);
    allNotes.forEach(r => rows.push(r));
    rows.push([]);
  }

  rows.push(['DEPRECIATION POLICY SUMMARY']);
  rows.push(['Asset Class', 'Method', 'Rate / Useful Life', 'Source']);
  const seen = new Set();
  for (const a of assets) {
    const key = a.asset_class;
    if (key && !seen.has(key)) {
      seen.add(key);
      rows.push([key, a.dep_method||'Straight-line', a.dep_rate||a.useful_life||'—', a._source_file||'']);
    }
  }
  rows.push([]);
  rows.push(['* AI-extracted working paper draft. Auditor review required before use.']);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{wch:35},{wch:8},{wch:18},{wch:18},{wch:18},{wch:18},{wch:18},{wch:14},{wch:12},{wch:10}];
  XLSX.utils.book_append_sheet(wb, ws, 'B110');

  // ── Sheet 2: Narrative ───────────────────────────────────────────────────────
  if (narrative) {
    const nRows = [['B110 — AI WORKING PAPER NARRATIVE'],['Generated:', new Date().toLocaleString('en-MY')],[],[narrative],[],['* AI-generated. Auditor must review and amend.']];
    const wsN = XLSX.utils.aoa_to_sheet(nRows);
    wsN['!cols'] = [{wch:120}];
    XLSX.utils.book_append_sheet(wb, wsN, 'Narrative');
  }

  // ── Sheet 3: _Provenance ─────────────────────────────────────────────────────
  const provRows = [['Asset/Doc','Field','Value','Confidence','Source File','Model','Extracted At','Raw Snippet']];
  const provFields = ['asset_class','cost_bf','additions','disposals','cost_cf','acc_dep_bf','dep_charge','acc_dep_cf','nbv_cf','dep_rate'];
  for (const a of assets) {
    const label = `${a.asset_class||'Unknown'} — ${a._source_file||''}`;
    provFields.forEach(field => {
      provRows.push([label,field,a[field]??'',a.confidence?.[field]??'',a._source_file||'',a._extraction_model||'',a._extracted_at||'',a.source_snippets?.[field]||'']);
    });
  }
  const wsProv = XLSX.utils.aoa_to_sheet(provRows);
  wsProv['!cols'] = [{wch:35},{wch:20},{wch:18},{wch:10},{wch:35},{wch:28},{wch:22},{wch:80}];
  XLSX.utils.book_append_sheet(wb, wsProv, '_Provenance');

  const slug = (engagementInfo.client||'client').replace(/[^a-zA-Z0-9]/g,'_');
  const filename = `B110_${slug}_${(engagementInfo.fyEnd||'').replace(/\//g,'-')}.xlsx`;
  XLSX.writeFile(wb, filename);
  return filename;
}
