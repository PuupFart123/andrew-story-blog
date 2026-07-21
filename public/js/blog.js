// Drives both books.html and movies.html. The page sets window.BLOG_TYPE to
// either 'book' or 'movie' before this script runs.

const BLOG_TYPE = window.BLOG_TYPE;
const CREATOR_LABEL = BLOG_TYPE === 'book' ? 'Author' : 'Director';
let isAdmin = false;

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function renderReviewWithSpoilers(text) {
  const regex = /\[spoiler\]([\s\S]*?)\[\/spoiler\]/gi;
  const parts = [];
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    parts.push(escapeHTML(text.slice(lastIndex, match.index)));
    parts.push(
      `<span class="spoiler"><button type="button" class="spoiler-toggle">Show spoiler</button><span class="spoiler-content">${escapeHTML(match[1])}</span></span>`
    );
    lastIndex = regex.lastIndex;
  }
  parts.push(escapeHTML(text.slice(lastIndex)));
  return parts.join('');
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function renderComment(comment) {
  return `
    <div class="comment">
      <span class="comment-name">${escapeHTML(comment.name)}:</span>
      ${escapeHTML(comment.text)}
    </div>
  `;
}

function renderPost(post) {
  const photo = post.photo
    ? `<img class="post-photo" src="${post.photo}" alt="${escapeHTML(post.title)}" />`
    : '';
  const comments = post.comments.map(renderComment).join('') ||
    '<p style="color:#999;font-size:0.9rem;">No comments yet.</p>';

  const deleteButton = isAdmin
    ? `<button type="button" class="delete-btn delete-post-btn">Delete</button>`
    : '';

  return `
    <article class="post-card" data-post-id="${post.id}">
      ${photo}
      <div class="post-header">
        <h2 class="post-title">${escapeHTML(post.title)}</h2>
        ${deleteButton}
      </div>
      <div class="post-meta">${CREATOR_LABEL}: ${escapeHTML(post.creator)} &middot; ${formatDate(post.date)}</div>
      <div class="post-review">${renderReviewWithSpoilers(post.review)}</div>
      <div class="comments">
        <h4>Comments</h4>
        <div class="comment-list">${comments}</div>
        <form class="comment-form">
          <input type="text" name="name" placeholder="Your name" required style="flex:1;padding:8px 12px;border-radius:8px;border:1px solid #ddd;min-width:120px;" />
          <input type="text" name="text" placeholder="Say something..." required style="flex:3;padding:8px 12px;border-radius:8px;border:1px solid #ddd;min-width:180px;" />
          <button type="submit" class="btn">Post</button>
        </form>
      </div>
    </article>
  `;
}

async function loadPosts() {
  const container = document.getElementById('posts-container');
  const res = await fetch(`/api/posts?type=${BLOG_TYPE}`);
  const posts = await res.json();

  if (posts.length === 0) {
    container.innerHTML = '<p class="empty-state">No posts yet. Check back soon.</p>';
    return;
  }

  container.innerHTML = posts.map(renderPost).join('');

  container.querySelectorAll('.delete-post-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const postId = btn.closest('.post-card').dataset.postId;
      if (!confirm('Delete this review? This cannot be undone.')) return;
      const res = await fetch(`/api/posts/${postId}`, { method: 'DELETE' });
      if (res.ok) loadPosts();
    });
  });

  container.querySelectorAll('.spoiler-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const spoiler = btn.closest('.spoiler');
      const revealed = spoiler.classList.toggle('revealed');
      btn.textContent = revealed ? 'Hide spoiler' : 'Show spoiler';
    });
  });

  container.querySelectorAll('.comment-form').forEach((form) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const postId = form.closest('.post-card').dataset.postId;
      const name = form.elements.name.value.trim();
      const text = form.elements.text.value.trim();
      if (!name || !text) return;
      const res = await fetch(`/api/posts/${postId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, text }),
      });
      if (res.ok) {
        const comment = await res.json();
        const list = form.closest('.comments').querySelector('.comment-list');
        if (list.querySelector('.empty-state, p')) list.innerHTML = '';
        list.insertAdjacentHTML('beforeend', renderComment(comment));
        form.reset();
      }
    });
  });
}

function renderAdminForm() {
  const panel = document.getElementById('admin-panel');
  panel.innerHTML = `
    <h3>Add a new ${BLOG_TYPE === 'book' ? 'book' : 'movie'} review</h3>
    <form id="new-post-form" enctype="multipart/form-data">
      <div class="field">
        <label for="post-title">Title</label>
        <input id="post-title" name="title" type="text" required />
      </div>
      <div class="field">
        <label for="post-creator">${CREATOR_LABEL}</label>
        <input id="post-creator" name="creator" type="text" required />
      </div>
      <div class="field">
        <label for="post-date">Date</label>
        <input id="post-date" name="date" type="date" required />
      </div>
      <div class="field">
        <label for="post-review">Review</label>
        <textarea id="post-review" name="review" rows="6" required placeholder="Wrap text in [spoiler]...[/spoiler] to hide it behind a reveal button"></textarea>
      </div>
      <div class="field">
        <label for="post-photo">Photo</label>
        <input id="post-photo" name="photo" type="file" accept="image/*" />
      </div>
      <div class="modal-error" id="new-post-error"></div>
      <button type="submit" class="btn">Publish</button>
    </form>
  `;
  panel.style.display = 'block';
  document.getElementById('post-date').valueAsDate = new Date();

  document.getElementById('new-post-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);
    formData.append('type', BLOG_TYPE);
    const errorEl = document.getElementById('new-post-error');
    errorEl.textContent = '';
    const res = await fetch('/api/posts', { method: 'POST', body: formData });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      errorEl.textContent = data.error || 'Failed to publish.';
      return;
    }
    form.reset();
    document.getElementById('post-date').valueAsDate = new Date();
    loadPosts();
  });
}

document.addEventListener('DOMContentLoaded', loadPosts);
document.addEventListener('admin-ready', () => {
  isAdmin = true;
  renderAdminForm();
  loadPosts();
});
