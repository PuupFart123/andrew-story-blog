// Drives future.html. Anyone can submit an entry (name required for
// non-admins); admin submissions skip the name field and get attributed
// automatically, and admins can delete entries.

let isAdmin = false;

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function categoryLabel(category) {
  return category === 'book' ? 'Book' : 'Movie';
}

function renderEntry(entry) {
  const adminButtons = isAdmin
    ? `
      <button type="button" class="delete-btn toggle-complete-btn">${entry.completed ? 'Mark unfinished' : 'Mark finished'}</button>
      <button type="button" class="delete-btn delete-future-btn">Delete</button>
    `
    : '';
  return `
    <div class="ranking-row future-row" data-entry-id="${entry.id}">
      <span class="rank-rating future-category">${categoryLabel(entry.category)}</span>
      <span class="rank-title${entry.completed ? ' future-completed' : ''}">${escapeHTML(entry.title)}</span>
      <span class="future-entered-by">added by ${escapeHTML(entry.enteredBy)}</span>
      ${adminButtons}
    </div>
  `;
}

async function loadFuture() {
  const container = document.getElementById('future-list');
  const res = await fetch('/api/future');
  const entries = await res.json();

  if (entries.length === 0) {
    container.innerHTML = '<p class="empty-state">Nothing on the list yet.</p>';
    return;
  }

  container.innerHTML = entries.map(renderEntry).join('');

  container.querySelectorAll('.delete-future-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const entryId = btn.closest('.future-row').dataset.entryId;
      if (!confirm('Delete this entry? This cannot be undone.')) return;
      const res = await fetch(`/api/future/${entryId}`, { method: 'DELETE' });
      if (res.ok) loadFuture();
    });
  });

  container.querySelectorAll('.toggle-complete-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const entryId = btn.closest('.future-row').dataset.entryId;
      const res = await fetch(`/api/future/${entryId}/toggle-complete`, { method: 'PATCH' });
      if (res.ok) loadFuture();
    });
  });
}

function updateFormForAdmin() {
  const enteredByField = document.getElementById('future-entered-by-field');
  const enteredByInput = document.getElementById('future-entered-by');
  if (isAdmin) {
    enteredByField.style.display = 'none';
    enteredByInput.required = false;
  } else {
    enteredByField.style.display = '';
    enteredByInput.required = true;
  }
}

function setupForm() {
  document.getElementById('future-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const category = form.category.value;
    const title = form.title.value.trim();
    const enteredBy = form.enteredBy.value.trim();
    const errorEl = document.getElementById('future-error');
    errorEl.textContent = '';

    const body = { category, title };
    if (!isAdmin) body.enteredBy = enteredBy;

    const res = await fetch('/api/future', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      errorEl.textContent = data.error || 'Failed to add entry.';
      return;
    }
    form.reset();
    loadFuture();
  });
}

document.addEventListener('DOMContentLoaded', () => {
  updateFormForAdmin();
  setupForm();
  loadFuture();
});

document.addEventListener('admin-ready', () => {
  isAdmin = true;
  updateFormForAdmin();
  loadFuture();
});
