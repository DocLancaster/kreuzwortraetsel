import fs from 'fs/promises';
import path from 'path';

const CUSTOM_IDS_KEY = 'customWords:ids';
const CUSTOM_WORD_PREFIX = 'customWord:';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  try {
    const filePath = path.join(process.cwd(), 'words.json');
    const baseWords = JSON.parse(await fs.readFile(filePath, 'utf8'));
    const customWords = await readCustomWords();
    const merged = mergeWords(baseWords, customWords);

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(merged);
  } catch (err) {
    return res.status(500).json({ error: 'words unavailable', details: String(err) });
  }
}

async function readCustomWords() {
  const base = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!base || !token) return [];

  const idsRes = await fetch(`${base}/smembers/${encodeURIComponent(CUSTOM_IDS_KEY)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!idsRes.ok) return [];

  const idsPayload = await idsRes.json();
  const ids = Array.isArray(idsPayload) ? idsPayload : idsPayload.result;
  if (!Array.isArray(ids) || !ids.length) return [];

  const keys = ids.map(id => `${CUSTOM_WORD_PREFIX}${id}`);
  const wordsRes = await fetch(`${base}/mget/${keys.map(encodeURIComponent).join('/')}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!wordsRes.ok) return [];

  const wordsPayload = await wordsRes.json();
  const values = Array.isArray(wordsPayload) ? wordsPayload : wordsPayload.result;
  return (values || [])
    .map(parseStoredWord)
    .filter(Boolean)
    .filter(w => w.active !== false);
}

function parseStoredWord(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(decodeURIComponent(String(raw)));
  } catch (_) {
    try { return JSON.parse(String(raw)); } catch (_err) { return null; }
  }
}

function mergeWords(baseWords, customWords) {
  const seen = new Set();
  const out = [];
  for (const word of [...customWords, ...baseWords]) {
    const key = String(word.word || word.id || '').toUpperCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(word);
  }
  return out;
}
