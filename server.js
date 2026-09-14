// server.js — FFPA backend: admissions applications + student login.
//
// Public endpoints:
//   POST /api/applications          — submit an admissions application
//   POST /api/students/login        — student logs in
//   POST /api/students/logout       — student logs out
//
// Protected (student session cookie required):
//   GET  /api/students/me           — get the logged-in student's info
//
// Protected (admin key required, header: x-admin-key):
//   GET  /api/applications          — list admissions applications
//   POST /api/admin/students        — create a new student account
//   GET  /api/admin/students        — list student accounts (no passwords)
//
// Run locally:
//   cp .env.example .env      (then fill in real values later)
//   npm install
//   npm start

require('dotenv').config({ quiet: true });
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const db = require('./db');
const { sendApplicationNotification, sendPasswordResetEmail } = require('./mailer');
const {
  hashPassword,
  verifyPassword,
  signStudentToken,
  requireStudentAuth,
  generateReadablePassword,
  generateResetToken,
  COOKIE_NAME,
} = require('./auth');

const app = express();

// credentials: true + a specific origin (not '*') is required for cookies
// to work cross-origin. Set ALLOWED_ORIGIN to your real website's address
// once deployed (see .env.example).
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'http://localhost:5500';
app.use(cors({ origin: ALLOWED_ORIGIN, credentials: true }));
app.use(express.json());
app.use((req, res, next) => {
  // If a request has no JSON body at all (e.g. an empty POST), make sure
  // req.body is still a plain object rather than undefined, so route
  // handlers can safely do things like req.body.password without checking.
  if (req.body === undefined) req.body = {};
  next();
});
app.use(cookieParser());

const PORT = process.env.PORT || 3001;
const ADMIN_KEY = process.env.ADMIN_KEY || 'change-me-before-deploying';

function requireAdmin(req, res, next) {
  if (req.header('x-admin-key') !== ADMIN_KEY) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  next();
}

function isBlank(value) {
  return typeof value !== 'string' || value.trim().length === 0;
}

// ---- Health ---------------------------------------------------------------

app.get('/api/health', (req, res) => res.json({ ok: true }));

// ---- Admissions applications ------------------------------------------

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

app.post('/api/applications', async (req, res) => {
  const errors = validateApplication(req.body);
  if (errors.length > 0) return res.status(400).json({ ok: false, errors });

  const {
    parentName, relationship = '', email, phone, childName, grade,
    esePlan = '', scholarship = '', notes = '',
  } = req.body;

  const saved = db.insertApplication({
    parent_name: parentName, relationship, email, phone,
    child_name: childName, grade, ese_plan: esePlan, scholarship, notes,
  });

  // Respond to the browser immediately once the application is saved.
  // The email notification happens separately below, without making the
  // family wait for it — if Gmail (or any SMTP server) is slow, misconfigured,
  // or times out, that should never block or break the actual submission.
  res.status(201).json({ ok: true, id: saved.id });

  sendApplicationNotification(saved).catch((err) => {
    console.error('Failed to send notification email:', err.message);
  });
});

app.get('/api/applications', requireAdmin, (req, res) => {
  res.json({ ok: true, applications: db.listApplications() });
});

// ---- Student accounts (created by admin, not self-signup) -----------------
// K-2 students don't sign themselves up — the school creates an account
// after enrollment and shares the username/password with the family.

app.post('/api/admin/students', requireAdmin, async (req, res) => {
  const { username, studentName, grade, parentEmail } = req.body;

  if (isBlank(username)) return res.status(400).json({ ok: false, error: 'Username is required.' });
  if (isBlank(studentName)) return res.status(400).json({ ok: false, error: "Student's name is required." });
  if (db.usernameExists(username)) {
    return res.status(409).json({ ok: false, error: 'That username is already taken. Try another.' });
  }

  // A password is generated automatically (readable, no ambiguous
  // characters) so the school can hand it straight to the family.
  // A specific password can be passed in instead if you'd rather set one.
  const plainPassword = req.body.password || generateReadablePassword();
  const password_hash = await hashPassword(plainPassword);

  const student = db.insertStudent({
    username,
    password_hash,
    student_name: studentName,
    grade: grade || '',
    parent_email: parentEmail || '',
  });

  // Return the plain password ONCE, here, so the admin can copy it down.
  // It is never retrievable again after this — only a new password can be
  // set going forward (see note in README about a future "reset password"
  // endpoint).
  res.status(201).json({
    ok: true,
    student: { id: student.id, username: student.username, studentName: student.student_name },
    password: plainPassword,
  });
});

app.get('/api/admin/students', requireAdmin, (req, res) => {
  res.json({ ok: true, students: db.listStudents() });
});

// Admin resets a student's password immediately (e.g. a parent calls the
// school directly). Returns the new password once — same as account
// creation — so the admin can hand it to the family right away.
app.post('/api/admin/students/:id/reset-password', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const student = db.findStudentById(id);
  if (!student) return res.status(404).json({ ok: false, error: 'Student not found.' });

  const plainPassword = req.body.password || generateReadablePassword();
  const password_hash = await hashPassword(plainPassword);
  db.updateStudent(id, { password_hash, reset_token: null, reset_token_expires: null });

  res.json({ ok: true, username: student.username, password: plainPassword });
});

// ---- Student login/logout ---------------------------------------------

const isProduction = process.env.NODE_ENV === 'production';

app.post('/api/students/login', async (req, res) => {
  const { username, password } = req.body;
  if (isBlank(username) || isBlank(password)) {
    return res.status(400).json({ ok: false, error: 'Username and password are required.' });
  }

  const student = db.findStudentByUsername(username);
  if (!student) {
    return res.status(401).json({ ok: false, error: 'Incorrect username or password.' });
  }

  const passwordMatches = await verifyPassword(password, student.password_hash);
  if (!passwordMatches) {
    return res.status(401).json({ ok: false, error: 'Incorrect username or password.' });
  }

  const token = signStudentToken(student);
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProduction, // only sent over HTTPS in production
    sameSite: isProduction ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });

  res.json({
    ok: true,
    student: { id: student.id, username: student.username, studentName: student.student_name, grade: student.grade },
  });
});

app.post('/api/students/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

// Self-service password reset, initiated by a parent using the family's
// email on file. Always responds with the same generic message whether or
// not the username exists, so this endpoint can't be used to check which
// usernames are registered.
const WEBSITE_URL = process.env.WEBSITE_URL || 'http://localhost:5500';

app.post('/api/students/forgot-password', async (req, res) => {
  const { username } = req.body;
  const genericResponse = {
    ok: true,
    message: 'If that account has a parent email on file, a reset link has been sent to it.',
  };

  if (isBlank(username)) return res.json(genericResponse);

  const student = db.findStudentByUsername(username);
  if (!student || !student.parent_email) return res.json(genericResponse);

  const token = generateResetToken();
  const expiresAt = Date.now() + 60 * 60 * 1000; // 1 hour
  db.updateStudent(student.id, { reset_token: token, reset_token_expires: expiresAt });

  const resetLink = `${WEBSITE_URL}/reset-password.html?token=${token}`;

  try {
    await sendPasswordResetEmail({
      parentEmail: student.parent_email,
      studentName: student.student_name,
      resetLink,
    });
  } catch (err) {
    console.error('Failed to send password reset email:', err.message);
  }

  res.json(genericResponse);
});

app.post('/api/students/reset-password', async (req, res) => {
  const { token, newPassword } = req.body;

  if (isBlank(token) || isBlank(newPassword)) {
    return res.status(400).json({ ok: false, error: 'A reset link and new password are required.' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ ok: false, error: 'Password must be at least 6 characters.' });
  }

  const student = db.findStudentByResetToken(token);
  if (!student) {
    return res.status(400).json({ ok: false, error: 'This reset link is invalid. Please request a new one.' });
  }
  if (!student.reset_token_expires || Date.now() > student.reset_token_expires) {
    return res.status(400).json({ ok: false, error: 'This reset link has expired. Please request a new one.' });
  }

  const password_hash = await hashPassword(newPassword);
  db.updateStudent(student.id, { password_hash, reset_token: null, reset_token_expires: null });

  res.json({ ok: true });
});

app.get('/api/students/me', requireStudentAuth, (req, res) => {
  const student = db.findStudentById(req.student.studentId);
  if (!student) return res.status(401).json({ ok: false, error: 'Account no longer exists.' });
  res.json({
    ok: true,
    student: { id: student.id, username: student.username, studentName: student.student_name, grade: student.grade },
  });
});

app.listen(PORT, () => {
  console.log(`FFPA backend listening on http://localhost:${PORT}`);
  if (ADMIN_KEY === 'change-me-before-deploying') {
    console.log('WARNING: ADMIN_KEY is still the default value. Set a real one in .env before deploying.');
  }
  if (process.env.JWT_SECRET === undefined) {
    console.log('WARNING: JWT_SECRET is not set. Set a real one in .env before deploying.');
  }
});
