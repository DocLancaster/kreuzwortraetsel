import fs from 'fs/promises';
import path from 'path';

const FILES = {
  classic:       'words.json',
  jura:          'words.law.json',
  reisesspecial: 'REISESPECIAL.json'
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { word, rating, puzzle } = req.body || {};
  if (!word || typeof rating !== 'number') {
    return res.status(400).json({ error: 'word & rating required' });
    }

  const base = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!base || !token) {
    return res.status(500).json({ error: 'missing redis env vars' });
  }

  const ns = puzzle || 'classic';
  const sumKey = `ratingSum:${ns}:${word}`;
  const cntKey = `ratingCount:${ns}:${word}`;

  try {
    const r1 = await fetch(
      `${base}/incrby/${encodeURIComponent(sumKey)}/${rating}`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}` } }
    );
    const r2 = await fetch(
      `${base}/incr/${encodeURIComponent(cntKey)}`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}` } }
    );

    if (!r1.ok || !r2.ok) {
      const d1 = await r1.text().catch(() => '');
      const d2 = await r2.text().catch(() => '');
      return res.status(500).json({ error: 'redis error', details: [d1, d2] });
    }

    return res.status(204).end();
  } catch (err) {
    return res.status(500).json({ error: 'unexpected', details: String(err) });
  }
}
