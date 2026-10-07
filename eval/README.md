# eval — 読みの実測コーパス

HENGE のお題の条件（短文はかな8〜18字、単語は2〜10字、長文は150〜220字）に合わせて書いたお題と、
手で付けた期待の読み。調査の経緯と結果は `reports/2026-10-reading-audit.md`（round1〜6）と
`reports/2026-10-reading-audit-r7.md`（round7〜11）。

- `corpus/round1〜11.tsv`: 1行1件 `本文<TAB>期待の読み（ひらがな。別解は | 区切り）<TAB>テーマ<TAB>形式(s|w|l)`。
  ラウンドごとに新しいテーマで作っている（round1〜6 は約120テーマ・860件、round7〜11 は約200テーマ・1004件）
- `run-eval.ts`: HENGE の読み Worker と同じ組み立てで読んで照合し、正解率・UNKNOWN_READING・CER（文字誤り率）を出す

```sh
bun scripts/fetch-dict.ts
bun eval/run-eval.ts eval/corpus/*.tsv               # 本番構成（Release の辞書 + user-lex.csv）
bun eval/run-eval.ts --no-lex eval/corpus/*.tsv      # 辞書のみ
bun eval/run-eval.ts --show eval/corpus/round6.tsv   # 誤った件をトークン列つきで
UNIDIC_DIC_PATH=path/to/other.dic.zst bun eval/run-eval.ts --lex-shift 5376 eval/corpus/*.tsv
```

期待の読みは揺れうる。読みが2通り成り立つ語（深々・注ぐ・蛙・明日・〜所 等）は別解を並べてある。
件数の小さな差（1〜2件）は期待値の揺れの範囲として読むこと。
