export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { word, words, puzzle } = req.body || {};
  const list = Array.isArray(words) ? words : (word ? [word] : []);
  if (list.length === 0) return res.status(400).json({ error: 'word(s) required' });

  const base = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!base || !token) return res.status(500).json({ error: 'missing redis env vars' });

  const ns = puzzle || 'classic';
  try {
    await Promise.all(
      list.map(w =>
        fetch(`${base}/incr/${encodeURIComponent(`appear:${ns}:${w}`)}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` }
        })
      )
    );
    return res.status(204).end();
  } catch (err) {
    return res.status(500).json({ error: 'unexpected', details: String(err) });
  }
}
