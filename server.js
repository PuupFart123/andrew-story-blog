const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
const POSTS_FILE = path.join(DATA_DIR, 'posts.json');
const RANKINGS_FILE = path.join(DATA_DIR, 'rankings.json');
const ADMIN_FILE = path.join(DATA_DIR, 'admin.json');

const DEFAULT_ADMIN_USERNAME = 'andrew';
const DEFAULT_ADMIN_PASSWORD = 'andrew123';

function readJSON(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  const raw = fs.readFileSync(file, 'utf8').trim();
  if (!raw) return fallback;
  return JSON.parse(raw);
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(POSTS_FILE)) writeJSON(POSTS_FILE, []);
if (!fs.existsSync(RANKINGS_FILE)) writeJSON(RANKINGS_FILE, []);
if (!fs.existsSync(ADMIN_FILE)) {
  const passwordHash = bcrypt.hashSync(DEFAULT_ADMIN_PASSWORD, 10);
  writeJSON(ADMIN_FILE, { username: DEFAULT_ADMIN_USERNAME, passwordHash });
  console.log('Created default admin account.');
  console.log(`  Username: ${DEFAULT_ADMIN_USERNAME}`);
  console.log(`  Password: ${DEFAULT_ADMIN_PASSWORD}`);
  console.log('  Change this by editing data/admin.json (delete it to regenerate).');
}

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

app.use(express.json());
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 1000 * 60 * 60 * 8 },
}));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    cb(null, allowed.includes(path.extname(file.originalname).toLowerCase()));
  },
});

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.status(401).json({ error: 'Admin login required.' });
}

// ---------- Admin auth ----------

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body || {};
  const admin = readJSON(ADMIN_FILE, null);
  if (!admin || !username || !password) {
    return res.status(400).json({ error: 'Missing credentials.' });
  }
  if (username !== admin.username || !bcrypt.compareSync(password, admin.passwordHash)) {
    return res.status(401).json({ error: 'Invalid username or password.' });
  }
  req.session.isAdmin = true;
  res.json({ ok: true });
});

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/admin/session', (req, res) => {
  res.json({ isAdmin: !!(req.session && req.session.isAdmin) });
});

// ---------- Posts (blog reviews) ----------

app.get('/api/posts', (req, res) => {
  const { type } = req.query;
  let posts = readJSON(POSTS_FILE, []);
  if (type) posts = posts.filter((p) => p.type === type);
  posts.sort((a, b) => new Date(b.date) - new Date(a.date));
  res.json(posts);
});

app.post('/api/posts', requireAdmin, upload.single('photo'), (req, res) => {
  const { type, title, creator, date, review } = req.body || {};
  if (!type || !['book', 'movie'].includes(type) || !title || !creator || !date || !review) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }
  const posts = readJSON(POSTS_FILE, []);
  const post = {
    id: uuidv4(),
    type,
    title,
    creator,
    date,
    review,
    photo: req.file ? `/uploads/${req.file.filename}` : null,
    comments: [],
    createdAt: new Date().toISOString(),
  };
  posts.push(post);
  writeJSON(POSTS_FILE, posts);
  res.status(201).json(post);
});

app.post('/api/posts/:id/comments', (req, res) => {
  const { name, text } = req.body || {};
  if (!name || !text) return res.status(400).json({ error: 'Missing name or text.' });
  const posts = readJSON(POSTS_FILE, []);
  const post = posts.find((p) => p.id === req.params.id);
  if (!post) return res.status(404).json({ error: 'Post not found.' });
  const comment = { id: uuidv4(), name, text, date: new Date().toISOString() };
  post.comments.push(comment);
  writeJSON(POSTS_FILE, posts);
  res.status(201).json(comment);
});

// ---------- Rankings ----------

app.get('/api/rankings', (req, res) => {
  const { type, sort } = req.query;
  let rankings = readJSON(RANKINGS_FILE, []);
  if (type) rankings = rankings.filter((r) => r.type === type);
  if (sort === 'rating') {
    rankings.sort((a, b) => b.rating - a.rating);
  } else {
    rankings.sort((a, b) => new Date(b.date) - new Date(a.date));
  }
  res.json(rankings);
});

app.post('/api/rankings', requireAdmin, (req, res) => {
  const { type, title, rating } = req.body || {};
  const numericRating = Number(rating);
  if (!type || !['book', 'movie'].includes(type) || !title || Number.isNaN(numericRating)) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }
  if (numericRating < 0 || numericRating > 1000) {
    return res.status(400).json({ error: 'Rating must be between 0 and 1000.' });
  }
  const rankings = readJSON(RANKINGS_FILE, []);
  const entry = {
    id: uuidv4(),
    type,
    title,
    rating: numericRating,
    date: new Date().toISOString(),
  };
  rankings.push(entry);
  writeJSON(RANKINGS_FILE, rankings);
  res.status(201).json(entry);
});

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`Andrew's Story Blog running at http://localhost:${PORT}`);
});
