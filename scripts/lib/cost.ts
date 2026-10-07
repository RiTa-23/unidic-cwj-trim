/**
 * ユーザー辞書のコストの基準。
 *
 * 辞書 v3（`scripts/filter_lex_v3.py`）は、compact bigram 接続表のずれ（MeCab の接続行列より
 * 全ペアで約5376低い）を打ち消すために、語彙と未知語の語コストに `COST_SHIFT` を足している。
 * ユーザー辞書の行も同じ基準で書かないと、相対的に5376強くなって熟語を割りやすくなる。
 *
 * HENGE の管理画面で選ぶコスト（熟語・常勝 -20000／単漢字・語幹 3000）と、自動推定の値は
 * **ずらす前の基準**のまま扱い、`user-lex.csv` に書くときにここで足す。管理画面の選択肢や
 * 承認済みの報告を、辞書の作り直しに合わせて直さずに済むようにするため。
 */
export const COST_SHIFT = 5376;

const I16_MIN = -32768;
const I16_MAX = 32767;

/** ずらす前の基準のコストを、user-lex.csv に書く値にする（Vibrato の語コストは i16） */
export function toLexCost(cost: number): number {
  return Math.max(I16_MIN, Math.min(I16_MAX, cost + COST_SHIFT));
}
