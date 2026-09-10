# FFPA Admissions Backend

A small, real backend for the Florida Foundations Preparatory Academy admissions
form. It does two things:

1. Saves every submitted application to a database file.
2. Emails you a notification when a new one comes in.

It's intentionally simple — one server file, one database file — so it's easy
to understand, run, and eventually hand to a developer if you outgrow it.

## What's in this folder

```
server.js        — the web server and API routes
db.js            — database setup (SQLite, stored in data/ffpa.db)
mailer.js        — sends the notification email (or logs it, if not configured)
.env.example     — template for your configuration/secrets
package.json     — dependency list
```

## Running it on your own computer (to try it out)

You'll need [Node.js](https://nodejs.org) installed (version 18 or later).

```
npm install
cp .env.example .env
npm start
```

You should see:
```
FFPA admissions backend listening on http://localhost:3001
```

At this point the backend is running, but no real emails are sent yet — see
"Setting up real email" below. Until then, every submission gets logged to
your terminal instead, so you can see exactly what would have been emailed.

## Connecting the website to it

In `admissions.html`, near the bottom, there's this line:

```js
const API_BASE_URL = 'http://localhost:3001';
```

While you're testing locally, leave this as-is and make sure the backend is
running (`npm start` in this folder). Once you deploy the backend somewhere
real (see below), change this line to that real address, e.g.:

```js
const API_BASE_URL = 'https://ffpa-backend.onrender.com';
```

## Setting up real email notifications

Open `.env` (the file you copied from `.env.example`) and fill in:

- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` — your email provider's
  sending details. Most providers (Gmail, Outlook, Zoho, SendGrid, Mailgun)
  have a page explaining exactly what to put here, usually under
  "SMTP settings" or "App passwords."
- `NOTIFY_EMAIL` — the address that should receive new-application alerts
  (e.g. your admissions inbox).
- `FROM_EMAIL` — the address emails will appear to come from.

Restart the server after editing `.env`.

## Viewing submitted applications

There's no admin webpage yet, but you can view submissions with:

```
curl http://localhost:3001/api/applications -H "x-admin-key: YOUR_ADMIN_KEY"
```

Replace `YOUR_ADMIN_KEY` with whatever you set `ADMIN_KEY` to in `.env`. If
you'd like a proper admin page instead of this, that's a reasonable next
build.

## Deploying it for real (so the website works for actual families)

This code needs to run somewhere other than your own laptop for real
families to use it. A few beginner-friendly options that all offer free or
cheap tiers:

- **[Render](https://render.com)** — connect a GitHub repo, it builds and
  runs the app, and gives you a public URL automatically.
- **[Railway](https://railway.app)** — similar to Render, also very
  beginner-friendly.
- **A cheap VPS** (DigitalOcean, Linode, etc.) — more setup, more control.

Whichever you choose, you'll need to:

1. Put this code in a Git repository (e.g. on GitHub).
2. Connect that repo to the hosting service.
3. Set the same environment variables from `.env` in the hosting service's
   dashboard (never commit your real `.env` file to Git — it's already
   excluded via `.gitignore`).
4. Once deployed, copy the URL they give you into `API_BASE_URL` in
   `admissions.html`, as described above.

## A note on the database

Applications are stored in `data/ffpa.db`, a single SQLite file. This is
fine for a small school getting started. If this account grows a lot
(hundreds of applications a month, multiple staff needing simultaneous
access), a developer can migrate this same schema to a hosted database like
Postgres without much trouble — the table structure is simple and defined in
`db.js`.

## A note on security

- `ADMIN_KEY` in `.env` protects the applications list. Treat it like a
  password — use a long, random value, and don't share it publicly.
- This backend does not handle payments or store any payment information —
  that's a separate system (see the Tuition page notes about FACTS).
