// HENGE 読み Worker と同じ組み立て（readingOf + katakanaToHiragana）で各文を読む。
// HENGE_ROOT に HENGE のチェックアウトを指定する。
//   HENGE_ROOT=... bun read-engine.ts <user-lex.csv> <出力先> <コーパス.jsonl> ...
import { readFileSync, writeFileSync } from "node:fs";
const R = process.env.HENGE_ROOT;
if (!R) throw new Error("HENGE_ROOT を指定する");
const { initSync, Reader } = await import(`${R}/packages/reading-wasm/pkg/reading_wasm.js`);
const { readingOf } = await import(`${R}/apps/reading/src/reading.ts`);
const { katakanaToHiragana } = await import(`${R}/packages/shared/src/index.ts`);
initSync({ module: readFileSync(`${R}/packages/reading-wasm/pkg/reading_wasm_bg.wasm`) });
const dict = readFileSync(`${R}/apps/reading/assets/unidic.dic.zst`);
const lex = readFileSync(process.argv[2], "utf8");
const [outDir, ...files] = process.argv.slice(3);
for (const [name, reader] of [["prod", Reader.from_zstd(dict, lex)], ["nolex", Reader.from_zstd(dict)]] as const) {
  for (const f of files) {
    const rows = readFileSync(f, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const out = rows.map((r) => {
      const res = readingOf(reader.tokenize(r.text), katakanaToHiragana);
      return JSON.stringify({ id: r.id, kana: "error" in res ? null : res.kana, unk: "error" in res ? res.surface : undefined, tok: name === "prod" ? reader.tokenize(r.text).split("\n").filter(Boolean).map((l: string) => { const [s, x] = l.split("\t"); return [s, x.split(",")[7] ?? "*"]; }) : undefined });
    });
    const base = f.split("/").pop()!.replace(".jsonl", "");
    writeFileSync(`${outDir}/${base}.${name}.jsonl`, out.join("\n") + "\n");
    console.log(name, base, rows.length);
  }
}
