/**
 * HENGEの承認済み読み違い報告を user-lex.csv に反映する（#200）。
 *
 * 流れ:
 *   1. GET  {HENGE_ORIGIN}/api/admin/reading-reports?status=approved
 *      （Bearer REPORTS_SYNC_TOKEN）で承認済み行を取得
 *   2. 各行を user-lex 13列の行に変換して追記:
 *      - lid/rid: lid-rid-map.tsv（v7800n-slim2 同表層の最小コストエントリ）を引く。
 *        表層そのものが無ければ先頭1文字の名詞エントリを借りる
 *      - 品詞は借用元の pos1（なければ名詞扱い）
 *      - cost: 報告の承認値。未指定なら「全部漢字2字以上→-20000、それ以外→3000」の
 *        ヒューリスティックで自動推定。
 *        `UNIDIC_DIC_PATH` と `READING_WASM_PKG_DIR` が揃っていれば、代わりに
 *        実測ミニマム探索（#12: promptText を再トークナイズして
 *        expectedKana が切れる最小コスト）を使う。検証ログは
 *        /tmp/user-lex-cost-log.md に残す（PR本文用）。
 *   3. 同一（表層, 読み）の報告は1行に集約。文脈ごとに実測コストが違う場合は
 *      全文脈で勝てる最小値を採用する
 *   4. すでに csv にある行（surface+読み一致）はスキップ。approved 行のうち
 *      csv にあるものは適用完了とみなし POST /applied に id を返す
 *   5. 変更があれば git 差分として残す（PR化は呼び出し側のワークフローがやる）
 *
 * 使い方:
 *   REPORTS_SYNC_TOKEN=... HENGE_ORIGIN=https://henge.app \
 *     bun scripts/apply-reports.ts [--mark-applied-only]
 *
 * --mark-applied-only: 追記せず、すでにcsvに入っている報告の applied 通知だけする
 *   （辞書PRのマージ後の再実行でキューを閉じる用）
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, appendFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const root = new URL("..", import.meta.url).pathname;
const csvPath = `${root}user-lex.csv`;
const mapPath = `${root}lid-rid-map.tsv.gz`;
const markOnly = process.argv.includes("--mark-applied-only");

const token = process.env.REPORTS_SYNC_TOKEN;
const origin = process.env.HENGE_ORIGIN;
if (!token || !origin) {
  console.error("REPORTS_SYNC_TOKEN と HENGE_ORIGIN が必要です");
  process.exit(2);
}

interface Report {
  id: string;
  promptText: string;
  surface: string;
  reportedKana: string;
  expectedKana: string;
  cost: number | null;
}

// ---- lid/rid 参照マップ（gzip tsv: surface\tlid\trid\tpos1） ----
const map = new Map<string, { lid: string; rid: string; pos1: string }>();
for (const line of gunzipSync(readFileSync(mapPath)).toString("utf8").split("\n")) {
  if (!line || line.startsWith("#")) continue;
  const [surf, lid, rid, pos1] = line.split("\t");
  if (surf) map.set(surf, { lid, rid, pos1 });
}

function connector(surface: string): { lid: string; rid: string; pos1: string } {
  const hit = map.get(surface);
  if (hit) return hit;
  const first = [...surface][0];
  const byChar = first ? map.get(first) : undefined;
  if (byChar) return byChar;
  // フォールバック: 名詞の代表（辞書にある「の」の名詞用法は拾えないので固定値）
  return { lid: "3026", rid: "6777", pos1: "名" };
}

function estimateCost(surface: string): number {
  // 熟語（漢字のみ2字以上）は常勝させる。語幹・単漢字・かな混じりは控えめに
  const allKanji = [...surface].every((c) => /[一-龯々]/.test(c));
  return allKanji && [...surface].length >= 2 ? -20000 : 3000;
}

// ---- 既存csv ----
const existingCsv = existsSync(csvPath) ? readFileSync(csvPath, "utf8") : "";
const existing = new Set<string>();
for (const line of existingCsv.split("\n")) {
  if (!line || line.startsWith("#")) continue;
  const f = line.split(",");
  existing.add(`${f[0]}\t${f[11]}`);
}

// ---- 実測ミニマムコスト探索（#12）。環境変数が揃ったときだけ有効 ----
const dicPath = process.env.UNIDIC_DIC_PATH;
const pkgDir = process.env.READING_WASM_PKG_DIR;
let costReader: import("./cost-reader").CostReader | null = null;
if (dicPath && pkgDir && existsSync(dicPath)) {
  const { CostReader } = await import("./cost-reader");
  costReader = await CostReader.load(dicPath, pkgDir, existingCsv);
  console.log("実測コスト探索: 有効");
} else {
  console.log("実測コスト探索: 辞書/pkg未指定のためスキップ（ヒューリスティック）");
}
const costLog: string[] = [];
const unresolved: string[] = [];

// ---- 承認済み報告を取得 ----
const res = await fetch(
  `${origin}/api/admin/reading-reports?status=approved&limit=200`,
  { headers: { authorization: `Bearer ${token}` } },
);
if (!res.ok) {
  console.error(`報告の取得に失敗: ${res.status} ${await res.text()}`);
  process.exit(1);
}
const { reports } = (await res.json()) as { reports: Report[] };
console.log(`approved: ${reports.length}件`);

// ---- 同一（表層, 読み）の報告を1行に集約 ----
// 既存csvとの照合では同一バッチ内の重複を拾えないため先にグルーピングする。
// 文脈ごとに「勝てる最小コスト」が違うので、グループ内の全文脈で実測し、
// 全文脈で勝てる最小値（=最も低いコスト）を採用して1行だけ書く。
interface Group {
  surface: string;
  expectedKana: string;
  reports: Report[];
}
const groups = new Map<string, Group>();
for (const r of reports) {
  const key = `${r.surface}\t${r.expectedKana}`;
  const g = groups.get(key) ?? { surface: r.surface, expectedKana: r.expectedKana, reports: [] };
  g.reports.push(r);
  groups.set(key, g);
}

const appliedIds: string[] = [];
const newLines: string[] = [];
for (const [key, g] of groups) {
  const ids = g.reports.map((r) => r.id);
  if (existing.has(key)) {
    appliedIds.push(...ids);
    continue;
  }
  if (markOnly) continue;
  const conn = connector(g.surface);
  const template = `${g.surface},${conn.lid},${conn.rid},{cost},${conn.pos1},*,*,*,*,*,*,${g.expectedKana},*`;
  let cost = g.reports.find((r) => r.cost !== null)?.cost ?? null;
  if (cost === null && costReader) {
    const texts = [...new Set(g.reports.map((r) => r.promptText))];
    let best: number | null = null;
    let failed = 0;
    for (const t of texts) {
      const pick = costReader.pickCost(t, g.surface, g.expectedKana, template);
      if (pick.cost === null) failed += 1;
      else if (best === null || pick.cost < best) best = pick.cost;
    }
    if (best !== null) {
      cost = best;
      const how =
        g.reports.length > 1
          ? `${g.reports.length}件を集約・全文脈で勝つ最小値`
          : "実測で勝った最小値";
      costLog.push(`- \`${g.surface}\` → ${g.expectedKana}: cost **${cost}**（${how}）`);
    }
    if (failed > 0) {
      unresolved.push(g.surface);
      costLog.push(
        `- \`${g.surface}\` → ${g.expectedKana}: **${failed}/${texts.length}文脈が未解決**（-20000でも勝たず。複合エントリか手動設計が必要${best === null ? `。暫定 ${estimateCost(g.surface)}` : ""}）`,
      );
    }
  }
  cost ??= estimateCost(g.surface);
  newLines.push(template.replace("{cost}", String(cost)));
  appliedIds.push(...ids); // このPRに載った行も、このPRがマージされれば適用完了
}

if (newLines.length > 0) {
  appendFileSync(csvPath, newLines.join("\n") + "\n");
  console.log(`追記: ${newLines.length}行`);
} else {
  console.log("追記なし");
}

// ---- 巻き込みチェック（#12）: 最終csvで各報告の promptText を再トークナイズし、
// 報告表層の範囲外で変わった読み・切れ目を拾う ----
if (costReader && newLines.length > 0) {
  const extraCsv = newLines.join("\n") + "\n";
  const collateral: string[] = [];
  const seenCtx = new Set<string>();
  for (const r of reports) {
    if (existing.has(`${r.surface}\t${r.expectedKana}`)) continue;
    const ctxKey = `${r.promptText} ${r.surface}`;
    if (seenCtx.has(ctxKey)) continue;
    seenCtx.add(ctxKey);
    for (const d of costReader.collateralDiff(r.promptText, r.surface, extraCsv)) {
      collateral.push(`- \`${r.surface}\` 周辺: ${d}（${r.promptText.slice(0, 20)}…）`);
    }
  }
  costLog.push("", "### 巻き込みチェック（報告promptTextの読み diff）");
  if (collateral.length === 0) {
    costLog.push("- 報告対象以外の読みに変化なし");
  } else {
    costLog.push(...collateral.map((c) => `${c} ⚠️`));
  }
  writeFileSync(
    "/tmp/user-lex-cost-log.md",
    `## 実測コスト探索の検証ログ\n\n${costLog.join("\n")}\n`,
  );
  console.log(`検証ログ: /tmp/user-lex-cost-log.md（未解決=${unresolved.length}, 巻き込み=${collateral.length}）`);
}

// applied 通知は --mark-applied-only のときだけ送る
// （追記した分はPRがマージされて初めて適用なので、その後の再実行で閉じる）
if (markOnly && appliedIds.length > 0) {
  const r = await fetch(`${origin}/api/admin/reading-reports/applied`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ ids: appliedIds }),
  });
  console.log(`applied 通知: ${r.status}（${appliedIds.length}件）`);
}

// PR作成用に新規行をファイルにも残す
writeFileSync("/tmp/user-lex-new-lines.txt", newLines.join("\n"));
console.log(`done: applied対象=${appliedIds.length}, new=${newLines.length}`);
