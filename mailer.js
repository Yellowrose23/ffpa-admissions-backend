// mailer.js — sends notification emails when a new application comes in.
//
// Configure real sending by setting these environment variables (e.g. in a
// .env file — see .env.example):
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, NOTIFY_EMAIL, FROM_EMAIL
//
// If SMTP_HOST is not set, this falls back to "dev mode": it logs the email
// to the console instead of sending it. That lets you run and test the
// whole app locally before you have real email credentials.

const nodemailer = require('nodemailer');

const hasSmtpConfig = Boolean(process.env.SMTP_HOST);

let transporter = null;
if (hasSmtpConfig) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

async function sendApplicationNotification(application) {
  const notifyEmail = process.env.NOTIFY_EMAIL || 'admissions@example.org';
  const fromEmail = process.env.FROM_EMAIL || 'no-reply@ffpacademy.org';

  const subject = `New application: ${application.child_name} (Grade ${application.grade})`;
  const text = [
    `A new application was submitted on the FFPA website.`,
    ``,
    `Parent/guardian: ${application.parent_name} (${application.relationship || 'not specified'})`,
    `Email: ${application.email}`,
    `Phone: ${application.phone}`,
    ``,
    `Child's name: ${application.child_name}`,
    `Grade applying for: ${application.grade}`,
    `Has IEP/504/support need: ${application.ese_plan || 'not specified'}`,
    `Planning to use a scholarship: ${application.scholarship || 'not specified'}`,
    ``,
    `Notes: ${application.notes || '(none)'}`,
    ``,
    `Submitted: ${application.created_at}`,
    `Application ID: ${application.id}`,
  ].join('\n');

  if (!transporter) {
    console.log('\n[DEV MODE] SMTP is not configured, so no real email was sent.');
    console.log('[DEV MODE] Here is the email that WOULD have been sent:\n');
    console.log(`To: ${notifyEmail}`);
    console.log(`From: ${fromEmail}`);
    console.log(`Subject: ${subject}`);
    console.log(`\n${text}\n`);
    return { sent: false, mode: 'dev' };
  }

  await transporter.sendMail({
    from: fromEmail,
    to: notifyEmail,
    subject,
    text,
  });

  return { sent: true, mode: 'smtp' };
}

module.exports = { sendApplicationNotification };
