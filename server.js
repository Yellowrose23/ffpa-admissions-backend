// server.js — FFPA admissions backend.
//
// Two endpoints:
//   POST /api/applications   — public. Called by the admissions form on the
//                               website. Saves the application and emails
//                               the school a notification.
//   GET  /api/applications   — protected by an admin key. Lets the school
//                               view submitted applications until a full
//                               admin dashboard exists.
//
// Run locally:
//   cp .env.example .env      (then fill in real values later)
//   npm install
//   npm start
//
// The server listens on PORT (default 3001).

require('dotenv').config({ quiet: true });
const express = require('express');
const cors = require('cors');
const db = require('./db');
const { sendApplicationNotification } = require('./mailer');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const ADMIN_KEY = process.env.ADMIN_KEY || 'change-me-before-deploying';

// ---- Helpers ----------------------------------------------------------

function isBlank(value) {
  return typeof value !== 'string' || value.trim().length === 0;
}

const VALID_GRADES = ['K', '1', '2'];

function validateApplication(body) {
  const errors = [];
  if (isBlank(body.parentName)) errors.push('Parent/guardian name is required.');
  if (isBlank(body.email)) errors.push('Email is required.');
  if (isBlank(body.phone)) errors.push('Phone is required.');
  if (isBlank(body.childName)) errors.push("Child's name is required.");
  if (!VALID_GRADES.includes(body.grade)) errors.push('A valid grade (K, 1, or 2) is required.');
  if (!isBlank(body.email) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
    errors.push('Email address looks invalid.');
  }
  return errors;
}

// ---- Routes -------------------------------------------------------------

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

// Public: submit a new application
app.post('/api/applications', async (req, res) => {
  const errors = validateApplication(req.body);
  if (errors.length > 0) {
    return res.status(400).json({ ok: false, errors });
  }

  const {
    parentName,
    relationship = '',
    email,
    phone,
    childName,
    grade,
    esePlan = '',
    scholarship = '',
    notes = '',
  } = req.body;

  const stmt = db.prepare(`
    INSERT INTO applications
      (parent_name, relationship, email, phone, child_name, grade, ese_plan, scholarship, notes)
    VALUES (@parentName, @relationship, @email, @phone, @childName, @grade, @esePlan, @scholarship, @notes)
  `);

  const info = stmt.run({ parentName, relationship, email, phone, childName, grade, esePlan, scholarship, notes });

  const saved = db.prepare('SELECT * FROM applications WHERE id = ?').get(info.lastInsertRowid);

  try {
    await sendApplicationNotification(saved);
  } catch (err) {
    // The application is already saved even if the email fails — we log the
    // error but don't fail the request, so a family's application isn't
    // lost just because email sending had a problem.
    console.error('Failed to send notification email:', err.message);
  }

  res.status(201).json({ ok: true, id: saved.id });
});

// Protected: list applications (simple header-based admin key for now)
app.get('/api/applications', (req, res) => {
  const key = req.header('x-admin-key');
  if (key !== ADMIN_KEY) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  const rows = db.prepare('SELECT * FROM applications ORDER BY created_at DESC').all();
  res.json({ ok: true, applications: rows });
});

app.listen(PORT, () => {
  console.log(`FFPA admissions backend listening on http://localhost:${PORT}`);
  if (ADMIN_KEY === 'change-me-before-deploying') {
    console.log('WARNING: ADMIN_KEY is still the default value. Set a real one in .env before deploying.');
  }
});
