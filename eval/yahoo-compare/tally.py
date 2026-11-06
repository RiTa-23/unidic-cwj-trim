"""読みが割れた文の判定を集計する。python3 -I tally.py <verdicts.tsv>

verdicts.tsv の1行目は `# counts {コーパス: {n, split}}`（sheet.py の counts.json）、以降は `corpus<TAB>id<TAB>判定`。
判定は prod（自前だけ正しい）、yahoo（Yahoo だけ正しい）、both（どちらも可）、neither（どちらも誤り）。
割れた文の中の割合に「割れた文の割合」を掛けて、全体での正解率の差を推定する。区間は文のブートストラップ。
"""
import collections, json, random, sys

lines = open(sys.argv[1], encoding="utf-8").read().splitlines()
counts = json.loads(lines[0].removeprefix("# counts "))
by = collections.defaultdict(list)
for line in lines[1:]:
    corpus, _, verdict = line.split("\t")
    by[corpus].append(verdict)


def diff(v, corpus):
    return (v.count("prod") - v.count("yahoo")) / len(v) * counts[corpus]["split"] / counts[corpus]["n"] * 100


rng = random.Random(5)
N = 4000
sims = {c: [diff([rng.choice(v) for _ in v], c) for _ in range(N)] for c, v in by.items()}
for c, v in by.items():
    k = collections.Counter(v)
    s = sorted(sims[c])
    print(f"{c}: n={len(v)} 割れ {counts[c]['split']}/{counts[c]['n']} 自前 {k['prod']} Yahoo {k['yahoo']} 両方可 {k['both']} 両方誤り {k['neither']} "
          f"差 {diff(v, c):+.2f}pt CI[{s[int(N * .025)]:+.2f},{s[int(N * .975)]:+.2f}]")
mean = sum(diff(v, c) for c, v in by.items()) / len(by)
pool = sorted(sum(sims[c][i] for c in by) / len(by) for i in range(N))
print(f"4コーパスの単純平均: 差 {mean:+.2f}pt CI[{pool[int(N * .025)]:+.2f},{pool[int(N * .975)]:+.2f}]")
