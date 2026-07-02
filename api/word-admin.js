import crypto from 'crypto';
import { requireAdmin } from './_lib/admin-auth.js';

const CUSTOM_IDS_KEY = 'customWords:ids';
const CUSTOM_WORD_PREFIX = 'customWord:';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (!requireAdmin(req, res)) return;

  const { action } = req.body || {};
  const base = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!base || !token) return res.status(500).json({ error: 'missing redis env vars' });

  try {
    if (action === 'add') {
      const entry = normalizeEntry(req.body || {});
      const value = encodeURIComponent(JSON.stringify(entry));
      const key = `${CUSTOM_WORD_PREFIX}${entry.id}`;
      const results = await Promise.all([
        fetch(`${base}/set/${encodeURIComponent(key)}/${value}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` }
        }),
        fetch(`${base}/sadd/${encodeURIComponent(CUSTOM_IDS_KEY)}/${encodeURIComponent(entry.id)}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` }
        })
      ]);
      const bad = results.find(r => !r.ok);
      if (bad) {
        const details = await bad.text().catch(() => '');
        return res.status(500).json({ error: 'redis error', details });
      }
      return res.status(200).json({ ok: true, word: entry });
    }

    return res.status(400).json({ error: 'unknown action' });
  } catch (err) {
    return res.status(400).json({ error: 'invalid word', details: String(err.message || err) });
  }
}

function normalizeEntry(body) {
  const word = normalizeWord(body.word);
  const clue = String(body.clue || '').trim();
  if (!word || word.length < 2) throw new Error('Wort muss mindestens 2 Zeichen haben.');
  if (word.length > 20) throw new Error('Wort ist zu lang.');
  if (!/^[A-ZÄÖÜ]+$/.test(word)) throw new Error('Wort darf nur Buchstaben enthalten.');
  if (!clue || clue.length < 4) throw new Error('Hinweis ist zu kurz.');

  const themes = normalizeThemes(body.themes, body.extraThemes);
  const id = makeCustomId(word, clue);
  return {
    id,
    word,
    clue,
    themes,
    baseDifficulty: toDifficulty(body.baseDifficulty),
    userRatingAvg: 0,
    userRatingCount: 0,
    flagCount: 0,
    usedCount: 0,
    firstTryCorrect: 0,
    avgHintRequests: 0,
    source: 'admin',
    active: true,
    createdAt: new Date().toISOString()
  };
}

function normalizeWord(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/ß/g, 'SS')
    .replace(/\s+/g, '');
}

function normalizeThemes(themes, extraThemes) {
  const list = [];
  if (Array.isArray(themes)) list.push(...themes);
  if (typeof themes === 'string') list.push(...themes.split(','));
  if (typeof extraThemes === 'string') list.push(...extraThemes.split(','));
  return [...new Set(list
    .map(v => String(v || '').trim().toLowerCase())
    .filter(Boolean)
    .map(v => v.replace(/\s+/g, '-'))
  )];
}

function toDifficulty(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(5, Math.round(n)));
}

function makeCustomId(word, clue) {
  const hash = crypto.createHash('sha1').update(`${word}|${clue}`).digest('hex').slice(0, 10);
  return `cw${hash}`;
}
