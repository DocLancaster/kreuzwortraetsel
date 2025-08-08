import fs from 'fs/promises';
import path from 'path';

const FILES = {
  classic:       'words.json',
  jura:          'words.law.json',
  reisesspecial: 'REISESPECIAL.json'
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // Body lesen (Vercel parsed i.d.R. JSON automatisch)
  const { word, puzzle } = req.body || {};
  if (!word) return res.status(400).json({ error: 'word required' });

  // Upstash Redis Credentials aus Env
  const base = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!base || !token) {
    return res.status(500).json({ error: 'missing redis env vars' });
  }

  // Key-Namespace: flag:<puzzle>:<word>
  const ns = puzzle || 'classic';
  const key = `flag:${ns}:${word}`;

  try {
    const url = `${base}/incr/${encodeURIComponent(key)}`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!r.ok) {
      const details = await r.text().catch(() => '');
      return res.status(500).json({ error: 'redis error', details });
    }

    return res.status(204).end();
  } catch (err) {
    return res.status(500).json({ error: 'unexpected', details: String(err) });
  }
}
