/**
 * user-lex.csv の行の棚卸し（#41）。1行ずつ「その行を抜いた CSV」で文を読み直し、読みが変わる文を数える。
 *
 * ユーザー辞書の行は、その表層を含む文にしか効かない。そこで行ごとに、表層を含む文だけを
 * 「今の CSV」と「その行を抜いた CSV」で読み比べる。期待の読みがある文は、変化を次に分ける。
 *   - fixed:  行を抜くと正しくなる（その行が誤読を作っている）
 *   - broken: 行を抜くと誤る（その行が効いている）
 *   - other:  誤り → 別の誤り、または期待の読みが無い文での変化
 * 表層そのもの（1語だけの文）も、今の読みを期待値として必ず読み比べる。
 *
 * 使い方（リポジトリルートから。先に `bun scripts/fetch-dict.ts`）:
 *   bun scripts/audit-rows.ts [--rows <n,n,...>] [--remove-unchanged] [--out <csv>] <tsv>...
 *     <tsv>               `本文<TAB>期待の読み（別解は | 区切り）<TAB>…`（eval/corpus と同じ）。
 *                         scripts/regression.test.ts の「ユーザー辞書で誤読が直る」の文はいつも足す
 *     --rows              調べる行（コメントを除いた1始まりの行番号）。省略すると全行
 *     --remove-unchanged  読みがどれも変わらなかった行を、その場で CSV から抜いてから次の行を調べる
 *                         （抜いた後の CSV を基準に次を調べるので、まとめて抜いても読みは変わらない）
 *     --out               --remove-unchanged の結果の CSV を書く先
 *   結果は標準出力に TSV（行番号, 行, 文の数, fixed, broken, other, 例）。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { Analyzer, CSV_PATH, katakanaToHiragana } from "./lib/reading";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    rows: { type: "string" },
    "remove-unchanged": { type: "boolean", default: false },
    out: { type: "string" },
  },
});

interface Sentence {
  text: string;
  /** 期待の読み（正規化済み）。無ければ空 */
  expected: string[];
}

const norm = (s: string) => katakanaToHiragana(s).replace(/[、。！？!?・「」\s]/gu, "");

function loadTsv(path: string): Sentence[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "" && !line.startsWith("#"))
    .map((line) => {
      const [text, expected = ""] = line.split("\t");
      return { text, expected: expected === "" ? [] : expected.split("|").map(norm) };
    });
}

/** 回帰テストのうち、ユーザー辞書を重ねて読む節の [文, 期待の読み] */
function loadRegression(): Sentence[] {
  const path = fileURLToPath(new URL("./regression.test.ts", import.meta.url));
  const source = readFileSync(path, "utf8");
  const start = source.indexOf('describe("ユーザー辞書で誤読が直る"');
  const end = source.indexOf("describe(", start + 1);
  return [...source.slice(start, end).matchAll(/\["([^"]+)", "([^"]+)"\]/g)].map((m) => ({
    text: m[1],
    expected: [norm(m[2])],
  }));
}

const sentences = [...positionals.flatMap(loadTsv), ...loadRegression()];

const header = (line: string) => line === "" || line.startsWith("#");
let lines = readFileSync(CSV_PATH, "utf8").split("\n").filter((line) => !header(line));
const original = [...lines];
const targets = values.rows
  ? values.rows.split(",").map((n) => original[Number(n) - 1])
  : [...original];

const kanaOf = (analyzer: Analyzer, text: string) => {
  const result = analyzer.reading(text);
  return "error" in result ? `（読めない: ${result.surface}）` : norm(result.kana);
};

let current = await Analyzer.open(`${lines.join("\n")}\n`);
console.log(["行", "行の中身", "文", "fixed", "broken", "other", "例"].join("\t"));

for (const target of targets) {
  const surface = target.slice(0, target.indexOf(","));
  const without = lines.filter((line) => line !== target);
  const candidate = await Analyzer.open(`${without.join("\n")}\n`);
  const affected: Sentence[] = [
    { text: surface, expected: [] },
    ...sentences.filter((s) => s.text.includes(surface)),
  ];
  let fixed = 0;
  let broken = 0;
  let other = 0;
  const examples: string[] = [];
  for (const sentence of affected) {
    const before = kanaOf(current, sentence.text);
    const after = kanaOf(candidate, sentence.text);
    if (before === after) continue;
    const okBefore = sentence.expected.includes(before);
    const okAfter = sentence.expected.includes(after);
    const mark = okAfter && !okBefore ? "+" : okBefore && !okAfter ? "-" : "~";
    if (mark === "+") fixed++;
    else if (mark === "-") broken++;
    else other++;
    if (examples.length < 6) examples.push(`${mark}${sentence.text}: ${before}→${after}`);
  }
  const index = original.indexOf(target) + 1;
  console.log([index, target, affected.length, fixed, broken, other, examples.join(" / ")].join("\t"));
  if (values["remove-unchanged"] && fixed + broken + other === 0) {
    lines = without;
    current.close();
    current = candidate;
  } else {
    candidate.close();
  }
}

if (values.out) writeFileSync(values.out, `${lines.join("\n")}\n`);
