import fs from 'fs/promises';
import path from 'path';

const FILE_LIST = [
  'words.json',
  'words.law.json',
  'REISESPECIAL.json'
];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  for (const fname of FILE_LIST) {
    const filePath = path.join(process.cwd(), fname);
    const list = JSON.parse(await fs.readFile(filePath, 'utf8'));
    list.forEach(e => {
      e.userRatingAvg = 0;
      e.userRatingCount = 0;
      e.flagCount = 0;
      e.usedCount = 0;
      e.firstTryCorrect = 0;
      e.avgHintRequests = 0;
    });
    await fs.writeFile(filePath, JSON.stringify(list, null, 2), 'utf8');
  }

  res.status(204).end();
}
