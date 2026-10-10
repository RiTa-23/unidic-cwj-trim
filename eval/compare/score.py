#!/usr/bin/env python3
"""読みの出力（1行1文）を TSV の期待の読みと照合する。eval/run-eval.ts と同じ正規化・同じ数え方。

    python3 eval/compare/score.py corpus.tsv out1.txt [out2.txt ...]

句読点・！？・「」と空白を両側から落として、別解（| 区切り）のどれかと一致すれば正解。
`<UNK>` か、読みに漢字が残った文は却下（読めない）に数える。CER では却下の文を全文字誤りとする。
"""
import re
import sys

HAN = re.compile(r"[㐀-鿿々]")


def k2h(s: str) -> str:
    return "".join(chr(ord(c) - 0x60) if "ァ" <= c <= "ヶ" else c for c in s)


def norm(s: str) -> str:
    return re.sub(r"[、。！？!?・「」\s]", "", k2h(s))


def distance(a: str, b: str) -> int:
    prev = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        cur = [i]
        for j in range(1, len(b) + 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] != b[j - 1])))
        prev = cur
    return prev[-1]


def main(tsv: str, outs: list) -> None:
    rows = [l.rstrip("\n").split("\t") for l in open(tsv, encoding="utf-8")
            if l.strip() and not l.startswith("#")]
    for path in outs:
        got = open(path, encoding="utf-8").read().split("\n")
        n = ok = unk = chars = edits = 0
        for row, out in zip(rows, got):
            expected = [norm(e) for e in row[1].split("|")]
            n += 1
            chars += len(expected[0])
            if out == "<UNK>" or HAN.search(out):
                unk += 1
                edits += len(expected[0])
                continue
            kana = norm(out)
            if kana in expected:
                ok += 1
            else:
                edits += min(distance(e, kana) for e in expected)
        assert n == len(rows), f"{path}: {n} 行（期待 {len(rows)}）"
        print(f"{path}: 正解 {ok}/{n} ({ok / n * 100:.1f}%) 誤読 {n - ok - unk} 却下 {unk} CER {edits / chars * 100:.2f}%")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2:])
