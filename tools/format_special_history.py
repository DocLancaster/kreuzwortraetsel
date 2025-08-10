#!/usr/bin/env python3
import argparse, json, re, sys
from pathlib import Path

# ---- Normalisierung: Wort (Umlaute -> AE/OE/UE/SS, nur A-Z, UPPER)
UMLAUT_MAP = {"Ä":"AE","Ö":"OE","Ü":"UE","ä":"AE","ö":"OE","ü":"UE","ß":"SS"}
AZ_RE = re.compile(r'[^A-Z]')
def normalize_word(s: str) -> str:
    if not isinstance(s, str): return ""
    for k,v in UMLAUT_MAP.items(): s = s.replace(k,v)
    s = AZ_RE.sub("", s.upper())
    return s

# ---- FNV-1a 32-bit, ID als 8-stellige Hex
def fnv1a32(s: str) -> int:
    h = 0x811c9dc5
    for ch in s:
        h ^= ord(ch)
        h = (h * 16777619) & 0xFFFFFFFF
    return h

def make_id(word_norm: str, prefix: str) -> str:
    return f"{prefix}{fnv1a32(word_norm):08x}"  # z.B. 'whdfb84063'

# ---- Eingabe tolerant parsen
def extract_word_and_clue(item):
    if isinstance(item, str):
        return item, ""
    if isinstance(item, dict):
        w = None
        for key in ("word","wort","name","term","text","value"):
            v = item.get(key)
            if isinstance(v, str) and v.strip():
                w = v
                break
        if not w: return None, None
        clue = ""
        for key in ("clue","hint","beschreibung","definition","desc"):
            v = item.get(key)
            if isinstance(v, str):
                clue = v
                break
        return w, clue
    return None, None

def load_json(p: Path):
    with p.open("r", encoding="utf-8") as f:
        return json.load(f)

def write_json(p: Path, data):
    with p.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")

# ---- Zielformat mit Defaults
DEFAULT_OBJ = {
    "word": "",
    "clue": "",
    "themes": [],
    "baseDifficulty": 0,
    "userRatingAvg": 0,
    "userRatingCount": 0,
    "flagCount": 0,
    "usedCount": 0,
    "firstTryCorrect": 0,
    "avgHintRequests": 0,
    "id": ""
}

def to_target_obj(word_norm: str, clue: str, id_prefix: str, themes):
    obj = DEFAULT_OBJ.copy()
    obj.update({
        "word": word_norm,
        "clue": clue or "",
        "themes": list(themes) if isinstance(themes, (list,tuple)) else [],
        "id": make_id(word_norm, id_prefix)
    })
    return obj

def ensure_target_fields(obj):
    # Füllt fehlende Felder, fixiert Datentypen
    fixed = DEFAULT_OBJ.copy()
    fixed.update(obj or {})
    fixed["word"] = normalize_word(fixed.get("word",""))
    if not isinstance(fixed["themes"], list):
        fixed["themes"] = []
    # Zahlenfelder hart auf ints/floats normalisieren
    num_int = ("baseDifficulty","userRatingCount","flagCount","usedCount","firstTryCorrect")
    num_float = ("userRatingAvg","avgHintRequests")
    for k in num_int:
        try: fixed[k] = int(fixed.get(k,0))
        except: fixed[k] = 0
    for k in num_float:
        try: fixed[k] = float(fixed.get(k,0))
        except: fixed[k] = 0.0
    fixed["id"] = str(fixed.get("id",""))
    return fixed

def build_special_list(raw_list, theme:str, id_prefix:str, empty_themes:bool):
    out, seen = [], set()
    for item in raw_list:
        w_raw, clue = extract_word_and_clue(item)
        if w_raw is None: continue
        w = normalize_word(w_raw)
        if len(w) < 2: continue
        if w in seen: continue
        seen.add(w)
        themes = [] if empty_themes else [theme]
        out.append(to_target_obj(w, clue, id_prefix, themes))
    return out

def merge_lists(base_list, special_list, theme:str, id_prefix:str, silent=False):
    """
    Merge-Strategie:
    - Dedupe nach 'word' (normalisiert)
    - Wenn Wort schon existiert:
        * ID bleibt wie in base (Stabilität). Falls abweichend -> Warnung.
        * Themes zusammenführen (+history, falls noch nicht vorhanden)
        * clue nur ersetzen, wenn base.clue leer ist und special.clue vorhanden
        * Zähler/Rating bleiben aus base erhalten (werden NICHT zurückgesetzt)
    - Wenn Wort neu:
        * Neuen Eintrag aus special übernehmen (mit id_prefix)
    - ID-Kollisionen sind unwahrscheinlich (wh... vs w...), trotzdem geprüft.
    """
    by_word = {}
    by_id = {}
    # Base einlesen & kanonisieren
    for raw in base_list:
        obj = ensure_target_fields(raw)
        w = obj["word"]
        if not w: continue
        if not obj["id"]:
            # Falls altes Item ohne ID: generiere 'w' + hash
            obj["id"] = make_id(w, "w")
            if not silent:
                print(f"[info] missing id for base word {w} -> assigned {obj['id']}", file=sys.stderr)
        if obj["id"] in by_id:
            if not silent:
                print(f"[warn] duplicate id in base: {obj['id']} (keeping first)", file=sys.stderr)
        by_word[w] = obj
        by_id[obj["id"]] = obj

    # Special mergen
    for s in special_list:
        s = ensure_target_fields(s)
        w = s["word"]
        if not w: continue
        if w in by_word:
            base = by_word[w]
            # ID-Abgleich
            if s["id"] and s["id"] != base["id"] and not silent:
                print(f"[note] id mismatch for word {w}: base={base['id']} special={s['id']} -> keeping base id", file=sys.stderr)
            # Themes zusammenführen
            t = list(dict.fromkeys((base.get("themes") or []) + [theme]))
            base["themes"] = t
            # Clue ggf. ergänzen
            if (not base.get("clue")) and s.get("clue"):
                base["clue"] = s["clue"]
            # Zähler/Ratings bleiben wie base
        else:
            # Neues Wort: sicherstellen, dass ID nicht kollidiert
            new_id = s["id"] or make_id(w, id_prefix)
            if new_id in by_id:
                # Ultra selten (anderes Wort mit gleicher ID) – löse mit anderem Prefix
                alt = make_id(w + "|history", id_prefix)
                if not silent:
                    print(f"[warn] id collision on {new_id}, using alt {alt}", file=sys.stderr)
                new_id = alt
            s["id"] = new_id
            # Theme sicherstellen
            t = s.get("themes") or []
            if theme not in t:
                t.append(theme)
            s["themes"] = t
            # Defaults für alle Zahlenfelder sind schon gesetzt
            by_word[w] = s
            by_id[new_id] = s

    merged = list(by_word.values())
    merged.sort(key=lambda x: x["word"])
    return merged

def main():
    ap = argparse.ArgumentParser(description="Format & Merge Special-JSON in words.json mit history-IDs und ID-Abgleich")
    ap.add_argument("input", type=Path, help="Special-JSON (Liste von Strings/Objekten)")
    ap.add_argument("--merge", type=Path, help="Pfad zu bestehender words.json (für Merge)")
    ap.add_argument("-o","--out", type=Path, required=True, help="Ausgabe-Datei (bei --merge: gemergte words.json)")
    ap.add_argument("--theme", default="history", help="Theme-Tag (Default: history)")
    ap.add_argument("--id-prefix", default="wh", help="ID-Präfix für neue Wörter (Default: wh)")
    ap.add_argument("--empty-themes", action="store_true", help="Themes leeren statt [theme] in den Special-Einträgen")
    ap.add_argument("--silent", action="store_true", help="Weniger Ausgaben (nur Fehler/Warnungen)")
    args = ap.parse_args()

    try:
        raw = load_json(args.input)
        if not isinstance(raw, list):
            print("Eingabe muss eine JSON-Liste sein.", file=sys.stderr); sys.exit(1)
    except Exception as e:
        print(f"Lesefehler {args.input}: {e}", file=sys.stderr); sys.exit(1)

    special = build_special_list(raw, theme=args.theme, id_prefix=args.id_prefix, empty_themes=args.empty_themes)

    if not args.merge:
        # Nur formatieren
        write_json(args.out, special)
        if not args.silent:
            print(f"[ok] {len(special)} Einträge formatiert → {args.out}", file=sys.stderr)
        return

    # Merge mit bestehender words.json
    try:
        base = load_json(args.merge)
        if not isinstance(base, list):
            print("merge-Datei muss eine JSON-Liste sein.", file=sys.stderr); sys.exit(1)
    except Exception as e:
        print(f"Lesefehler {args.merge}: {e}", file=sys.stderr); sys.exit(1)

    merged = merge_lists(base, special, theme=args.theme, id_prefix=args.id_prefix, silent=args.silent)
    write_json(args.out, merged)
    if not args.silent:
        print(f"[ok] Merge abgeschlossen: {len(special)} Special-Einträge → {args.out}", file=sys.stderr)

if __name__ == "__main__":
    main()