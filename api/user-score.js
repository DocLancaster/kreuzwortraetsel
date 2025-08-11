// api/user-score.js
// Returns per-user aggregated stats and recent scores
// Request: POST { userId }
// Response: { ok, totals: {completed, bestTimeMs, avgTimeMs, streak, maxStreak, totalScore, coins}, recent: { lastScores: number[], avgScore }, special: { history: { thisWeek: boolean, weekKey: string, lastWeek: string|null } } }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    // --- global counters branch ---
    const isGlobal = !!(req.body && req.body.global === true);
    if (isGlobal) {
      const base = process.env.UPSTASH_REDIS_REST_URL;
      const token = process.env.UPSTASH_REDIS_REST_TOKEN;
      if (!base || !token) return res.status(500).json({ error: 'missing redis env vars' });

      const keys = [
        'games:generated',
        'games:completed',
        'games:generated:classic',
        'games:completed:classic',
        'games:generated:history',
        'games:completed:history'
      ];
      const mgetUrl = `${base}/mget/${keys.map(encodeURIComponent).join('/')}`;
      const r = await fetch(mgetUrl, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) {
        const details = await r.text().catch(() => '');
        return res.status(500).json({ error: 'redis error (mget)', details });
      }
      const payload = await r.json();
      const arr = Array.isArray(payload) ? payload : payload.result;

      const g = (i) => toPosInt(arr?.[i], 0);

      // Optional timeseries for admin mini-charts
      const wantsTs = !!(req.body && req.body.timeseries === true);
      if (wantsTs) {
        const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
        const days = clamp(toPosInt(req.body && req.body.days, 7), 1, 30);
        // Build last N UTC dates as YYYY-MM-DD (matches key format used when writing)
        const dayStrings = [];
        {
          const start = new Date();
          start.setUTCHours(0,0,0,0);
          for (let i = days - 1; i >= 0; i--) {
            const d = new Date(start);
            d.setUTCDate(start.getUTCDate() - i);
            dayStrings.push(d.toISOString().slice(0,10));
          }
        }
        // Helper to mget an array of keys and coerce to ints
        async function mgetSeries(keys){
          if (!keys.length) return [];
          const url = `${base}/mget/${keys.map(encodeURIComponent).join('/')}`;
          const r2 = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
          if (!r2.ok) {
            const details = await r2.text().catch(()=>'');
            throw new Error(`redis error (mget ts): ${details}`);
          }
          const payload2 = await r2.json();
          const arr2 = Array.isArray(payload2) ? payload2 : payload2.result;
          return (arr2 || []).map(v => toPosInt(v, 0));
        }
        // Keys per series
        const genAllKeys     = dayStrings.map(d => `games:generated:${d}`);
        const genClassicKeys = dayStrings.map(d => `games:generated:classic:${d}`);
        const genHistoryKeys = dayStrings.map(d => `games:generated:history:${d}`);
        const compAllKeys     = dayStrings.map(d => `games:completed:${d}`);
        const compClassicKeys = dayStrings.map(d => `games:completed:classic:${d}`);
        const compHistoryKeys = dayStrings.map(d => `games:completed:history:${d}`);
        // Fetch in parallel (6 mget calls)
        const [
          genAll, genClassic, genHistory,
          compAll, compClassic, compHistory
        ] = await Promise.all([
          mgetSeries(genAllKeys),
          mgetSeries(genClassicKeys),
          mgetSeries(genHistoryKeys),
          mgetSeries(compAllKeys),
          mgetSeries(compClassicKeys),
          mgetSeries(compHistoryKeys)
        ]);
        return res.status(200).json({
          ok: true,
          global: {
            generated: g(0),
            completed: g(1),
            byPuzzle: {
              classic: { generated: g(2), completed: g(3) },
              history: { generated: g(4), completed: g(5) }
            }
          },
          timeseries: {
            days: dayStrings,
            generated: { total: genAll, classic: genClassic, history: genHistory },
            completed: { total: compAll, classic: compClassic, history: compHistory }
          }
        });
      }

      return res.status(200).json({
        ok: true,
        global: {
          generated: g(0),
          completed: g(1),
          byPuzzle: {
            classic: { generated: g(2), completed: g(3) },
            history: { generated: g(4), completed: g(5) }
          }
        }
      });
    }
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId required' });

    const base = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!base || !token) return res.status(500).json({ error: 'missing redis env vars' });

    const P = (k) => `usr:${userId}:${k}`;
    const keys = [
      P('completed'),                 // 0
      P('dur'),                       // 1
      P('best'),                      // 2
      P('streak'),                    // 3
      P('maxstreak'),                 // 4
      P('scoreTotal'),                // 5
      P('coins'),                     // 6
      P('special:history:lastWeek')   // 7
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

    const lastWeekKey = (arr?.[7] ?? null) || null;
    const thisWeekKey = isoWeekKeyBerlin(Date.now());
    const thisWeekDone = !!(lastWeekKey && thisWeekKey && lastWeekKey === thisWeekKey);

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
      ,
      special: { history: { thisWeek: thisWeekDone, weekKey: thisWeekKey, lastWeek: lastWeekKey } }
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

const DAY_MS = 24*60*60*1000;
function isoWeekKeyBerlin(t){
  try{
    const { y, m, d } = berlinYMD(t);
    const wk = isoWeekFromYMD(y, m, d);
    return `${wk.year}-W${String(wk.week).padStart(2,'0')}`;
  }catch(_){ return null; }
}
function berlinYMD(t){
  const dtf = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' });
  const parts = dtf.formatToParts(new Date(t));
  const map = Object.create(null);
  for (const p of parts) map[p.type] = p.value;
  return { y: parseInt(map.year,10), m: parseInt(map.month,10), d: parseInt(map.day,10) };
}
function isoWeekFromYMD(y, m, d){
  // Treat the given Y-M-D as a local (Berlin) date anchored at UTC midnight for stable math
  const date = new Date(Date.UTC(y, m-1, d));
  const day = date.getUTCDay(); // 0..6, Sun..Sat
  // Shift to Thursday in current week to determine ISO year
  const thursday = new Date(date);
  const diffMon = (day + 6) % 7; // Mon=0
  thursday.setUTCDate(date.getUTCDate() - diffMon + 3);
  const isoYear = thursday.getUTCFullYear();
  // Monday of week 1: the Monday of the week that contains Jan 4th
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4Day = (jan4.getUTCDay() + 6) % 7; // Mon=0
  const week1Mon = new Date(jan4);
  week1Mon.setUTCDate(jan4.getUTCDate() - jan4Day);
  const week = Math.floor((date - week1Mon) / (7*DAY_MS)) + 1;
  return { year: isoYear, week };
}