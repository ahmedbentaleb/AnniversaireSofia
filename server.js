const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
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
// Chemin de la base : en prod, on peut rediriger vers un disque persistant via DB_PATH
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'invitations.db');
const INVITE_BASE_URL = process.env.INVITE_BASE_URL || `http://localhost:${PORT}`;
const ORGANIZER_EMAIL = process.env.ORGANIZER_EMAIL || 'asmaaelhouboub@gmail.com';

const ALLOWED_STATUSES = ['pending', 'oui', 'non'];

const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new sqlite3.Database(DB_PATH);

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

// Initialize database tables and default admin
db.serialize(() => {
  db.run(
    `CREATE TABLE IF NOT EXISTS guests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      child_name TEXT,
      parent_name TEXT,
      contact_email TEXT,
      whatsapp TEXT,
      token TEXT UNIQUE,
      status TEXT DEFAULT 'pending',
      created_at TEXT,
      responded_at TEXT
    )`
  );

  db.run(
    `CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE,
      password_hash TEXT
    )`
  );

  const defaultEmail = 'admin@sofia.local';
  const now = new Date().toISOString();

  db.get('SELECT id FROM admin_users WHERE email = ?', [defaultEmail], async (err, row) => {
    if (err) {
      console.error('Error checking admin existence:', err);
      return;
    }
    try {
      const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);
      if (!row) {
        db.run(
          'INSERT INTO admin_users (email, password_hash) VALUES (?, ?)',
          [defaultEmail, hash],
          (insertErr) => {
            if (insertErr) {
              console.error('Error creating default admin:', insertErr);
            } else {
              console.log(`[db] Default admin created (${defaultEmail}) at ${now}`);
            }
          }
        );
      } else {
        db.run(
          'UPDATE admin_users SET password_hash = ? WHERE email = ?',
          [hash, defaultEmail],
          (updateErr) => {
            if (updateErr) {
              console.error('Error updating default admin password:', updateErr);
            } else {
              console.log(`[db] Default admin password refreshed for ${defaultEmail} at ${now}`);
            }
          }
        );
      }
    } catch (hashErr) {
      console.error('Error hashing admin password:', hashErr);
    }
  });
});

function requireAdmin(req, res, next) {
  if (req.session && req.session.adminId) {
    return next();
  }
  return res.redirect('/admin/login');
}

app.get('/', (req, res) => res.redirect('/admin/login'));

// Public invitation
app.get('/invite/:token', (req, res) => {
  const { token } = req.params;
  db.get('SELECT * FROM guests WHERE token = ?', [token], (err, guest) => {
    if (err) {
      console.error('Error fetching guest:', err);
      return res.status(500).send('Erreur serveur.');
    }
    if (!guest) {
      return res.status(404).send('Invitation introuvable.');
    }
    res.render('invite', {
      child_name: guest.child_name,
      token: guest.token,
      status: guest.status,
      inviteBaseUrl: INVITE_BASE_URL,
    });
  });
});

// RSVP API
app.post('/api/rsvp', (req, res) => {
  const { token, response } = req.body;
  if (!token || !['oui', 'non', 'pending'].includes(response)) {
    return res.status(400).json({ success: false, message: 'Données invalides.' });
  }

  const respondedAt = response === 'pending' ? null : new Date().toISOString();
  db.run(
    'UPDATE guests SET status = ?, responded_at = ? WHERE token = ?',
    [response, respondedAt, token],
    function updateCallback(err) {
      if (err) {
        console.error('Error updating RSVP:', err);
        return res.status(500).json({ success: false });
      }
      if (this.changes === 0) {
        return res.status(404).json({ success: false, message: 'Invitation introuvable.' });
      }

      db.get('SELECT * FROM guests WHERE token = ?', [token], async (fetchErr, guest) => {
        if (fetchErr || !guest) {
          if (fetchErr) {
            console.error('Error fetching guest after RSVP update:', fetchErr);
          }
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
      });
    }
  );
});

// Admin login routes
app.get('/admin/login', (req, res) => {
  if (req.session && req.session.adminId) {
    return res.redirect('/admin/dashboard');
  }
  res.render('admin-login', { error: null });
});

app.post('/admin/login', (req, res) => {
  const { email, password } = req.body;
  db.get('SELECT * FROM admin_users WHERE email = ?', [email], async (err, admin) => {
    if (err) {
      console.error('Error fetching admin:', err);
      return res.status(500).send('Erreur serveur.');
    }
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
  });
});

app.get('/admin/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/admin/login');
  });
});

// Admin dashboard
app.get('/admin/dashboard', requireAdmin, (req, res) => {
  db.all('SELECT * FROM guests ORDER BY created_at DESC', (err, guests) => {
    if (err) {
      console.error('Error fetching guests:', err);
      return res.status(500).send('Erreur serveur.');
    }
    db.get(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'oui' THEN 1 ELSE 0 END) as oui,
        SUM(CASE WHEN status = 'non' THEN 1 ELSE 0 END) as non,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending
      FROM guests`,
      (countErr, stats) => {
        if (countErr) {
          console.error('Error fetching stats:', countErr);
          return res.status(500).send('Erreur serveur.');
        }
        res.render('admin-dashboard', {
          guests,
          stats: stats || { total: 0, oui: 0, non: 0, pending: 0 },
          adminEmail: req.session.adminEmail,
          inviteBaseUrl: INVITE_BASE_URL,
        });
      }
    );
  });
});

// Create guest
app.post('/admin/guests', requireAdmin, (req, res) => {
  const { child_name, parent_name, contact_email, whatsapp } = req.body;
  if (!child_name || !parent_name || !whatsapp) {
    return res.status(400).send('Champs requis manquants.');
  }

  const emailValue = contact_email && contact_email.trim() !== '' ? contact_email.trim() : null;
  const token = uuidv4();
  const createdAt = new Date().toISOString();

  db.run(
    `INSERT INTO guests (child_name, parent_name, contact_email, whatsapp, token, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
    [child_name.trim(), parent_name.trim(), emailValue, whatsapp.trim(), token, createdAt],
    (err) => {
      if (err) {
        console.error('Error inserting guest:', err);
        return res.status(500).send('Erreur lors de la création.');
      }
      res.redirect('/admin/dashboard');
    }
  );
});

// Edit guest (form)
app.get('/admin/guests/:id/edit', requireAdmin, (req, res) => {
  const { id } = req.params;
  db.get('SELECT * FROM guests WHERE id = ?', [id], (err, guest) => {
    if (err) {
      console.error('Error fetching guest for edit:', err);
      return res.status(500).send('Erreur serveur.');
    }
    if (!guest) {
      return res.status(404).send('Invité introuvable.');
    }
    return res.render('admin-edit-guest', { guest, adminEmail: req.session.adminEmail });
  });
});

// Edit guest (submit)
app.post('/admin/guests/:id/edit', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { child_name, parent_name, whatsapp } = req.body;
  if (!child_name || !parent_name || !whatsapp) {
    return res.status(400).send('Champs requis manquants.');
  }
  db.run(
    'UPDATE guests SET child_name = ?, parent_name = ?, whatsapp = ? WHERE id = ?',
    [child_name.trim(), parent_name.trim(), whatsapp.trim(), id],
    (err) => {
      if (err) {
        console.error('Error updating guest:', err);
        return res.status(500).send('Erreur lors de la mise à jour.');
      }
      return res.redirect('/admin/dashboard');
    }
  );
});

// Admin actions: update status and delete
app.post('/admin/guests/:id/status', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  if (!ALLOWED_STATUSES.includes(status)) {
    return res.status(400).send('Statut invalide.');
  }
  const respondedAt = status === 'pending' ? null : new Date().toISOString();
  db.run(
    'UPDATE guests SET status = ?, responded_at = ? WHERE id = ?',
    [status, respondedAt, id],
    function updateStatus(err) {
      if (err) {
        console.error('Error updating status:', err);
        return res.status(500).send('Erreur mise à jour statut.');
      }
      return res.redirect('/admin/dashboard');
    }
  );
});

app.post('/admin/guests/:id/delete', requireAdmin, (req, res) => {
  const { id } = req.params;
  db.run('DELETE FROM guests WHERE id = ?', [id], function deleteGuest(err) {
    if (err) {
      console.error('Error deleting guest:', err);
      return res.status(500).send('Erreur suppression.');
    }
    return res.redirect('/admin/dashboard');
  });
});

// Simple 404 handler
app.use((req, res) => {
  res.status(404).send('Page non trouvée.');
});

app.listen(PORT, () => {
  console.log(`Serveur démarré sur http://localhost:${PORT}`);
});
