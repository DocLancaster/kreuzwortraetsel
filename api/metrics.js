export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // Accept optional ids[] parallel to words[]; keep words[] for output keys
  const { puzzle, words, ids } = req.body || {};
  if (!Array.isArray(words) || words.length === 0) {
    return res.status(400).json({ error: 'words[] required' });
  }

  const base = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!base || !token) {
    return res.status(500).json({ error: 'missing redis env vars' });
  }

  const ns = puzzle || 'classic';
  const hasIds = Array.isArray(ids) && ids.length === words.length;

  // Build key lists: ID-first (new) and word-based (legacy fallback)
  const sumKeysId     = hasIds ? ids.map(v => `ratingSumId:${ns}:${v}`)   : [];
  const cntKeysId     = hasIds ? ids.map(v => `ratingCountId:${ns}:${v}`): [];
  const flagKeysId    = hasIds ? ids.map(v => `flagId:${ns}:${v}`)       : [];
  const appearKeysId  = hasIds ? ids.map(v => `appearId:${ns}:${v}`)     : [];

  const sumKeysW      = words.map(w => `ratingSum:${ns}:${w}`);
  const cntKeysW      = words.map(w => `ratingCount:${ns}:${w}`);
  const flagKeysW     = words.map(w => `flag:${ns}:${w}`);
  const appearKeysW   = words.map(w => `appear:${ns}:${w}`);

  const idKeys   = hasIds ? [...sumKeysId, ...cntKeysId, ...flagKeysId, ...appearKeysId] : [];
  const wordKeys = [...sumKeysW, ...cntKeysW, ...flagKeysW, ...appearKeysW];
  const allKeys  = [...idKeys, ...wordKeys];

  // Build /mget path
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

    // Helper to parse numbers safely from Upstash mget values
    const num = (v) => (v === null || v === undefined) ? 0 : parseInt(v, 10) || 0;

    for (let i = 0; i < n; i++) {
      let sum, count, flags, appear;

      if (hasIds) {
        const idSum    = arr?.[i];
        const idCount  = arr?.[i + n];
        const idFlags  = arr?.[i + 2 * n];
        const idAppear = arr?.[i + 3 * n];

        const idHasAny = (idSum !== null && idSum !== undefined)
                       || (idCount !== null && idCount !== undefined)
                       || (idFlags !== null && idFlags !== undefined)
                       || (idAppear !== null && idAppear !== undefined);

        if (idHasAny) {
          sum    = num(idSum);
          count  = num(idCount);
          flags  = num(idFlags);
          appear = num(idAppear);
        } else {
          // fallback to legacy word keys
          const off = hasIds ? (4 * n) : 0; // word block starts after id block
          sum    = num(arr?.[off + i]);
          count  = num(arr?.[off + i + n]);
          flags  = num(arr?.[off + i + 2 * n]);
          appear = num(arr?.[off + i + 3 * n]);
        }
      } else {
        // Only word keys requested
        sum    = num(arr?.[i]);
        count  = num(arr?.[i + n]);
        flags  = num(arr?.[i + 2 * n]);
        appear = num(arr?.[i + 3 * n]);
      }

      const flagRate = appear > 0 ? (flags / appear) : 0;
      out[words[i]] = {
        ratingSum: sum,
        ratingCount: count,
        avgRating: count ? (sum / count) : 0,
        flags,
        appear,
        flagRate
      };
    }

    return res.status(200).json(out);
  } catch (err) {
    return res.status(500).json({ error: 'unexpected', details: String(err) });
  }
}