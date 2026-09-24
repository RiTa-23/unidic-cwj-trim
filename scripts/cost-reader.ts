/**
 * 報告コストの実測推定（#12）。
 *
 * Vibrato のコストは「その文脈の競合パスとの相対値」なので、語彙知識では
 * 決まらない。ここでは報告された promptText を実際に再トークナイズし、
 * 表層が expectedKana で切れる最小の勝率コストを探す。
 *
 * Reader は user_csv ごとに辞書を組み直す必要があるため、報告1件あたり
 * コスト候補の数だけ Reader を作り直す（dict パースは数秒。バッチ処理
 * なので十分に安い）。
 *
 * 使い方（apply-reports から import して使う）:
 *   const reader = await CostReader.load(dictPath, pkgDir, baseCsv);
 *   const pick = reader.pickCost({promptText, surface, expectedKana, conn, pos1});
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// ---- wasm loader（HENGE packages/reading-wasm/pkg をそのまま使う） ----
interface ReadingWasm {
  initSync(input: { module: Uint8Array } | { module: WebAssembly.Module }): unknown;
  Reader: {
    from_zstd(compressed: Uint8Array, user_csv?: string | null): ReaderLike;
  };
}
interface ReaderLike {
  tokenize(text: string): string;
  free(): void;
}

export async function loadWasm(pkgDir: string): Promise<ReadingWasm> {
  const dir = resolve(pkgDir);
  const js = await import(join(dir, "reading_wasm.js"));
  js.initSync({ module: readFileSync(join(dir, "reading_wasm_bg.wasm")) });
  return js as ReadingWasm;
}

// ---- かな変換 ----
const kataToHira = (s: string): string =>
  [...s].map((c) => {
    const n = c.codePointAt(0)!;
    return n >= 0x30a1 && n <= 0x30f6 ? String.fromCodePoint(n - 96) : c;
  }).join("");

// ---- tokenize 結果の分解（surface\tfeatures → {surface, hiraKana}） ----
interface Tok {
  surface: string;
  kana: string; // ひらがな（不明は表層そのまま）
}
function parseTokens(out: string): Tok[] {
  const toks: Tok[] = [];
  for (const line of out.split("\n")) {
    if (!line) continue;
    const tab = line.indexOf("\t");
    const surface = line.slice(0, tab);
    const f = line.slice(tab + 1).split(",");
    const kana = f.length >= 9 ? f[7] : "*";
    toks.push({ surface, kana: kana === "*" ? surface : kataToHira(kana) });
  }
  return toks;
}

/**
 * トークン列から、報告 surface が占める範囲の読みを拾う。
 * surface が複数トークンに跨っても、その合計かなが expectedKana と
 * 一致すれば「直った」とみなす（愛情深い→あいじょう+ぶかい 等）。
 * 表層がトークン境界をまたいで半端に割れる場合は不一致。
 */
function surfaceReading(toks: Tok[], text: string, surface: string): string | null {
  // surface の出現位置を探す（報告の文脈で一意とは限らないので全出現を見る）
  let from = 0;
  while (true) {
    const at = text.indexOf(surface, from);
    if (at === -1) return null;
    from = at + 1;
    const end = at + [...surface].length;
    // トークンを前から歩いて [at,end) に跨るトークンを集める
    let pos = 0;
    const covered: string[] = [];
    let exact = true;
    for (const t of toks) {
      const len = [...t.surface].length;
      const s = pos;
      const e = pos + len;
      pos = e;
      if (e <= at || s >= end) continue;
      // トークンが範囲に被さる。境界をまたぐと半端なので切り詰めはしない
      covered.push(t.kana);
      if (s > at || e < end) {
        // トークンが surface の一部だけを含む＝表層が別の切れ方をしている
        exact = false;
      }
    }
    if (!exact || covered.length === 0) continue;
    return covered.join("");
  }
}

export interface PickResult {
  cost: number | null; // 勝った最小コスト（見つからなければ null）
  attempts: { cost: number; kana: string | null }[]; // 各コストでの実読み（検証ログ用）
}

export interface SpanTok extends Tok {
  start: number;
  end: number;
}
function tokenizeSpans(out: string): SpanTok[] {
  const toks = parseTokens(out);
  const spans: SpanTok[] = [];
  let pos = 0;
  for (const t of toks) {
    const len = [...t.surface].length;
    spans.push({ ...t, start: pos, end: pos + len });
    pos += len;
  }
  return spans;
}

/** 試すコスト列。現行デフォルト 3000 から弱→強の順。 */
export const COST_CANDIDATES = [
  3000, 2000, 1000, 0, -1000, -2000, -3000, -5000, -8000, -12000, -16000, -20000,
];

export class CostReader {
  private constructor(
    private wasm: ReadingWasm,
    private dict: Uint8Array,
    private baseCsv: string,
  ) {}

  static async load(dictPath: string, pkgDir: string, baseCsv: string): Promise<CostReader> {
    const wasm = await loadWasm(pkgDir);
    return new CostReader(wasm, new Uint8Array(readFileSync(dictPath)), baseCsv);
  }

  private withCsv(userCsv: string): ReaderLike {
    return this.wasm.Reader.from_zstd(this.dict, userCsv);
  }

  /** 素の（csv指定時の）読みを返す。巻き込みチェック用。 */
  readKana(text: string, extraCsv = ""): string {
    const r = this.withCsv(extraCsv ? `${this.baseCsv}${extraCsv}` : this.baseCsv);
    try {
      return parseTokens(r.tokenize(text)).map((t) => t.kana).join("");
    } finally {
      r.free();
    }
  }

  /**
   * 巻き込みチェック: extraCsv 適用前後で promptText をトークナイズし、
   * surface が占める文字範囲と**交差しない**トークンで読み・切れ目が
   * 変わったものを返す（報告対象の修正自体は除外）。
   */
  collateralDiff(
    promptText: string,
    surface: string,
    extraCsv: string,
  ): string[] {
    const at = promptText.indexOf(surface);
    const spanStart = at;
    const spanEnd = at + [...surface].length;
    const run = (csv: string) => {
      const r = this.withCsv(csv);
      try {
        return tokenizeSpans(r.tokenize(promptText));
      } finally {
        r.free();
      }
    };
    const before = run(this.baseCsv);
    const after = run(`${this.baseCsv}${extraCsv}`);
    // surface範囲と交差しないトークン同士を読み・表層で比較
    const notIn = (t: SpanTok) => t.end <= spanStart || t.start >= spanEnd;
    const b = before.filter(notIn).map((t) => `${t.surface}:${t.kana}`);
    const a = after.filter(notIn).map((t) => `${t.surface}:${t.kana}`);
    const diffs: string[] = [];
    for (let i = 0; i < Math.max(b.length, a.length); i++) {
      if (b[i] !== a[i]) diffs.push(`${b[i] ?? "(なし)"} → ${a[i] ?? "(なし)"}`);
    }
    return diffs;
  }

  /**
   * 報告1件について、expectedKana で切れる最小コストを返す。
   * entryRow: `${surface},${lid},${rid},{cost},${pos1},*,*,*,*,*,*,${kana},*`
   *   の {cost} プレースホルダを持つ行テンプレート。
   */
  pickCost(
    promptText: string,
    surface: string,
    expectedKana: string,
    rowTemplate: string,
  ): PickResult {
    const expected = kataToHira(expectedKana);
    const attempts: { cost: number; kana: string | null }[] = [];
    for (const cost of COST_CANDIDATES) {
      const csv = `${this.baseCsv}${rowTemplate.replace("{cost}", String(cost))}\n`;
      const reader = this.withCsv(csv);
      try {
        const toks = parseTokens(reader.tokenize(promptText));
        const kana = surfaceReading(toks, promptText, surface);
        attempts.push({ cost, kana });
        if (kana === expected) return { cost, attempts };
      } finally {
        reader.free();
      }
    }
    return { cost: null, attempts };
  }
}
