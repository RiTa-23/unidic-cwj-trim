"""4コーパス共通の絞り込み。

数字の除外は広めに取る。算用数字（半角・全角）は文字集合で落ち、漢数字は語の一部でも文ごと落とす
（「一緒」「千葉」「万一」も落ちる）。Yahoo の漢数字の扱いが結果に混ざらないようにするため。
"""
import os
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


# 現代の語彙に絞る条件。漢字は HENGE の共通語彙（wordfreq の zipf 3.5 以上）に出てくる字に限る
MODERN_KANJI = set(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "modern-kanji.txt"), encoding="utf-8").read().strip())
PERIOD = re.compile(r"侍|奉行|拙者|殿様|若殿|御前|旗本|浪人|大名|家老|与力|足軽|武士|将軍|城主|姫|徳川|幕府|藩|御座|ござ|候|天皇|皇帝|朝廷|公家|武将|律令|古墳|王朝|明治|大正|江戸|戦国|室町|鎌倉|平安|奈良時代")
OLD_ENDING = re.compile(r"(じゃ|ぬ|なり|けり|たまえ|給え|おる|おった|まい|であろう|のう)[。！？、]")


def modern_kanji(text: str) -> bool:
    return all(c in MODERN_KANJI for c in KANJI.findall(text))


def modern(text: str) -> bool:
    return modern_kanji(text) and PERIOD.search(text) is None and OLD_ENDING.search(text) is None
