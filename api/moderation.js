import { requireAdmin } from './_lib/admin-auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { action, puzzle, id, word, ids, words, reason } = req.body || {};
  const ns = puzzle || 'classic';
  const base = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!base || !token) return res.status(500).json({ error: 'missing redis env vars' });

  try {
    if (action === 'status') {
      const idList = Array.isArray(ids) ? ids : (id ? [id] : []);
      const wordList = Array.isArray(words) ? words : (word ? [word] : []);
      if (idList.length === 0 && wordList.length === 0) {
        return res.status(400).json({ error: 'ids[] or words[] required' });
      }

      const idKeys = idList.map(v => blockIdKey(ns, v));
      const wordKeys = wordList.map(v => blockWordKey(ns, v));
      const allKeys = [...idKeys, ...wordKeys];
      const mgetUrl = `${base}/mget/${allKeys.map(encodeURIComponent).join('/')}`;
      const r = await fetch(mgetUrl, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) {
        const details = await r.text().catch(() => '');
        return res.status(500).json({ error: 'redis error', details });
      }

      const payload = await r.json();
      const arr = Array.isArray(payload) ? payload : payload.result;
      const byId = {};
      const byWord = {};

      for (let i = 0; i < idList.length; i++) {
        const raw = arr?.[i];
        byId[idList[i]] = parseStatus(raw);
      }
      const off = idList.length;
      for (let i = 0; i < wordList.length; i++) {
        const raw = arr?.[off + i];
        byWord[wordList[i]] = parseStatus(raw);
      }

      return res.status(200).json({ ok: true, byId, byWord });
    }

    if (action === 'block' || action === 'unblock') {
      if (!requireAdmin(req, res)) return;
      if (!id && !word) return res.status(400).json({ error: 'id or word required' });

      const keys = [];
      if (id) keys.push(blockIdKey(ns, id));
      if (word) keys.push(blockWordKey(ns, word));

      const tasks = [];
      if (action === 'block') {
        const value = encodeURIComponent(JSON.stringify({
          blocked: true,
          reason: String(reason || '').slice(0, 240),
          at: new Date().toISOString()
        }));
        for (const key of keys) {
          tasks.push(fetch(`${base}/set/${encodeURIComponent(key)}/${value}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` }
          }));
        }
      } else {
        for (const key of keys) {
          tasks.push(fetch(`${base}/del/${encodeURIComponent(key)}`, {
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

      return res.status(200).json({ ok: true, blocked: action === 'block' });
    }

    return res.status(400).json({ error: 'unknown action' });
  } catch (err) {
    return res.status(500).json({ error: 'unexpected', details: String(err) });
  }
}

function blockIdKey(ns, id){ return `moderation:blockId:${ns}:${id}`; }
function blockWordKey(ns, word){ return `moderation:block:${ns}:${word}`; }

function parseStatus(raw){
  if (raw === null || raw === undefined) return { blocked: false };
  try {
    const data = JSON.parse(decodeURIComponent(String(raw)));
    return { blocked: true, reason: data.reason || '', at: data.at || null };
  } catch (_) {
    return { blocked: true, reason: '', at: null };
  }
}
