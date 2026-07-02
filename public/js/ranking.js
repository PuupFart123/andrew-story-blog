// Drives both books-ranking.html and movies-ranking.html.
// window.RANKING_TYPE is set to 'book' or 'movie' before this script runs.

const RANKING_TYPE = window.RANKING_TYPE;
let currentSort = 'recency';
let isAdmin = false;

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function renderRankings(entries) {
  const container = document.getElementById('ranking-list');
  if (entries.length === 0) {
    container.innerHTML = '<p class="empty-state">No entries yet.</p>';
    return;
  }
  container.innerHTML = entries
    .map(
      (entry) => `
      <div class="ranking-row" data-entry-id="${entry.id}">
        <span class="rank-title">${escapeHTML(entry.title)}</span>
        <span class="rank-rating">${entry.rating} / 1000</span>
        ${isAdmin ? '<button type="button" class="delete-btn delete-rank-btn">Delete</button>' : ''}
      </div>
    `
    )
    .join('');

  container.querySelectorAll('.delete-rank-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const entryId = btn.closest('.ranking-row').dataset.entryId;
      if (!confirm('Delete this ranking entry? This cannot be undone.')) return;
      const res = await fetch(`/api/rankings/${entryId}`, { method: 'DELETE' });
      if (res.ok) loadRankings();
    });
  });
}

async function loadRankings() {
  const res = await fetch(`/api/rankings?type=${RANKING_TYPE}&sort=${currentSort}`);
  const entries = await res.json();
  renderRankings(entries);
}

function setupSortButtons() {
  document.querySelectorAll('.sort-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentSort = btn.dataset.sort;
      document.querySelectorAll('.sort-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      loadRankings();
    });
  });
}

function renderAdminForm() {
  const panel = document.getElementById('admin-panel');
  const label = RANKING_TYPE === 'book' ? 'Book' : 'Movie';
  panel.innerHTML = `
    <h3>Add a new ranking entry</h3>
    <form id="new-ranking-form">
      <div class="field">
        <label for="rank-title">${label} title</label>
        <input id="rank-title" name="title" type="text" required />
      </div>
      <div class="field">
        <label for="rank-rating">Rating (0-1000)</label>
        <input id="rank-rating" name="rating" type="number" min="0" max="1000" step="1" required />
      </div>
      <div class="modal-error" id="new-ranking-error"></div>
      <button type="submit" class="btn">Add to ranking</button>
    </form>
  `;
  panel.style.display = 'block';

  document.getElementById('new-ranking-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const title = form.title.value.trim();
    const rating = form.rating.value;
    const errorEl = document.getElementById('new-ranking-error');
    errorEl.textContent = '';
    const res = await fetch('/api/rankings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: RANKING_TYPE, title, rating }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      errorEl.textContent = data.error || 'Failed to add entry.';
      return;
    }
    form.reset();
    loadRankings();
  });
}

document.addEventListener('DOMContentLoaded', () => {
  setupSortButtons();
  loadRankings();
});
document.addEventListener('admin-ready', () => {
  isAdmin = true;
  renderAdminForm();
  loadRankings();
});
