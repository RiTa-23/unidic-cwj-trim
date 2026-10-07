#!/bin/bash
# cwj-3.1.1 → トリム辞書 v3.1（unidic-cwj-v3.1.dic.zst）の再現ビルド。
# Release の辞書はこの手順で作る（.github/workflows/build-dict.yml が CI で同じものを回す）。
#
#   使い方: scripts/build_dict.sh [作業ディレクトリ（既定 /tmp/cwj311）]
#   前提:   cargo（rust）, python3（pip install -r scripts/requirements.txt）, zstd, curl
#   成果物: <作業>/build/unidic-cwj-v3.1.dic.zst と lid-rid-map.tsv.gz
#
# 規則は scripts/filter_lex_v3.py の先頭、根拠は reports/2026-10-reading-audit.md。
# compact bigram 接続表（vibrato の generate_bigram_info）は MeCab の接続行列より全ペアで
# 約5376低いので、filter_lex_v3.py が語彙と未知語の語コストに +5376 を足して打ち消す。
# **user-lex.csv のコストも同じ基準（+5376 済み）で書くこと。**
set -euo pipefail

REPO=$(cd "$(dirname "$0")/.." && pwd)
WORK=${1:-/tmp/cwj311}
BASE=https://clrd.ninjal.ac.jp/unidic_archive/cwj/3.1.1/unidic-cwj-3.1.1-full
mkdir -p "$WORK/build"
cd "$WORK"

# --- 1. cwj-3.1.1 の素材を取得し、sha256 を照合（lex_3_1.csv 233MB・model.def 392MB） ---
for f in char.def unk.def feature.def left-id.def right-id.def lex_3_1.csv model.def; do
  [ -f "$f" ] || curl -fsSLO "$BASE/$f"
done
sha256sum -c "$REPO/scripts/cwj-3.1.1.sha256"

# --- 2. vibrato 0.5.2 のハーネス（measure/）をビルド ---
(cd "$REPO/measure" && cargo build --release --locked)
VIBTEST="$REPO/measure/target/release/vibtest"

# --- 3. model.def から compact bigram 接続表を生成（dense 行列は Workers に載らない） ---
"$VIBTEST" bigramgen "$WORK"
cp char.def bigram.right bigram.left bigram.cost build/

# --- 4. 語彙を選び、語コスト・未知語コストに +5376 を足す ---
python3 "$REPO/scripts/filter_lex_v3.py" lex_3_1.csv build/lex.csv \
  --unk unk.def --unk-out build/unk.def --lid-rid-map build/lid-rid-map.tsv.gz

# --- 5. コンパイル（from_readers_with_bigram_info, dual_connector=false） ---
"$VIBTEST" compile build/lex.csv build build/unidic-cwj-v3.1.dic

# --- 6. 圧縮: 必ず --long なしの -19（--long は ruzstd が128MBの窓を確保してメモリを壊す） ---
zstd -19 -f -q build/unidic-cwj-v3.1.dic -o build/unidic-cwj-v3.1.dic.zst

sha256sum build/unidic-cwj-v3.1.dic build/unidic-cwj-v3.1.dic.zst build/lid-rid-map.tsv.gz
