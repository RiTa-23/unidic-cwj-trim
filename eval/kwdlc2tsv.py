#!/usr/bin/env python3
"""KWDLC（京都大学ウェブ文書リードコーパス）を eval/run-eval.ts の TSV に変換する。

KWDLC は研究目的の公開で、元の Web 文書の著作権者の許諾を得ていない（README）。
**変換した文はリポジトリに入れない。** 手元で測って数字だけを reports/ に残す。

    git clone --depth 1 https://github.com/ku-nlp/KWDLC.git /path/to/KWDLC
    python3 eval/kwdlc2tsv.py /path/to/KWDLC > /tmp/kwdlc.tsv
    bun eval/run-eval.ts /tmp/kwdlc.tsv

HENGE のお題と同じ条件（かな・漢字・句読点だけ。数字・英字・記号を含まない）の文を、漢字を含むものに限って採る。
期待の読みは KWDLC の形態素の読み（JUMAN の体系）をつないだもの。UniDic と付け方が違う語がある
（他の＝たの、私＝わたくし、株式会社＝かぶしきかいしゃ と かぶしきがいしゃ の混在 等）ので、誤りを数えるときは差分を確かめること。
"""
import glob
import re
import sys

TYPABLE = re.compile(r"^[ぁ-ゖァ-ヺ一-鿿々、。ー！？]+$")
KANJI = re.compile(r"[一-鿿々]")


def main(root: str) -> None:
    total = kept = 0
    seen = set()
    for path in sorted(glob.glob(f"{root}/knp/*/*.knp")):
        surface, reading, sid = [], [], ""
        for line in open(path, encoding="utf-8"):
            line = line.rstrip("\n")
            if line.startswith("# S-ID:"):
                sid = line.split()[1][len("S-ID:"):]
                surface, reading = [], []
            elif line == "EOS":
                total += 1
                text, kana = "".join(surface), "".join(reading)
                # 読みに漢字が残る（JUMAN の未定義語）文は期待値にならないので落とす
                if TYPABLE.match(text) and KANJI.search(text) and not KANJI.search(kana) and text not in seen:
                    seen.add(text)
                    kept += 1
                    print(f"{text}\t{kana}\t{sid}\ts")
            elif line and line[0] not in "#*+@":
                fields = line.split(" ")
                surface.append(fields[0])
                reading.append(fields[1])
    print(f"{total} 文中 {kept} 文を採用", file=sys.stderr)


if __name__ == "__main__":
    main(sys.argv[1])
