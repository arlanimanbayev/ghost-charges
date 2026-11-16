// Turn pdf.js text content into reading-order lines: items on the same baseline are joined
// left to right. Kept separate from the pdf.js loader so it can be tested in Node.

export function linesFromTextContent(content, tolerance = 2) {
  const rows = [];
  for (const it of content.items || []) {
    if (!it.str || !it.str.trim()) continue;
    const x = it.transform[4];
    const y = it.transform[5];
    let row = rows.find((r) => Math.abs(r.y - y) <= tolerance);
    if (!row) { row = { y, parts: [] }; rows.push(row); }
    row.parts.push({ x, s: it.str });
  }
  rows.sort((a, b) => b.y - a.y);
  return rows.map((r) => r.parts.sort((a, b) => a.x - b.x).map((p) => p.s.trim()).join(' ').replace(/\s+/g, ' ').trim());
}
