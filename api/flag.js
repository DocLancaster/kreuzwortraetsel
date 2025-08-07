import fs from 'fs/promises';
import path from 'path';

const FILES = {
  classic:       'words.json',
  jura:          'words.law.json',
  reisesspecial: 'REISESPECIAL.json'
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  
  const { word, puzzle } = req.body;
  if (!word) {
    return res.status(400).json({ error: 'word required' });
  }

  const filename = FILES[puzzle] || FILES.classic;
  const filePath = path.join(process.cwd(), filename);
  const list = JSON.parse(await fs.readFile(filePath, 'utf8'));

  for (let e of list) {
    if (e.word === word) {
      e.flagCount = (e.flagCount || 0) + 1;
      break;
    }
  }

  await fs.writeFile(filePath, JSON.stringify(list, null, 2), 'utf8');
  res.status(204).end();
}
