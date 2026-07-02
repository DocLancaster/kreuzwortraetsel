import { requireAdmin } from './_lib/admin-auth.js';

const FLAG_REASONS = [
  'unclear_clue',
  'wrong_answer',
  'spelling',
  'too_hard',
  'too_easy',
  'abbreviation',
  'inappropriate',
  'other'
];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // Accept id-first, fallback to word (both allowed)
  const { action, id, word, puzzle, reason, reasons } = req.body || {};
  if (!id && !word) return res.status(400).json({ error: 'id or word required' });

  const base = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!base || !token) {
    return res.status(500).json({ error: 'missing redis env vars' });
  }

  const ns = puzzle || 'classic';

  try {
    if (action === 'reasons') {
      if (!requireAdmin(req, res)) return;
      const keys = [];
      const labels = [];
      for (const r of FLAG_REASONS) {
        if (id) {
          keys.push(reasonKeyId(ns, id, r));
          labels.push(r);
        }
        if (word) {
          keys.push(reasonKeyWord(ns, word, r));
          labels.push(r);
        }
      }
      const url = `${base}/mget/${keys.map(encodeURIComponent).join('/')}`;
      const rr = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!rr.ok) {
        const details = await rr.text().catch(() => '');
        return res.status(500).json({ error: 'redis error', details });
      }
      const payload = await rr.json();
      const arr = Array.isArray(payload) ? payload : payload.result;
      const reasons = {};
      for (let i = 0; i < labels.length; i++) {
        reasons[labels[i]] = (reasons[labels[i]] || 0) + toInt(arr?.[i]);
      }
      return res.status(200).json({ ok: true, reasons });
    }

    const safeReasons = normalizeReasons(reasons || reason);
    const tasks = [];

    // New: ID-based key
    if (id) {
      const keyId = `flagId:${ns}:${id}`;
      tasks.push(fetch(`${base}/incr/${encodeURIComponent(keyId)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      }));
      for (const safeReason of safeReasons) {
        tasks.push(fetch(`${base}/incr/${encodeURIComponent(reasonKeyId(ns, id, safeReason))}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` }
        }));
      }
    }

    // Legacy: word-based key for backward compatibility
    if (word) {
      const keyWord = `flag:${ns}:${word}`;
      tasks.push(fetch(`${base}/incr/${encodeURIComponent(keyWord)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      }));
      for (const safeReason of safeReasons) {
        tasks.push(fetch(`${base}/incr/${encodeURIComponent(reasonKeyWord(ns, word, safeReason))}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` }
        }));
      }
    }

    const results = await Promise.all(tasks);
    const bad = results.find(r => !r.ok);
    if (bad) {
      const details = await bad.text().catch(() => '');
      return res.status(500).json({ error: 'redis error', details });
    }

    return res.status(204).end();
  } catch (err) {
    return res.status(500).json({ error: 'unexpected', details: String(err) });
  }
}

function normalizeReason(reason) {
  return FLAG_REASONS.includes(reason) ? reason : 'other';
}

function normalizeReasons(input) {
  const raw = Array.isArray(input) ? input : [input];
  const out = [];
  for (const item of raw) {
    const reason = normalizeReason(item);
    if (!out.includes(reason)) out.push(reason);
  }
  return out.length ? out : ['other'];
}

function reasonKeyId(ns, id, reason) {
  return `flagReasonId:${ns}:${id}:${reason}`;
}

function reasonKeyWord(ns, word, reason) {
  return `flagReason:${ns}:${word}:${reason}`;
}

function toInt(value) {
  const n = typeof value === 'string' ? parseInt(value, 10) : Number(value || 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}
