"""4コーパス共通の絞り込み。

数字の除外は広めに取る。算用数字（半角・全角）は文字集合で落ち、漢数字は語の一部でも文ごと落とす
（「一緒」「千葉」「万一」も落ちる）。Yahoo の漢数字の扱いが結果に混ざらないようにするため。
"""
import re

# 前回（eval/kwdlc2tsv.py）と同じ文字集合に、採点で落とす「」だけを足した
TYPABLE = re.compile(r"^[ぁ-ゖァ-ヺ一-鿿々、。ー！？「」]+$")
KANJI = re.compile(r"[一-鿿々]")
NUMERAL = re.compile(r"[〇零一二三四五六七八九十百千万億兆壱弐参拾廿卅]")
MIN_LEN, MAX_LEN = 8, 200


def eligible(text: str) -> bool:
    return (
        MIN_LEN <= len(text) <= MAX_LEN
        and TYPABLE.match(text) is not None
        and KANJI.search(text) is not None
        and NUMERAL.search(text) is None
    )


def split_sentences(text: str) -> list:
    return [s.strip() for s in re.findall(r"[^。！？]+[。！？]*", text) if s.strip()]
