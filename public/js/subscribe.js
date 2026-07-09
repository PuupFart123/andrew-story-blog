// Drives mailing-list.html.

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('subscribe-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const email = form.elements.email.value.trim();
    const errorEl = document.getElementById('subscribe-error');
    const messageEl = document.getElementById('subscribe-message');
    errorEl.textContent = '';
    messageEl.textContent = '';

    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        errorEl.textContent = data.error || 'Something went wrong.';
        return;
      }
      messageEl.textContent = data.message || 'Subscribed!';
      form.reset();
    } catch (err) {
      errorEl.textContent = 'Something went wrong.';
    }
  });
});
