/**
 * 検査用の読み取得。**HENGE の読み Worker と同じ組み立て**で、辞書（Release の
 * システム辞書）＋ユーザー辞書（任意の CSV 文字列）から読み仮名を作る。
 *
 * - Wasm は `vendor/reading-wasm-pkg`（HENGE の `packages/reading-wasm/pkg` の複製）
 * - 読みの組み立ては HENGE の `apps/reading/src/reading.ts` の `readingOf` と同じ規則
 *   （特徴列の index 7 がカタカナの読み、読みが無く漢字を含む語は UNKNOWN_READING）
 *
 * システム辞書は `bun scripts/fetch-dict.ts` で `.cache/` に取る（`UNIDIC_DIC_PATH` で差し替え可）。
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const DEFAULT_DICT_PATH = fileURLToPath(
  new URL("../../.cache/unidic-cwj-v3.2.dic.zst", import.meta.url),
);
const PKG_DIR = fileURLToPath(new URL("../../vendor/reading-wasm-pkg/", import.meta.url));
export const CSV_PATH = fileURLToPath(new URL("../../user-lex.csv", import.meta.url));

interface ReaderLike {
  tokenize(text: string): string;
  free(): void;
}
interface ReadingWasm {
  initSync(input: { module: Uint8Array }): unknown;
  Reader: { from_zstd(compressed: Uint8Array, userCsv?: string | null): ReaderLike };
}

export type ReadingResult = { kana: string } | { error: "UNKNOWN_READING"; surface: string };

export function katakanaToHiragana(text: string): string {
  return text.replace(/[ァ-ヶ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60));
}

/** 1トークン分。読みが無い（未知語）ときは reading が null */
export interface Token {
  surface: string;
  reading: string | null;
}

const READING_INDEX = 7;
const FEATURE_COLUMNS = 9;

export function parseTokens(tokenized: string): Token[] {
  const tokens: Token[] = [];
  for (const line of tokenized.split("\n")) {
    if (line === "") continue;
    const tab = line.indexOf("\t");
    const fields = line.slice(tab + 1).split(",");
    const reading = fields.length >= FEATURE_COLUMNS ? fields[READING_INDEX] : undefined;
    tokens.push({
      surface: line.slice(0, tab),
      reading: reading !== undefined && reading !== "*" ? katakanaToHiragana(reading) : null,
    });
  }
  return tokens;
}

/** HENGE の `readingOf` と同じ規則で読みを組み立てる */
export function readingOf(tokens: Token[]): ReadingResult {
  const kana: string[] = [];
  for (const token of tokens) {
    if (token.reading !== null) {
      kana.push(token.reading);
      continue;
    }
    if (/\p{Script=Han}/u.test(token.surface)) {
      return { error: "UNKNOWN_READING", surface: token.surface };
    }
    kana.push(katakanaToHiragana(token.surface));
  }
  return { kana: kana.join("") };
}

let wasm: ReadingWasm | undefined;
let dict: Uint8Array | undefined;

async function load(): Promise<{ wasm: ReadingWasm; dict: Uint8Array }> {
  const dictPath = process.env.UNIDIC_DIC_PATH ?? DEFAULT_DICT_PATH;
  if (!existsSync(dictPath)) {
    throw new Error(`システム辞書が無い: ${dictPath}（bun scripts/fetch-dict.ts で取得する）`);
  }
  if (wasm === undefined) {
    const module = (await import(`${PKG_DIR}reading_wasm.js`)) as ReadingWasm;
    module.initSync({ module: readFileSync(`${PKG_DIR}reading_wasm_bg.wasm`) });
    wasm = module;
  }
  dict ??= new Uint8Array(readFileSync(dictPath));
  return { wasm, dict };
}

/**
 * システム辞書にユーザー辞書（CSV 文字列。null なら重ねない）を重ねた解析器。
 * 辞書の展開に数秒かかるので、同じ CSV の解析は1つの Analyzer で回す。
 */
export class Analyzer {
  private constructor(private reader: ReaderLike) {}

  static async open(userCsv: string | null): Promise<Analyzer> {
    const { wasm, dict } = await load();
    return new Analyzer(wasm.Reader.from_zstd(dict, userCsv));
  }

  tokens(text: string): Token[] {
    return parseTokens(this.reader.tokenize(text));
  }

  reading(text: string): ReadingResult {
    return readingOf(this.tokens(text));
  }

  close(): void {
    this.reader.free();
  }
}
