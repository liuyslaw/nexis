// E100 Bank Reconciliation — Excel export

export async function exportE100Excel(accounts, engagementInfo, narrative, signoff = {}) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();

  // ── Sheet 1: E100 Main Working Paper ────────────────────────────────────────
  const rows = [];
  rows.push(['CLIENT:',      engagementInfo.client || '', '', '', '', '']);
  rows.push(['PERIOD:',      engagementInfo.fyEnd  || '', '', '', '', '']);
  rows.push(['SUBJECT:',     'Bank Reconciliation (E100)', '', '', '', '']);
  rows.push(['PREPARED BY:', signoff.preparedBy || '', 'DATE:', signoff.preparedDate || '', '', '']);
  rows.push(['REVIEWED BY:', signoff.reviewedBy || '', 'DATE:', signoff.reviewedDate || '', '', '']);
  rows.push(['PARTNER:',     signoff.partner    || '', 'DATE:', signoff.partnerDate  || '', '', '']);
  rows.push([]);
  rows.push(['WORK STEPS:']);
  rows.push(['1', 'Obtain bank statements for all accounts as at period end date.']);
  rows.push(['2', 'Agree closing balance per bank statement to bank confirmation letter.']);
  rows.push(['3', 'Obtain client-prepared bank reconciliation and agree to bank statements and TB.']);
  rows.push(['4', 'Test outstanding cheques — confirm cleared or still outstanding post year-end.']);
  rows.push(['5', 'Test deposits in transit — confirm received by bank post year-end.']);
  rows.push(['6', 'Investigate and clear all unreconciled differences.']);
  rows.push([]);

  // Per-account reconciliation tables
  accounts.forEach((a, i) => {
    const ass = a._assessment || {};
    rows.push([`ACCOUNT ${i + 1}: ${a.bank_name || 'Unknown Bank'} — ${a.account_name || ''}`]);
    rows.push(['Account No.:', a.account_number || '', 'Account Type:', a.account_type || '', 'Currency:', a.currency || 'MYR']);
    rows.push(['Statement Date:', a.statement_date || '', '', '', '', '']);
    rows.push([]);

    // Reconciliation
    rows.push(['BANK RECONCILIATION', '', '', '', 'RM', 'AI Confidence']);
    rows.push(['Balance per Bank Statement', '', '', '', a.balance_per_bank_statement ?? '', pct(a.confidence?.balance_per_bank_statement)]);
    rows.push(['Less: Outstanding Cheques', '', '', '', a.outstanding_cheques ? -(a.outstanding_cheques) : '', pct(a.confidence?.outstanding_cheques)]);
    if (a.outstanding_cheques_details) rows.push(['', `Details: ${a.outstanding_cheques_details}`, '', '', '', '']);
    rows.push(['Add: Deposits in Transit', '', '', '', a.deposits_in_transit ?? '', pct(a.confidence?.deposits_in_transit)]);
    if (a.deposits_in_transit_details) rows.push(['', `Details: ${a.deposits_in_transit_details}`, '', '', '', '']);
    rows.push(['Add/(Less): Other Items', '', '', '', a.other_reconciling_items ?? '', '']);
    if (a.other_reconciling_items_details) rows.push(['', `Details: ${a.other_reconciling_items_details}`, '', '', '', '']);
    rows.push(['Adjusted Bank Balance', '', '', '', ass.adjustedBankBalance ?? '', '']);
    rows.push([]);
    rows.push(['Balance per Book (TB)', '', '', '', a.balance_per_book ?? '', pct(a.confidence?.balance_per_book)]);
    rows.push(['Unreconciled Difference', '', '', '', ass.difference ?? '', '']);
    rows.push(['Reconciliation Status', '', '', '', ass.isReconciled ? '✓ RECONCILED' : '⚠ DIFFERENCE — INVESTIGATE', '']);
    rows.push([]);

    // Review notes
    if (a._assessment?.missing?.length > 0 || a.review_notes?.length > 0) {
      rows.push(['REVIEW NOTES:']);
      (a._assessment?.missing || []).forEach(f => rows.push(['', `Missing: ${f}`]));
      (a.review_notes || []).forEach(n => rows.push(['', n]));
    }
    rows.push([]);
    rows.push(['Source:', a._source_file || '', 'Extracted:', a._extracted_at ? new Date(a._extracted_at).toLocaleString('en-MY') : '']);
    rows.push([]);
    rows.push(['─'.repeat(80)]);
    rows.push([]);
  });

  // Summary
  rows.push(['SUMMARY — ALL ACCOUNTS']);
  rows.push(['Bank', 'Account No.', 'Balance per Bank (RM)', 'Balance per Book (RM)', 'Difference (RM)', 'Status']);
  accounts.forEach(a => {
    const ass = a._assessment || {};
    rows.push([
      a.bank_name || '', a.account_number || '',
      a.balance_per_bank_statement ?? '', a.balance_per_book ?? '',
      ass.difference ?? '', ass.isReconciled ? '✓ Reconciled' : '⚠ Difference'
    ]);
  });
  rows.push([]);
  rows.push(['* AI-extracted working paper draft. Auditor review required before use in audit files.']);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 35 }, { wch: 40 }, { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 15 }];
  XLSX.utils.book_append_sheet(wb, ws, 'E100');

  // ── Sheet 2: Narrative ───────────────────────────────────────────────────────
  if (narrative) {
    const nRows = [
      ['E100 — AI WORKING PAPER NARRATIVE'],
      ['Generated:', new Date().toLocaleString('en-MY')],
      [],
      [narrative],
      [],
      ['* AI-generated. Auditor must review and amend as appropriate.']
    ];
    const wsN = XLSX.utils.aoa_to_sheet(nRows);
    wsN['!cols'] = [{ wch: 120 }];
    XLSX.utils.book_append_sheet(wb, wsN, 'Narrative');
  }

  // ── Sheet 3: _Provenance ─────────────────────────────────────────────────────
  const provRows = [['Account', 'Field', 'Value', 'Confidence', 'Source File', 'Model', 'Extracted At', 'Raw Snippet']];
  const provFields = ['bank_name', 'account_number', 'statement_date', 'balance_per_bank_statement', 'outstanding_cheques', 'deposits_in_transit', 'balance_per_book'];
  accounts.forEach(a => {
    const label = `${a.bank_name || 'Unknown'} ${a.account_number || ''}`;
    provFields.forEach(field => {
      provRows.push([label, field, a[field] ?? '', a.confidence?.[field] ?? '', a._source_file || '', a._extraction_model || '', a._extracted_at || '', a.source_snippets?.[field] || '']);
    });
  });
  const wsProv = XLSX.utils.aoa_to_sheet(provRows);
  wsProv['!cols'] = [{ wch: 30 }, { wch: 28 }, { wch: 20 }, { wch: 10 }, { wch: 40 }, { wch: 28 }, { wch: 22 }, { wch: 80 }];
  XLSX.utils.book_append_sheet(wb, wsProv, '_Provenance');

  // ── Write ────────────────────────────────────────────────────────────────────
  const slug = (engagementInfo.client || 'client').replace(/[^a-zA-Z0-9]/g, '_');
  const filename = `E100_${slug}_${(engagementInfo.fyEnd || '').replace(/\//g, '-')}.xlsx`;
  XLSX.writeFile(wb, filename);
  return filename;
}

function pct(val) {
  return val != null ? `${Math.round(val * 100)}%` : '';
}
