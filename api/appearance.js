export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { id, ids, word, words, puzzle, gameStart } = req.body || {};
  const idList = Array.isArray(ids) ? ids : (id ? [id] : []);
  const wordList = Array.isArray(words) ? words : (word ? [word] : []);

  if (idList.length === 0 && wordList.length === 0) {
    return res.status(400).json({ error: 'ids[] or words[] required' });
  }

  const base = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!base || !token) return res.status(500).json({ error: 'missing redis env vars' });

  const ns = puzzle || 'classic';
  try {
    const tasks = [];
    // New: count by ID (separate namespace)
    for (const i of idList) {
      const key = `appearId:${ns}:${i}`;
      tasks.push(
        fetch(`${base}/incr/${encodeURIComponent(key)}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` }
        })
      );
    }
    // Legacy: also count by word for backward compatibility
    for (const w of wordList) {
      const key = `appear:${ns}:${w}`;
      tasks.push(
        fetch(`${base}/incr/${encodeURIComponent(key)}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` }
        })
      );
    }

    await Promise.all(tasks);
    // If this call marks the start of a new generated game, bump global counters
    try {
      if (gameStart) {
        const keyAll = 'games:generated';
        const keyNs  = `games:generated:${ns}`;
        await Promise.all([
          fetch(`${base}/incr/${encodeURIComponent(keyAll)}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` }
          }),
          fetch(`${base}/incr/${encodeURIComponent(keyNs)}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` }
          })
        ]);
        // Also bump day-based keys for timeseries charts (YYYY-MM-DD)
        const day = new Date().toISOString().slice(0,10); // e.g., "2025-08-11"
        const keyAllDay = `games:generated:${day}`;
        const keyNsDay  = `games:generated:${ns}:${day}`;
        await Promise.all([
          fetch(`${base}/incr/${encodeURIComponent(keyAllDay)}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` }
          }),
          fetch(`${base}/incr/${encodeURIComponent(keyNsDay)}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` }
          })
        ]);
      }
    } catch(_e) {
      // non-fatal
    }
    return res.status(204).end();
  } catch (err) {
    return res.status(500).json({ error: 'unexpected', details: String(err) });
  }
}
