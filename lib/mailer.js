// Sends mailing-list emails through Gmail SMTP. Set GMAIL_USER and
// GMAIL_APP_PASSWORD in the environment (an "app password" from your Google
// account, not your regular password); without them, sends are logged and
// skipped so local dev doesn't require credentials.

const nodemailer = require('nodemailer');

const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;

const transporter =
  GMAIL_USER && GMAIL_APP_PASSWORD
    ? nodemailer.createTransport({
        service: 'gmail',
        auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
      })
    : null;

const FROM_EMAIL = process.env.MAIL_FROM || GMAIL_USER;

async function sendMail({ to, subject, html, text }) {
  if (!transporter) {
    console.warn(`GMAIL_USER/GMAIL_APP_PASSWORD not set; skipping email to ${to}`);
    return;
  }
  try {
    await transporter.sendMail({ from: FROM_EMAIL, to, subject, html, text });
  } catch (err) {
    console.error(`Failed to send email to ${to}:`, err);
  }
}

async function notifySubscribers({ subscribers, post, baseUrl }) {
  if (!subscribers.length) return;

  const typeLabel = post.type === 'book' ? 'Book' : 'Movie';
  const creatorLabel = post.type === 'book' ? 'Author' : 'Director';
  const pageUrl = `${baseUrl}/${post.type === 'book' ? 'books.html' : 'movies.html'}`;
  const excerpt = post.review.length > 400 ? `${post.review.slice(0, 400)}…` : post.review;

  await Promise.allSettled(
    subscribers.map((sub) => {
      const unsubscribeUrl = `${baseUrl}/api/unsubscribe?token=${sub.token}`;
      return sendMail({
        to: sub.email,
        subject: `New ${typeLabel} Review: ${post.title}`,
        text:
          `${post.title} (${creatorLabel}: ${post.creator})\n\n${excerpt}\n\n` +
          `Read the full review: ${pageUrl}\n\n` +
          `Unsubscribe: ${unsubscribeUrl}`,
        html: `
          <div style="font-family: Georgia, 'Times New Roman', serif; color: #2c2c54; max-width: 560px; margin: 0 auto;">
            <p style="font-size: 0.9rem; color: #7371fc; text-transform: uppercase; letter-spacing: 0.05em;">New ${typeLabel} Review</p>
            <h2 style="margin: 0 0 6px;">${escapeHTML(post.title)}</h2>
            <p style="margin: 0 0 18px; color: #555;">${creatorLabel}: ${escapeHTML(post.creator)}</p>
            <p style="line-height: 1.6; white-space: pre-wrap;">${escapeHTML(excerpt)}</p>
            <p style="margin-top: 24px;">
              <a href="${pageUrl}" style="color: #7371fc;">Read the full review &rarr;</a>
            </p>
            <hr style="margin: 32px 0; border: none; border-top: 1px solid #eee;" />
            <p style="font-size: 0.8rem; color: #999;">
              You're receiving this because you subscribed to Andrew's Story Blog.
              <a href="${unsubscribeUrl}" style="color: #999;">Unsubscribe</a>
            </p>
          </div>
        `,
      });
    })
  );
}

function escapeHTML(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = { sendMail, notifySubscribers };
