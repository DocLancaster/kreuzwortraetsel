import fs from 'fs/promises';
import path from 'path';

const FILES = {
  classic:       'words.json',
  jura:          'words.law.json',
  reisesspecial: 'REISESPECIAL.json'
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // Accept id-first, fallback to word (both allowed)
  const { id, word, puzzle } = req.body || {};
  if (!id && !word) return res.status(400).json({ error: 'id or word required' });

  const base = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!base || !token) {
    return res.status(500).json({ error: 'missing redis env vars' });
  }

  const ns = puzzle || 'classic';
  const tasks = [];

  try {
    // New: ID-based key
    if (id) {
      const keyId = `flagId:${ns}:${id}`;
      tasks.push(fetch(`${base}/incr/${encodeURIComponent(keyId)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      }));
    }

    // Legacy: word-based key for backward compatibility
    if (word) {
      const keyWord = `flag:${ns}:${word}`;
      tasks.push(fetch(`${base}/incr/${encodeURIComponent(keyWord)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      }));
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
