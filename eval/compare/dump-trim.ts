/**
 * トリム辞書（＋ユーザー辞書）で TSV の各文を読み、1行1文で出す（読めなければ `<UNK>`）。
 * 4者比較（reports/2026-10-four-way.md）で、ほかの読み方と同じ採点（score.py）にかけるため。
 *
 *   bun eval/compare/dump-trim.ts <user-lex.csv|none> <tsv> > out.txt
 *   システム辞書は `UNIDIC_DIC_PATH` で差し替える（既定は Release の v3.2）。
 */
import { readFileSync } from "node:fs";
import { Analyzer, katakanaToHiragana } from "../../scripts/lib/reading";

const [lexPath, tsv] = process.argv.slice(2);
const analyzer = await Analyzer.open(lexPath === "none" ? null : readFileSync(lexPath, "utf8"));
const out: string[] = [];
for (const line of readFileSync(tsv, "utf8").split("\n")) {
  if (line.trim() === "" || line.startsWith("#")) continue;
  const result = analyzer.reading(line.split("\t")[0]);
  out.push("error" in result ? "<UNK>" : katakanaToHiragana(result.kana));
}
console.log(out.join("\n"));
analyzer.close();
