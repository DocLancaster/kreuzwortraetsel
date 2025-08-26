#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json, random, string
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent  # ../raetsel
RECORDS_FILE = BASE_DIR / "records.json"
WORDS_FILE   = BASE_DIR / "words.json"
BACKUP_FILE  = BASE_DIR / "words.json.bak"

def make_id():
    return "wr" + "".join(random.choices(string.digits, k=7))

def normalize_word(s: str) -> str:
    if not s:
        return ""
    rep = {
        "ä":"AE","ö":"OE","ü":"UE",
        "Ä":"AE","Ö":"OE","Ü":"UE",
        "ß":"SS"
    }
    out = s.strip()
    for a,b in rep.items():
        out = out.replace(a,b)
    return out.upper()

def main():
    records = json.loads(RECORDS_FILE.read_text(encoding="utf-8"))
    words   = json.loads(WORDS_FILE.read_text(encoding="utf-8"))

    added = 0
    for rec in records:
        word = rec.get("word") or rec.get("name") or rec.get("title")
        clue = rec.get("clue") or rec.get("definition") or rec.get("description") or rec.get("desc")
        if not word or not clue:
            continue
        entry = {
            "word": normalize_word(word),
            "clue": clue.strip(),
            "themes": ["records"],
            "baseDifficulty": 0,
            "userRatingAvg": 0.0,
            "userRatingCount": 0,
            "flagCount": 0,
            "usedCount": 0,
            "firstTryCorrect": 0,
            "avgHintRequests": 0.0,
            "id": make_id()
        }
        words.append(entry)
        added += 1

    # Backup
    BACKUP_FILE.write_text(WORDS_FILE.read_text(encoding="utf-8"), encoding="utf-8")

    # Save
    WORDS_FILE.write_text(json.dumps(words, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"{added} Records hinzugefügt → {WORDS_FILE} (Backup: {BACKUP_FILE})")

if __name__ == "__main__":
    main()