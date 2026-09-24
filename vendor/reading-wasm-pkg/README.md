# reading-wasm pkg（HENGE からの複製）

`RiTa-23/HENGE` の `packages/reading-wasm/pkg/` をそのまま複製したもの。
`apply-reports` ワークフローが報告コストの実測推定（#12）で Vibrato+Wasm の
Reader を実行するために使う。

HENGE 側の `packages/reading-wasm`（Rustソース）を更新して pkg を再生成したら、
このディレクトリの4ファイルを差し替えること（生成物なので手編集しない）。
