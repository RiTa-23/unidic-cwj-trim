/**
 * 語彙の巻き込みチェック（#19）。
 *
 * ユーザー辞書の1行は、報告された1文だけでなく**その表層を含むあらゆる語**の解析に効く。
 * 1字や語幹の裸登録（田→タ、向→ム、場→バ）は、その字を含む熟語を分解して読みを壊す
 * （水田→みずた、方向→かたむ、入場→いりば）。報告文を解析し直すだけでは拾えない。
 *
 * そこで辞書そのものを正解表として使う。追加する行の表層を含む、それより長い辞書の語
 * （lid-rid-map.tsv.gz の表層）を1語ずつ解析し、
 *   - 行を足す前（base）に**辞書の1語としてそのまま読める語**（1トークンで表層が一致）は、
 *     その読みを正しいとみなす
 *   - 行を足した後（candidate）に読みが変わったら、巻き込み（回帰）として返す
 * 行を足す前から分割されている語は正解が分からないので見ない。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import type { Analyzer } from "./reading";

const MAP_PATH = fileURLToPath(new URL("../../lid-rid-map.tsv.gz", import.meta.url));
/**
 * 意図して読みを変える語の許可リスト（`語\t新しい読み(ひらがな)`）。辞書の読みそのものが
 * 誤っていて、行を足した結果の方が正しい場合にだけ足す
 */
const ALLOW_PATH = fileURLToPath(new URL("../../collateral-allow.tsv", import.meta.url));

export interface Regression {
  /** 巻き込みを起こした行の表層 */
  surface: string;
  /** 読みが変わった辞書の語 */
  word: string;
  before: string;
  after: string;
}

let vocabulary: string[] | undefined;

/** 辞書の表層のうち、漢字かかなを含む2字以上のもの */
function loadVocabulary(): string[] {
  if (vocabulary !== undefined) return vocabulary;
  const words = new Set<string>();
  for (const line of gunzipSync(readFileSync(MAP_PATH)).toString("utf8").split("\n")) {
    if (line === "" || line.startsWith("#")) continue;
    const surface = line.slice(0, line.indexOf("\t"));
    if ([...surface].length >= 2 && /[\p{Script=Han}\p{Script=Hiragana}]/u.test(surface)) {
      words.add(surface);
    }
  }
  vocabulary = [...words];
  return vocabulary;
}

function loadAllowed(): Set<string> {
  try {
    const allowed = new Set<string>();
    for (const line of readFileSync(ALLOW_PATH, "utf8").split("\n")) {
      if (line === "" || line.startsWith("#")) continue;
      allowed.add(line.trim());
    }
    return allowed;
  } catch {
    return new Set();
  }
}

/** CSV の1行の表層（先頭列） */
export const surfaceOf = (line: string) => line.slice(0, line.indexOf(","));

/**
 * `surfaces` の各表層について、base → candidate で読みが変わった辞書の語を返す。
 * base / candidate は同じシステム辞書に、違うユーザー辞書を重ねた Analyzer。
 */
export function findRegressions(
  surfaces: string[],
  base: Analyzer,
  candidate: Analyzer,
): Regression[] {
  const words = loadVocabulary();
  const allowed = loadAllowed();
  const regressions: Regression[] = [];
  for (const surface of new Set(surfaces)) {
    for (const word of words) {
      if (word === surface || !word.includes(surface)) continue;
      const tokens = base.tokens(word);
      // 辞書の1語としてそのまま読める語だけを正解として使う
      if (tokens.length !== 1 || tokens[0]?.surface !== word || tokens[0].reading === null) {
        continue;
      }
      const before = tokens[0].reading;
      const result = candidate.reading(word);
      const after = "kana" in result ? result.kana : `（読めない: ${result.surface}）`;
      if (after !== before && !allowed.has(`${word}\t${after}`)) {
        regressions.push({ surface, word, before, after });
      }
    }
  }
  return regressions;
}

export function formatRegressions(regressions: Regression[], limitPerSurface = 10): string[] {
  const bySurface = Map.groupBy(regressions, (r) => r.surface);
  const lines: string[] = [];
  for (const [surface, list] of bySurface) {
    const shown = list
      .slice(0, limitPerSurface)
      .map((r) => `${r.word}: ${r.before}→${r.after}`)
      .join("、");
    const more = list.length > limitPerSurface ? ` ほか${list.length - limitPerSurface}語` : "";
    lines.push(`\`${surface}\`（${list.length}語）: ${shown}${more}`);
  }
  return lines;
}
