// Shared across every page: nav highlighting, secret "o p p" admin login trigger,
// and the admin status bar.

function highlightActiveNav() {
  const path = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-pill').forEach((link) => {
    const href = link.getAttribute('href');
    if (href === path || (path === '' && href === 'index.html')) {
      link.classList.add('active');
    }
  });
}

async function getAdminSession() {
  const res = await fetch('/api/admin/session');
  const data = await res.json();
  return data.isAdmin;
}

function buildLoginModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box">
      <h3>Admin Login</h3>
      <form id="admin-login-form">
        <div class="field">
          <label for="admin-username">Username</label>
          <input id="admin-username" name="username" type="text" autocomplete="username" required />
        </div>
        <div class="field">
          <label for="admin-password">Password</label>
          <input id="admin-password" name="password" type="password" autocomplete="current-password" required />
        </div>
        <div class="modal-error" id="admin-login-error"></div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" id="admin-login-cancel">Cancel</button>
          <button type="submit" class="btn">Sign In</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#admin-login-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  overlay.querySelector('#admin-login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = overlay.querySelector('#admin-username').value;
    const password = overlay.querySelector('#admin-password').value;
    const errorEl = overlay.querySelector('#admin-login-error');
    errorEl.textContent = '';
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        errorEl.textContent = data.error || 'Login failed.';
        return;
      }
      overlay.remove();
      window.location.reload();
    } catch (err) {
      errorEl.textContent = 'Something went wrong.';
    }
  });

  overlay.querySelector('#admin-username').focus();
}

function setupSecretLoginTrigger() {
  const sequence = ['o', 'p', 'p'];
  let buffer = [];
  let lastKeyTime = 0;
  const MAX_GAP_MS = 600;

  document.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    const now = Date.now();
    if (now - lastKeyTime > MAX_GAP_MS) buffer = [];
    lastKeyTime = now;

    const key = e.key.toLowerCase();
    buffer.push(key);
    if (buffer.length > sequence.length) buffer.shift();

    if (buffer.join('') === sequence.join('')) {
      buffer = [];
      if (!document.querySelector('.modal-overlay')) buildLoginModal();
    }
  });
}

function renderAdminBar() {
  if (document.querySelector('.admin-bar')) return;
  const bar = document.createElement('div');
  bar.className = 'admin-bar';
  bar.innerHTML = `<span>Admin mode</span><button id="admin-logout-btn">Log out</button>`;
  document.body.appendChild(bar);
  bar.querySelector('#admin-logout-btn').addEventListener('click', async () => {
    await fetch('/api/admin/logout', { method: 'POST' });
    window.location.reload();
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  highlightActiveNav();
  setupSecretLoginTrigger();
  const isAdmin = await getAdminSession();
  if (isAdmin) {
    renderAdminBar();
    document.body.classList.add('is-admin');
    document.dispatchEvent(new CustomEvent('admin-ready'));
  }
});
