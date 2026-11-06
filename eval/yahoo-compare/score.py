"""自前エンジン（prod / nolex）と Yahoo を採点する。python3 -I score.py <work> [--partial]

却下 = 読みが返らない（Yahoo のエラー、自前の UNKNOWN_READING）か、読みに漢字が残った文。
正解率は却下を不正解に数える。誤読率と別に出すので、却下の扱いで差が動くかが見える。
--partial は Yahoo がまだ読んでいない文を全構成から外す（途中経過を見るため）。
"""
import json, math, random, re, sys

work = sys.argv[1]
PARTIAL = "--partial" in sys.argv
HAN = re.compile(r"[㐀-鿿々〆]")


def k2h(s):
    return "".join(chr(ord(c) - 0x60) if "ァ" <= c <= "ヶ" else c for c in s)


def norm(s):
    return re.sub(r"[、。！？!?・「」\s]", "", k2h(s))


O_ROW = set("おこそとのほもよろをごぞどぼぽょ")
U_ROW = set("うくすつぬふむゆるぐずづぶぷゅ")


def canon(s):
    """点字の長音表記（とーじ）と仮名表記（とうじ）を同じ形にする。青空文庫の採点専用で、両者に同じくかける"""
    out = []
    for c in norm(s):
        p = out[-1] if out else ""
        if c == "う" and p in O_ROW | U_ROW and p:
            out.append("ー")
        elif c == "お" and p in O_ROW and p:
            out.append("ー")
        else:
            out.append(c)
    return "".join(out)


def load(path):
    return [json.loads(l) for l in open(path, encoding="utf-8")]


yahoo = {}
for r in load(f"{work}/yahoo.cache.jsonl"):
    yahoo[r["text"]] = None if "error" in r else "".join(k2h(w.get("furigana", w["surface"])) for w in r["words"])


def distance(a, b):
    prev = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        cur = [i]
        for j in range(1, len(b) + 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] != b[j - 1])))
        prev = cur
    return prev[-1]


def get(corpus):
    rows = load(f"{work}/{corpus}.jsonl")
    prod = {r["id"]: r["kana"] for r in load(f"{work}/{corpus}.prod.jsonl")}
    nolex = {r["id"]: r["kana"] for r in load(f"{work}/{corpus}.nolex.jsonl")}
    out = []
    for r in rows:
        if r["text"] not in yahoo:
            if PARTIAL:
                continue
            raise SystemExit(f"Yahoo 未取得: {corpus} {r['id']}")
        out.append({**r, "prod": prod[r["id"]], "nolex": nolex[r["id"]], "yahoo": yahoo[r["text"]]})
    return out


def rejected(h):
    return h is None or HAN.search(h) is not None


def bootstrap(rows, ok_a, ok_b, n=2000):
    """文書単位のブートストラップで 正解率の差（a − b）の95%区間を出す。同じ文書の文は独立でないため"""
    docs = {}
    for r, a, b in zip(rows, ok_a, ok_b):
        d = docs.setdefault(r.get("doc", r["id"]), [0, 0])
        d[0] += a - b
        d[1] += 1
    items = list(docs.values())
    rng = random.Random(1)
    vals = []
    for _ in range(n):
        s = t = 0
        for _ in items:
            x = items[rng.randrange(len(items))]
            s += x[0]
            t += x[1]
        vals.append(s / t * 100)
    vals.sort()
    return vals[int(n * 0.025)], vals[int(n * 0.975)]


def gold_table(corpus, fn):
    rows = get(corpus)
    print(f"\n## {corpus}  n={len(rows)}")
    res = {}
    for k in ("prod", "nolex", "yahoo"):
        ok, mis, rej, ed, ch = [], 0, 0, 0, 0
        for r in rows:
            g = fn(r["gold"])
            ch += len(g)
            if rejected(r[k]):
                rej += 1
                ok.append(0)
                ed += len(g)
                continue
            h = fn(r[k])
            good = h == g
            ok.append(int(good))
            mis += not good
            ed += distance(h, g) if len(g) < 400 else 0
        res[k] = ok
        print(f"{k:6} 正解 {sum(ok):6} ({sum(ok)/len(rows)*100:5.2f}%)  誤読 {mis:5}  却下 {rej:4}  CER {ed/ch*100:.2f}%")
    for k in ("prod", "nolex"):
        b = sum(a and not y for a, y in zip(res[k], res["yahoo"]))
        c = sum(y and not a for a, y in zip(res[k], res["yahoo"]))
        z = (b - c) / math.sqrt(b + c) if b + c else 0
        lo, hi = bootstrap(rows, res[k], res["yahoo"])
        print(f"{k} − yahoo: 自前のみ正解 {b} / Yahooのみ正解 {c}  差 {(b-c)/len(rows)*100:+.2f}pt  95%CI[{lo:+.2f}, {hi:+.2f}]  McNemar z={z:.2f}")


def agree_table(corpus):
    rows = get(corpus)
    print(f"\n## {corpus}（正解データなし） n={len(rows)}")
    for k in ("prod", "nolex"):
        same = sum(not rejected(r[k]) and not rejected(r["yahoo"]) and norm(r[k]) == norm(r["yahoo"]) for r in rows)
        print(f"{k} と Yahoo の一致 {same} ({same/len(rows)*100:.2f}%)")
    for k in ("prod", "nolex", "yahoo"):
        print(f"{k} 却下 {sum(rejected(r[k]) for r in rows)}")


def head_table():
    rows = get("wikipedia_head")
    print(f"\n## wikipedia_head（見出し語の読みのみ人手） n={len(rows)}")
    res = {}
    for k in ("prod", "nolex", "yahoo"):
        ok = [int(not rejected(r[k]) and norm(r[k]).startswith(norm(r["gold_head"]))) for r in rows]
        res[k] = ok
        print(f"{k:6} 正解 {sum(ok):6} ({sum(ok)/len(rows)*100:5.2f}%)  却下 {sum(rejected(r[k]) for r in rows)}")
    for k in ("prod", "nolex"):
        b = sum(a and not y for a, y in zip(res[k], res["yahoo"]))
        c = sum(y and not a for a, y in zip(res[k], res["yahoo"]))
        lo, hi = bootstrap(rows, res[k], res["yahoo"])
        print(f"{k} − yahoo: 自前のみ {b} / Yahooのみ {c}  差 {(b-c)/len(rows)*100:+.2f}pt  95%CI[{lo:+.2f}, {hi:+.2f}]")


gold_table("kwdlc", norm)
gold_table("aozora", canon)
agree_table("livedoor")
if not PARTIAL or __import__("os").path.exists(f"{work}/wikipedia.prod.jsonl"):
    agree_table("wikipedia")
    head_table()
