export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { userId, puzzle, words, ids } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'userId required' });

  const listW = Array.isArray(words) ? words : [];
  const listI = Array.isArray(ids) ? ids : [];
  if (listW.length === 0 && listI.length === 0) {
    return res.status(400).json({ error: 'ids[] or words[] required' });
  }

  const base = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!base || !token) return res.status(500).json({ error: 'missing redis env vars' });

  const ns = puzzle || 'classic';

  // ID-first keys (separate namespace), plus legacy word keys for fallback.
  const keysId = listI.map(id => `cdId:${userId}:${ns}:${id}`);
  const keysW = listW.map(w => `cd:${userId}:${ns}:${w}`);
  const allKeys = [...keysId, ...keysW];
  const path = allKeys.map(k => encodeURIComponent(k)).join('/');
  const url = `${base}/mget/${path}`;

  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) {
      const details = await r.text().catch(() => '');
      return res.status(500).json({ error: 'redis error', details });
    }

    const payload = await r.json();
    const arr = Array.isArray(payload) ? payload : payload.result;
    const map = {};
    const cooled = [];

    // First map IDs.
    for (let i = 0; i < listI.length; i++) {
      const v = arr?.[i];
      const isCd = v !== null && v !== undefined;
      map[listI[i]] = !!isCd;
      if (isCd) cooled.push(listI[i]);
    }

    // Then map words (offset after ids).
    const off = listI.length;
    for (let j = 0; j < listW.length; j++) {
      const v = arr?.[off + j];
      const isCd = v !== null && v !== undefined;
      map[listW[j]] = !!isCd;
      if (isCd) cooled.push(listW[j]);
    }

    return res.status(200).json({ cooled, map });
  } catch (err) {
    return res.status(500).json({ error: 'unexpected', details: String(err) });
  }
}
