// File: /Users/tomgrasser/Desktop/raetsel/api/cooldown-get.js
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { userId, puzzle, words } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'userId required' });
  if (!Array.isArray(words) || words.length === 0) {
    return res.status(400).json({ error: 'words[] required' });
  }

  const base = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!base || !token) return res.status(500).json({ error: 'missing redis env vars' });

  const ns = puzzle || 'classic';
  const keys = words.map(w => `cd:${userId}:${ns}:${w}`);
  const path = keys.map(k => encodeURIComponent(k)).join('/');
  const url = `${base}/mget/${path}`;

  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) {
      const details = await r.text().catch(() => '');
      return res.status(500).json({ error: 'redis error', details });
    }
    const payload = await r.json();
    const arr = Array.isArray(payload) ? payload : payload.result;
    const cooled = [];
    const map = {};
    for (let i = 0; i < words.length; i++) {
      const v = arr?.[i];
      const isCooldown = v !== null && v !== undefined; // any value counts
      map[words[i]] = !!isCooldown;
      if (isCooldown) cooled.push(words[i]);
    }
    return res.status(200).json({ cooled, map });
  } catch (err) {
    return res.status(500).json({ error: 'unexpected', details: String(err) });
  }
}

// File: /Users/tomgrasser/Desktop/raetsel/api/cooldown-set.js
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { userId, puzzle, words, ttlSeconds } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'userId required' });
  const list = Array.isArray(words) ? words : (typeof words === 'string' ? [words] : []);
  if (list.length === 0) return res.status(400).json({ error: 'words[] required' });

  const base = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!base || !token) return res.status(500).json({ error: 'missing redis env vars' });

  const ns = puzzle || 'classic';
  const ttl = Number(ttlSeconds || 86400); // default 24h

  try {
    await Promise.all(list.map(async (w) => {
      const key = `cd:${userId}:${ns}:${w}`;
      // SET key 1, then EXPIRE key ttl
      const setUrl = `${base}/set/${encodeURIComponent(key)}/1`;
      const expUrl = `${base}/expire/${encodeURIComponent(key)}/${ttl}`;
      const r1 = await fetch(setUrl, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      const r2 = await fetch(expUrl, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      if (!r1.ok || !r2.ok) {
        const d1 = await r1.text().catch(() => '');
        const d2 = await r2.text().catch(() => '');
        throw new Error(`redis error: ${d1} ${d2}`);
      }
    }));

    return res.status(204).end();
  } catch (err) {
    return res.status(500).json({ error: 'unexpected', details: String(err) });
  }
}

// File: /Users/tomgrasser/Desktop/raetsel/raetsel.html
// (partial content showing only the relevant changes)

// 1) Near the top of your main <script> (where globals are declared), insert:
function getUserId() {
  const KEY = 'puzzle_user_id_v1';
  let id = localStorage.getItem(KEY);
  if (!id) {
    // 16-byte random -> base36
    const arr = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(arr);
    id = Array.from(arr, b => b.toString(16).padStart(2,'0')).join('');
    localStorage.setItem(KEY, id);
  }
  return id;
}
const USER_ID = getUserId();

// 2) In the metrics scoring block, after computing w.rank for all words and before sorting, insert:
try {
  const resCd = await fetch('/api/cooldown-get', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: USER_ID, puzzle: puzzleType, words: wordList.map(w => w.word) })
  });
  if (resCd.ok) {
    const { map } = await resCd.json();
    const available = [];
    const cooled    = [];
    for (const w of wordList) {
      (map[w.word] ? cooled : available).push(w);
    }
    // keep variety: demote cooled words behind available
    wordList = available.concat(cooled);
  }
} catch(_) {}
// final sort by rank among each partition
wordList.sort((a,b) => (b.rank||0) - (a.rank||0));

// 3) After fresh generation (same block where you already call /api/appearance), replace:
generateWords();
// einmalig Appearances ...
try {
  const unique = [...new Set(words.map(w => w.word))];
  fetch('/api/appearance', { /* ... */ });
} catch (e) {}
saveState();

// with:
generateWords();
try {
  const unique = [...new Set(words.map(w => w.word))];
  // track appearances
  fetch('/api/appearance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ puzzle: puzzleType, words: unique })
  }).catch(() => {});
  // set per-user cooldown (24h)
  fetch('/api/cooldown-set', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: USER_ID, puzzle: puzzleType, words: unique, ttlSeconds: 86400 })
  }).catch(() => {});
} catch (e) {}
saveState();
