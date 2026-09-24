/* tslint:disable */
/* eslint-disable */

export class Reader {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * zstd 圧縮のまま（Vibrato の配布物 `system.dic.zst` そのもの）の辞書から作る。
     *
     * **展開済みのバイト列を JS 側でも Wasm 側でも持たない。** Workers のメモリ上限は
     * 128MB で、UniDic トリム辞書は展開すると Wasm メモリ +84MB ある。JS で展開してから
     * 渡すと JS 側バッファと Wasm 側の辞書が同時に存在して上限を超える。圧縮のまま渡し
     * （~7MB）、Wasm の中でストリーム展開しながら `Dictionary::read` に流すと、
     * ピークは「圧縮 ~7MB ＋ 辞書 +84MB ＋ 展開の作業領域」で済む。
     *
     * `user_csv` はユーザー辞書（MeCab CSV 書式）。システム辞書とは別に語彙を重ねられ、
     * 誤読・分割ミス・辞書欠落語を Viterbi 競合で直接直せる。不要なら省略（undefined）。
     */
    static from_zstd(compressed: Uint8Array, user_csv?: string | null): Reader;
    /**
     * 展開済みの辞書バイト列から作る。テストや計測用。
     * 辞書のバイナリ形式は Vibrato のバージョンに縛られる（MODEL_MAGIC）。
     * 合わないときは `Err` を返し、JS 側には例外として届く。
     */
    constructor(dictionary: Uint8Array);
    /**
     * 1文を解析し、1トークン1行の `表層形\t特徴列` を返す。
     * JSON にしないのは、依存を増やさずに済み、JS 側の split で足りるため。
     * 表層形・特徴列にタブや改行は含まれない（UniDic トリム辞書はカンマ区切り）。
     */
    tokenize(text: string): string;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_reader_free: (a: number, b: number) => void;
    readonly reader_from_zstd: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly reader_new: (a: number, b: number) => [number, number, number];
    readonly reader_tokenize: (a: number, b: number, c: number) => [number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
