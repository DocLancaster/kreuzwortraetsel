

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