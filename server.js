// server.js
// Ein einfaches Backend mit Express, das deine word-JSONs updatet

import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import cors from 'cors';

const app = express();
app.use(express.json());
app.use(cors());  // Erlaubt alle Domains (für Entwicklung)

// Pfad zur Wortliste (anpassen, falls nötig)
const DATA_DIR = path.resolve('./raetsel');
const WORDS_FILE = path.join(DATA_DIR, 'words.json');
const WORDS_LAW_FILE = path.join(DATA_DIR, 'words.law.json');
const WORDS_SPECIAL_FILE = path.join(DATA_DIR, 'REISESPECIAL.json');

// Hilfsfunktion: JSON-Datei laden
async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

// Hilfsfunktion: JSON-Datei schreiben
async function writeJson(filePath, data) {
  const text = JSON.stringify(data, null, 2);
  await fs.writeFile(filePath, text, 'utf8');
}

// Endpoint: Rating (1–5 Sterne)
app.post('/api/rate', async (req, res) => {
  const { word, rating, puzzle } = req.body;
  if (!word || !rating) {
    return res.status(400).json({ error: 'word und rating erforderlich' });
  }
  // Wähle die richtige Datei basierend auf puzzle-Typ
  let filePath;
  switch (puzzle) {
    case 'jura': filePath = WORDS_LAW_FILE; break;
    case 'reisesspecial': filePath = WORDS_SPECIAL_FILE; break;
    default: filePath = WORDS_FILE;
  }

  const list = await readJson(filePath);
  for (const entry of list) {
    if (entry.word === word) {
      const prevAvg = entry.userRatingAvg || 0;
      const prevCount = entry.userRatingCount || 0;
      entry.userRatingAvg = (prevAvg * prevCount + rating) / (prevCount + 1);
      entry.userRatingCount = prevCount + 1;
      break;
    }
  }
  await writeJson(filePath, list);
  res.sendStatus(204);
});

// Endpoint: Flag ("schlechtes" Wort markieren)
app.post('/api/flag', async (req, res) => {
  const { word, puzzle } = req.body;
  if (!word) {
    return res.status(400).json({ error: 'word erforderlich' });
  }
  let filePath;
  switch (puzzle) {
    case 'jura': filePath = WORDS_LAW_FILE; break;
    case 'reisesspecial': filePath = WORDS_SPECIAL_FILE; break;
    default: filePath = WORDS_FILE;
  }
  const list = await readJson(filePath);
  for (const entry of list) {
    if (entry.word === word) {
      entry.flagCount = (entry.flagCount || 0) + 1;
      break;
    }
  }
  await writeJson(filePath, list);
  res.sendStatus(204);
});

// Endpoint: Usage (Nutzung/statistisches Feedback)
app.post('/api/usage', async (req, res) => {
  const { word, puzzle, correctFirstTry, hintsUsed } = req.body;
  if (!word) {
    return res.status(400).json({ error: 'word erforderlich' });
  }
  let filePath;
  switch (puzzle) {
    case 'jura': filePath = WORDS_LAW_FILE; break;
    case 'reisesspecial': filePath = WORDS_SPECIAL_FILE; break;
    default: filePath = WORDS_FILE;
  }
  const list = await readJson(filePath);
  for (const entry of list) {
    if (entry.word === word) {
      entry.usedCount = (entry.usedCount || 0) + 1;
      // firstTryCorrect mitteln
      const prevCorrect = entry.firstTryCorrect || 0;
      const prevUsed = (entry.usedCount - 1);
      entry.firstTryCorrect = (prevCorrect * prevUsed + (correctFirstTry ? 1 : 0)) / (prevUsed + 1);
      // avgHintRequests mitteln
      const prevHints = entry.avgHintRequests || 0;
      entry.avgHintRequests = (prevHints * prevUsed + Number(hintsUsed || 0)) / (prevUsed + 1);
      break;
    }
  }
  await writeJson(filePath, list);
  res.sendStatus(204);
});

// Optional: Stats reset für Admin
app.post('/api/reset-stats', async (_req, res) => {
  const files = [WORDS_FILE, WORDS_LAW_FILE, WORDS_SPECIAL_FILE];
  for (const fp of files) {
    const list = await readJson(fp);
    list.forEach(e => {
      e.userRatingAvg = 0;
      e.userRatingCount = 0;
      e.flagCount = 0;
      e.usedCount = 0;
      e.firstTryCorrect = 0;
      e.avgHintRequests = 0;
    });
    await writeJson(fp, list);
  }
  res.sendStatus(204);
});

// Server starten auf Port 3000
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server läuft auf http://localhost:${PORT}`);
});
