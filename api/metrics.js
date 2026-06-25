const MAX_METRICS_WORDS = 250;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // Accept optional ids[] parallel to words[]; keep words[] for output keys.
  const { puzzle, words, ids } = req.body || {};
  if (!Array.isArray(words) || words.length === 0) {
    return res.status(400).json({ error: 'words[] required' });
  }

  const base = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!base || !token) {
    return res.status(500).json({ error: 'missing redis env vars' });
  }

  const requestLimit = Math.min(words.length, MAX_METRICS_WORDS);
  const wordsForLookup = words.slice(0, requestLimit);
  const idsForLookup = Array.isArray(ids) ? ids.slice(0, requestLimit) : [];
  const ns = puzzle || 'classic';
  const hasIds = Array.isArray(ids) && ids.length === words.length;

  // The client can send the complete dictionary. Looking up metrics for every
  // word creates very large Upstash /mget URLs and delays puzzle generation.
  // Only the first ranked window is needed for generation quality; missing
  // words fall back to neutral client-side defaults.
  const sumKeysId = hasIds ? idsForLookup.map(v => `ratingSumId:${ns}:${v}`) : [];
  const cntKeysId = hasIds ? idsForLookup.map(v => `ratingCountId:${ns}:${v}`) : [];
  const flagKeysId = hasIds ? idsForLookup.map(v => `flagId:${ns}:${v}`) : [];
  const appearKeysId = hasIds ? idsForLookup.map(v => `appearId:${ns}:${v}`) : [];

  const sumKeysW = wordsForLookup.map(w => `ratingSum:${ns}:${w}`);
  const cntKeysW = wordsForLookup.map(w => `ratingCount:${ns}:${w}`);
  const flagKeysW = wordsForLookup.map(w => `flag:${ns}:${w}`);
  const appearKeysW = wordsForLookup.map(w => `appear:${ns}:${w}`);

  const idKeys = hasIds ? [...sumKeysId, ...cntKeysId, ...flagKeysId, ...appearKeysId] : [];
  const wordKeys = [...sumKeysW, ...cntKeysW, ...flagKeysW, ...appearKeysW];
  const allKeys = [...idKeys, ...wordKeys];

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

    const n = wordsForLookup.length;
    const out = {};

    const num = (v) => (v === null || v === undefined) ? 0 : parseInt(v, 10) || 0;

    for (let i = 0; i < n; i++) {
      let sum, count, flags, appear;

      if (hasIds) {
        const idSum = arr?.[i];
        const idCount = arr?.[i + n];
        const idFlags = arr?.[i + 2 * n];
        const idAppear = arr?.[i + 3 * n];

        const idHasAny = (idSum !== null && idSum !== undefined)
                       || (idCount !== null && idCount !== undefined)
                       || (idFlags !== null && idFlags !== undefined)
                       || (idAppear !== null && idAppear !== undefined);

        if (idHasAny) {
          sum = num(idSum);
          count = num(idCount);
          flags = num(idFlags);
          appear = num(idAppear);
        } else {
          const off = 4 * n; // word block starts after id block
          sum = num(arr?.[off + i]);
          count = num(arr?.[off + i + n]);
          flags = num(arr?.[off + i + 2 * n]);
          appear = num(arr?.[off + i + 3 * n]);
        }
      } else {
        sum = num(arr?.[i]);
        count = num(arr?.[i + n]);
        flags = num(arr?.[i + 2 * n]);
        appear = num(arr?.[i + 3 * n]);
      }

      const flagRate = appear > 0 ? (flags / appear) : 0;
      out[wordsForLookup[i]] = {
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
