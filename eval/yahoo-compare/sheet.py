"""自前（prod）と Yahoo の読みが割れた文を無作為に抜き、どちらの読みか伏せた判定シートを作る。

正解率の差は「割れた文」だけで決まる（両者が同じ読みの文は、正しくても誤りでも差に効かない）。
だから割れた文を判定すれば、正解データの無いコーパスでも差を推定できる。
A/B の割り当ては文ごとに無作為で、対応表（key）は判定が終わるまで開かない。

    python3 -I sheet.py <work> <出力先> kwdlc:150 aozora:150 livedoor:200 wikipedia:200
"""
import difflib, json, random, re, sys

work, out_dir, specs = sys.argv[1], sys.argv[2], sys.argv[3:]
HAN = re.compile(r"[㐀-鿿々〆]")


def k2h(s):
    return "".join(chr(ord(c) - 0x60) if "ァ" <= c <= "ヶ" else c for c in s)


def norm(s):
    return re.sub(r"[、。！？!?・「」\s]", "", k2h(s))


def load(p):
    return [json.loads(l) for l in open(p, encoding="utf-8")]


yahoo = {}
for r in load(f"{work}/yahoo.cache.jsonl"):
    yahoo[r["text"]] = None if "error" in r else "".join(k2h(w.get("furigana", w["surface"])) for w in r["words"])


def fragments(a, b):
    """読みの違う箇所を前後4字つきで並べる"""
    pairs = []
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if tag != "equal":
            pairs.append((a[max(0, i1 - 4):i2 + 4], b[max(0, j1 - 4):j2 + 4]))
    return pairs


rng = random.Random(20261107)
sheet, key, counts = [], {}, {}
for spec in specs:
    corpus, n = spec.split(":")
    prod = {r["id"]: r["kana"] for r in load(f"{work}/{corpus}.prod.jsonl")}
    rows = load(f"{work}/{corpus}.jsonl")
    split = []
    for r in rows:
        p, y = prod[r["id"]], yahoo[r["text"]]
        if p is None or y is None or HAN.search(y):
            continue  # 却下は別に数える
        if norm(p) != norm(y):
            split.append((r, norm(p), norm(y)))
    counts[corpus] = {"n": len(rows), "split": len(split)}
    for r, p, y in rng.sample(split, min(int(n), len(split))):
        qid = f"{corpus[0]}{len(sheet):03}"
        a_is_prod = rng.random() < 0.5
        a, b = (p, y) if a_is_prod else (y, p)
        sheet.append({"q": qid, "text": r["text"], "pairs": fragments(a, b)})
        key[qid] = {"corpus": corpus, "A": "prod" if a_is_prod else "yahoo", "id": r["id"], "gold": r.get("gold")}

rng.shuffle(sheet)  # コーパスごとの癖で判定がぶれないように混ぜる
with open(f"{out_dir}/sheet.txt", "w", encoding="utf-8") as o:
    for s in sheet:
        o.write(f"{s['q']} {s['text']}\n")
        for a, b in s["pairs"]:
            o.write(f"  A:{a} | B:{b}\n")
json.dump(key, open(f"{out_dir}/key.json", "w"), ensure_ascii=False)
json.dump(counts, open(f"{out_dir}/counts.json", "w"), ensure_ascii=False)
print(counts, len(sheet))
