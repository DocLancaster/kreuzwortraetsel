import json

# Pfad zur Datei anpassen, falls nötig
FILE_PATH = 'words.json'

# Lade die bestehende Wortliste
with open(FILE_PATH, 'r', encoding='utf-8') as f:
    words = json.load(f)

# Die neuen Felder und ihre Default-Werte
default_fields = {
    'themes': [],
    'baseDifficulty': 0,
    'userRatingAvg': 0,
    'userRatingCount': 0,
    'flagCount': 0,
    'usedCount': 0,
    'firstTryCorrect': 0,
    'avgHintRequests': 0
}

# Ergänze jedes Wort-Objekt um die fehlenden Felder
for entry in words:
    for key, default in default_fields.items():
        if key not in entry:
            entry[key] = default

# Schreibe die aktualisierte Liste zurück
with open(FILE_PATH, 'w', encoding='utf-8') as f:
    json.dump(words, f, ensure_ascii=False, indent=2)

print(f"✅ {len(words)} Einträge in '{FILE_PATH}' aktualisiert.")