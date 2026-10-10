# 4者比較：初期版・最新版・UniDic フル・Yahoo ふりがな API（2026-10-10）

同じ文を、同じ採点ルールで4つの読み方に読ませた。スクリプトは `eval/compare/`。

## 比べた構成

| 構成 | 中身 | Workers |
|---|---|---|
| 初期版 | v1 辞書（`unidic-cwj-v7800n-slim2`）＋ 当時の user-lex 751行（`c740049` の時点。`reports/2026-10-reading-audit.md` の「本番」） | 載る（+84.1MB） |
| 最新版 | v3.2 辞書 ＋ 今の user-lex 196行 | 載る（+78.4MB） |
| 最新版の辞書だけ | v3.2 辞書。user-lex を重ねない | 載る |
| UniDic フル | UniDic 3.1.0 の MeCab 版（unidic-py の配布物。sys.dic 243MB ＋ matrix.bin 481MB）を fugashi で。読みは出現形の仮名（特徴列 index 20 ＝ トリム辞書と同じ列）。user-lex なし | 載らない |
| Yahoo API | Yahoo! ふりがな API V2（`grade=1`）に1文ずつ送る | 外部サービス |

UniDic フルは 3.1.0、トリム辞書の元は 3.1.1 で、版が少し違う。フルは本来の接続表（MeCab の接続行列）を使うので、
`reports/2026-10-reading-audit.md` の「フル語彙・同じ接続表」（compact 接続表に全語彙を載せたもの）とは別物。

## 採点

`eval/compare/score.py`（`eval/run-eval.ts` と同じ正規化）。句読点・！？・「」と空白を落として、別解のどれかと一致すれば正解。
読みに漢字が残った文と、読めなかった文は**却下**に数える。

- Yahoo は漢数字（一・九 等）に読みを返さない（「九回裏」→「九かいうら」）。この文は却下に入る
- KWDLC の1文（「ドアーズのギタリストの名前は分かるかな？」）に Yahoo が Invalid params を返した。これも却下に数えた
- Yahoo は改行でつないでまとめて送ると、前の文の末尾と続けて解析される（「…煮込む\n包丁で」→ ぼうちょう）ので、1文ずつ送った

## 結果（正解率 / 誤読 / 却下）

| 構成 | 自作お題 round1〜6（860件） | round7〜11（1,004件） | KWDLC（10,716文） |
|---|---|---|---|
| 初期版 | 72.6% / 213 / 23 | 74.9% / 228 / 24 | 62.2% / 3,848 / 208 |
| **最新版** | **91.5%** / 73 / 0 | **98.5%**※ / 15 / 0 | **87.1%** / 1,373 / 6 |
| 最新版の辞書だけ | 88.0% / 103 / 0 | 90.0% / 100 / 0 | 83.1% / 1,805 / 6 |
| UniDic フル | 86.0% / 120 / 0 | 89.1% / 109 / 0 | 82.4% / 1,885 / 4 |
| Yahoo API | 90.8% / 47 / 32 | 94.2% / 42 / 16 | 85.1% / 1,435 / 167 |

※ round7〜11 は user-lex の行を選ぶのに使ったコーパスなので、最新版の 98.5% は参考値（`reports/2026-10-reading-audit-r7.md`）。
KWDLC も dev 側の半分を user-lex の調整に使っている（`reports/2026-10-kwdlc.md`）。ほかの構成と同じ条件で比べるなら「最新版の辞書だけ」の行を見る。

文字誤り率（CER。却下の文は全文字を誤りに数える）: KWDLC で 初期版 5.11%、最新版 0.95%、辞書だけ 1.15%、フル 1.15%、Yahoo 2.70%。
Yahoo の CER が高いのは、却下（漢数字）の文を全文字誤りに数えるため。

KWDLC のうち、かな18字以下の短い文（1,402文。短文のお題と同じ長さ）: 初期版 75.1%、最新版 91.4%、辞書だけ 88.7%、フル 87.6%、Yahoo 90.7%。

## 読み取れること

- **最新版は初期版より 19〜25 ポイント高い。** 却下も KWDLC で 208 → 6
- **最新版の辞書だけで、UniDic フルを3つとも上回る。** KWDLC では最新版の辞書だけが正解した文が 182、フルだけが正解した文が 104。
  濁音形の付け替え（規則6・9）や活用形の補完などの規則が効いていると考えられる（文ごとの原因は分けていない）
- **Yahoo との差は、辞書だけなら Yahoo が 2〜4 ポイント上、user-lex 込みなら最新版が上。** 得意が違う
  - Yahoo が正しく最新版が誤る例: 植木鉢・賽銭箱・松葉杖（複合語の濁り）、種（たね）、的（まと）
  - 最新版が正しく Yahoo が誤る例: 漢数字（一晩・九回）、無人島→むじんじま、盛る→さかる、値→ね、天の川→てんのかわ

## メモリ（参考）

Vibrato 本体（`vendor/reading-wasm-pkg`、wasm 260KB）の起動直後の wasm メモリは 1.1MB。辞書を読み込むと v1 は 85.3MB（+84.2MB）、
v3.2 は 79.1MB（+78.0MB、user-lex 込みで +78.1MB）になる（MB = 10⁶ バイト）。README の「wasm Δ」は、この Vibrato 本体の上に
辞書の分が上乗せされた量。1,800字の文を解析しても wasm メモリは増えなかった。

## 再現

```sh
bun scripts/fetch-dict.ts
# 初期版の辞書と user-lex
curl -L -o .cache/v1.dic.zst https://github.com/RiTa-23/unidic-cwj-trim/releases/download/unidic-cwj-trim-v1/unidic-cwj-v7800n-slim2.dic.zst
git show c740049:user-lex.csv > /tmp/user-lex-initial.csv

UNIDIC_DIC_PATH=.cache/v1.dic.zst bun eval/compare/dump-trim.ts /tmp/user-lex-initial.csv corpus.tsv > init.out
bun eval/compare/dump-trim.ts user-lex.csv corpus.tsv > latest.out
bun eval/compare/dump-trim.ts none corpus.tsv > latest_nolex.out
python3 eval/compare/read-full-unidic.py /path/to/unidic corpus.tsv > full.out   # pip install fugashi
python3 eval/compare/read-yahoo.py corpus.tsv > yahoo.out                        # YAHOO_APPID が要る
python3 eval/compare/score.py corpus.tsv init.out latest.out latest_nolex.out full.out yahoo.out
```

`corpus.tsv` は `eval/corpus/round1〜6.tsv` を連結したもの・`round7〜11.tsv` を連結したもの・KWDLC を `eval/kwdlc2tsv.py` で変換したもの。
KWDLC の文と読みの出力はリポジトリに入れない（`eval/README.md`）。Yahoo の結果は API 側の更新で変わりうる。
