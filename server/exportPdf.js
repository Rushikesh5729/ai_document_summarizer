const PDFDocument = require("pdfkit");

/**
 * PDFKit's built-in standard fonts (Helvetica etc.) only support WinAnsi
 * encoding — a limited Latin-1-like character set. Text extracted from
 * uploaded PDFs/files often contains "smart" typographic characters
 * (curly quotes, em/en dashes, ellipses) or, occasionally, mis-decoded
 * glyphs from poorly-encoded source PDFs. Any character outside WinAnsi
 * gets silently rendered as garbage by the default font instead of
 * erroring, which is why exported PDFs could show corrupted text.
 *
 * This sanitizes text to safe ASCII equivalents before rendering, and
 * strips any remaining non-printable/out-of-range characters as a
 * last-resort safety net.
 */
function sanitizeForPdf(text) {
  if (!text) return "";
  return text
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")   // curly single quotes
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')   // curly double quotes
    .replace(/[\u2013\u2014]/g, "-")                // en/em dash
    .replace(/\u2026/g, "...")                       // ellipsis
    .replace(/[\u00A0\u2000-\u200A\u202F\u205F]/g, " ") // various spaces/nbsp
    .replace(/[\u200B-\u200D\uFEFF]/g, "")           // zero-width chars
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "");       // strip anything else non-ASCII-printable
}

function streamSummaryAsPdf(res, record) {
  const doc = new PDFDocument({ margin: 50 });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="summary-${record.id}.pdf"`
  );
  doc.pipe(res);

  const title = sanitizeForPdf(record.title) || "Document Summary";
  const summaryText = sanitizeForPdf(record.summary_text);
  const originalText = sanitizeForPdf(record.original_text);

  doc.fontSize(18).text(title, { underline: true });
  doc.moveDown();
  doc.fontSize(10).fillColor("gray").text(`Generated: ${record.created_at}`);
  doc.text(`AI Provider: ${record.ai_provider}`);
  if (record.tags && record.tags.length) {
    doc.text(`Tags: ${record.tags.map(sanitizeForPdf).join(", ")}`);
  }
  doc.moveDown();

  doc.fillColor("black").fontSize(13).text("Summary", { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(11).text(summaryText, { align: "left" });

  doc.moveDown();
  doc.fontSize(13).text("Original Text", { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(9).fillColor("#444").text(originalText);

  doc.end();
}

module.exports = { streamSummaryAsPdf };