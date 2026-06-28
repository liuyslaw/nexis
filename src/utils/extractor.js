// PDF text extraction: pdf.js for text layer, Tesseract.js fallback for scans

let pdfjsLib = null;

async function getPdfJs() {
  if (!pdfjsLib) {
    pdfjsLib = await import('pdfjs-dist');
    // Use local bundled worker — avoids CDN dependency that breaks on mobile
    const workerUrl = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url
    ).href;
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
  }
  return pdfjsLib;
}

// Extract text from a PDF file. Returns array of { page, text, method, confidence }
export async function extractPdfText(file, onProgress) {
  const pdfjs = await getPdfJs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  const numPages = pdf.numPages;
  const pages = [];

  for (let i = 1; i <= numPages; i++) {
    onProgress && onProgress({ page: i, total: numPages, stage: 'extracting' });
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const text = textContent.items.map(item => item.str).join(' ').trim();

    if (text.length > 50) {
      // Text layer present — use directly
      pages.push({ page: i, text, method: 'text-layer', confidence: 1.0 });
    } else {
      // Scanned page — render to canvas and OCR
      onProgress && onProgress({ page: i, total: numPages, stage: 'ocr' });
      const ocrResult = await ocrPage(page);
      pages.push({ page: i, text: ocrResult.text, method: 'tesseract', confidence: ocrResult.confidence / 100 });
    }
  }

  return pages;
}

async function ocrPage(page) {
  const Tesseract = await import('tesseract.js');
  const viewport = page.getViewport({ scale: 2.0 });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d');

  await page.render({ canvasContext: ctx, viewport }).promise;

  // Enhance contrast for scanned docs
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  enhanceContrast(imageData);
  ctx.putImageData(imageData, 0, 0);

  const result = await Tesseract.recognize(canvas, 'eng', { logger: () => {} });
  return { text: result.data.text, confidence: result.data.confidence };
}

function enhanceContrast(imageData) {
  const data = imageData.data;
  const factor = 1.4;
  for (let i = 0; i < data.length; i += 4) {
    data[i]     = Math.min(255, Math.max(0, factor * (data[i]     - 128) + 128));
    data[i + 1] = Math.min(255, Math.max(0, factor * (data[i + 1] - 128) + 128));
    data[i + 2] = Math.min(255, Math.max(0, factor * (data[i + 2] - 128) + 128));
  }
}

export async function extractImageText(file, onProgress) {
  const Tesseract = await import('tesseract.js');
  onProgress && onProgress({ stage: 'ocr', page: 1, total: 1 });
  const result = await Tesseract.recognize(file, 'eng', {
    logger: m => { if (m.status === 'recognizing text') onProgress && onProgress({ stage: 'ocr', progress: m.progress }); }
  });
  return [{ page: 1, text: result.data.text, method: 'tesseract', confidence: result.data.confidence / 100 }];
}

export async function extractExcelText(file) {
  const XLSX = await import('xlsx');
  const arrayBuffer = await file.arrayBuffer();
  const wb = XLSX.read(arrayBuffer, { type: 'array' });
  const sheets = wb.SheetNames.map(name => {
    const ws = wb.Sheets[name];
    return `[Sheet: ${name}]\n${XLSX.utils.sheet_to_csv(ws)}`;
  });
  return [{ page: 1, text: sheets.join('\n\n'), method: 'excel-parse', confidence: 1.0 }];
}

export async function extractFileText(file, onProgress) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'pdf') return extractPdfText(file, onProgress);
  if (['xlsx', 'xls', 'xlsm'].includes(ext)) return extractExcelText(file);
  if (['jpg', 'jpeg', 'png', 'tiff', 'bmp'].includes(ext)) return extractImageText(file, onProgress);
  throw new Error(`Unsupported file type: .${ext}`);
}
