import fs from 'fs/promises';
import path from 'path';

const FILES = {
  classic:       'words.json',
  jura:          'words.law.json',
  reisesspecial: 'REISESPECIAL.json'
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { id, word, rating, puzzle } = req.body || {};
  if ((!id && !word) || typeof rating !== 'number') {
    return res.status(400).json({ error: 'id or word and numeric rating required' });
  }

  const base = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!base || !token) {
    return res.status(500).json({ error: 'missing redis env vars' });
  }

  const ns = puzzle || 'classic';
  const tasks = [];

  try {
    // New: ID-based keys
    if (id) {
      const sumKeyId = `ratingSumId:${ns}:${id}`;
      const cntKeyId = `ratingCountId:${ns}:${id}`;
      tasks.push(fetch(`${base}/incrby/${encodeURIComponent(sumKeyId)}/${rating}`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }
      }));
      tasks.push(fetch(`${base}/incr/${encodeURIComponent(cntKeyId)}`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }
      }));
    }

    // Legacy: word-based keys (compat)
    if (word) {
      const sumKey = `ratingSum:${ns}:${word}`;
      const cntKey = `ratingCount:${ns}:${word}`;
      tasks.push(fetch(`${base}/incrby/${encodeURIComponent(sumKey)}/${rating}`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }
      }));
      tasks.push(fetch(`${base}/incr/${encodeURIComponent(cntKey)}`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }
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
