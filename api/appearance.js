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
  const puzzleQuality = sanitizeQuality(req.body && req.body.puzzleQuality);
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
        if (puzzleQuality) {
          await recordQuality(base, token, ns, puzzleQuality, day);
        }
      }
    } catch(_e) {
      // non-fatal
    }
    return res.status(204).end();
  } catch (err) {
    return res.status(500).json({ error: 'unexpected', details: String(err) });
  }
}

async function recordQuality(base, token, ns, quality, day) {
  const updates = [
    [`quality:generated:count:${ns}`, 1],
    [`quality:generated:score:${ns}`, quality.score],
    [`quality:generated:words:${ns}`, quality.words],
    [`quality:generated:crossings:${ns}`, quality.crossingCells],
    [`quality:generated:balanceGap:${ns}`, quality.balanceGap],
    [`quality:generated:densityPermille:${ns}`, quality.densityPermille],
    [`quality:generated:count:${ns}:${day}`, 1],
    [`quality:generated:score:${ns}:${day}`, quality.score],
    [`quality:generated:words:${ns}:${day}`, quality.words],
    [`quality:generated:crossings:${ns}:${day}`, quality.crossingCells],
    [`quality:generated:balanceGap:${ns}:${day}`, quality.balanceGap],
    [`quality:generated:densityPermille:${ns}:${day}`, quality.densityPermille]
  ];
  const tasks = updates.map(([key, amount]) => fetch(`${base}/incrby/${encodeURIComponent(key)}/${amount}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  }));
  tasks.push(fetch(`${base}/set/${encodeURIComponent(`quality:generated:last:${ns}`)}/${encodeURIComponent(JSON.stringify(quality))}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  }));
  await Promise.all(tasks);
}

function sanitizeQuality(input) {
  if (!input || typeof input !== 'object') return null;
  const density = typeof input.density === 'number' ? input.density : parseFloat(input.density || '0');
  return {
    score: clamp(toPosInt(input.score, 0), 0, 100),
    words: toPosInt(input.words, 0),
    horizontal: toPosInt(input.horizontal, 0),
    vertical: toPosInt(input.vertical, 0),
    balanceGap: toPosInt(input.balanceGap, 0),
    filledCells: toPosInt(input.filledCells, 0),
    densityPermille: clamp(Math.round((Number.isFinite(density) ? density : 0) * 1000), 0, 1000),
    crossingCells: toPosInt(input.crossingCells, 0),
    crossingLinks: toPosInt(input.crossingLinks, 0),
    components: toPosInt(input.components, 0)
  };
}

function toPosInt(value, fallback) {
  const n = typeof value === 'string' ? parseInt(value, 10) : (typeof value === 'number' ? value : fallback);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
