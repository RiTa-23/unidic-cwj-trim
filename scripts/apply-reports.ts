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
 *        ヒューリスティックで自動推定（本格的な掃引は将来の estimate-cost）
 *   3. すでに csv にある行（surface+読み一致）はスキップ。approved 行のうち
 *      csv にあるものは適用完了とみなし POST /applied に id を返す
 *   4. 変更があれば git 差分として残す（PR化は呼び出し側のワークフローがやる）
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
const existing = new Set<string>();
if (existsSync(csvPath)) {
  for (const line of readFileSync(csvPath, "utf8").split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const f = line.split(",");
    existing.add(`${f[0]}\t${f[11]}`);
  }
}

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

const appliedIds: string[] = [];
const newLines: string[] = [];
for (const r of reports) {
  const key = `${r.surface}\t${r.expectedKana}`;
  if (existing.has(key)) {
    appliedIds.push(r.id);
    continue;
  }
  if (markOnly) continue;
  const conn = connector(r.surface);
  const cost = r.cost ?? estimateCost(r.surface);
  newLines.push(
    `${r.surface},${conn.lid},${conn.rid},${cost},${conn.pos1},*,*,*,*,*,*,${r.expectedKana},*`,
  );
  appliedIds.push(r.id); // このPRに載った行も、このPRがマージされれば適用完了
}

if (newLines.length > 0) {
  appendFileSync(csvPath, newLines.join("\n") + "\n");
  console.log(`追記: ${newLines.length}行`);
} else {
  console.log("追記なし");
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
