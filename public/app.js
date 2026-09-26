// ---- Config ----
const API_BASE = ""; // same-origin; change if frontend/backend are deployed separately

// ---- Pseudo-auth: persistent anonymous user id per browser ----
function getUserId() {
  let id = localStorage.getItem("summarizer_user_id");
  if (!id) {
    id = "user_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem("summarizer_user_id", id);
  }
  return id;
}

function apiHeaders(extra = {}) {
  return { "x-user-id": getUserId(), ...extra };
}

// ---- Tabs ----
const tabButtons = document.querySelectorAll(".tab-btn");
const tabPanels = document.querySelectorAll(".tab-panel");
tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    tabButtons.forEach((b) => b.classList.remove("active"));
    tabPanels.forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
    if (btn.dataset.tab === "history") loadHistory();
  });
});

// ---- Input mode switch (text vs file) ----
const modeButtons = document.querySelectorAll(".mode-btn");
const modeText = document.getElementById("mode-text");
const modeFile = document.getElementById("mode-file");
let currentMode = "text";
modeButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    modeButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentMode = btn.dataset.mode;
    modeText.classList.toggle("active", currentMode === "text");
    modeFile.classList.toggle("active", currentMode === "file");
  });
});

// ---- Char counter ----
const textInput = document.getElementById("textInput");
const charCount = document.getElementById("charCount");
textInput.addEventListener("input", () => {
  charCount.textContent = `${textInput.value.length} characters`;
});

// ---- File dropzone ----
const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const dropzoneText = document.getElementById("dropzoneText");
let selectedFile = null;

dropzone.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  if (fileInput.files[0]) setSelectedFile(fileInput.files[0]);
});
["dragover", "dragenter"].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  })
);
["dragleave", "drop"].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
  })
);
dropzone.addEventListener("drop", (e) => {
  const file = e.dataTransfer.files[0];
  if (file) setSelectedFile(file);
});

function setSelectedFile(file) {
  const isValid = /\.(txt|pdf)$/i.test(file.name);
  if (!isValid) {
    showError("Only .txt and .pdf files are supported.");
    return;
  }
  selectedFile = file;
  dropzoneText.textContent = `Selected: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
}

// ---- Summarize action ----
const summarizeBtn = document.getElementById("summarizeBtn");
const errorBox = document.getElementById("errorBox");
const resultEmpty = document.getElementById("resultEmpty");
const resultBox = document.getElementById("resultBox");
const loadingBox = document.getElementById("loadingBox");
const resultProvider = document.getElementById("resultProvider");
const resultStats = document.getElementById("resultStats");
const resultSummary = document.getElementById("resultSummary");
const resultTags = document.getElementById("resultTags");

let lastRecordId = null;

summarizeBtn.addEventListener("click", async () => {
  hideError();

  const title = document.getElementById("titleInput").value.trim();
  const length = document.getElementById("lengthSelect").value;
  const tags = document.getElementById("tagsInput").value.trim();

  let body, headers;

  if (currentMode === "file") {
    if (!selectedFile) return showError("Please choose a .txt or .pdf file first.");
    const fd = new FormData();
    fd.append("file", selectedFile);
    if (title) fd.append("title", title);
    fd.append("length", length);
    if (tags) fd.append("tags", tags);
    body = fd;
    headers = apiHeaders(); // don't set Content-Type; browser sets multipart boundary
  } else {
    const text = textInput.value.trim();
    if (!text) return showError("Please paste some text first.");
    body = JSON.stringify({ text, title, length, tags });
    headers = apiHeaders({ "Content-Type": "application/json" });
  }

  setLoading(true);
  try {
    const res = await fetch(`${API_BASE}/api/summarize`, { method: "POST", headers, body });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Something went wrong.");
    lastRecordId = data.id;
    renderResult(data);
  } catch (err) {
    showError(err.message);
  } finally {
    setLoading(false);
  }
});

function setLoading(isLoading) {
  summarizeBtn.disabled = isLoading;
  loadingBox.classList.toggle("hidden", !isLoading);
  if (isLoading) {
    resultEmpty.classList.add("hidden");
    resultBox.classList.add("hidden");
  }
}

function renderResult(data) {
  resultEmpty.classList.add("hidden");
  resultBox.classList.remove("hidden");
  resultProvider.textContent = data.aiProvider;
  resultStats.textContent = `${data.wordCountOriginal} words → ${data.wordCountSummary} words`;
  resultSummary.textContent = data.summaryText;
  resultTags.innerHTML = "";
  data.tags.forEach((t) => {
    const pill = document.createElement("span");
    pill.className = "tag-pill";
    pill.textContent = t;
    resultTags.appendChild(pill);
  });
}

document.getElementById("copyBtn").addEventListener("click", () => {
  navigator.clipboard.writeText(resultSummary.textContent);
  const btn = document.getElementById("copyBtn");
  const original = btn.textContent;
  btn.textContent = "✅ Copied!";
  setTimeout(() => (btn.textContent = original), 1500);
});

document.getElementById("exportBtn").addEventListener("click", () => {
  if (!lastRecordId) return;
  window.open(`${API_BASE}/api/history/${lastRecordId}/export?userId=${encodeURIComponent(getUserId())}`, "_blank");
});

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.classList.remove("hidden");
}
function hideError() {
  errorBox.classList.add("hidden");
}

// ---- History tab ----
const historyList = document.getElementById("historyList");
const historySearch = document.getElementById("historySearch");
let historyDebounce = null;

historySearch.addEventListener("input", () => {
  clearTimeout(historyDebounce);
  historyDebounce = setTimeout(loadHistory, 300);
});

async function loadHistory() {
  const q = historySearch.value.trim();
  const url = new URL(`${API_BASE}/api/history`, window.location.origin);
  if (q) url.searchParams.set("search", q);

  try {
    const res = await fetch(url, { headers: apiHeaders() });
    const items = await res.json();
    renderHistory(items);
  } catch (err) {
    historyList.innerHTML = `<div class="empty-state">Failed to load history.</div>`;
  }
}

function renderHistory(items) {
  if (!items.length) {
    historyList.innerHTML = `<div class="empty-state">No summaries yet — generate one from the Summarize tab.</div>`;
    return;
  }
  historyList.innerHTML = "";
  items.forEach((item) => {
    const el = document.createElement("div");
    el.className = "history-item";
    const date = new Date(item.createdAt).toLocaleString();
    el.innerHTML = `
      <div class="history-item-top">
        <div class="history-item-title">${escapeHtml(item.title)}</div>
        <div class="history-item-date">${date}</div>
      </div>
      <div class="history-item-summary">${escapeHtml(truncate(item.summaryText, 220))}</div>
      <div class="tag-list">${item.tags.map((t) => `<span class="tag-pill">${escapeHtml(t)}</span>`).join("")}</div>
      <div class="history-item-actions">
        <button data-action="export" data-id="${item.id}">⬇ Export PDF</button>
        <button data-action="delete" data-id="${item.id}">🗑 Delete</button>
      </div>
    `;
    historyList.appendChild(el);
  });

  historyList.querySelectorAll("button[data-action='export']").forEach((btn) => {
    btn.addEventListener("click", () => {
      window.open(`${API_BASE}/api/history/${btn.dataset.id}/export?userId=${encodeURIComponent(getUserId())}`, "_blank");
    });
  });
  historyList.querySelectorAll("button[data-action='delete']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this summary?")) return;
      await fetch(`${API_BASE}/api/history/${btn.dataset.id}`, {
        method: "DELETE",
        headers: apiHeaders(),
      });
      loadHistory();
    });
  });
}

function truncate(str, n) {
  return str.length > n ? str.slice(0, n) + "…" : str;
}
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
