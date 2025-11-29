const ORGANIZER_WHATSAPP = process.env.ORGANIZER_WHATSAPP || '21678405898';

function buildWaUrl(phoneNumber, message) {
  const cleaned = (phoneNumber || '').replace(/[^0-9]/g, '');
  return `https://wa.me/${cleaned}?text=${encodeURIComponent(message)}`;
}

function buildOrganizerRsvpMessage({ guestName, guestPhone, status, respondedAt }) {
  return (
    `Nouvelle réponse pour l’anniversaire de Sofia 🎂\n\n` +
    `Invité : ${guestName || 'N/A'}\n` +
    `Téléphone : ${guestPhone || 'N/A'}\n` +
    `Statut : ${status}\n` +
    `Heure : ${respondedAt || new Date().toISOString()}\n`
  );
}

function getOrganizerRsvpWaUrl(payload) {
  const message = buildOrganizerRsvpMessage(payload);
  return buildWaUrl(ORGANIZER_WHATSAPP, message);
}

module.exports = {
  buildWaUrl,
  getOrganizerRsvpWaUrl,
};

