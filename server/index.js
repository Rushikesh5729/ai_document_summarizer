require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");

const db = require("./db");
const { generateSummary } = require("./summarizer");
const { extractTextFromUpload } = require("./extractText");
const { streamSummaryAsPdf } = require("./exportPdf");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

// Simple pseudo-auth: the frontend generates/keeps a user id in localStorage
// and sends it as a header. This keeps each visitor's history separate
// without requiring a full login system for the MVP.
function getUserId(req) {
  return req.header("x-user-id") || req.query.userId || "anonymous";
}

/* ------------------------------------------------------------------ */
/* POST /api/summarize  — accepts either JSON { text } or a file upload */
/* ------------------------------------------------------------------ */
app.post("/api/summarize", upload.single("file"), async (req, res) => {
  try {
    const userId = getUserId(req);
    const length = req.body.length || "medium";
    const tags = safeParseTags(req.body.tags);

    let text, sourceType, originalFilename = null;

    if (req.file) {
      const extracted = await extractTextFromUpload(req.file);
      text = extracted.text;
      sourceType = extracted.sourceType;
      originalFilename = req.file.originalname;
    } else if (req.body.text && req.body.text.trim()) {
      text = req.body.text;
      sourceType = "text";
    } else {
      return res.status(400).json({ error: "Please provide text or upload a .txt/.pdf file." });
    }

    text = text.trim();
    if (!text) {
      return res.status(400).json({ error: "No readable text found in the input/file." });
    }
    if (text.length < 20) {
      return res.status(400).json({ error: "Text is too short to summarize meaningfully." });
    }

    const { summary, provider } = await generateSummary(text, { length });

    const id = uuidv4();
    const title = req.body.title?.trim() || deriveTitle(text, originalFilename);
    const wordCountOriginal = countWords(text);
    const wordCountSummary = countWords(summary);

    const record = {
      id,
      user_id: userId,
      title,
      source_type: sourceType,
      original_filename: originalFilename,
      original_text: text,
      summary_text: summary,
      tags: tags,
      word_count_original: wordCountOriginal,
      word_count_summary: wordCountSummary,
      ai_provider: provider,
      created_at: new Date().toISOString(),
    };

    db.insert(record);
    res.status(201).json(formatRecord(record));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Failed to generate summary." });
  }
});

/* ------------------------------------------------------------------ */
/* GET /api/history  — list past summaries for this user (optional tag filter) */
/* ------------------------------------------------------------------ */
app.get("/api/history", (req, res) => {
  const userId = getUserId(req);
  const { tag, search } = req.query;

  let rows = db.findByUser(userId);

  if (tag) {
    rows = rows.filter((r) => (r.tags || []).includes(tag));
  }
  if (search) {
    const q = search.toLowerCase();
    rows = rows.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.summary_text.toLowerCase().includes(q) ||
        r.original_text.toLowerCase().includes(q)
    );
  }

  res.json(rows.map(formatRecord));
});

/* ------------------------------------------------------------------ */
/* GET /api/history/:id — single record detail                         */
/* ------------------------------------------------------------------ */
app.get("/api/history/:id", (req, res) => {
  const userId = getUserId(req);
  const record = db.findById(req.params.id, userId);
  if (!record) return res.status(404).json({ error: "Not found." });
  res.json(formatRecord(record));
});

/* ------------------------------------------------------------------ */
/* PATCH /api/history/:id — update tags/title                          */
/* ------------------------------------------------------------------ */
app.patch("/api/history/:id", (req, res) => {
  const userId = getUserId(req);
  const record = db.findById(req.params.id, userId);
  if (!record) return res.status(404).json({ error: "Not found." });

  const title = req.body.title !== undefined ? req.body.title : record.title;
  const tags = req.body.tags !== undefined ? safeParseTags(req.body.tags) : record.tags;

  const updated = db.update(req.params.id, userId, { title, tags });
  res.json(formatRecord(updated));
});

/* ------------------------------------------------------------------ */
/* DELETE /api/history/:id                                             */
/* ------------------------------------------------------------------ */
app.delete("/api/history/:id", (req, res) => {
  const userId = getUserId(req);
  const ok = db.delete(req.params.id, userId);
  if (!ok) return res.status(404).json({ error: "Not found." });
  res.status(204).end();
});

/* ------------------------------------------------------------------ */
/* GET /api/history/:id/export — download a summary as a PDF           */
/* ------------------------------------------------------------------ */
app.get("/api/history/:id/export", (req, res) => {
  const userId = getUserId(req);
  const record = db.findById(req.params.id, userId);
  if (!record) return res.status(404).json({ error: "Not found." });
  streamSummaryAsPdf(res, record);
});

app.get("/api/health", (req, res) => res.json({ status: "ok" }));

// Fallback to index.html for any non-API route (simple SPA-style serving)
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

/* -------------------------- helpers -------------------------- */
function countWords(str) {
  return (str.trim().match(/\S+/g) || []).length;
}

function deriveTitle(text, filename) {
  if (filename) return filename.replace(/\.(txt|pdf)$/i, "");
  const firstLine = text.split(/\r?\n/).find((l) => l.trim().length > 0) || "Untitled Summary";
  return firstLine.trim().slice(0, 60);
}

function safeParseTags(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch {
    // Not JSON — treat as comma-separated string
    return raw.split(",").map((t) => t.trim()).filter(Boolean);
  }
  return [];
}

function formatRecord(r) {
  return {
    id: r.id,
    title: r.title,
    sourceType: r.source_type,
    originalFilename: r.original_filename,
    originalText: r.original_text,
    summaryText: r.summary_text,
    tags: r.tags || [],
    wordCountOriginal: r.word_count_original,
    wordCountSummary: r.word_count_summary,
    aiProvider: r.ai_provider,
    createdAt: r.created_at,
  };
}

app.listen(PORT, () => {
  console.log(`AI Document Summarizer server running on http://localhost:${PORT}`);
});
