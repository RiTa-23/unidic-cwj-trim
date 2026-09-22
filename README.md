# unidic-cwj-trim

**UniDic cwj-3.1.1 を軽量トリムし、Vibrato 向けにコンパイルした日本語形態素解析辞書。**

フルサイズ辞書とほぼ同等の読み精度を保ちながら、**zstd 圧縮で約 7MB・wasm メモリ使用量 +84MB** まで削減。**Cloudflare Workers の 128MB メモリ上限内に辞書を丸ごと載せられます。**

## ダウンロード

[Releases](https://github.com/RiTa-23/unidic-cwj-trim/releases) から `.dic.zst` を取得してください。

| アセット | 語彙数 | zst | wasm Δ（推定） | 特徴 |
|---|---|---|---|---|
| `unidic-cwj-v7800n-slim2.dic.zst`（推奨） | 539,835 | 6.9MB | +84.1MB | 精度とメモリのバランス最良。人名・固有名詞も収録 |
| `unidic-cwj-vmax2.dic.zst` | 588,931 | 7.4MB | +105.3MB | 最大語彙。ロード瞬間のメモリピークが128MBに際どい |

sha256（v7800n-slim2）: `aae2f56b6f88a2a6a2671a072248220166b708a1a4a8d2ffbff610d6c0d06d9f`

## 特徴

- **フルサイズとほぼ同等の読み精度**: 5,000文の実測で読み不明の差はごく僅か（フル比 63件 → トリム 71件）。「語彙が多すぎて変な読みを配信する」より「読めない→未登録（UNKNOWN）」に倒す設計
- **Cloudflare Workers 対応サイズ**: ロード後のwasmメモリ増分 +84.1MB。ロード瞬間ピーク ~104MB で128MB上限内に収まる
- **人名・固有名詞も収録**: 信長・織田信長・豊臣秀吉・卑弥呼・紫式部など正しく読める
- **読みに特化した最小化**: 各エントリの特徴文字列は読み（`features[7]`）のみ保持。残りは潰して約25MB削減（5,000文の読み出力と**完全同一**を検証済み）

## フォーマット

Vibrato の辞書フォーマット（`vibrato` CLI の `compile` 出力、`zstd -19` 圧縮）。9フィールド IPADIC 互換の feature 文字列を持ち、**読みは `features[7]`** に入ります。

```
use vibrato::{Dictionary, Tokenizer};
let dict = Dictionary::read_from_zstd(std::fs::File::open("unidic-cwj-v7800n-slim2.dic.zst")?)?;
let tokenizer = Tokenizer::new(dict);
// トークンの feature[7] がカタカナ読み
```

Cloudflare Workers（wasm-pack ビルドの vibrato-wasm）では、辞書を `assets/` に置いて `Reader.from_zstd` で初回リクエスト時に遅延ロードする構成を想定しています。

## ユースケース

- **エッジでの読み取得・振り仮名生成**（Cloudflare Workers / Deno Deploy 等のメモリ制約環境）
- **漢字かな混じりテキストのルビ付け**（タイピングゲームのお題、学習アプリ、読み上げ前処理）
- **形態素解析ベースの前処理**（検索クエリ正規化、分かち書き）
- 人名・地名・一般名詞を広くカバーするので、固有名詞を含む文の読みも取れます

## ユーザー辞書（user-lex.csv）

`user-lex.csv` は本辞書の上に重ねる Vibrato ユーザー辞書です。誤読修正の例外的なエントリを1行ずつ追記していきます。

- **管理場所**: このリポジトリで git 管理。誤読の表層（特に lid/rid は辞書ビルドの接続ID空間を参照する）を**辞書と同じ場所に置く**のが正しい
- **検証**: PR ごとに `bun scripts/validate-user-lex.ts` が構文チェックを走らせる（13列・lid/rid/cost整数・読みカタカナ）。誤読回帰の本検査（実際に読みが変わるか/壊れるか）は利用側（HENGE）の CI が辞書取得後に行うため、ここでは機械的な構文チェックのみ
- **コストの目安**: `-20000` = 熟語等の強制勝ち、`3000` = 別読みには勝ち・複合語には負ける、`~7500` + lid/rid借用 = 同表層エントリの差し替え

## 再ビルド

`scripts/` に再現レシピを同梱しています。

```sh
scripts/build_dict.sh   # cwj-3.1.1 ソース取得 → フィルタ → vibrato compile → zstd
```

- `scripts/filter_lex_v2.py`: lex.csv から語彙を絞り、特徴文字列を最小化するフィルタ（コスト閾値 V_MAX=7800 等）
- `scripts/build_dict.sh`: 一連のビルド手順（vibrato 0.5.2, compact connector bigram, cost_factor=700.0）
- `measure/`: wasmメモリ・読み出力の計測ハーネス（Rust）

## ライセンス

このリポジトリは2つのライセンスが混在します。

- **スクリプト・ドキュメント等のコード**（`scripts/`, `measure/`, 本 README）: [MIT License](LICENSE)
- **辞書アセット（`.dic.zst`）**: UniDic cwj-3.1.1 の派生物です。UniDic は GPL/LGPL/BSD のトリライセンスのうち、**本配布物では BSD ライセンスを選択**しています。再配布・利用の際は `LICENSE-BSD.unidic` / `COPYING.unidic` / `AUTHORS.unidic` の著作権表示を保持してください

辞書の詳しいライセンス条件は [UniDic の利用許諾](https://clrd.ninjal.ac.jp/unidic/) を参照してください。

## 謝辞

辞書データは国立国語研究所の [UniDic](https://clrd.ninjal.ac.jp/unidic/) cwj-3.1.1 を元にしています。形態素解析エンジンは [Vibrato](https://github.com/daac-tools/vibrato) を利用しています。

## 報告の自動取り込み（apply-reports）

HENGEのリザルト画面でユーザーが報告した読み違いは、管理画面で承認されると
このリポジトリの `apply-reports` ワークフロー（手動 or 日次cron）が拾い、
`user-lex.csv` に追記するPRを自動作成する。

1. HENGE管理画面で報告を承認（読みのカタカナ正規化とコストを確定 or 自動推定に委ねる）
2. ワークフローが `GET /api/admin/reading-reports?status=approved` を呼んで行を生成
   - lid/rid は `lid-rid-map.tsv.gz`（v7800n-slim2 の各表層の最小コストエントリ）を
     参照。表層が無ければ先頭1文字のエントリを借りる
   - コストは承認値。未指定は「漢字のみ2字以上→-20000、他→3000」で推定
3. `validate-user-lex` で構文検証してからPR作成（GH_TOKEN・GITHUB_TOKEN自動）
4. PRマージ → 次回実行（--mark-applied-only）でHENGE側が applied に閉じられる
   → HENGEのCI（誤読回帰テスト）がデプロイ時に走り、壊れた行は本番に出ない

### 必要な設定（このリポジトリの Settings）

| 名前 | 種別 | 内容 |
|---|---|---|
| `HENGE_ORIGIN` | Actions variable | HENGEの公開origin（例 `https://henge.app`） |
| `REPORTS_SYNC_TOKEN` | Actions secret | HENGEの `wrangler secret put REPORTS_SYNC_TOKEN` と同じ値 |
| `GITHUB_TOKEN` | 自動 | PR作成・pushに使用（permissions: contents/pull-requests write） |
