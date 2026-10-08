'use strict';
// A time-based promotional session, explicitly separate from registration inventory.
const OFFER_DURATION_MINUTES = 50;
const OFFER_INTERVAL_MS = 60000;
const WORKSHOP_START = Date.parse('2026-10-15T19:30:00+07:00');
let offerStarted = Date.now();

function offerMinutesAt(now) {
  return Math.max(0, OFFER_DURATION_MINUTES - Math.floor(Math.max(0, now - offerStarted) / OFFER_INTERVAL_MS));
}
function updateClocks() {
  const now = Date.now();
  document.querySelectorAll('[data-offer-minutes]').forEach(el => {
    const next = String(offerMinutesAt(now)).padStart(2, '0');
    if (el.textContent !== next) el.textContent = next;
  });
  let remainder = Math.max(0, Math.floor((WORKSHOP_START - now) / 1000));
  for (const [id, divisor] of [['days', 86400], ['hours', 3600], ['minutes', 60], ['seconds', 1]]) {
    document.getElementById(id).textContent = String(Math.floor(remainder / divisor)).padStart(2, '0');
    remainder %= divisor;
  }
  if (now >= WORKSHOP_START) document.querySelector('.event-countdown').setAttribute('aria-label', 'Workshop đã đến thời gian diễn ra');
}
updateClocks();
setInterval(updateClocks, 1000);
document.addEventListener('visibilitychange', updateClocks);
const dialog = document.getElementById('image-dialog');
const dialogImage = document.getElementById('dialog-image');
document.querySelectorAll('[data-image]').forEach(button => {
  button.addEventListener('click', () => {
    document.getElementById('image-title').textContent = button.dataset.title;
    dialogImage.src = button.dataset.image;
    dialogImage.alt = button.dataset.title;
    dialog.showModal();
    document.body.classList.add('dialog-open');
  });
});
document.getElementById('close-dialog').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => document.body.classList.remove('dialog-open'));
dialog.addEventListener('click', event => {
  const box = dialog.getBoundingClientRect();
  if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
});
