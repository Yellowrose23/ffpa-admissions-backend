// db.js — SQLite database setup for FFPA admissions applications.
// Uses a single file on disk (data/ffpa.db) — no external database server needed.
// Good enough for a small school; if you outgrow it later, the same schema
// maps cleanly onto Postgres/MySQL.

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

const db = new Database(path.join(dataDir, 'ffpa.db'));

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    parent_name TEXT NOT NULL,
    relationship TEXT,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    child_name TEXT NOT NULL,
    grade TEXT NOT NULL,
    ese_plan TEXT,
    scholarship TEXT,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'new'
  );
`);

module.exports = db;
