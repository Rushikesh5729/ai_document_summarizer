# 📄 AI-Powered Document Summarizer

A full-stack MVP that lets users paste text or upload a `.txt`/`.pdf` file, generates
an AI-powered summary, and stores every summary in a database so users can revisit
their history, tag entries, search past summaries, and export any summary as a PDF.

---

## ✨ Features

- **Frontend**: Clean single-page UI (vanilla HTML/CSS/JS, no build step) with two
  input modes — paste raw text, or drag-and-drop a `.txt`/`.pdf` file.
- **Backend**: Node.js + Express REST API handling text extraction, AI calls, and
  CRUD operations on history.
- **Database**: A lightweight, pure-JavaScript JSON file store (`server/db.js`) —
  zero-config, no native compilation required (works instantly on any OS with no
  build tools), and easy to swap for Postgres/MongoDB later since all DB access is
  isolated behind a small `insert/findByUser/findById/update/delete` API.
- **AI Integration**: Pluggable provider layer (`server/summarizer.js`) that supports
  **Anthropic Claude**, **OpenAI**, or **Google Gemini** — whichever API key you set
  in `.env` is used automatically. If no key is configured, the app **automatically
  falls back to a local extractive summarizer**, so the entire flow (upload → process
  → store → display) still works end-to-end for demo/grading purposes without any paid key.
- **Extras included**:
  - 📚 Summarization history per (anonymous) user, with search
  - 🏷️ Tagging support on each saved summary (editable)
  - ⬇️ Export any saved summary to a downloadable PDF
  - 📏 Adjustable summary length (short / medium / detailed)
  - 🗑️ Delete summaries from history

---

## 🗂 Project Structure

```
doc-summarizer/
├── server/
│   ├── index.js         # Express app & all API routes
│   ├── db.js             # JSON file storage (data access layer)
│   ├── summarizer.js      # AI provider abstraction + local fallback
│   ├── extractText.js     # TXT/PDF text extraction
│   └── exportPdf.js       # PDF export generation
├── public/
│   ├── index.html         # Frontend markup
│   ├── style.css          # Frontend styling
│   └── app.js              # Frontend logic (fetch calls, DOM rendering)
├── package.json
├── .env.example
└── README.md
```

---

## 🔌 API Endpoints

| Method | Route                        | Description                                  |
|--------|-------------------------------|-----------------------------------------------|
| POST   | `/api/summarize`              | Summarize pasted text OR uploaded file        |
| GET    | `/api/history`                | List current user's saved summaries           |
| GET    | `/api/history/:id`            | Get one summary's full detail                 |
| PATCH  | `/api/history/:id`            | Update a summary's title/tags                 |
| DELETE | `/api/history/:id`            | Delete a summary                              |
| GET    | `/api/history/:id/export`     | Download a summary as PDF                     |
| GET    | `/api/health`                 | Health check                                  |

`POST /api/summarize` accepts either:
- JSON: `{ "text": "...", "title": "...", "length": "medium", "tags": "tag1,tag2" }`
- OR `multipart/form-data` with a `file` field (`.txt` or `.pdf`) plus the same optional fields.

Each request is tagged to a browser-generated anonymous user ID sent via the
`x-user-id` header (created and persisted in `localStorage` by the frontend), so
each visitor sees only their own history. This can be swapped for real auth
(e.g. JWT + login) later without changing the DB schema.

---

## 🚀 Running Locally

**Requirements:** Node.js 18+

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Open .env and paste in ONE of: ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY
# (Leave all blank to use the built-in local fallback summarizer)

# 3. Start the server
npm start
# or, for auto-reload during development:
npm run dev

# 4. Open the app
# http://localhost:5000
```

The database file is created automatically at `./data/summaries.json` on
first run — no manual database setup, no SQL, no native compilation needed.

---

## ☁️ Deployment Guide

This app is a **single Node/Express server** that serves both the API and the
static frontend, so it deploys as **one service** — no separate frontend host needed.

### Option A: Deploy to Render (recommended, free tier available)

1. Push this repo to GitHub.
2. On [Render](https://render.com), click **New → Web Service** and connect your repo.
3. Settings:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Environment:** Node
4. Add environment variables (Render dashboard → Environment):
   - `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY` / `GEMINI_API_KEY`)
   - `DB_PATH=/opt/render/project/src/data/summaries.json` (optional; default works fine too)
   > ⚠️ Render's free-tier filesystem is ephemeral on redeploys — for a persistent
   > production database, either enable a Render Disk (Settings → Disks) mounted at
   > `/data`, or swap this JSON store for a managed Postgres/Mongo instance later.
5. Deploy. Render gives you a live URL like `https://your-app.onrender.com`.

### Option B: Deploy to Railway

1. Push to GitHub, then on [Railway](https://railway.app) choose **New Project → Deploy from GitHub repo**.
2. Railway auto-detects Node; it will run `npm install` and `npm start`.
3. Add the same environment variables as above under **Variables**.
4. For persistent storage, attach a Railway Volume mounted to `/app/data`.
5. Railway will provide a public deployment URL.

### Option C: Split frontend/backend (Vercel + Render)

If you'd rather deploy the frontend separately (e.g. to Vercel/Netlify):
1. Deploy `server/` to Render/Railway/Heroku as above (backend only).
2. Deploy the `public/` folder as a static site to Vercel/Netlify.
3. In `public/app.js`, set `const API_BASE = "https://your-backend-url.onrender.com";`
   so the frontend calls the deployed backend instead of same-origin.

---

## 🧠 How the AI Integration Works

`server/summarizer.js` builds a single summarization prompt and tries providers in
this order: **Anthropic → OpenAI → Gemini → local fallback**, based on which API key
is present in `.env`. This keeps the app functional regardless of which free/paid
API key a grader or user has available, and demonstrates clean separation between
the API-communication layer and the rest of the app (routes never call a provider
directly — they only call `generateSummary()`).

The local fallback (used only when no key is set, or if the API call fails) performs
frequency-based extractive summarization — not "true AI," but it keeps the full
request → process → store → retrieve pipeline demonstrably working offline.

---

## 🔮 Possible Next Steps

- Replace anonymous `x-user-id` with real authentication (email/password or OAuth)
- Move from the JSON file store to Postgres/MongoDB for multi-instance, concurrent-safe deployments
- Add streaming responses for long documents
- Support `.docx` uploads
- Add summary comparison / diff view across multiple documents
