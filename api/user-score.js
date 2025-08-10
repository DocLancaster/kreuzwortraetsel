

// api/user-score.js
// Returns per-user aggregated stats and recent scores
// Request: POST { userId }
// Response: { ok, totals: {completed, bestTimeMs, avgTimeMs, streak, maxStreak, totalScore, coins}, recent: { lastScores: number[], avgScore } }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId required' });

    const base = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!base || !token) return res.status(500).json({ error: 'missing redis env vars' });

    const P = (k) => `usr:${userId}:${k}`;
    const keys = [
      P('completed'), // 0
      P('dur'),       // 1
      P('best'),      // 2
      P('streak'),    // 3
      P('maxstreak'), // 4
      P('scoreTotal'),// 5
      P('coins')      // 6
    ];

    const mgetUrl = `${base}/mget/${keys.map(encodeURIComponent).join('/')}`;
    const r = await fetch(mgetUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) {
      const details = await r.text().catch(() => '');
      return res.status(500).json({ error: 'redis error (mget)', details });
    }
    const payload = await r.json();
    const arr = Array.isArray(payload) ? payload : payload.result;

    const completed = toPosInt(arr?.[0], 0);
    const dur = toPosInt(arr?.[1], 0);
    const best = toPosInt(arr?.[2], 0);
    const streak = toPosInt(arr?.[3], 0);
    const maxStreak = toPosInt(arr?.[4], 0);
    const totalScore = toPosInt(arr?.[5], 0);
    const coins = toPosInt(arr?.[6], 0);

    const avgTimeMs = completed > 0 ? Math.round(dur / completed) : 0;
    const avgScore = completed > 0 ? round2(totalScore / completed) : 0;

    // Get last 10 scores (most recent first)
    const lrUrl = `${base}/lrange/${encodeURIComponent(P('scores'))}/0/9`;
    const lr = await fetch(lrUrl, { headers: { Authorization: `Bearer ${token}` } });
    let lastScores = [];
    if (lr.ok) {
      const l = await lr.json();
      const list = Array.isArray(l) ? l : l.result;
      if (Array.isArray(list)) lastScores = list.map((x) => toPosInt(x, 0));
    }

    return res.status(200).json({
      ok: true,
      totals: { completed, bestTimeMs: best, avgTimeMs, streak, maxStreak, totalScore, coins },
      recent: { lastScores, avgScore }
    });
  } catch (err) {
    return res.status(500).json({ error: 'unexpected', details: String(err) });
  }
}

// --- helpers ---
function toPosInt(v, dflt){
  const n = typeof v === 'string' ? parseInt(v, 10) : (typeof v === 'number' ? v : dflt);
  if (!isFinite(n) || n < 0) return dflt;
  return Math.floor(n);
}
function round2(x){ return Math.round((x + Number.EPSILON) * 100) / 100; }