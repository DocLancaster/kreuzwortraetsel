#!/usr/bin/env python3
import argparse, json, re, sys
from pathlib import Path

# ---------- Normalisierung: Wort (Umlaute -> AE/OE/UE/SS, nur A-Z, UPPER)
UMLAUT_MAP = {"Ä":"AE","Ö":"OE","Ü":"UE","ä":"AE","ö":"OE","ü":"UE","ß":"SS"}
AZ_RE = re.compile(r'[^A-Z]')
def normalize_word(s: str) -> str:
    if not isinstance(s, str): return ""
    for k,v in UMLAUT_MAP.items(): s = s.replace(k, v)
    s = s.upper()
    s = AZ_RE.sub("", s)
    return s

# ---------- FNV-1a 32-bit, ID als 8-stellige Hex (Präfix 'w')
def fnv1a32(s: str) -> int:
    h = 0x811c9dc5
    for ch in s:
        h ^= ord(ch)
        h = (h * 16777619) & 0xFFFFFFFF
    return h

def make_id(word_norm: str, prefix: str = "w") -> str:
    return f"{prefix}{fnv1a32(word_norm):08x}"

# ---------- Eingabe tolerant parsen
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

# ---------- Zielformat mit Defaults
DEFAULT_OBJ = {
    "word": "",
    "clue": "",
    "themes": [],
    "baseDifficulty": 0,
    "userRatingAvg": 0.0,
    "userRatingCount": 0,
    "flagCount": 0,
    "usedCount": 0,
    "firstTryCorrect": 0,
    "avgHintRequests": 0.0,
    "id": ""
}

def to_target_obj(word_norm: str, clue: str, id_prefix="w"):
    obj = DEFAULT_OBJ.copy()
    obj.update({
        "word": word_norm,
        "clue": clue or "",
        "themes": [],
        "id": make_id(word_norm, id_prefix)
    })
    return obj

def ensure_target_fields(obj):
    fixed = DEFAULT_OBJ.copy()
    fixed.update(obj or {})
    fixed["word"] = normalize_word(fixed.get("word",""))
    # Typen hart festziehen
    fixed["baseDifficulty"] = int(fixed.get("baseDifficulty", 0) or 0)
    fixed["userRatingAvg"] = float(fixed.get("userRatingAvg", 0.0) or 0.0)
    fixed["userRatingCount"] = int(fixed.get("userRatingCount", 0) or 0)
    fixed["flagCount"] = int(fixed.get("flagCount", 0) or 0)
    fixed["usedCount"] = int(fixed.get("usedCount", 0) or 0)
    fixed["firstTryCorrect"] = int(fixed.get("firstTryCorrect", 0) or 0)
    fixed["avgHintRequests"] = float(fixed.get("avgHintRequests", 0.0) or 0.0)
    if not isinstance(fixed.get("themes"), list):
        fixed["themes"] = []
    fixed["id"] = str(fixed.get("id",""))
    return fixed

def build_new_list(raw_list, id_prefix="w"):
    out, seen = [], set()
    for item in raw_list:
        w_raw, clue = extract_word_and_clue(item)
        if w_raw is None: continue
        w = normalize_word(w_raw)
        if len(w) < 2: continue
        if w in seen: continue
        seen.add(w)
        out.append(to_target_obj(w, clue, id_prefix=id_prefix))
    return out

def merge_lists(base_list, new_list, id_prefix="w", silent=False):
    """
    Merge-Regeln:
    - Dedupe nach 'word' (normalisiert).
    - Existiert Wort schon in base: ID bleibt wie base; Clue nur ergänzen, wenn base.clue leer ist.
      Zähler/Rating bleiben unangetastet.
    - Neues Wort: generiere ID mit Präfix 'w'; falls ID-Kollision (sehr selten),
      berechne Alternativen mit Suffix '|1', '|2', ... bis unique.
    """
    by_word = {}
    used_ids = set()

    # Base vorbereiten
    for raw in base_list:
        obj = ensure_target_fields(raw)
        w = obj["word"]
        if not w: continue
        if not obj["id"]:
            obj["id"] = make_id(w, id_prefix)
            if not silent:
                print(f"[info] missing id for base word {w} -> {obj['id']}", file=sys.stderr)
        if obj["id"] in used_ids and not silent:
            print(f"[warn] duplicate id in base: {obj['id']} (keeping first)", file=sys.stderr)
        by_word[w] = obj
        used_ids.add(obj["id"])

    # Neue Liste mergen
    for s in new_list:
        s = ensure_target_fields(s)
        w = s["word"]
        if not w: continue
        if w in by_word:
            base = by_word[w]
            if (not base.get("clue")) and s.get("clue"):
                base["clue"] = s["clue"]
            # themes bleiben [], Zähler aus base
        else:
            # sichere ID
            base_id = make_id(w, id_prefix)
            if base_id in used_ids:
                # Kollisionslösung
                i = 1
                while True:
                    alt = make_id(f"{w}|{i}", id_prefix)
                    if alt not in used_ids:
                        base_id = alt
                        break
                    i += 1
                if not silent:
                    print(f"[warn] id collision for {w}, using {base_id}", file=sys.stderr)
            s["id"] = base_id
            by_word[w] = s
            used_ids.add(base_id)

    merged = list(by_word.values())
    merged.sort(key=lambda x: x["word"])
    return merged

def main():
    ap = argparse.ArgumentParser(description="Format & Merge newwords.json in words.json (w-IDs, Ziel-Format).")
    ap.add_argument("input", type=Path, help="newwords.json (Liste von Strings/Objekten)")
    ap.add_argument("-o","--out", type=Path, help="Ausgabe-Datei (bei --merge: gemergte words.json)")
    ap.add_argument("--merge", type=Path, help="Pfad zu words.json (zum Mergen)")
    ap.add_argument("--inplace", action="store_true", help="Direkt words.json überschreiben (Backup wird erstellt)")
    ap.add_argument("--silent", action="store_true", help="Weniger Ausgaben")
    args = ap.parse_args()

    try:
        raw = load_json(args.input)
        if not isinstance(raw, list):
            print("Eingabe muss eine JSON-Liste sein.", file=sys.stderr); sys.exit(1)
    except Exception as e:
        print(f"Lesefehler {args.input}: {e}", file=sys.stderr); sys.exit(1)

    formatted = build_new_list(raw, id_prefix="w")

    # Nur formatieren?
    if not args.merge:
        outp = args.out or Path("newwords.formatted.json")
        write_json(outp, formatted)
        if not args.silent:
            print(f"[ok] {len(formatted)} Einträge formatiert → {outp}", file=sys.stderr)
        return

    # Merge
    try:
        base = load_json(args.merge)
        if not isinstance(base, list):
            print("merge-Datei (words.json) muss eine JSON-Liste sein.", file=sys.stderr); sys.exit(1)
    except Exception as e:
        print(f"Lesefehler {args.merge}: {e}", file=sys.stderr); sys.exit(1)

    merged = merge_lists(base, formatted, id_prefix="w", silent=args.silent)

    if args.inplace:
        # Backup
        bak = args.merge.with_suffix(args.merge.suffix + ".bak")
        write_json(bak, base)
        write_json(args.merge, merged)
        if not args.silent:
            print(f"[ok] Merge in-place: Backup → {bak}, aktualisiert → {args.merge}", file=sys.stderr)
    else:
        outp = args.out or Path("words.merged.json")
        write_json(outp, merged)
        if not args.silent:
            print(f"[ok] Merge geschrieben → {outp}", file=sys.stderr)

if __name__ == "__main__":
    main()