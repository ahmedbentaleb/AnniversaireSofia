# Anniversaire Sofia - Invitations

Application Express + EJS + SQLite pour gérer les invitations personnalisées à l’anniversaire de Sofia (vidéo + RSVP + dashboard admin).

## Installation

```bash
npm install
cp .env.example .env
# Editez .env et définissez ADMIN_PASSWORD
npm run dev
```

## Scripts

- `npm run dev` : lancement avec nodemon
- `npm start` : lancement en production

## URL utiles

- Invitation publique : `/invite/<token>`
- Login admin : `/admin/login`
- Dashboard : `/admin/dashboard`

## Structure

- `server.js` : serveur Express, routes, sessions, SQLite
- `public/` : assets (CSS, JS, vidéo)
- `views/` : vues EJS (invitation, admin)
- `data/invitations.db` : base SQLite (créée au premier lancement)

## Notes

- Un admin par défaut est créé au démarrage avec l’email `admin@sofia.local` et le mot de passe `ADMIN_PASSWORD` du `.env`.
- Les tokens d’invitation sont générés automatiquement (uuid).
