# unidic-cwj-trim

**UniDic cwj-3.1.1 を軽量トリムし、Vibrato 向けにコンパイルした日本語形態素解析辞書。**

フルサイズ辞書と同等の読み精度を保ちながら、**zstd 圧縮で約 6MB・wasm メモリ使用量 +76MB** まで削減。**Cloudflare Workers の 128MB メモリ上限内に辞書を丸ごと載せられます。**

## ダウンロード

[Releases](https://github.com/RiTa-23/unidic-cwj-trim/releases) から `.dic.zst` を取得してください。

| Release | アセット | 語彙数 | zst | wasm Δ | 特徴 |
|---|---|---|---|---|---|
| `unidic-cwj-trim-v4` | `unidic-cwj-v3.2.dic.zst`（推奨） | 571,399 | 6.2MB | +78.4MB | v3.1 に、名詞の後で濁る形（証券会社→がいしゃ・砂時計→どけい）を選べる規則を足した（`reports/2026-10-kwdlc.md`） |
| `unidic-cwj-trim-v3` | `unidic-cwj-v3.1.dic.zst` | 571,399 | 6.2MB | +78.4MB | v3 に、動詞・形容詞の活用形の欠け（「合わない」「溶く」）を埋める規則を足した（`reports/2026-10-reading-audit-r7.md`） |
| `unidic-cwj-trim-v2` | `unidic-cwj-v3.dic.zst` | 539,203 | 6.0MB | +76.2MB | 接続表のずれを補正し、頻出語を救済。860件の実測で正解率 88.1%（v7800n-slim2 は 73.1%） |
| `unidic-cwj-trim-v1` | `unidic-cwj-v7800n-slim2.dic.zst`（旧） | 539,835 | 6.9MB | +84.1MB | 熟語を割って読む偏りがある（`reports/2026-10-reading-audit.md`） |

sha256（v3.2）: `f4775d178eb3aaaca9579cbcbd6c1d612a8072630d0733e7968e6c4317314e86`（展開後の `.dic` は `6601dc5dc0df4579102471e042f4f594cdf03f12064f8e7bc37ce6137fae03d8`）

v3.2 は `scripts/build_dict.sh`（CI では `build-dict` ワークフロー）で cwj-3.1.1 の配布物から再現ビルドする。
**語コストに +5376 を足してある**ので、ユーザー辞書を重ねるときは同じ基準で書くこと（下記）。

## 特徴

- **フルサイズと同等の読み精度**: お題860件の実測で、UniDic の全語彙を同じ接続表に載せた辞書（86.6%）と同等の 87.1%（ユーザー辞書なし）。頻出語（wordfreq の zipf ≥ 4）の欠落は 0語
- **Cloudflare Workers 対応サイズ**: ロード後のwasmメモリ増分 +76.2MB（v7800n-slim2 は +84.1MB）
- **人名・固有名詞も収録**: 信長・織田信長・豊臣秀吉・卑弥呼・紫式部など正しく読める
- **読みに特化した最小化**: 各エントリの特徴文字列は読み（`features[7]`）のみ保持。残りは潰して約25MB削減（5,000文の読み出力と**完全同一**を検証済み）

## フォーマット

Vibrato の辞書フォーマット（`vibrato` CLI の `compile` 出力、`zstd -19` 圧縮）。9フィールド IPADIC 互換の feature 文字列を持ち、**読みは `features[7]`** に入ります。

```
use vibrato::{Dictionary, Tokenizer};
let dict = Dictionary::read_from_zstd(std::fs::File::open("unidic-cwj-v3.2.dic.zst")?)?;
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
- **検証**: PR ごとに CI（`validate`）が次の3つを走らせる。**Release の差し替えはマージの後なので、ここを通っていない行は利用側（HENGE）に届かない**
  - 構文: `bun scripts/validate-user-lex.ts`（13列・lid/rid/cost整数・読みカタカナ）
  - 誤読回帰: `bun test`（`scripts/regression.test.ts`。直したい読みになるか・既存の複合語を壊さないか。行を足したら、その文と壊しそうな複合語をここに足す）
  - 語彙の巻き込み: `bun scripts/check-collateral.ts`。増えた行の表層を含む辞書の語を1語ずつ解析し、**辞書の1語として読めていた語の読みが変わったら失敗**にする。1字や語幹の裸登録（田→タ で 水田→みずた）はここで止まる。辞書の読みの方が誤っている場合だけ `collateral-allow.tsv` に足す
  - 手元では `bun scripts/fetch-dict.ts`（システム辞書を `.cache/` に取る）のあとに同じコマンドを打つ。既存の全行の棚卸しは `bun scripts/check-collateral.ts --all`（巻き込み）と `bun scripts/audit-rows.ts eval/corpus/*.tsv`（1行ずつ外して読みが変わる文を数える。`reports/2026-10-user-lex-cleanup.md`）
- **自動PR**: `apply-reports` が HENGE の承認済み報告から `bot/user-lex` ブランチの PR を1本だけ作り、実行のたびに作り直す。語彙の巻き込みがある行は PR に載せず、理由をジョブのサマリと PR 本文に出す
- **反映**: マージされると `release-user-lex` が Release を差し替え、HENGE の Deploy を `reread=true` で起動する。HENGE はデプロイが通ってから既存お題を再読みする
- **コストの基準（v3）**: 辞書 v3 は語コストに +5376 を足してあるので、**csv の値はずらす前の基準 +5376** で書く。目安は `-14624`（ずらす前 -20000）= 熟語等の強制勝ち、`8376`（3000）= 別読みには勝ち・複合語には負ける、`~12876`（~7500）+ lid/rid借用 = 同表層エントリの差し替え。HENGE の管理画面で選ぶ値（-20000／3000）はずらす前の基準のままで、`apply-reports` が csv に書くときに足す（`scripts/lib/cost.ts`）

## 再ビルド

`scripts/` に再現レシピを同梱しています。

```sh
pip install -r scripts/requirements.txt
scripts/build_dict.sh   # cwj-3.1.1 ソース取得（sha256 照合）→ bigram 生成 → フィルタ → vibrato compile → zstd
```

- `scripts/filter_lex_v3.py`: lex.csv から語彙を絞り、語コストを補正し、特徴列を最小化するフィルタ（規則と根拠は先頭のコメント）
- `scripts/build_dict.sh`: 一連のビルド手順（vibrato 0.5.2, compact connector bigram, cost_factor=700.0）。`.github/workflows/build-dict.yml` が同じ手順で Release に上げる
- `scripts/filter_lex_v2.py`: 旧辞書 v7800n-slim2 のフィルタ（参考）
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
   - lid/rid は `lid-rid-map.tsv.gz`（辞書 v3 の各表層の最小コストエントリ。`build_dict.sh` が作る）を
     参照。表層が無ければ先頭1文字のエントリを借りる
   - コストは承認値。未指定は「漢字のみ2字以上→-20000、他→3000」で推定。どちらもずらす前の基準で、
     csv には +5376 して書く
3. 構文検証・誤読回帰（`bun test`）・語彙の巻き込み（追加行をまとめて）を**push の前に**かけてから
   PR を作る（GH_TOKEN・GITHUB_TOKEN自動）。**bot の PR では `validate` が自動で走らない**
   （Actions のトークンで作った PR・push は別のワークフローを起動しない）ので、ここで検査する
4. PRマージ → `release-user-lex` が Release を差し替え、HENGE側の報告を applied に閉じ、
   HENGE の Deploy を起動する（デプロイの後に既存お題を再読み）

### 必要な設定（このリポジトリの Settings）

| 名前 | 種別 | 内容 |
|---|---|---|
| `HENGE_ORIGIN` | Actions variable | HENGEの公開origin（例 `https://henge.app`） |
| `REPORTS_SYNC_TOKEN` | Actions secret | HENGEの `wrangler secret put REPORTS_SYNC_TOKEN` と同じ値 |
| `GITHUB_TOKEN` | 自動 | PR作成・pushに使用（permissions: contents/pull-requests write） |
