

// api/user-submit.js
// Stores per-user progress and rewards after a puzzle is completed.
// - Computes a per-puzzle score (0..100) if not provided
// - Increments monotonic total score and coins (10 coins per 100 score)
// - Updates usage stats (completed, duration, reveals, checks, wrong, letters)
// - Maintains best time and daily streak

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const body = req.body || {};
  const userId = body.userId;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  // Inputs (all optional except userId)
  const puzzle = body.puzzle || 'classic'; // kept for future namespacing if needed
  const themes = Array.isArray(body.themes) ? body.themes : (typeof body.themes === 'string' ? body.themes.split(',') : []);
  const durationMs = toPosInt(body.durationMs, 0);
  const revealsUsed = toPosInt(body.revealsUsed, 0);
  const checks = toPosInt(body.checks, 0);
  const wrongCells = toPosInt(body.wrongCells, 0);
  const wordsCount = toPosInt(body.wordsCount, 0);
  const lettersCount = toPosInt(body.lettersCount, 0);
  const clientScore = toPosInt(body.puzzleScore, -1);
  const completedAt = isFinite(body.completedAt) ? Number(body.completedAt) : Date.now();

  // Compute score if client didn’t provide or it’s out of range
  const computedScore = computeScore({ durationMs, revealsUsed, wrongCells, lettersCount });
  const score = (clientScore >= 0 && clientScore <= 100) ? clientScore : computedScore;
  const scoreRounded = Math.max(0, Math.min(100, Math.round(score)));
  const coinsEarned = Math.floor(scoreRounded / 10); // 10 coins per 100 score
  const isHistorySpecial = (puzzle === 'history') || (Array.isArray(themes) && themes.includes('history'));

  const base = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!base || !token) {
    return res.status(500).json({ error: 'missing redis env vars' });
  }

  // Namespacing keys (global per user; can be extended with :theme later)
  const P = (k) => `usr:${userId}:${k}`;

  // Fetch current aggregates needed for streak & best calculations
  const keysToGet = [
    P('best'), P('lastDate'), P('streak'), P('maxstreak'),
    P('completed'), P('dur'), P('scoreTotal'), P('coins')
  ];

  const mgetUrl = `${base}/mget/${keysToGet.map(encodeURIComponent).join('/')}`;

  try {
    const r = await fetch(mgetUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) {
      const details = await r.text().catch(() => '');
      return res.status(500).json({ error: 'redis error (mget)', details });
    }
    const payload = await r.json();
    const arr = Array.isArray(payload) ? payload : payload.result;

    const cur = {
      best: toPosInt(arr?.[0], Infinity),
      lastDate: (arr?.[1] ?? null),
      streak: toPosInt(arr?.[2], 0),
      maxstreak: toPosInt(arr?.[3], 0),
      completed: toPosInt(arr?.[4], 0),
      dur: toPosInt(arr?.[5], 0),
      scoreTotal: toPosInt(arr?.[6], 0),
      coins: toPosInt(arr?.[7], 0)
    };

    // Streak logic (UTC days)
    const todayDays = floorUtcDays(completedAt);
    const todayStr = yyyymmddUtc(completedAt);
    const lastDays = cur.lastDate ? parseInt(cur.lastDate, 10) : null; // we stored as YYYYMMDD; convert to days via helper

    let newStreak = cur.streak || 0;
    if (!cur.lastDate) {
      newStreak = 1;
    } else {
      const lastDaysEpoch = daysFromYyyymmdd(cur.lastDate);
      if (lastDaysEpoch === todayDays) {
        newStreak = cur.streak || 1; // same day: keep
      } else if (lastDaysEpoch === todayDays - 1) {
        newStreak = (cur.streak || 0) + 1; // consecutive
      } else {
        newStreak = 1; // reset
      }
    }
    const newMaxStreak = Math.max(cur.maxstreak || 0, newStreak);

    // Best time
    const hasDuration = durationMs > 0;
    const isBest = hasDuration && (cur.best === 0 || cur.best === Infinity || durationMs < cur.best);

    // Prepare updates
    const tasks = [];

    // Counters / sums
    tasks.push(post(`${base}/incr/${encodeURIComponent(P('completed'))}`));
    if (hasDuration) tasks.push(post(`${base}/incrby/${encodeURIComponent(P('dur'))}/${durationMs}`));
    if (revealsUsed) tasks.push(post(`${base}/incrby/${encodeURIComponent(P('reveal'))}/${revealsUsed}`));
    if (checks) tasks.push(post(`${base}/incrby/${encodeURIComponent(P('checks'))}/${checks}`));
    if (wrongCells) tasks.push(post(`${base}/incrby/${encodeURIComponent(P('wrong'))}/${wrongCells}`));
    if (lettersCount) tasks.push(post(`${base}/incrby/${encodeURIComponent(P('letters'))}/${lettersCount}`));

    // Monotonic totals
    tasks.push(post(`${base}/incrby/${encodeURIComponent(P('scoreTotal'))}/${scoreRounded}`));
    if (coinsEarned) tasks.push(post(`${base}/incrby/${encodeURIComponent(P('coins'))}/${coinsEarned}`));

    // Best time & streak
    if (isBest) tasks.push(post(`${base}/set/${encodeURIComponent(P('best'))}/${durationMs}`));
    tasks.push(post(`${base}/set/${encodeURIComponent(P('lastDate'))}/${todayStr}`));
    tasks.push(post(`${base}/set/${encodeURIComponent(P('streak'))}/${newStreak}`));
    tasks.push(post(`${base}/set/${encodeURIComponent(P('maxstreak'))}/${newMaxStreak}`));

    // Recent scores list (keep last 30)
    tasks.push(post(`${base}/lpush/${encodeURIComponent(P('scores'))}/${scoreRounded}`));
    tasks.push(post(`${base}/ltrim/${encodeURIComponent(P('scores'))}/0/29`));

    // Optional: store last themes (for future breakdowns)
    if (themes && themes.length) {
      tasks.push(post(`${base}/set/${encodeURIComponent(P('lastThemes'))}/${encodeURIComponent(themes.join(','))}`));
    }

    // Mark completion of the current ISO week for the history special (Europe/Berlin)
    if (isHistorySpecial) {
      const weekKey = isoWeekKeyBerlin(completedAt); // e.g. "2025-W32"
      if (weekKey) {
        tasks.push(post(`${base}/set/${encodeURIComponent(P('special:history:lastWeek'))}/${weekKey}`));
      }
    }

    // Global completed-games counters (overall + per-puzzle namespace)
    tasks.push(post(`${base}/incr/${encodeURIComponent('games:completed')}`));
    tasks.push(post(`${base}/incr/${encodeURIComponent(`games:completed:${puzzle}`)}`));
    // Day-based counters for mini-charts (YYYY-MM-DD from completedAt in UTC)
    try {
      const day = new Date(completedAt).toISOString().slice(0,10);
      tasks.push(post(`${base}/incr/${encodeURIComponent(`games:completed:${day}`)}`));
      tasks.push(post(`${base}/incr/${encodeURIComponent(`games:completed:${puzzle}:${day}`)}`));
    } catch(_e) { /* non-fatal */ }
    const results = await Promise.all(tasks);
    const bad = results.find(r => !r.ok);
    if (bad) {
      const details = await bad.text().catch(() => '');
      return res.status(500).json({ error: 'redis error (updates)', details });
    }

    // Build response preview (derived new totals without extra reads)
    const out = {
      ok: true,
      puzzle,
      themes,
      score: scoreRounded,
      coinsEarned,
      totals: {
        completed: cur.completed + 1,
        durationMs: cur.dur + (hasDuration ? durationMs : 0),
        bestTimeMs: isBest ? durationMs : (isFinite(cur.best) ? cur.best : 0),
        totalScore: cur.scoreTotal + scoreRounded,
        coins: cur.coins + coinsEarned,
        streak: newStreak,
        maxStreak: newMaxStreak
      }
      ,
      special: isHistorySpecial ? { history: { weekKey: isoWeekKeyBerlin(completedAt) } } : undefined
    };

    return res.status(200).json(out);
  } catch (err) {
    return res.status(500).json({ error: 'unexpected', details: String(err) });
  }
}

// --- helpers ---
function post(url){
  return fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` } });
}
function toPosInt(v, dflt){
  const n = typeof v === 'string' ? parseInt(v, 10) : (typeof v === 'number' ? v : dflt);
  if (!isFinite(n) || n < 0) return dflt;
  return Math.floor(n);
}
function clamp(x, a, b){ return Math.max(a, Math.min(b, x)); }
function computeScore({ durationMs=0, revealsUsed=0, wrongCells=0, lettersCount=0 }){
  const timePenalty = Math.min(40, (durationMs||0) / 3000);     // ~ -1 per 3s, capped 40
  const revealPenalty = 8 * (revealsUsed||0);                   // -8 per reveal
  const errorPenalty = 0.5 * (wrongCells||0);                    // -0.5 per wrong cell on checks
  const sizeBonus = Math.min(10, (lettersCount||0) / 30);        // + up to 10 for big grids
  const raw = 100 - timePenalty - revealPenalty - errorPenalty + sizeBonus;
  return clamp(raw, 0, 100);
}
function yyyymmddUtc(t){
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth()+1).padStart(2,'0');
  const day = String(d.getUTCDate()).padStart(2,'0');
  return `${y}${m}${day}`;
}
const DAY_MS = 24*60*60*1000;
function floorUtcDays(t){
  const d = new Date(t);
  const utc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.floor(utc / DAY_MS);
}
function daysFromYyyymmdd(s){
  if (!s || s.length !== 8) return -1;
  const y = parseInt(s.slice(0,4),10);
  const m = parseInt(s.slice(4,6),10)-1;
  const d = parseInt(s.slice(6,8),10);
  const utc = Date.UTC(y, m, d);
  return Math.floor(utc / DAY_MS);
}

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