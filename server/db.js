const path = require("path");
const fs = require("fs");

// Pure-JS, file-based storage — no native compilation required (unlike
// better-sqlite3), so it installs instantly on any OS with zero build tools.
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "data", "summaries.json");

const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}
if (!fs.existsSync(DB_PATH)) {
  fs.writeFileSync(DB_PATH, JSON.stringify([], null, 2));
}

function readAll() {
  const raw = fs.readFileSync(DB_PATH, "utf-8");
  try {
    return JSON.parse(raw || "[]");
  } catch {
    return [];
  }
}

function writeAll(rows) {
  fs.writeFileSync(DB_PATH, JSON.stringify(rows, null, 2));
}

const db = {
  insert(record) {
    const rows = readAll();
    rows.push(record);
    writeAll(rows);
    return record;
  },

  findById(id, userId) {
    const rows = readAll();
    return rows.find((r) => r.id === id && (userId === undefined || r.user_id === userId));
  },

  findByUser(userId) {
    return readAll()
      .filter((r) => r.user_id === userId)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  },

  update(id, userId, updates) {
    const rows = readAll();
    const idx = rows.findIndex((r) => r.id === id && r.user_id === userId);
    if (idx === -1) return null;
    rows[idx] = { ...rows[idx], ...updates };
    writeAll(rows);
    return rows[idx];
  },

  delete(id, userId) {
    const rows = readAll();
    const idx = rows.findIndex((r) => r.id === id && r.user_id === userId);
    if (idx === -1) return false;
    rows.splice(idx, 1);
    writeAll(rows);
    return true;
  },
};

module.exports = db;
