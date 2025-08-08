

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { puzzle, words } = req.body || {};
  if (!Array.isArray(words) || words.length === 0) {
    return res.status(400).json({ error: 'words[] required' });
  }

  const base = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!base || !token) {
    return res.status(500).json({ error: 'missing redis env vars' });
  }

  const ns = puzzle || 'classic';

  // Keys: ratingSum, ratingCount, flag
  const sumKeys  = words.map(w => `ratingSum:${ns}:${w}`);
  const cntKeys  = words.map(w => `ratingCount:${ns}:${w}`);
  const flagKeys = words.map(w => `flag:${ns}:${w}`);
  const allKeys  = [...sumKeys, ...cntKeys, ...flagKeys];

  // Build /mget path: /mget/key1/key2/...
  const mgetPath = allKeys.map(k => encodeURIComponent(k)).join('/');
  const url = `${base}/mget/${mgetPath}`;

  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) {
      const details = await r.text().catch(() => '');
      return res.status(500).json({ error: 'redis error', details });
    }

    const payload = await r.json();
    const arr = Array.isArray(payload) ? payload : payload.result; // Upstash returns {result:[...]}
    const n = words.length;

    const out = {};
    for (let i = 0; i < words.length; i++) {
      const sum   = parseInt(arr?.[i]          ?? '0', 10);
      const count = parseInt(arr?.[i + n]      ?? '0', 10);
      const flags = parseInt(arr?.[i + 2 * n]  ?? '0', 10);
      out[words[i]] = {
        ratingSum: sum,
        ratingCount: count,
        avgRating: count ? (sum / count) : 0,
        flags
      };
    }

    return res.status(200).json(out);
  } catch (err) {
    return res.status(500).json({ error: 'unexpected', details: String(err) });
  }
}