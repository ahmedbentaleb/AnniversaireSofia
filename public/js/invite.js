const feedback = document.getElementById('feedback');
const btnOui = document.getElementById('btn-oui');
const btnNon = document.getElementById('btn-non');
const statusMessage = document.getElementById('status-message');

let currentStatus = window.INITIAL_STATUS || 'pending';

function showMessage(message, success = true) {
  feedback.textContent = message;
  feedback.style.color = success ? '#1e9e45' : '#c0392b';
}

function needsConfirmation(nextStatus) {
  return currentStatus !== 'pending' && currentStatus !== nextStatus;
}

function updateButtons() {
  btnOui.classList.remove('active-oui', 'active-non');
  btnNon.classList.remove('active-oui', 'active-non');
  btnOui.classList.remove('transparent');
  btnNon.classList.remove('transparent');
  if (currentStatus === 'oui') {
    btnOui.classList.add('active-oui');
    btnNon.classList.add('transparent');
  } else if (currentStatus === 'non') {
    btnNon.classList.add('active-non');
    btnOui.classList.add('transparent');
  }
}

function updateStatusMessage() {
  if (!statusMessage) return;
  if (currentStatus === 'pending') {
    statusMessage.innerHTML = 'Dis-moi si tu viens :';
    return;
  }
  const label = currentStatus.toUpperCase();
  const cls = currentStatus === 'oui' ? 'oui' : 'non';
  statusMessage.innerHTML = `Tu as déjà répondu : <strong class="status-label ${cls}">${label}</strong> (tu peux changer ta réponse)`;
}

// --- Compteur J-... avant la fête ---
function updateCountdown() {
  const eventDate = new Date("2025-12-06T14:00:00"); // date & heure de la fête
  const today = new Date();

  const diff = eventDate - today;
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));

  const text = days > 0 
    ? `J-${days} avant la fête ! 🎉`
    : (days === 0 ? "C'est aujourd'hui ! 🎂✨" : "La fête est passée 🎈");

  const el = document.getElementById("countdown-text");
  if (el) el.textContent = text;
}

async function sendResponse(response) {
  try {
    const res = await fetch('/api/rsvp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: window.INVITE_TOKEN, response }),
    });
    const data = await res.json();
    if (data.success) {
      const updated = currentStatus !== response;
      currentStatus = response;
      updateButtons();
      updateStatusMessage();
      showMessage(updated ? 'Réponse mise à jour.' : 'Merci ! Réponse enregistrée.');
    } else {
      showMessage('Erreur: ' + (data.message || 'Impossible d’enregistrer.'), false);
    }
  } catch (err) {
    console.error(err);
    showMessage('Erreur réseau.', false);
  }
}

if (btnOui) {
  btnOui.addEventListener('click', () => {
    if (needsConfirmation('oui') && !confirm('Tu as déjà répondu. Changer pour OUI ?')) return;
    sendResponse('oui');
  });
}

if (btnNon) {
  btnNon.addEventListener('click', () => {
    if (needsConfirmation('non') && !confirm('Tu as déjà répondu. Changer pour NON ?')) return;
    sendResponse('non');
  });
}

updateButtons();
updateStatusMessage();
updateCountdown();
setInterval(updateCountdown, 60 * 1000);
