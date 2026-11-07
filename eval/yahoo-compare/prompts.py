#!/usr/bin/env python3
"""HENGE の本番のお題で、本番構成と Yahoo の読みを比べる。

    python3 -I prompts.py prepare <D1 の JSON 出力> <work>
    python3 -I prompts.py sheet <work>
    python3 -I prompts.py verdicts <work> <判定.txt> <出力.tsv>
    python3 -I prompts.py tally <判定.tsv>

prepare は同じ文を1つにまとめ、read-engine.ts と read-yahoo.py に渡す prompts.jsonl を作る。
sheet は読みが割れた文を、どちらの読みか伏せて sheet.tsv に書き、対応表を key.json に書く。
verdicts は sheet.tsv の番号ごとの判定（A / B / = / x）を、構成の名前に戻す。
"""
import difflib, json, random, re, sys
from collections import Counter

KANA = re.compile(r"^[ぁ-ゖー]+$")
FORMS = ["word", "sentence", "long"]
VERDICTS = ["prod", "yahoo", "both_ok", "both_bad"]


def k2h(s):
    return "".join(chr(ord(c) - 0x60) if "ァ" <= c <= "ヶ" else c for c in s)


def norm(s):
    return re.sub(r"[、。！？!?・「」\s]", "", k2h(s or ""))


def load(path):
    return [json.loads(l) for l in open(path, encoding="utf-8")]


def kana_by_id(path):
    return {r["id"]: norm(r["kana"]) for r in load(path)}


def prepare(export, work):
    seen = {}
    for r in json.load(open(export, encoding="utf-8"))[0]["results"]:
        seen.setdefault(r["text"], r)
    with open(f"{work}/prompts.jsonl", "w", encoding="utf-8") as f:
        for r in seen.values():
            f.write(json.dumps({"id": r["id"], "text": r["text"], "form": r["form"]}, ensure_ascii=False) + "\n")
    print(len(seen))


def splits(work):
    """(読みが割れた文, 却下を含む形式ごとの件数) を返す"""
    prod = kana_by_id(f"{work}/prompts.prod.jsonl")
    yahoo = {}
    for r in load(f"{work}/yahoo.cache.jsonl"):
        yahoo[r["text"]] = "" if "error" in r else norm("".join(w.get("furigana", w["surface"]) for w in r["words"]))
    out, stat = [], Counter()
    for r in load(f"{work}/prompts.jsonl"):
        p, y = prod[r["id"]], yahoo[r["text"]]
        stat[r["form"], "n"] += 1
        stat[r["form"], "prod_rejected"] += not KANA.match(p)
        stat[r["form"], "yahoo_rejected"] += not KANA.match(y)
        if KANA.match(p) and KANA.match(y) and p != y:
            out.append({**r, "p": p, "y": y})
    return out, stat


def sheet(work):
    rows, stat = splits(work)
    rng = random.Random(20261107)
    rows.sort(key=lambda _: rng.random())
    key = {}
    with open(f"{work}/sheet.tsv", "w", encoding="utf-8") as f:
        for n, r in enumerate(rows):
            swap = rng.random() < 0.5
            a, b = (r["y"], r["p"]) if swap else (r["p"], r["y"])
            diffs = [
                f"{a[max(0, i1 - 4):i2 + 4]} / {b[max(0, j1 - 4):j2 + 4]}"
                for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes()
                if tag != "equal"
            ]
            f.write(f"{n}\t{r['form']}\t{r['text']}\t{' ; '.join(diffs)}\n")
            key[n] = {"A": "yahoo" if swap else "prod", "id": r["id"], "form": r["form"], "p": r["p"], "y": r["y"]}
    json.dump(key, open(f"{work}/key.json", "w", encoding="utf-8"), ensure_ascii=False)
    print(len(rows), sorted(stat.items()))


def verdicts(work, marks, out):
    key = json.load(open(f"{work}/key.json", encoding="utf-8"))
    nolex = kana_by_id(f"{work}/prompts.nolex.jsonl")
    with open(out, "w", encoding="utf-8") as f:
        f.write("id\tform\tverdict\tnolex\n")
        for line in open(marks, encoding="utf-8"):
            n, mark = line.split()
            k = key[n]
            other = "yahoo" if k["A"] == "prod" else "prod"
            v = {"=": "both_ok", "x": "both_bad", "A": k["A"], "B": other}[mark]
            nl = nolex[k["id"]]
            same = "prod" if nl == k["p"] else "yahoo" if nl == k["y"] else "other"
            f.write(f"{k['id']}\t{k['form']}\t{v}\t{same}\n")


def tally(path, total=4512):
    rows = [l.rstrip("\n").split("\t") for l in open(path, encoding="utf-8")][1:]
    for form in FORMS + [None]:
        c = Counter(r[2] for r in rows if form is None or r[1] == form)
        print(form or "all", [c[v] for v in VERDICTS])
    print("prod wins by nolex", Counter(r[3] for r in rows if r[2] == "prod"))
    d = [(r[2] == "prod") - (r[2] == "yahoo") for r in rows]
    rng = random.Random(20261107)
    boot = sorted(sum(rng.choice(d) for _ in d) for _ in range(5000))
    pt = lambda x: round(100 * x / total, 2)
    print("diff pt", pt(sum(d)), "ci", pt(boot[125]), pt(boot[4875]))


cmd, args = sys.argv[1], sys.argv[2:]
{"prepare": prepare, "sheet": sheet, "verdicts": verdicts, "tally": tally}[cmd](*args)
