#!/usr/bin/env python3
# filter_lex_v2.py — cwj-3.1.1 lex_3_1.csv → v7800n-slim2 (推奨トリムv2) のlex生成
#   使い方: python3 filter_lex_v2.py lex_3_1.csv out.csv
#   変更点 vs saf24: 人名<6800復元・動詞<7800・特徴列を最小化(pos1を1文字・活用/原形/発音を"*")
#   実測: 539,835語 / zst 6.9MB / wasm +84.1MB / unk 71 / 5000文出力はsaf24とほぼ同等・人名は全復元
import csv, sys
csv.field_size_limit(sys.maxsize)

FUNC = {"助詞","助動詞","副詞","接続詞","感動詞","連体詞","接頭辞","形状詞",
        "記号","補助記号","空白","代名詞","数詞","接尾辞"}

# 閾値 (変更して再実験するならここだけ)
V_MAX, A_MAX, N_MAX, SN_MAX, P_MAX, NAME_MAX = 7800, 7200, 6200, 7800, 6800, 6800

def keep(r):
    cost = int(r[3]); p1, p2, p3 = r[4], r[5], r[6]
    if p1 in FUNC: return True
    if p1 == "動詞": return cost < V_MAX
    if p1 == "形容詞": return cost < A_MAX
    if p1 == "名詞":
        if p2 == "固有名詞": return cost < (NAME_MAX if p3 == "人名" else P_MAX)
        if p2 == "普通名詞": return cost < (SN_MAX if p3 == "サ変可能" else N_MAX)
        return cost < N_MAX
    return False

seen = set(); n = 0
with open(sys.argv[2], "w", encoding="utf-8", newline="") as f:
    out = csv.writer(f, lineterminator="\n")
    for r in csv.reader(open(sys.argv[1], encoding="utf-8")):
        if len(r) < 26 or not r[24] or r[24] == "*": continue
        if not keep(r): continue
        key = (r[0], r[24])
        if key in seen: continue
        seen.add(key)
        # 13列: surf,lid,rid,cost, pos1(1文字),*,*,*, *,*,*, f24読み, "*"
        # ※feature文字列は表示用のため最小化してもtokenize出力は不変(実測0.00%差)
        out.writerow([r[0], r[1], r[2], r[3], r[4][:1] if r[4] else "*",
                      "*", "*", "*", "*", "*", "*", r[24], "*"])
        n += 1
print(f"rows: {n}", file=sys.stderr)
