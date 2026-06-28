// A420 Excel export — matches real Nexia SSY template exactly
//
// Column map (0-indexed):
//   A=0  Bank/creditor name + type marker row
//   B=1  (empty/merged)
//   C=2  AWP — left blank (auditor fills)
//   D=3  Type of facilities
//   E=4  Limit (RM)
//   F=5  Utilised (RM)
//   G=6  Unutilised (RM) — formula E-F written as value
//   H=7  (empty)
//   I=8  Interest Rate
//   J=9  Repayment Terms (multi-row)
//   K=10 (empty)
//   L=11 Security (multi-row)
//   M-P  (empty/merged)
//   Q=16 Loan Covenants (multi-row)
//   R=17 (empty — merged with Q in template)
//   S=18 Purposes (multi-row)
//   T=19 (empty)
//   U=20 Cross-ref to PAF — RED FILL, always blank
//   V=21 Facility agreement date
//
// Row pattern per facility:
//   Row 0: bank_name(A), facility_type(D), limit(E), utilised(F), unutilised(G),
//           rate(I), repayment_line_1(J), security_line_1(L), covenant_line_1(Q),
//           purpose_line_1(S), date(V)
//   Row 1: "L" or "HP" marker (A), repayment_line_2(J), security_line_2(L), etc.
//   Rows 2+: continuation lines for repayment/security/covenants/purpose

export async function exportA420Excel(facilities, engagementInfo, narrative, signoff = {}) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const N_COLS = 22; // A through V (indices 0–21)

  // Build an empty row of N_COLS cells
  function emptyRow() {
    return Array(N_COLS).fill('');
  }

  // Split a string into lines of max ~80 chars, respecting existing newlines
  function splitLines(text, maxLen = 80) {
    if (!text) return [];
    const rawLines = String(text).split(/\n/);
    const result = [];
    for (const line of rawLines) {
      if (line.length <= maxLen) {
        result.push(line.trim());
      } else {
        // Word-wrap long lines
        const words = line.split(' ');
        let current = '';
        for (const word of words) {
          if (current.length + word.length + 1 > maxLen && current) {
            result.push(current.trim());
            current = word;
          } else {
            current = current ? current + ' ' + word : word;
          }
        }
        if (current) result.push(current.trim());
      }
    }
    return result.filter(l => l.length > 0);
  }

  // Format HP interest rate — if it looks like a decimal (0.045), convert to percentage string
  function formatRate(rate, category) {
    if (!rate) return '';
    if (category === 'HP') {
      // If already a text percentage string, return as-is
      if (typeof rate === 'string' && (rate.includes('%') || rate.toLowerCase().includes('flat') || rate.toLowerCase().includes('p.a'))) {
        return rate;
      }
      // If it's a number or numeric string that looks like a decimal
      const num = parseFloat(rate);
      if (!isNaN(num) && num < 1) {
        return `${(num * 100).toFixed(2)}% p.a.`;
      }
      return rate;
    }
    return rate || '';
  }

  // Format number for RM columns — number or empty string
  function fmtNum(v) {
    if (v == null || v === '') return '';
    const n = parseFloat(v);
    return isNaN(n) ? '' : n;
  }

  const rows = [];

  // ── Header block (rows 4–25 equivalent) ──────────────────────────────────
  // Row 0: CLIENT
  let r = emptyRow();
  r[0] = 'Client:'; r[1] = engagementInfo.client || '';
  rows.push(r);

  // Row 1: PERIOD
  r = emptyRow();
  r[0] = 'Period:'; r[1] = engagementInfo.fyEnd || '';
  rows.push(r);

  // Row 2: SUBJECT
  r = emptyRow();
  r[0] = 'Subject:'; r[1] = 'Summary of loan facilities and covenants';
  rows.push(r);

  // Row 3: blank
  rows.push(emptyRow());

  // Row 4: Work steps header
  r = emptyRow(); r[0] = 'Work steps:'; rows.push(r);

  const workSteps = [
    [1, 'Obtain summary of loan facilities from the management and compare to information with prior year for new facilities agreement obtained during the period.'],
    [2, 'Update PAF with relevant information for new loans and finance lease agreements.'],
    [3, 'Check whether any receivables, inventories, property, plant and equipment and/or other assets are pledged as collateral or liens. Cross check to register of charge <G-series>'],
    [4, 'Ascertain details of any loan covenants included in the facility agreements. Test compliance of loan covenant by:\n - agreeing covenant details to loan agreements\n - test calculations that demonstrate compliance e.g. debt equity ratio, profit ratio, interest coverage ratio etc.\n - discuss with management what remedial action taken to deal with any non compliance'],
    [5, 'For any incident of default, if any:\n - enquire management if there is any waiver obtained before the reporting date from the banks for any non-compliance which could accelerate debt repayment.'],
  ];

  for (const [num, text] of workSteps) {
    r = emptyRow(); r[0] = num; r[1] = text; rows.push(r);
    rows.push(emptyRow());
  }

  // ── Column header rows ───────────────────────────────────────────────────
  // Header row 1 (top labels)
  r = emptyRow();
  r[3]  = 'Type of ';
  r[5]  = 'Amount ';
  r[6]  = 'Amount ';
  r[8]  = 'Interest';
  r[16] = 'Loan covenants';
  r[20] = 'Cross-ref';
  r[21] = 'Facility agreement ';
  rows.push(r);

  // Header row 2 (field names)
  r = emptyRow();
  r[0]  = 'Bank';
  r[2]  = 'AWP';
  r[3]  = 'facilities';
  r[4]  = 'Limit';
  r[5]  = 'Utilised';
  r[6]  = 'Unutilised';
  r[8]  = 'Rate';
  r[9]  = 'Repayment Terms';
  r[11] = 'Security';
  r[18] = 'Purposes';
  r[20] = 'to PAF';
  r[21] = 'date';
  rows.push(r);

  // Header row 3 (RM sub-labels)
  r = emptyRow();
  r[4] = 'RM'; r[5] = 'RM'; r[6] = 'RM';
  rows.push(r);

  // Track the row index where data starts (for subtotal formula range tracking)
  const dataStartRow = rows.length; // 0-indexed within rows array

  // ── Separate facilities by category ─────────────────────────────────────
  const lFacilities  = facilities.filter(f => f.facility_category === 'L');
  const hpFacilities = facilities.filter(f => f.facility_category === 'HP');

  // Track row indices for subtotal SUM ranges
  const lRowIndices  = [];  // row indices of first row for each L facility
  const hpRowIndices = []; // row indices of first row for each HP facility

  // ── Helper: write one facility block ────────────────────────────────────
  function writeFacility(facility, isNumbered, facilityNumber) {
    const cat    = facility.facility_category || 'L';
    const rate   = formatRate(facility.interest_profit_rate, cat);
    const limit  = fmtNum(facility.facility_limit_rm);
    const util   = fmtNum(facility.amount_utilised_rm);
    const unutilised = (limit !== '' && util !== '') ? limit - util : '';

    // Split multi-line fields
    const repayLines    = splitLines(facility.repayment_terms, 70);
    const secLines      = splitLines(cat === 'HP' ? 'N/A' : (facility.security || ''), 70);
    const covenantLines = splitLines(facility.covenants || 'N/A', 70);
    const purposeLines  = splitLines(facility.purpose || '', 70);

    // How many continuation rows do we need after the first?
    const maxLines = Math.max(
      repayLines.length,
      secLines.length,
      covenantLines.length,
      purposeLines.length,
      2  // minimum: first row + marker row
    );

    // Bank name: numbered or not
    const bankLabel = isNumbered
      ? `${facilityNumber}) ${facility.bank_name || 'Unknown'}`
      : (facility.bank_name || 'Unknown');

    // First row: all main fields
    const firstRow = emptyRow();
    firstRow[0]  = bankLabel;
    firstRow[2]  = '';               // AWP — always blank, auditor fills
    firstRow[3]  = facility.facility_type || '';
    firstRow[4]  = limit;
    firstRow[5]  = util;
    firstRow[6]  = unutilised;
    firstRow[8]  = rate;
    firstRow[9]  = repayLines[0] || '';
    firstRow[11] = secLines[0] || '';
    firstRow[16] = covenantLines[0] || '';
    firstRow[18] = purposeLines[0] || '';
    firstRow[20] = '';               // Cross-ref to PAF — red fill, blank
    firstRow[21] = facility.facility_agreement_date || '';
    rows.push(firstRow);

    // Second row: category marker (L / HP) in col A, continuation line 1
    const markerRow = emptyRow();
    markerRow[0]  = cat;  // 'L' or 'HP'
    markerRow[9]  = repayLines[1] || '';
    markerRow[11] = secLines[1] || '';
    markerRow[16] = covenantLines[1] || '';
    markerRow[18] = purposeLines[1] || '';
    rows.push(markerRow);

    // Continuation rows for lines 3+
    for (let i = 2; i < maxLines; i++) {
      const contRow = emptyRow();
      contRow[9]  = repayLines[i] || '';
      contRow[11] = secLines[i] || '';
      contRow[16] = covenantLines[i] || '';
      contRow[18] = purposeLines[i] || '';
      rows.push(contRow);
    }

    // Blank separator between facilities
    rows.push(emptyRow());
  }

  // ── Write L facilities ───────────────────────────────────────────────────
  let facilityNum = 1;
  for (const f of lFacilities) {
    lRowIndices.push(rows.length);
    writeFacility(f, true, facilityNum++);
  }

  // BA+TL subtotal row
  const lSubtotalRow = emptyRow();
  lSubtotalRow[4] = 'BA + TL';
  lSubtotalRow[5] = lFacilities.reduce((s, f) => s + (parseFloat(f.amount_utilised_rm) || 0), 0) || '';
  rows.push(lSubtotalRow);
  const lSubtotalRowIdx = rows.length - 1;

  rows.push(emptyRow());

  // ── Write HP facilities ──────────────────────────────────────────────────
  facilityNum = 1;
  for (const f of hpFacilities) {
    hpRowIndices.push(rows.length);
    writeFacility(f, true, facilityNum++);
  }

  // HP subtotal row
  const hpSubtotalRow = emptyRow();
  hpSubtotalRow[5] = hpFacilities.reduce((s, f) => s + (parseFloat(f.amount_utilised_rm) || 0), 0) || '';
  rows.push(hpSubtotalRow);
  const hpSubtotalRowIdx = rows.length - 1;

  rows.push(emptyRow());

  // TOTAL row
  const totalRow = emptyRow();
  totalRow[4] = 'TOTAL';
  const lUtil  = lFacilities.reduce((s, f)  => s + (parseFloat(f.amount_utilised_rm) || 0), 0);
  const hpUtil = hpFacilities.reduce((s, f) => s + (parseFloat(f.amount_utilised_rm) || 0), 0);
  totalRow[5] = (lUtil + hpUtil) || '';
  totalRow[6] = 'A400';
  rows.push(totalRow);

  rows.push(emptyRow());

  // ── Work done legend ─────────────────────────────────────────────────────
  let wr = emptyRow(); wr[0] = 'Work done:'; rows.push(wr);
  wr = emptyRow(); wr[0] = 'L'; wr[1] = 'Extracted from bank facilities letter/agreement'; rows.push(wr);
  wr = emptyRow(); wr[0] = 'Ø'; wr[1] = 'Casting checked'; rows.push(wr);
  wr = emptyRow(); wr[0] = 'HP'; wr[1] = 'Extracted from Hire purchase facilities letter/agreement'; rows.push(wr);

  rows.push(emptyRow());

  // ── Sign-off block ───────────────────────────────────────────────────────
  wr = emptyRow(); wr[0] = 'Prepared by:'; wr[1] = signoff.preparedBy || engagementInfo.preparedBy || ''; wr[3] = 'Date:'; wr[4] = signoff.preparedDate || ''; rows.push(wr);
  wr = emptyRow(); wr[0] = 'Reviewed by:'; wr[1] = signoff.reviewedBy || engagementInfo.reviewedBy || ''; wr[3] = 'Date:'; wr[4] = signoff.reviewedDate || ''; rows.push(wr);
  wr = emptyRow(); wr[0] = 'Partner:';     wr[1] = signoff.partner    || engagementInfo.partner    || ''; wr[3] = 'Date:'; wr[4] = signoff.partnerDate  || ''; rows.push(wr);

  rows.push(emptyRow());
  wr = emptyRow(); wr[0] = '* AI-extracted working paper draft. Auditor review required before use.'; rows.push(wr);

  // ── Build worksheet ──────────────────────────────────────────────────────
  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Red fill for entire column U (index 20) header and data rows
  // Apply red fill to column U cells in the data range
  const redFill = {
    patternType: 'solid',
    fgColor: { rgb: 'FFFF0000' },
    bgColor: { rgb: 'FFFF0000' }
  };

  // Mark every cell in column U with red fill using the sheet's cell objects
  for (let i = 0; i < rows.length; i++) {
    const cellRef = XLSX.utils.encode_cell({ r: i, c: 20 });
    if (!ws[cellRef]) ws[cellRef] = { t: 's', v: '' };
    ws[cellRef].s = { fill: redFill };
  }

  // Column widths matching template
  ws['!cols'] = [
    { wch: 35 },  // A — Bank name
    { wch: 6  },  // B — empty
    { wch: 10 },  // C — AWP
    { wch: 30 },  // D — Facility type
    { wch: 15 },  // E — Limit
    { wch: 15 },  // F — Utilised
    { wch: 15 },  // G — Unutilised
    { wch: 4  },  // H — empty
    { wch: 28 },  // I — Interest Rate
    { wch: 45 },  // J — Repayment Terms
    { wch: 4  },  // K — empty
    { wch: 55 },  // L — Security
    { wch: 4  },  // M
    { wch: 4  },  // N
    { wch: 4  },  // O
    { wch: 4  },  // P
    { wch: 50 },  // Q — Covenants
    { wch: 4  },  // R
    { wch: 45 },  // S — Purpose
    { wch: 4  },  // T
    { wch: 12 },  // U — Cross-ref PAF (red)
    { wch: 18 },  // V — Agreement date
  ];

  // Row heights — allow tall rows for multi-line cells
  ws['!rows'] = rows.map(() => ({ hpt: 15 }));

  XLSX.utils.book_append_sheet(wb, ws, 'A420');

  // ── Sheet 2: Narrative ────────────────────────────────────────────────────
  if (narrative) {
    const nRows = [
      ['A420 — AI WORKING PAPER NARRATIVE'],
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

  // ── Sheet 3: _Provenance ──────────────────────────────────────────────────
  const provRows = [['Facility', 'Category', 'Field', 'Value', 'Confidence', 'Source File', 'Model', 'Extracted At', 'Raw Snippet']];
  const provFields = ['bank_name', 'facility_type', 'facility_limit_rm', 'amount_utilised_rm', 'interest_profit_rate', 'repayment_terms', 'security', 'covenants', 'facility_agreement_date', 'purpose'];

  for (const f of facilities) {
    const label = `${f.bank_name || 'Unknown'} — ${f.facility_type || ''}`;
    for (const field of provFields) {
      provRows.push([
        label,
        f.facility_category || '',
        field,
        f[field] !== null && f[field] !== undefined ? String(f[field]) : '',
        f.confidence?.[field] ?? '',
        f._source_file || '',
        f._extraction_model || '',
        f._extracted_at || '',
        f.source_snippets?.[field] || ''
      ]);
    }
  }
  const wsProv = XLSX.utils.aoa_to_sheet(provRows);
  wsProv['!cols'] = [{ wch: 35 }, { wch: 8 }, { wch: 22 }, { wch: 50 }, { wch: 10 }, { wch: 40 }, { wch: 30 }, { wch: 22 }, { wch: 80 }];
  XLSX.utils.book_append_sheet(wb, wsProv, '_Provenance');

  // ── Sheet 4: Review Notes ────────────────────────────────────────────────
  const reviewRows = [['Facility', 'Category', 'Issue Type', 'Description', 'Action Required']];

  for (const f of facilities) {
    const label = `${f.bank_name || 'Unknown'} — ${f.facility_type || ''}`;
    const assessment = f._assessment;

    if (assessment?.missing?.length > 0) {
      for (const field of assessment.missing) {
        if (field === 'amount_utilised_rm') continue; // expected null from offer letters
        reviewRows.push([label, f.facility_category || '', 'MISSING FIELD', `Field "${field}" not found in source document`, 'Obtain from management or source document']);
      }
    }
    if (assessment?.lowConfidence?.length > 0) {
      for (const field of assessment.lowConfidence) {
        reviewRows.push([label, f.facility_category || '', 'LOW CONFIDENCE', `Field "${field}" confidence below 85% — verify against source`, 'Cross-check with original document']);
      }
    }
    for (const note of (f.review_notes || [])) {
      reviewRows.push([label, f.facility_category || '', 'AI NOTE', note, 'Auditor to review']);
    }
    // Flag missing utilised separately with clearer action
    if (f.amount_utilised_rm == null) {
      reviewRows.push([label, f.facility_category || '', 'OUTSTANDING', 'Utilised amount not extracted — offer letters / HP agreements do not contain FY-end outstanding balance', 'Obtain from bank confirmation letter or loan account statement as at ' + (engagementInfo.fyEnd || 'FY end')]);
    }
  }

  if (reviewRows.length === 1) {
    reviewRows.push(['—', '—', '—', 'No review notes — all extractions high confidence', '—']);
  }

  const wsReview = XLSX.utils.aoa_to_sheet(reviewRows);
  wsReview['!cols'] = [{ wch: 40 }, { wch: 8 }, { wch: 18 }, { wch: 80 }, { wch: 55 }];
  XLSX.utils.book_append_sheet(wb, wsReview, 'Review Notes');

  // ── Write and download ────────────────────────────────────────────────────
  const clientSlug = (engagementInfo.client || 'client').replace(/[^a-zA-Z0-9]/g, '_');
  const period = (engagementInfo.fyEnd || '').replace(/\//g, '-');
  const filename = `A420_${clientSlug}_${period}.xlsx`;

  XLSX.writeFile(wb, filename);
  return filename;
}
