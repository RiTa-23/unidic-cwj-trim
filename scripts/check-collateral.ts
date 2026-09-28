/**
 * 語彙の巻き込みチェック（#19）の CLI。仕組みは `scripts/lib/collateral.ts`。
 *
 * 使い方（リポジトリルートから。先に `bun scripts/fetch-dict.ts`）:
 *   bun scripts/check-collateral.ts [--base <git-ref>]
 *     作業ツリーの user-lex.csv と、<git-ref>（既定 origin/main）の user-lex.csv を比べ、
 *     **増えた行**の巻き込みを調べる。1語でもあれば終了コード1（PR の CI 用）
 *   bun scripts/check-collateral.ts --all
 *     全行を1行ずつ「その行を抜いた CSV」と比べる（既存の行の棚卸し用。常に終了コード0）
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { findRegressions, formatRegressions, surfaceOf } from "./lib/collateral";
import { Analyzer, CSV_PATH } from "./lib/reading";

const { values } = parseArgs({
  options: {
    base: { type: "string", default: "origin/main" },
    all: { type: "boolean", default: false },
  },
});

const csv = readFileSync(CSV_PATH, "utf8");
const lines = csv.split("\n").filter((line) => line !== "" && !line.startsWith("#"));

if (values.all) {
  const candidate = await Analyzer.open(csv);
  let total = 0;
  for (const [i, line] of lines.entries()) {
    const without = lines.filter((_, j) => j !== i).join("\n") + "\n";
    // 1行ずつ辞書を組み直すので遅い（1行数秒）。棚卸しのときだけ使う
    // oxlint-disable-next-line no-await-in-loop
    const base = await Analyzer.open(without);
    const regressions = findRegressions([surfaceOf(line)], base, candidate);
    base.close();
    if (regressions.length > 0) {
      total += regressions.length;
      console.log(`${i + 1}: ${line}`);
      for (const text of formatRegressions(regressions, 20)) console.log(`    ${text}`);
    }
  }
  console.log(`巻き込み: ${total}語`);
  process.exit(0);
}

const baseCsv = execFileSync("git", ["show", `${values.base}:user-lex.csv`], { encoding: "utf8" });
const baseLines = new Set(baseCsv.split("\n"));
const added = lines.filter((line) => !baseLines.has(line));
if (added.length === 0) {
  console.log(`${values.base} から増えた行はない`);
  process.exit(0);
}

const [base, candidate] = await Promise.all([Analyzer.open(baseCsv), Analyzer.open(csv)]);
const regressions = findRegressions(added.map(surfaceOf), base, candidate);
console.log(`増えた行: ${added.length}行`);
if (regressions.length === 0) {
  console.log("巻き込み: なし");
  process.exit(0);
}
console.log(`巻き込み: ${regressions.length}語`);
for (const text of formatRegressions(regressions, 20)) console.log(`  ${text}`);
console.log(
  "\n辞書の1語として読めていた語の読みが変わる。表層を前後に広げる・コストを上げる・" +
    "文脈つきエントリにするなどで直す。辞書の読みの方が誤っている場合だけ collateral-allow.tsv に足す",
);
process.exit(1);
