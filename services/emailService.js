const nodemailer = require('nodemailer');

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = process.env.SMTP_PORT;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const FROM_EMAIL = process.env.FROM_EMAIL || SMTP_USER || 'no-reply@example.com';

let transporter = null;

if (SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });
} else {
  console.warn(
    '[emailService] SMTP configuration missing. Emails will be logged to console instead of being sent.'
  );
}

async function sendRsvpNotificationEmail({ to, subject, guestName, guestPhone, status, respondedAt, token }) {
  const text = [
    `Invité : ${guestName || 'N/A'}`,
    `Téléphone : ${guestPhone || 'N/A'}`,
    `Statut : ${status}`,
    `Date de réponse : ${respondedAt || new Date().toISOString()}`,
    `Token : ${token}`,
  ].join('\n');

  if (!transporter) {
    console.log('[emailService] Mock email send:', { to, subject, text });
    return;
  }

  await transporter.sendMail({
    from: FROM_EMAIL,
    to,
    subject,
    text,
  });
}

module.exports = {
  sendRsvpNotificationEmail,
};

