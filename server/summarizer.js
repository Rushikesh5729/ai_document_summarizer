const fetch = require("node-fetch");

/**
 * Truncate very long input so we stay within typical context/token limits
 * of free-tier API keys during grading/demo use.
 */
function clampText(text, maxChars = 18000) {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n\n[...truncated for length...]";
}

function buildPrompt(text, length) {
  const lengthInstruction =
    length === "short"
      ? "in 2-3 concise sentences"
      : length === "detailed"
      ? "in a detailed multi-paragraph summary covering all key points"
      : "in a clear, well-structured paragraph (5-8 sentences)";

  return `Summarize the following document ${lengthInstruction}. Focus on the main ideas, key facts, and conclusions. Do not add information that isn't in the text.\n\nDOCUMENT:\n"""\n${text}\n"""\n\nSUMMARY:`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wraps an AI provider call with automatic retries for transient failures
 * (rate limits / temporary server overload), so a single busy moment on
 * the provider's side doesn't immediately dump the user into the much
 * simpler local fallback summarizer.
 */
async function withRetry(fn, { retries = 2, baseDelayMs = 1500 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const isTransient = /\b(429|500|502|503|504)\b/.test(err.message || "");
      if (!isTransient || attempt === retries) throw err;
      await sleep(baseDelayMs * (attempt + 1)); // simple backoff: 1.5s, 3s...
    }
  }
  throw lastErr;
}

async function summarizeWithAnthropic(text, length) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 800,
      messages: [{ role: "user", content: buildPrompt(clampText(text), length) }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const textBlock = data.content?.find((c) => c.type === "text");
  return textBlock?.text?.trim() || "";
}

async function summarizeWithOpenAI(text, length) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: buildPrompt(clampText(text), length) }],
      max_tokens: 800,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI API error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || "";
}

async function summarizeWithGemini(text, length) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: buildPrompt(clampText(text), length) }] }],
    }),
  });
  if (!res.ok) throw new Error(`Gemini API error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
}

/**
 * Local, dependency-free extractive fallback summarizer.
 * Used automatically when no AI API key is configured (or when the AI
 * provider is unavailable even after retries), so the full-stack flow
 * (upload -> process -> store -> display) always works end-to-end.
 * Simple frequency-based sentence scoring (not AI, but functional) that
 * also spreads picks across the whole document rather than clustering
 * near the start, so short summaries still touch on later sections.
 */
function localExtractiveSummary(text, length) {
  const sentences = text
    .replace(/\s+/g, " ")
    .match(/[^.!?]+[.!?]+/g) || [text];

  if (sentences.length <= 3) return text.trim();

  const stopwords = new Set(
    "the a an and or but of to in on for with is are was were be been being this that it as at by from has have had not no so than then which who whom whose".split(" ")
  );

  const freq = {};
  const words = text.toLowerCase().match(/[a-z0-9']+/g) || [];
  for (const w of words) {
    if (stopwords.has(w)) continue;
    freq[w] = (freq[w] || 0) + 1;
  }

  const scored = sentences.map((s, idx) => {
    const sWords = s.toLowerCase().match(/[a-z0-9']+/g) || [];
    const score = sWords.reduce((sum, w) => sum + (freq[w] || 0), 0) / (sWords.length || 1);
    return { s: s.trim(), score, idx };
  });

  const targetCount =
    length === "short" ? Math.min(2, sentences.length) :
    length === "detailed" ? Math.min(8, sentences.length) :
    Math.min(4, sentences.length);

  // Instead of picking the top N sentences by raw score (which tends to
  // cluster together near wherever the most "on-topic" words first
  // appear), split the document into targetCount roughly-equal segments
  // and take the best-scoring sentence from each segment. This spreads
  // the summary across the whole document instead of just its opening.
  const segmentSize = Math.ceil(scored.length / targetCount);
  const picked = [];
  for (let i = 0; i < targetCount; i++) {
    const segment = scored.slice(i * segmentSize, (i + 1) * segmentSize);
    if (!segment.length) continue;
    const best = segment.reduce((a, b) => (b.score > a.score ? b : a));
    picked.push(best);
  }
  picked.sort((a, b) => a.idx - b.idx); // restore original document order

  return picked.map((t) => t.s).join(" ");
}

/**
 * Main entry point: picks the first configured provider, retrying each
 * on transient failures (rate limits / temporary overload) before giving
 * up on it, and only falls back to the local summarizer if every
 * configured provider ultimately fails.
 */
async function generateSummary(text, { length = "medium" } = {}) {
  const attempts = [];

  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const summary = await withRetry(() => summarizeWithAnthropic(text, length));
      return { summary, provider: "anthropic" };
    } catch (err) {
      attempts.push(`anthropic: ${err.message}`);
    }
  }
  if (process.env.OPENAI_API_KEY) {
    try {
      const summary = await withRetry(() => summarizeWithOpenAI(text, length));
      return { summary, provider: "openai" };
    } catch (err) {
      attempts.push(`openai: ${err.message}`);
    }
  }
  if (process.env.GEMINI_API_KEY) {
    try {
      const summary = await withRetry(() => summarizeWithGemini(text, length));
      return { summary, provider: "gemini" };
    } catch (err) {
      attempts.push(`gemini: ${err.message}`);
    }
  }

  // Fallback: local extractive summary (no external API required)
  if (attempts.length) {
    console.warn("AI provider(s) failed, falling back to local summarizer:\n" + attempts.join("\n"));
  }
  return { summary: localExtractiveSummary(text, length), provider: "local-fallback" };
}

module.exports = { generateSummary };
