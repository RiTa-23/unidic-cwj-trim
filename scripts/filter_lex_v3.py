#!/usr/bin/env python3
# filter_lex_v3.py — cwj lex.csv → トリム辞書の lex（v3 案）。reports/2026-10-reading-audit.md の検証結果に基づく
#
#   使い方: python3 filter_lex_v3.py lex_3_1.csv out.csv [--unk unk.def --unk-out unk_shifted.def]
#   依存:   pip install wordfreq（頻出語の救済に使う。語の頻度表は wordfreq に同梱）
#
# v2（filter_lex_v2.py）からの変更点。どれも 783 文の実測で効果を確かめたもの:
#   1. 語コストに +5376（COST_SHIFT）を足す。compact bigram 接続表は MeCab の接続行列より
#      全ペアで一様に約 5376 低く、トークンが1つ増えるごとに 5376 得をする＝細かく割るほど勝つ。
#      各トークンは入ってくる接続をちょうど1本持つので、語コストに足せば打ち消せる。
#      **未知語（unk.def）とユーザー辞書（user-lex.csv）のコストにも同じ値を足すこと**
#   2. 重複除去を「表層+読み」から「表層+lid+rid+読み（最小コスト）」に変える。
#      表層+読みでは同形の別品詞（回し[名詞]/回し[動詞]・過ぎ[接尾辞]/過ぎ[動詞]）が先勝ちで消え、
#      「回して」「過ぎて」「干して」が 回/かい+して・過/か+ぎて に割れていた
#   3. 品詞別のコスト閾値に加えて、wordfreq の頻度（zipf）が FREQ_Z 以上の表層は、その表層の
#      最小コスト + FREQ_MARGIN までの行を残す（言葉・絵・皿・虹・洗っ・鳴く 等が閾値で落ちていた）
#   4. カタカナだけの名詞で読み＝表層の行は落とす（未知語でも表層のまま読めるので読みは変わらない。
#      約 8.8 万行減り、上の救済分を差し引いても v2 より小さい）
#   5. 補助記号・空白は読みが無くても残す（句読点が未知語になると前後の接続が崩れる）
#   6. 表層・lid・rid が同じで基本形より濁音形が安い組（川→ガワ・蛸→ダコ・小屋→ゴヤ）は、
#      濁音形の lid を接尾辞のもの（RENDAKU_LID）に替えてコストを RENDAKU_PEN 上げる。
#      lid/rid が同じだと文脈によらず濁音形が勝つ。接尾辞の lid にすると名詞の後（犬小屋・小春日和）では
#      勝ち、文頭や助詞の後では基本形に負ける
#   7. 特徴列を ",,,,,,,読み," に縮める（HENGE の読みは index 7 だけを見る）。wasm メモリ −8MB
import argparse, csv, math, re, sys
from collections import defaultdict

csv.field_size_limit(sys.maxsize)

FUNC = {"助詞", "助動詞", "副詞", "接続詞", "感動詞", "連体詞", "接頭辞", "形状詞",
        "記号", "補助記号", "空白", "代名詞", "数詞", "接尾辞"}
V_MAX, A_MAX, N_MAX, SN_MAX, P_MAX, NAME_MAX = 7800, 7200, 6200, 7800, 6800, 6800
COST_SHIFT = 5376
FREQ_Z, FREQ_MARGIN = 2.0, 3000
RENDAKU_LID, RENDAKU_PEN = "10234", 1500  # 10234 = 接尾辞-名詞的-一般 で最も多い lid
CONTENT = ("動詞", "形容詞", "名詞")
KATA_ONLY = re.compile(r"^[ァ-ヺー]+$")

# lex の列（表層,lid,rid,cost の後に特徴29列）
SURF, LID, RID, COST, POS1, POS2, POS3 = 0, 1, 2, 3, 4, 5, 6
IFORM, KANA = 18, 24


def keep_by_cost(r):
    cost = int(r[COST]); p1, p2, p3 = r[POS1], r[POS2], r[POS3]
    if p1 in FUNC: return True
    if p1 == "動詞": return cost < V_MAX
    if p1 == "形容詞": return cost < A_MAX
    if p1 == "名詞":
        if p2 == "固有名詞": return cost < (NAME_MAX if p3 == "人名" else P_MAX)
        if p2 == "普通名詞": return cost < (SN_MAX if p3 == "サ変可能" else N_MAX)
        return cost < N_MAX
    return False


def clamp16(v): return max(-32768, min(32767, v))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("lex"); ap.add_argument("out")
    ap.add_argument("--unk", help="unk.def。COST_SHIFT を足した版を --unk-out に書く")
    ap.add_argument("--unk-out")
    a = ap.parse_args()

    from wordfreq import get_frequency_dict
    zipf = {w: math.log10(f) + 9 for w, f in get_frequency_dict("ja").items()}

    rows = [r for r in csv.reader(open(a.lex, encoding="utf-8")) if len(r) > KANA]
    min_cost = {}
    for r in rows:
        if r[POS1] in CONTENT:
            min_cost[r[SURF]] = min(min_cost.get(r[SURF], 1 << 30), int(r[COST]))

    def keep(r):
        if r[POS1] in CONTENT and zipf.get(r[SURF], 0) >= FREQ_Z \
                and int(r[COST]) <= min_cost[r[SURF]] + FREQ_MARGIN:
            return True
        return keep_by_cost(r)

    kept, index = [], {}
    for r in rows:
        kana = r[KANA]
        if (not kana or kana == "*") and r[POS1] not in ("補助記号", "空白"): continue
        if not keep(r): continue
        if r[POS1] == "名詞" and KATA_ONLY.match(r[SURF]) and r[SURF] == kana: continue
        key = (r[SURF], r[LID], r[RID], kana)
        if key in index:
            if int(r[COST]) < int(kept[index[key]][COST]): kept[index[key]] = r
            continue
        index[key] = len(kept); kept.append(r)

    groups = defaultdict(list)
    for i, r in enumerate(kept): groups[(r[SURF], r[LID], r[RID])].append(i)
    remapped = 0
    for ix in groups.values():
        base = [int(kept[i][COST]) for i in ix if kept[i][IFORM] == "基本形"]
        if not base: continue
        for i in ix:
            if kept[i][IFORM] == "濁音形" and int(kept[i][COST]) < min(base):
                kept[i] = list(kept[i]); kept[i][LID] = RENDAKU_LID
                kept[i][COST] = str(int(kept[i][COST]) + RENDAKU_PEN); remapped += 1

    with open(a.out, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        for r in kept:
            kana = r[KANA] if r[KANA] else "*"
            w.writerow([r[SURF], r[LID], r[RID], clamp16(int(r[COST]) + COST_SHIFT),
                        "", "", "", "", "", "", "", kana, ""])
    print(f"rows: {len(kept)} (濁音形の付け替え {remapped})", file=sys.stderr)

    if a.unk:
        with open(a.unk_out, "w", encoding="utf-8", newline="") as f:
            w = csv.writer(f, lineterminator="\n")
            for r in csv.reader(open(a.unk, encoding="utf-8")):
                r[COST] = str(clamp16(int(r[COST]) + COST_SHIFT)); w.writerow(r)


if __name__ == "__main__":
    main()
