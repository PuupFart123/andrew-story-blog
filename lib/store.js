// Data storage abstraction: uses Vercel KV in production (persistent across
// serverless invocations), falls back to local JSON files for local dev so
// `npm start` works with zero cloud setup.

const fs = require('fs');
const path = require('path');

const useKV = !!process.env.KV_REST_API_URL;
const kv = useKV ? require('@vercel/kv').kv : null;

const DATA_DIR = path.join(__dirname, '..', 'data');

function localFile(key) {
  return path.join(DATA_DIR, `${key}.json`);
}

async function readData(key, fallback) {
  if (useKV) {
    const value = await kv.get(key);
    return value === null || value === undefined ? fallback : value;
  }
  const file = localFile(key);
  if (!fs.existsSync(file)) return fallback;
  const raw = fs.readFileSync(file, 'utf8').trim();
  return raw ? JSON.parse(raw) : fallback;
}

async function writeData(key, data) {
  if (useKV) {
    await kv.set(key, data);
    return;
  }
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(localFile(key), JSON.stringify(data, null, 2));
}

module.exports = { readData, writeData, useKV };
