

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { userId, puzzle, ids, words, ttlSeconds } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'userId required' });

  const listI = Array.isArray(ids) ? ids : (ids ? [ids] : []);
  const listW = Array.isArray(words) ? words : (typeof words === 'string' ? [words] : []);
  if (listI.length === 0 && listW.length === 0) {
    return res.status(400).json({ error: 'ids[] or words[] required' });
  }

  const base = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!base || !token) return res.status(500).json({ error: 'missing redis env vars' });

  const ns = puzzle || 'classic';
  const ttl = Number(ttlSeconds || 86400); // default 24h

  try {
    const tasks = [];

    // New: per-user cooldown keyed by ID
    for (const id of listI) {
      const key = `cdId:${userId}:${ns}:${id}`;
      const setUrl = `${base}/set/${encodeURIComponent(key)}/1`;
      const expUrl = `${base}/expire/${encodeURIComponent(key)}/${ttl}`;
      tasks.push(fetch(setUrl, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }));
      tasks.push(fetch(expUrl, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }));
    }

    // Legacy: keep word-based cooldowns for backward compatibility
    for (const w of listW) {
      const key = `cd:${userId}:${ns}:${w}`;
      const setUrl = `${base}/set/${encodeURIComponent(key)}/1`;
      const expUrl = `${base}/expire/${encodeURIComponent(key)}/${ttl}`;
      tasks.push(fetch(setUrl, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }));
      tasks.push(fetch(expUrl, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }));
    }

    const results = await Promise.all(tasks);
    const bad = results.find(r => !r.ok);
    if (bad) {
      const d = await bad.text().catch(() => '');
      throw new Error(`redis error: ${d}`);
    }

    return res.status(204).end();
  } catch (err) {
    return res.status(500).json({ error: 'unexpected', details: String(err) });
  }
}