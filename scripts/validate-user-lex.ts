/**
 * user-lex.csv の軽量構文検証。
 * 本格的な誤読回帰テスト（実際の読みが変わる/壊れるか）は HENGE 側の
 * `bun run --cwd apps/reading test` が担うため、ここでは「壊れた行を
 * 辞書リポに取り込まない」レベルの機械的チェックだけを行う。
 *
 * 使い方: `bun scripts/validate-user-lex.ts`（リポジトリルートから）
 */
import { readFileSync } from "node:fs";

const csvPath = new URL("../user-lex.csv", import.meta.url).pathname;
const text = readFileSync(csvPath, "utf8");
const lines = text.split("\n").filter((line) => line.length > 0 && !line.startsWith("#"));

const FIELD_COUNT = 13;
const CATEGORY = new Set(["名", "動", "形", "副", "連", "助", "接", "感", "代", "形動", "助動", "記", "固", "人名", "冠", "その他"]);
const POS = new Set(["名詞", "動詞", "形容詞", "副詞", "連体詞", "助詞", "接続詞", "感動詞", "代名詞", "形状詞", "助動詞", "記号", "固有名詞"]);

let errors = 0;
const fail = (lineNo: number, line: string, reason: string) => {
  errors++;
  console.error(`${lineNo}: ${reason}: ${line}`);
};

lines.forEach((line, i) => {
  const f = line.split(",");
  if (f.length !== FIELD_COUNT) {
    fail(i + 1, line, `列数が ${FIELD_COUNT} ではない（${f.length}列）`);
    return;
  }
  const [surface, lid, rid, cost, cat, , , , , , , reading] = f;
  if (!surface) fail(i + 1, line, "表層が空");
  if (!/^\d+$/.test(lid) || !/^\d+$/.test(rid)) fail(i + 1, line, "lid/rid が整数ではない");
  if (!/^-?\d+$/.test(cost)) fail(i + 1, line, "cost が整数ではない");
  if (cat !== "*" && !CATEGORY.has(cat)) fail(i + 1, line, `不明な品詞1文字: ${cat}`);
  if (!reading || !/^[ァ-ヶー]+$/.test(reading)) fail(i + 1, line, `読みがカタカナではない: ${reading}`);
});

// 表層の重複は vibrato 側で先勝ちではなく全エントリ競合するため警告のみ
const seen = new Map<string, number>();
for (const line of lines) {
  const s = line.split(",")[0];
  seen.set(s, (seen.get(s) ?? 0) + 1);
}
for (const [s, n] of seen) {
  if (n > 1) console.warn(`警告: 表層 ${s} が ${n} 行ある（読み違いエントリなら意図通り）`);
}

if (errors > 0) {
  console.error(`\n${errors} 件のエラー`);
  process.exit(1);
}
console.log(`OK: ${lines.length} 行を検証した`);
