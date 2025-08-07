import fs from 'fs/promises';
import path from 'path';

const FILES = {
  classic:       'words.json',
  jura:          'words.law.json',
  reisesspecial: 'REISESPECIAL.json'
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  
  const { word, puzzle, correctFirstTry, hintsUsed } = req.body;
  if (!word) {
    return res.status(400).json({ error: 'word required' });
  }

  const filename = FILES[puzzle] || FILES.classic;
  const filePath = path.join(process.cwd(), filename);
  const list = JSON.parse(await fs.readFile(filePath, 'utf8'));

  for (let e of list) {
    if (e.word === word) {
      // Count usage
      const prevUsed = e.usedCount || 0;
      e.usedCount = prevUsed + 1;
      // Average first-try correctness
      const prevCorrect = e.firstTryCorrect || 0;
      e.firstTryCorrect = (prevCorrect * prevUsed + (correctFirstTry ? 1 : 0)) / (prevUsed + 1);
      // Average hints requested
      const prevHintsAvg = e.avgHintRequests || 0;
      e.avgHintRequests = (prevHintsAvg * prevUsed + Number(hintsUsed || 0)) / (prevUsed + 1);
      break;
    }
  }

  await fs.writeFile(filePath, JSON.stringify(list, null, 2), 'utf8');
  res.status(204).end();
}
