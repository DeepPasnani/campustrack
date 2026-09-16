const PDFDocument = require('pdfkit');

/* ═══════════════════════════════════════════════════════════
 * PDF summary report — the formatted counterpart to the raw
 * CSV export. Streams directly to the HTTP response so nothing
 * has to be buffered in memory for large drives.
 * ═══════════════════════════════════════════════════════════ */

function pct(score, max) {
  return max > 0 ? Math.round((score / max) * 100) : 0;
}

function buildResultsPdf({ test, submissions, classBreakdown }, res) {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  doc.pipe(res);

  // ── Header ──────────────────────────────────────────────
  doc.font('Helvetica-Bold').fontSize(18).fillColor('#14141E').text('CampusTrack', { continued: true });
  doc.font('Helvetica').fontSize(18).fillColor('#4A9EFF').text('  Results Report');
  doc.moveDown(0.2);
  doc.font('Helvetica').fontSize(11).fillColor('#555').text(test.title);
  doc.fontSize(9).fillColor('#888').text(`${test.department}  ·  Generated ${new Date().toLocaleString()}`);
  doc.moveDown(1);

  // ── Summary ─────────────────────────────────────────────
  const scored = submissions.filter(s => s.status === 'submitted' && s.max_score > 0);
  const avgPct = scored.length ? Math.round(scored.reduce((a, s) => a + pct(s.score, s.max_score), 0) / scored.length) : 0;
  const passCount = scored.filter(s => pct(s.score, s.max_score) >= (test.settings?.passingScore ?? 40)).length;
  const passRate = scored.length ? Math.round((passCount / scored.length) * 100) : 0;

  const summaryY = doc.y;
  const cols = [
    { label: 'Total Submissions', value: String(submissions.length) },
    { label: 'Average Score', value: `${avgPct}%` },
    { label: 'Passed', value: String(passCount) },
    { label: 'Pass Rate', value: `${passRate}%` },
  ];
  const colWidth = (doc.page.width - 80) / cols.length;
  cols.forEach((c, i) => {
    const x = 40 + i * colWidth;
    doc.font('Helvetica').fontSize(9).fillColor('#888').text(c.label, x, summaryY, { width: colWidth });
    doc.font('Helvetica-Bold').fontSize(16).fillColor('#14141E').text(c.value, x, summaryY + 13, { width: colWidth });
  });
  doc.y = summaryY + 45;
  doc.moveDown(0.5);

  // ── Class-wise breakdown ────────────────────────────────
  if (classBreakdown?.length > 1) {
    sectionTitle(doc, 'Class-wise Breakdown');
    tableHeader(doc, ['Class', 'Submitted', 'Average', 'Pass Rate'], [200, 100, 100, 100]);
    classBreakdown.forEach((c, i) => {
      tableRow(doc, [c.class, String(c.count), `${c.avg}%`, `${c.passRate}%`], [200, 100, 100, 100], i);
    });
    doc.moveDown(1);
  }

  // ── Leaderboard ──────────────────────────────────────────
  sectionTitle(doc, 'Leaderboard');
  const ranked = [...submissions].sort(
    (a, b) => (b.status === 'submitted' ? 1 : 0) - (a.status === 'submitted' ? 1 : 0) ||
      pct(b.score, b.max_score) - pct(a.score, a.max_score)
  );
  const widths = [30, 130, 90, 80, 60, 60, 60];
  tableHeader(doc, ['#', 'Name', 'Roll No', 'Class', 'Score', '%', 'Result'], widths);
  ranked.forEach((s, i) => {
    checkPageBreak(doc);
    const p = pct(s.score, s.max_score);
    const result = s.status !== 'submitted' ? '—' : p >= (test.settings?.passingScore ?? 40) ? 'Pass' : 'Fail';
    tableRow(doc, [
      String(i + 1),
      s.user_name || '—',
      s.roll_number || '—',
      s.class_display || '—',
      s.status === 'submitted' ? `${s.score}/${s.max_score}` : '—',
      s.status === 'submitted' ? `${p}%` : '—',
      result,
    ], widths, i);
  });

  doc.end();
}

function sectionTitle(doc, text) {
  checkPageBreak(doc, 40);
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#14141E').text(text);
  doc.moveDown(0.3);
}

function tableHeader(doc, cells, widths) {
  const startX = 40;
  const y = doc.y;
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#888');
  let x = startX;
  cells.forEach((c, i) => { doc.text(c.toUpperCase(), x, y, { width: widths[i] }); x += widths[i]; });
  doc.moveDown(0.5);
  doc.moveTo(startX, doc.y).lineTo(startX + widths.reduce((a, w) => a + w, 0), doc.y).strokeColor('#DDD').stroke();
  doc.moveDown(0.3);
}

function tableRow(doc, cells, widths, i) {
  const startX = 40;
  const y = doc.y;
  if (i % 2 === 0) {
    doc.rect(startX, y - 2, widths.reduce((a, w) => a + w, 0), 16).fillColor('#F7F7FA').fill();
  }
  doc.font('Helvetica').fontSize(8.5).fillColor('#2A2A3E');
  let x = startX;
  cells.forEach((c, idx) => { doc.text(String(c), x, y, { width: widths[idx] }); x += widths[idx]; });
  doc.y = y + 16;
}

function checkPageBreak(doc, buffer = 60) {
  if (doc.y > doc.page.height - doc.page.margins.bottom - buffer) {
    doc.addPage();
  }
}

module.exports = { buildResultsPdf };
