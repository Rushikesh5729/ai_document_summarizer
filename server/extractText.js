const path = require("path");

// We use pdfjs-dist (Mozilla's actively-maintained PDF.js) directly instead
// of the unmaintained `pdf-parse` package. pdf-parse bundles a very old
// (~2020) internal copy of PDF.js that mis-decodes text from PDFs using
// certain embedded/subsetted font encodings — producing garbled output
// even though the PDF itself is perfectly valid (tools like poppler's
// pdftotext handle the same file correctly). The current pdfjs-dist does
// not have this bug and, like pdf-parse, is pure JS with no native/system
// dependencies, so it stays easy to install everywhere.
async function extractTextFromPdfBuffer(buffer) {
  // pdfjs-dist v4+ ships only ESM (.mjs) builds, even for its "legacy"
  // Node-compatible bundle — a plain require() fails with
  // "Cannot find module". Node's CommonJS files can still load ESM
  // modules via a dynamic import(), so we use that instead.
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    // Disable features that need extra data files we don't ship, so
    // extraction still works even for PDFs missing standard font files.
    useSystemFonts: true,
    disableFontFace: true,
  });

  const pdfDocument = await loadingTask.promise;
  const pageTexts = [];

  for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
    const page = await pdfDocument.getPage(pageNum);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map((item) => item.str).join(" ");
    pageTexts.push(pageText);
  }

  await pdfDocument.destroy();
  return pageTexts.join("\n\n");
}

async function extractTextFromUpload(file) {
  const { mimetype, buffer, originalname } = file;

  if (mimetype === "application/pdf" || originalname.toLowerCase().endsWith(".pdf")) {
    const text = await extractTextFromPdfBuffer(buffer);
    return { text, sourceType: "pdf-file" };
  }

  if (
    mimetype === "text/plain" ||
    originalname.toLowerCase().endsWith(".txt")
  ) {
    return { text: buffer.toString("utf-8"), sourceType: "txt-file" };
  }

  throw new Error("Unsupported file type. Please upload a .txt or .pdf file.");
}

module.exports = { extractTextFromUpload };
