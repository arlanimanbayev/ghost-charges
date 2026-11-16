// Statement parsing: CSV exports and text lines (from PDF or paste) -> transactions.
// Pure functions, no DOM, so they are unit-tested in Node.
//
// A transaction is { date: 'YYYY-MM-DD', description: string, amount: number }
// where amount < 0 is money going out (a charge) and amount > 0 is money coming in.

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

/** Split one CSV line, honouring quotes ("a, b" stays one field; "" is an escaped quote). */
export function splitCsvLine(line, sep = ',') {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === sep) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** "$1,234.56", "(12.00)", "-4.99", "12.00 CR", "1.234,56" -> number, or null. */
export function parseAmount(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/\bCR\b$/i.test(s)) { s = s.replace(/\bCR\b$/i, '').trim(); }
  else if (/\bDR\b$/i.test(s)) { neg = true; s = s.replace(/\bDR\b$/i, '').trim(); }
  if (s.endsWith('-')) { neg = true; s = s.slice(0, -1); }
  if (s.startsWith('-')) { neg = !neg; s = s.slice(1); }
  if (s.startsWith('+')) s = s.slice(1);
  s = s.replace(/[$€£\s]/g, '');
  if (/^\d{1,3}(\.\d{3})+,\d{2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.'); // 1.234,56
  else s = s.replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return neg ? -n : n;
}

const pad = (n) => String(n).padStart(2, '0');

/** Many date styles -> 'YYYY-MM-DD'. `fallbackYear` fills in dates like "10/03" or "Oct 3". */
export function parseDate(raw, fallbackYear) {
  if (raw == null) return null;
  const s = String(raw).trim();
  let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/))) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return `${y}-${pad(m[1])}-${pad(m[2])}`;
  }
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})$/)) && fallbackYear) return `${fallbackYear}-${pad(m[1])}-${pad(m[2])}`;
  if ((m = s.match(/^([A-Za-z]{3,4})\.?\s+(\d{1,2}),?\s*(\d{4})?$/))) {
    const mo = MONTHS[m[1].toLowerCase()];
    const y = m[3] ? Number(m[3]) : fallbackYear;
    if (mo && y) return `${y}-${pad(mo)}-${pad(m[2])}`;
  }
  if ((m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,4})\.?,?\s*(\d{4})?$/))) {
    const mo = MONTHS[m[2].toLowerCase()];
    const y = m[3] ? Number(m[3]) : fallbackYear;
    if (mo && y) return `${y}-${pad(mo)}-${pad(m[1])}`;
  }
  return null;
}

const HEADER = {
  date: /^(transaction\s*date|trans\.?\s*date|date|posted\s*date|posting\s*date|post\s*date)$/i,
  description: /^(description|payee|merchant|name|details|transaction|memo|narrative|transaction\s*description)$/i,
  amount: /^(amount|transaction\s*amount|amount\s*\(usd\)|value)$/i,
  debit: /^(debit|withdrawal|withdrawals|money\s*out|paid\s*out|charges?)$/i,
  credit: /^(credit|deposit|deposits|money\s*in|paid\s*in|payments?)$/i,
};

function findCol(headers, re, prefer = []) {
  for (const p of prefer) { const i = headers.findIndex((h) => p.test(h)); if (i >= 0) return i; }
  return headers.findIndex((h) => re.test(h));
}

/**
 * Parse a CSV bank or card export. Finds the date, description and amount columns from the header,
 * including exports with separate debit and credit columns.
 * Returns { transactions, signFlipped, skipped }.
 */
export function parseCsv(text) {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { transactions: [], signFlipped: false, skipped: 0 };
  const sep = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ';' : ',';
  // The header is the first line that names a date column (some banks put a title above it).
  let h = lines.findIndex((l) => splitCsvLine(l, sep).some((c) => HEADER.date.test(c)));
  if (h < 0) throw new Error('Could not find a header row with a date column.');
  const headers = splitCsvLine(lines[h], sep);
  const iDate = findCol(headers, HEADER.date, [/^transaction\s*date$/i, /^date$/i]);
  const iDesc = findCol(headers, HEADER.description, [/^description$/i, /^payee$/i, /^merchant$/i, /^name$/i]);
  const iAmt = findCol(headers, HEADER.amount);
  const iDebit = findCol(headers, HEADER.debit);
  const iCredit = findCol(headers, HEADER.credit);
  if (iDesc < 0 || (iAmt < 0 && iDebit < 0 && iCredit < 0)) {
    throw new Error('Could not find description and amount columns.');
  }
  const rows = [];
  let skipped = 0;
  for (const line of lines.slice(h + 1)) {
    const c = splitCsvLine(line, sep);
    const date = parseDate(c[iDate]);
    let amount;
    if (iAmt >= 0) amount = parseAmount(c[iAmt]);
    else {
      const d = parseAmount(c[iDebit]);
      const cr = parseAmount(c[iCredit]);
      amount = (cr ? Math.abs(cr) : 0) - (d ? Math.abs(d) : 0);
      if (!d && !cr) amount = null;
    }
    const description = (c[iDesc] || '').replace(/\s+/g, ' ').trim();
    if (!date || amount == null || !description) { skipped++; continue; }
    rows.push({ date, description, amount });
  }
  // Card exports often show purchases as positive numbers. If most rows are positive and only
  // separate debit/credit columns were not used, flip so that charges are negative.
  let signFlipped = false;
  if (iAmt >= 0 && rows.length) {
    const positives = rows.filter((r) => r.amount > 0).length;
    if (positives / rows.length >= 0.7) {
      signFlipped = true;
      for (const r of rows) r.amount = -r.amount;
    }
  }
  return { transactions: sortTx(rows), signFlipped, skipped };
}

const LINE_DATE = /^(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\d{4}-\d{2}-\d{2}|[A-Za-z]{3}\.?\s+\d{1,2}(?:,?\s*\d{4})?)\s+/;
const LINE_AMOUNT = /\s(\(?-?\$?\d{1,3}(?:,\d{3})*\.\d{2}\)?-?(?:\s?(?:CR|DR))?)\s*(?:\$?\d{1,3}(?:,\d{3})*\.\d{2})?\s*$/i;

/**
 * Parse statement text (lines from a PDF or pasted text). A transaction line starts with a date
 * and ends with an amount; an optional running balance after the amount is ignored.
 * Lines that mention "deposit", "payment received", "credit" or "refund" count as money in.
 * Returns { transactions, skipped }.
 */
export function parseText(text, { year } = {}) {
  const fallbackYear = year || guessYear(text) || new Date().getFullYear();
  const out = [];
  let skipped = 0;
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    const d = line.match(LINE_DATE);
    if (!d) continue;
    const rest = line.slice(d[0].length);
    // A posting date often follows the transaction date; skip it.
    const rest2 = rest.replace(LINE_DATE, '');
    const a = (' ' + rest2).match(LINE_AMOUNT);
    if (!a) { skipped++; continue; }
    const date = parseDate(d[1], fallbackYear);
    let amount = parseAmount(a[1]);
    const description = (' ' + rest2).slice(0, a.index).trim();
    if (!date || amount == null || !description) { skipped++; continue; }
    const incoming = /\b(deposit|direct dep|payroll|payment received|payment - thank you|payment thank you|refund|interest paid|credit)\b/i.test(description);
    if (amount > 0 && !incoming) amount = -amount;
    out.push({ date, description, amount });
  }
  return { transactions: sortTx(out), skipped };
}

function guessYear(text) {
  const m = String(text).match(/\b(20\d{2})\b/);
  return m ? Number(m[1]) : null;
}

function sortTx(rows) {
  return rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Pick a parser by content: CSV if the first lines look comma/semicolon separated with a header. */
export function parseAny(text, opts) {
  const head = String(text).split(/\r?\n/).slice(0, 8).join('\n');
  const looksCsv = /,|;/.test(head) && /date/i.test(head) && /(amount|debit|credit|withdrawal)/i.test(head);
  if (looksCsv) {
    try {
      const r = parseCsv(text);
      if (r.transactions.length) return { ...r, format: 'csv' };
    } catch { /* fall through to text */ }
  }
  return { ...parseText(text, opts), signFlipped: false, format: 'text' };
}
