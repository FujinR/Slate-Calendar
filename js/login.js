import { DEMO_MODE, getFirebase } from './firebase-config.js';

const form = document.getElementById('loginForm');
const errorBanner = document.getElementById('errorBanner');

function showError(msg) {
  errorBanner.textContent = msg;
  errorBanner.style.display = 'block';
}

if (DEMO_MODE) {
  document.getElementById('demoBanner').style.display = 'block';
  [...form.elements].forEach(el => (el.disabled = true));
}

form.addEventListener('submit', async e => {
  e.preventDefault();
  if (DEMO_MODE) return;
  errorBanner.style.display = 'none';
  const fd = new FormData(form);
  const submitBtn = form.querySelector('button[type=submit]');
  submitBtn.disabled = true;
  try {
    const { auth, authMod } = await getFirebase();
    await authMod.signInWithEmailAndPassword(auth, fd.get('email'), fd.get('password'));
    window.location.href = 'dashboard.html';
  } catch (err) {
    showError('Login failed: ' + err.message);
    submitBtn.disabled = false;
  }
});

(async () => {
  if (DEMO_MODE) return;
  const { auth, authMod } = await getFirebase();
  authMod.onAuthStateChanged(auth, user => {
    if (user) window.location.href = 'dashboard.html';
  });
})();
