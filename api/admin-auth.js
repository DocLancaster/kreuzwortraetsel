import fs from 'fs/promises';
import path from 'path';
import { adminHeaders, requireAdmin } from './_lib/admin-auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  if (!requireAdmin(req, res)) return;

  try {
    const filePath = path.join(process.cwd(), 'admin.html');
    const html = await fs.readFile(filePath, 'utf8');
    for (const [key, value] of Object.entries(adminHeaders({ 'Content-Type': 'text/html; charset=utf-8' }))) {
      res.setHeader(key, value);
    }
    return res.status(200).send(html);
  } catch (err) {
    return res.status(500).json({ error: 'admin page unavailable', details: String(err) });
  }
}
