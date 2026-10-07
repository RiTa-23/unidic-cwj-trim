/**
 * 検査用のシステム辞書（v3）を Release `unidic-cwj-trim-v2` から `.cache/` に取る（sha256 照合つき）。
 * すでに正しいものがあれば何もしない。
 *
 * 使い方: `bun scripts/fetch-dict.ts`（リポジトリルートから）
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULT_DICT_PATH } from "./lib/reading";

const URL_ = "https://github.com/RiTa-23/unidic-cwj-trim/releases/download/unidic-cwj-trim-v2/unidic-cwj-v3.dic.zst";
const SHA256 = "a6ba1c111b139c4032a4bf808e9a97250341360ca8aa66ee96261d8e771da007";

const sha256 = (body: Uint8Array) => createHash("sha256").update(body).digest("hex");

if (existsSync(DEFAULT_DICT_PATH) && sha256(readFileSync(DEFAULT_DICT_PATH)) === SHA256) {
  console.log(`取得済み: ${DEFAULT_DICT_PATH}`);
  process.exit(0);
}

const response = await fetch(URL_);
if (!response.ok) throw new Error(`取得に失敗: ${response.status} ${URL_}`);
const body = new Uint8Array(await response.arrayBuffer());
const digest = sha256(body);
if (digest !== SHA256) {
  throw new Error(`sha256 が一致しない\n  expected ${SHA256}\n  actual   ${digest}`);
}
mkdirSync(dirname(DEFAULT_DICT_PATH), { recursive: true });
writeFileSync(DEFAULT_DICT_PATH, body);
console.log(`${DEFAULT_DICT_PATH} (${body.byteLength} bytes)`);
