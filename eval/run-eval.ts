/**
 * 読みの実測。お題コーパス（`eval/corpus/*.tsv`）を HENGE の読み Worker と同じ組み立てで読み、
 * 期待の読みと照合する。調査の経緯と結果は `reports/2026-10-reading-audit.md`。
 *
 * TSV は1行1件で `本文<TAB>期待の読み（ひらがな。別解は | 区切り）<TAB>テーマ<TAB>形式(s|w|l)`。
 * 比べるときは句読点・！？と空白を両側から落とす（読みは記号をそのまま通すため）。
 *
 * 使い方（リポジトリルートから。先に `bun scripts/fetch-dict.ts`）:
 *   bun eval/run-eval.ts [--lex <csv>|--no-lex] [--lex-shift <n>] [--show] eval/corpus/*.tsv
 *     --lex        重ねるユーザー辞書（既定は user-lex.csv）
 *     --no-lex     ユーザー辞書を重ねない
 *     --lex-shift  ユーザー辞書の全行のコストに足す値。語コストをずらした辞書（filter_lex_v3 の
 *                  COST_SHIFT）に今の user-lex.csv を重ねるときに使う
 *     --show       誤った件をトークン列つきで出す
 *   システム辞書は `UNIDIC_DIC_PATH` で差し替えられる（.dic.zst）。
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { Analyzer, CSV_PATH, katakanaToHiragana } from "../scripts/lib/reading";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    lex: { type: "string" },
    "no-lex": { type: "boolean", default: false },
    "lex-shift": { type: "string", default: "0" },
    show: { type: "boolean", default: false },
  },
});

function loadLex(): string | null {
  if (values["no-lex"]) return null;
  const csv = readFileSync(values.lex ?? CSV_PATH, "utf8");
  const shift = Number(values["lex-shift"]);
  if (shift === 0) return csv;
  return csv
    .split("\n")
    .map((line) => {
      if (line === "" || line.startsWith("#")) return line;
      const f = line.split(",");
      f[3] = String(Math.max(-32768, Math.min(32767, Number(f[3]) + shift)));
      return f.join(",");
    })
    .join("\n");
}

const norm = (s: string) => katakanaToHiragana(s).replace(/[、。！？!?・「」\s]/gu, "");

/** 文字単位の編集距離（CER の分子） */
function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

const analyzer = await Analyzer.open(loadLex());
const total = { n: 0, ok: 0, unknown: 0, chars: 0, edits: 0 };

for (const path of positionals) {
  const rows = readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "" && !line.startsWith("#"))
    .map((line) => {
      const [text, expected, theme = "", form = ""] = line.split("\t");
      return { text, expected: expected.split("|").map(norm), theme, form };
    });
  const sub = { n: 0, ok: 0, unknown: 0, chars: 0, edits: 0 };
  for (const row of rows) {
    const result = analyzer.reading(row.text);
    const kana = "error" in result ? null : norm(result.kana);
    const ok = kana !== null && row.expected.includes(kana);
    sub.n++;
    sub.chars += row.expected[0].length;
    sub.edits += kana === null ? row.expected[0].length : Math.min(...row.expected.map((e) => distance(e, kana)));
    if (ok) sub.ok++;
    if (kana === null) sub.unknown++;
    if (!ok && values.show) {
      const tokens = analyzer
        .tokens(row.text)
        .map((t) => `${t.surface}/${t.reading ?? "∅"}`)
        .join(" ");
      const head = "error" in result ? `UNKNOWN_READING(${result.surface})` : "誤読";
      console.log(`[${head}] ${row.theme} ${row.text}\n  期待 ${row.expected[0]}\n  結果 ${kana}\n  ${tokens}`);
    }
  }
  for (const key of Object.keys(total) as (keyof typeof total)[]) total[key] += sub[key];
  console.log(format(path, sub));
}
if (positionals.length > 1) console.log(format("計", total));
analyzer.close();

function format(name: string, s: typeof total): string {
  const pct = ((s.ok / s.n) * 100).toFixed(1);
  const cer = ((s.edits / s.chars) * 100).toFixed(2);
  return `${name}: 正解 ${s.ok}/${s.n} (${pct}%) 誤読 ${s.n - s.ok - s.unknown} UNKNOWN_READING ${s.unknown} CER ${cer}%`;
}
