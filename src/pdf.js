// PDF statements: extract text lines in the browser with pdf.js. Loaded only when a PDF is chosen.
import * as pdfjs from 'pdfjs-dist';
import { linesFromTextContent } from './pdftext.js';

pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

export async function pdfToLines(buffer) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false }).promise;
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    lines.push(...linesFromTextContent(await page.getTextContent()));
  }
  await (doc.destroy?.() ?? doc.cleanup?.());
  return lines;
}
