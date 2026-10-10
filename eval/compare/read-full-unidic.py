#!/usr/bin/env python3
"""UniDic フルサイズ（MeCab 版）で TSV の各文を読み、1行1文で出す（読めなければ <UNK>）。

    pip install fugashi
    # unidic-py の配布物（https://cotonoha-dic.s3-ap-northeast-1.amazonaws.com/unidic-3.1.0.zip）を展開
    python3 eval/compare/read-full-unidic.py /path/to/unidic eval/corpus/round1.tsv > out.txt

読みは出現形の仮名（特徴列 index 20 = lex.csv の f[24]。トリム辞書の読みと同じ列）。
読みの無い未知語は、漢字を含めば <UNK>、含まなければ表層をそのまま使う（HENGE の readingOf と同じ規則）。
"""
import csv
import re
import sys

import fugashi

HAN = re.compile(r"[㐀-鿿豈-﫿々]")


def k2h(s: str) -> str:
    return "".join(chr(ord(c) - 0x60) if "ァ" <= c <= "ヶ" else c for c in s)


def main(dicdir: str, tsv: str) -> None:
    tagger = fugashi.GenericTagger(f"-d {dicdir} -r {dicdir}/dicrc")
    for line in open(tsv, encoding="utf-8"):
        if not line.strip() or line.startswith("#"):
            continue
        out = []
        for word in tagger(line.rstrip("\n").split("\t")[0]):
            f = next(csv.reader([word.feature_raw]))
            reading = f[20] if len(f) > 20 and f[20] != "*" else None
            if reading is None:
                if HAN.search(word.surface):
                    out = None
                    break
                reading = word.surface
            out.append(k2h(reading))
        print("<UNK>" if out is None else "".join(out))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
