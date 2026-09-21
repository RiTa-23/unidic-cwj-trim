#!/bin/bash
# cwj-3.1.1 → トリム版 vibrato 辞書 (.dic.zst) 再現ビルド手順
# 前提: cargo (rust), zstd, python3 が入っていること
set -euo pipefail

WORK=${1:-/tmp/cwj311}
mkdir -p "$WORK" && cd "$WORK"

# --- 1. cwj-3.1.1 ソース一式を取得（full配布の個別ファイルURL） ---
BASE=https://clrd.ninjal.ac.jp/unidic_archive/cwj/3.1.1/unidic-cwj-3.1.1-full
for f in lex_3_1.csv char.def unk.def feature.def left-id.def right-id.def dicrc model.def; do
  [ -f "$f" ] || curl -fLO "$BASE/$f"
done
# lex_3_1.csv 233MB, model.def 392MB が大物

# --- 2. vibrato ビルド用ハーネスをコンパイル ---
# vibtest/: vibrato 0.5.2 (mecab feature) を使う小さい Rust CLI
#   modes: bigramgen <dir> / compile <lex.csv> <dir> [out.dic] / diff / tri / tok
cp -r ~/unidic-artifacts/vibtest /tmp/vibtest || true
cd /tmp/vibtest && cargo build --release && cd "$WORK"

# --- 3. bigram connector を生成（dense行列の代替。IDリマップ不要） ---
# model.def から素性ペア重みを生成 → bigram.{right,left,cost}
[ -f bigram.cost ] || /tmp/vibtest/target/release/vibtest bigramgen "$WORK"

# --- 4. lex をトリム（saf24レシピ: 機能語全保持+品詞別コスト閾値+人名全落とし） ---
python3 ~/unidic-artifacts/filter_lex_saf24.py lex_3_1.csv lex_cwj_saf24.csv

# --- 5. コンパイル（from_readers_with_bigram_info, dual_connector=false） ---
/tmp/vibtest/target/release/vibtest compile lex_cwj_saf24.csv "$WORK" unidic-cwj-saf24.dic

# --- 6. 圧縮: 必ず --long なしの -19 (--longはruzstdが128MBウィンドウを確保し計測を壊す) ---
zstd -19 -f unidic-cwj-saf24.dic -o unidic-cwj-saf24.dic.zst

echo "DONE: $WORK/unidic-cwj-saf24.dic.zst"
echo "成果物例: ~/unidic-artifacts/unidic-cwj-saf24.dic.zst (8.0MB, 519,496語, wasm +109MB)"
