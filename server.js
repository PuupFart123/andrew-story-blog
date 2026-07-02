const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const { readData, writeData } = require('./lib/store');
const { savePhoto } = require('./lib/photoStorage');

const DEFAULT_ADMIN_USERNAME = 'andrew';
const DEFAULT_ADMIN_PASSWORD = 'andrew123';

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

if (!process.env.JWT_SECRET) {
  console.warn(
    'WARNING: JWT_SECRET is not set. On a serverless host this invalidates admin sessions ' +
      'on every cold start. Set JWT_SECRET in your environment for production.'
  );
}

async function getOrCreateAdmin() {
  let admin = await readData('admin', null);
  if (!admin) {
    const passwordHash = bcrypt.hashSync(DEFAULT_ADMIN_PASSWORD, 10);
    admin = { username: DEFAULT_ADMIN_USERNAME, passwordHash };
    await writeData('admin', admin);
    console.log('Created default admin account.');
    console.log(`  Username: ${DEFAULT_ADMIN_USERNAME}`);
    console.log(`  Password: ${DEFAULT_ADMIN_PASSWORD}`);
    console.log('  Change this by logging in and updating data/admin.json (or the "admin" KV key).');
  }
  return admin;
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

const app = express();

app.use(express.json());
app.use(cookieParser());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    cb(null, allowed.includes(path.extname(file.originalname).toLowerCase()));
  },
});

function isAdminRequest(req) {
  const token = req.cookies && req.cookies.admin_token;
  if (!token) return false;
  try {
    jwt.verify(token, JWT_SECRET);
    return true;
  } catch {
    return false;
  }
}

function requireAdmin(req, res, next) {
  if (!isAdminRequest(req)) return res.status(401).json({ error: 'Admin login required.' });
  next();
}

// ---------- Admin auth ----------

app.post(
  '/api/admin/login',
  asyncHandler(async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Missing credentials.' });
    }
    const admin = await getOrCreateAdmin();
    if (username !== admin.username || !bcrypt.compareSync(password, admin.passwordHash)) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }
    const token = jwt.sign({ isAdmin: true }, JWT_SECRET, { expiresIn: '8h' });
    res.cookie('admin_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 8 * 60 * 60 * 1000,
    });
    res.json({ ok: true });
  })
);

app.post('/api/admin/logout', (req, res) => {
  res.clearCookie('admin_token');
  res.json({ ok: true });
});

app.get('/api/admin/session', (req, res) => {
  res.json({ isAdmin: isAdminRequest(req) });
});

// ---------- Posts (blog reviews) ----------

app.get(
  '/api/posts',
  asyncHandler(async (req, res) => {
    const { type } = req.query;
    let posts = await readData('posts', []);
    if (type) posts = posts.filter((p) => p.type === type);
    posts.sort((a, b) => new Date(b.date) - new Date(a.date));
    res.json(posts);
  })
);

app.post(
  '/api/posts',
  requireAdmin,
  upload.single('photo'),
  asyncHandler(async (req, res) => {
    const { type, title, creator, date, review } = req.body || {};
    if (!type || !['book', 'movie'].includes(type) || !title || !creator || !date || !review) {
      return res.status(400).json({ error: 'Missing required fields.' });
    }
    const photo = req.file ? await savePhoto(req.file) : null;
    const posts = await readData('posts', []);
    const post = {
      id: uuidv4(),
      type,
      title,
      creator,
      date,
      review,
      photo,
      comments: [],
      createdAt: new Date().toISOString(),
    };
    posts.push(post);
    await writeData('posts', posts);
    res.status(201).json(post);
  })
);

app.post(
  '/api/posts/:id/comments',
  asyncHandler(async (req, res) => {
    const { name, text } = req.body || {};
    if (!name || !text) return res.status(400).json({ error: 'Missing name or text.' });
    const posts = await readData('posts', []);
    const post = posts.find((p) => p.id === req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found.' });
    const comment = { id: uuidv4(), name, text, date: new Date().toISOString() };
    post.comments.push(comment);
    await writeData('posts', posts);
    res.status(201).json(comment);
  })
);

app.delete(
  '/api/posts/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const posts = await readData('posts', []);
    const remaining = posts.filter((p) => p.id !== req.params.id);
    if (remaining.length === posts.length) {
      return res.status(404).json({ error: 'Post not found.' });
    }
    await writeData('posts', remaining);
    res.json({ ok: true });
  })
);

// ---------- Rankings ----------

app.get(
  '/api/rankings',
  asyncHandler(async (req, res) => {
    const { type, sort } = req.query;
    let rankings = await readData('rankings', []);
    if (type) rankings = rankings.filter((r) => r.type === type);
    if (sort === 'rating') {
      rankings.sort((a, b) => b.rating - a.rating);
    } else {
      rankings.sort((a, b) => new Date(b.date) - new Date(a.date));
    }
    res.json(rankings);
  })
);

app.post(
  '/api/rankings',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { type, title, rating } = req.body || {};
    const numericRating = Number(rating);
    if (!type || !['book', 'movie', 'story'].includes(type) || !title || Number.isNaN(numericRating)) {
      return res.status(400).json({ error: 'Missing required fields.' });
    }
    if (numericRating < 0 || numericRating > 1000) {
      return res.status(400).json({ error: 'Rating must be between 0 and 1000.' });
    }
    const rankings = await readData('rankings', []);
    const entry = {
      id: uuidv4(),
      type,
      title,
      rating: numericRating,
      date: new Date().toISOString(),
    };
    rankings.push(entry);
    await writeData('rankings', rankings);
    res.status(201).json(entry);
  })
);

app.delete(
  '/api/rankings/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const rankings = await readData('rankings', []);
    const remaining = rankings.filter((r) => r.id !== req.params.id);
    if (remaining.length === rankings.length) {
      return res.status(404).json({ error: 'Ranking entry not found.' });
    }
    await writeData('rankings', remaining);
    res.json({ ok: true });
  })
);

// ---------- Future watch/read list ----------

app.get(
  '/api/future',
  asyncHandler(async (req, res) => {
    const entries = await readData('future', []);
    entries.sort((a, b) => new Date(b.date) - new Date(a.date));
    res.json(entries);
  })
);

app.post(
  '/api/future',
  asyncHandler(async (req, res) => {
    const { category, title } = req.body || {};
    if (!category || !['book', 'movie'].includes(category) || !title) {
      return res.status(400).json({ error: 'Missing required fields.' });
    }

    const admin = isAdminRequest(req);
    let enteredBy;
    if (admin) {
      const adminRecord = await getOrCreateAdmin();
      enteredBy = adminRecord.username.charAt(0).toUpperCase() + adminRecord.username.slice(1);
    } else {
      enteredBy = (req.body && req.body.enteredBy || '').trim();
      if (!enteredBy) {
        return res.status(400).json({ error: 'Please enter your name.' });
      }
    }

    const entries = await readData('future', []);
    const entry = {
      id: uuidv4(),
      category,
      title,
      enteredBy,
      isAdmin: admin,
      completed: false,
      date: new Date().toISOString(),
    };
    entries.push(entry);
    await writeData('future', entries);
    res.status(201).json(entry);
  })
);

app.patch(
  '/api/future/:id/toggle-complete',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const entries = await readData('future', []);
    const entry = entries.find((e) => e.id === req.params.id);
    if (!entry) return res.status(404).json({ error: 'Entry not found.' });
    entry.completed = !entry.completed;
    await writeData('future', entries);
    res.json(entry);
  })
);

app.delete(
  '/api/future/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const entries = await readData('future', []);
    const remaining = entries.filter((e) => e.id !== req.params.id);
    if (remaining.length === entries.length) {
      return res.status(404).json({ error: 'Entry not found.' });
    }
    await writeData('future', remaining);
    res.json({ ok: true });
  })
);

app.use(express.static(path.join(__dirname, 'public')));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error.' });
});

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Andrew's Story Blog running at http://localhost:${PORT}`);
  });
}

module.exports = app;
