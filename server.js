const path = require('path');
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const dotenv = require('dotenv');
const { sendRsvpNotificationEmail } = require('./services/emailService');
const { getOrganizerRsvpWaUrl } = require('./services/whatsappService');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'sofia-session-secret';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';
const DATABASE_URL = process.env.DATABASE_URL;
const INVITE_BASE_URL = process.env.INVITE_BASE_URL || `http://localhost:${PORT}`;
const ORGANIZER_EMAIL = process.env.ORGANIZER_EMAIL || 'asmaaelhouboub@gmail.com';

const ALLOWED_STATUSES = ['pending', 'oui', 'non'];

if (!DATABASE_URL) {
  console.error(
    '[db] DATABASE_URL manquante. Définissez DATABASE_URL (Postgres) dans vos variables d’environnement.'
  );
  process.exit(1);
}

const useSsl = process.env.PGSSL === 'true' || process.env.NODE_ENV === 'production';

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: useSsl
    ? {
        rejectUnauthorized: false,
      }
    : false,
});

// Initialize database tables and default admin
async function initDb() {
  try {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS guests (
        id SERIAL PRIMARY KEY,
        child_name TEXT,
        parent_name TEXT,
        contact_email TEXT,
        whatsapp TEXT,
        token TEXT UNIQUE,
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMPTZ,
        responded_at TIMESTAMPTZ
      )`
    );

    await pool.query(
      `CREATE TABLE IF NOT EXISTS admin_users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE,
        password_hash TEXT
      )`
    );

    const defaultEmail = 'admin@sofia.local';
    const now = new Date().toISOString();
    const { rows } = await pool.query('SELECT id FROM admin_users WHERE email = $1', [defaultEmail]);
    const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);

    if (rows.length === 0) {
      await pool.query('INSERT INTO admin_users (email, password_hash) VALUES ($1, $2)', [
        defaultEmail,
        hash,
      ]);
      console.log(`[db] Default admin created (${defaultEmail}) at ${now}`);
    } else {
      await pool.query('UPDATE admin_users SET password_hash = $1 WHERE email = $2', [
        hash,
        defaultEmail,
      ]);
      console.log(`[db] Default admin password refreshed for ${defaultEmail} at ${now}`);
    }
  } catch (err) {
    console.error('[db] Error during initialization:', err);
    process.exit(1);
  }
}

initDb();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
  })
);

function requireAdmin(req, res, next) {
  if (req.session && req.session.adminId) {
    return next();
  }
  return res.redirect('/admin/login');
}

app.get('/', (req, res) => res.redirect('/admin/login'));

// Public invitation
app.get('/invite/:token', async (req, res) => {
  const { token } = req.params;
  try {
    const { rows } = await pool.query('SELECT * FROM guests WHERE token = $1', [token]);
    const guest = rows[0];
    if (!guest) {
      return res.status(404).send('Invitation introuvable.');
    }
    return res.render('invite', {
      child_name: guest.child_name,
      token: guest.token,
      status: guest.status,
      inviteBaseUrl: INVITE_BASE_URL,
    });
  } catch (err) {
    console.error('Error fetching guest:', err);
    return res.status(500).send('Erreur serveur.');
  }
});

// RSVP API
app.post('/api/rsvp', async (req, res) => {
  const { token, response } = req.body;
  if (!token || !['oui', 'non', 'pending'].includes(response)) {
    return res.status(400).json({ success: false, message: 'Données invalides.' });
  }

  const respondedAt = response === 'pending' ? null : new Date().toISOString();

  try {
    const updateResult = await pool.query(
      'UPDATE guests SET status = $1, responded_at = $2 WHERE token = $3',
      [response, respondedAt, token]
    );

    if (updateResult.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Invitation introuvable.' });
    }

    const { rows } = await pool.query('SELECT * FROM guests WHERE token = $1', [token]);
    const guest = rows[0];

    if (!guest) {
      return res.json({ success: true });
    }

    const statusLabel = response === 'oui' ? 'CONFIRMÉ' : response === 'non' ? 'ANNULÉ' : 'EN ATTENTE';

    if (response === 'oui' || response === 'non') {
      try {
        await sendRsvpNotificationEmail({
          to: ORGANIZER_EMAIL,
          subject:
            response === 'oui'
              ? 'Nouvelle CONFIRMATION – Anniversaire Sofia'
              : 'Nouvelle ANNULATION – Anniversaire Sofia',
          guestName: guest.child_name,
          guestPhone: guest.whatsapp,
          status: statusLabel,
          respondedAt,
          token,
        });

        const waUrl = getOrganizerRsvpWaUrl({
          guestName: guest.child_name,
          guestPhone: guest.whatsapp,
          status: statusLabel,
          respondedAt,
        });
        console.log('[RSVP] Organizer WhatsApp URL (ouvrir manuellement) :', waUrl);
      } catch (notifyErr) {
        console.error('Error sending RSVP notifications:', notifyErr);
      }
    }

    return res.json({ success: true });
  } catch (err) {
    console.error('Error updating RSVP:', err);
    return res.status(500).json({ success: false });
  }
});

// Admin login routes
app.get('/admin/login', (req, res) => {
  if (req.session && req.session.adminId) {
    return res.redirect('/admin/dashboard');
  }
  return res.render('admin-login', { error: null });
});

app.post('/admin/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const { rows } = await pool.query('SELECT * FROM admin_users WHERE email = $1', [email]);
    const admin = rows[0];
    if (!admin) {
      return res.render('admin-login', { error: 'Identifiants invalides.' });
    }
    const match = await bcrypt.compare(password, admin.password_hash);
    if (!match) {
      return res.render('admin-login', { error: 'Identifiants invalides.' });
    }
    req.session.adminId = admin.id;
    req.session.adminEmail = admin.email;
    return res.redirect('/admin/dashboard');
  } catch (err) {
    console.error('Error fetching admin:', err);
    return res.status(500).send('Erreur serveur.');
  }
});

app.get('/admin/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/admin/login');
  });
});

// Admin dashboard
app.get('/admin/dashboard', requireAdmin, async (req, res) => {
  try {
    const guestsResult = await pool.query('SELECT * FROM guests ORDER BY created_at DESC');
    const statsResult = await pool.query(
      `SELECT
        COUNT(*)::int as total,
        SUM(CASE WHEN status = 'oui' THEN 1 ELSE 0 END)::int as oui,
        SUM(CASE WHEN status = 'non' THEN 1 ELSE 0 END)::int as non,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END)::int as pending
      FROM guests`
    );

    const guests = guestsResult.rows;
    const stats =
      statsResult.rows[0] || {
        total: 0,
        oui: 0,
        non: 0,
        pending: 0,
      };

    return res.render('admin-dashboard', {
      guests,
      stats,
      adminEmail: req.session.adminEmail,
      inviteBaseUrl: INVITE_BASE_URL,
    });
  } catch (err) {
    console.error('Error fetching guests or stats:', err);
    return res.status(500).send('Erreur serveur.');
  }
});

// Create guest
app.post('/admin/guests', requireAdmin, async (req, res) => {
  const { child_name, parent_name, contact_email, whatsapp } = req.body;
  if (!child_name || !parent_name || !whatsapp) {
    return res.status(400).send('Champs requis manquants.');
  }

  const emailValue = contact_email && contact_email.trim() !== '' ? contact_email.trim() : null;
  const token = uuidv4();
  const createdAt = new Date().toISOString();

  try {
    await pool.query(
      `INSERT INTO guests (child_name, parent_name, contact_email, whatsapp, token, status, created_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6)`,
      [child_name.trim(), parent_name.trim(), emailValue, whatsapp.trim(), token, createdAt]
    );
    return res.redirect('/admin/dashboard');
  } catch (err) {
    console.error('Error inserting guest:', err);
    return res.status(500).send('Erreur lors de la création.');
  }
});

// Edit guest (form)
app.get('/admin/guests/:id/edit', requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query('SELECT * FROM guests WHERE id = $1', [id]);
    const guest = rows[0];
    if (!guest) {
      return res.status(404).send('Invité introuvable.');
    }
    return res.render('admin-edit-guest', { guest, adminEmail: req.session.adminEmail });
  } catch (err) {
    console.error('Error fetching guest for edit:', err);
    return res.status(500).send('Erreur serveur.');
  }
});

// Edit guest (submit)
app.post('/admin/guests/:id/edit', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { child_name, parent_name, whatsapp } = req.body;
  if (!child_name || !parent_name || !whatsapp) {
    return res.status(400).send('Champs requis manquants.');
  }
  try {
    await pool.query(
      'UPDATE guests SET child_name = $1, parent_name = $2, whatsapp = $3 WHERE id = $4',
      [child_name.trim(), parent_name.trim(), whatsapp.trim(), id]
    );
    return res.redirect('/admin/dashboard');
  } catch (err) {
    console.error('Error updating guest:', err);
    return res.status(500).send('Erreur lors de la mise à jour.');
  }
});

// Admin actions: update status and delete
app.post('/admin/guests/:id/status', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  if (!ALLOWED_STATUSES.includes(status)) {
    return res.status(400).send('Statut invalide.');
  }
  const respondedAt = status === 'pending' ? null : new Date().toISOString();
  try {
    await pool.query('UPDATE guests SET status = $1, responded_at = $2 WHERE id = $3', [
      status,
      respondedAt,
      id,
    ]);
    return res.redirect('/admin/dashboard');
  } catch (err) {
    console.error('Error updating status:', err);
    return res.status(500).send('Erreur mise à jour statut.');
  }
});

app.post('/admin/guests/:id/delete', requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM guests WHERE id = $1', [id]);
    return res.redirect('/admin/dashboard');
  } catch (err) {
    console.error('Error deleting guest:', err);
    return res.status(500).send('Erreur suppression.');
  }
});

// Simple 404 handler
app.use((req, res) => {
  res.status(404).send('Page non trouvée.');
});

app.listen(PORT, () => {
  console.log(`Serveur démarré sur http://localhost:${PORT}`);
});
