#!/usr/bin/env python3
"""Yahoo! ふりがな API（V2）で TSV の各文を読み、1行1文で出す。

    YAHOO_APPID=... python3 eval/compare/read-yahoo.py eval/corpus/round1.tsv > out.txt

1文ずつ送る。改行でつないでまとめて送ると、前の文の末尾と続けて解析され
（「…煮込む\\n包丁で」→ ぼうちょう）、結果が変わるため。
漢数字（一・九 など）には読みが返らず、漢字のまま残る。score.py はそれを却下に数える。
"""
import json
import os
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

URL = "https://jlp.yahooapis.jp/FuriganaService/V2/furigana"


def k2h(s: str) -> str:
    return "".join(chr(ord(c) - 0x60) if "ァ" <= c <= "ヶ" else c for c in s)


def call(text: str) -> list:
    body = json.dumps({"id": "1", "jsonrpc": "2.0", "method": "jlp.furiganaservice.furigana",
                       "params": {"q": text, "grade": 1}}).encode()
    headers = {"Content-Type": "application/json"}
    if "YAHOO_APPID" in os.environ:
        headers["User-Agent"] = f"Yahoo AppID: {os.environ['YAHOO_APPID']}"
    for attempt in range(6):
        try:
            req = urllib.request.Request(URL, data=body, headers=headers)
            with urllib.request.urlopen(req, timeout=60) as res:
                data = json.load(res)
            if "result" in data:
                return data["result"]["word"]
            print("ERR", data, file=sys.stderr)
        except Exception as e:  # 一時的な失敗は待って再送する
            print("EXC", e, file=sys.stderr)
        time.sleep(2 ** attempt)
    raise SystemExit(f"failed: {text}")


def read(text: str) -> str:
    kana = "".join(k2h(w.get("furigana", w["surface"])) for w in call(text))
    time.sleep(0.8)  # 4並列で毎秒4件程度に抑える
    return kana


def main(tsv: str) -> None:
    texts = [l.rstrip("\n").split("\t")[0] for l in open(tsv, encoding="utf-8")
             if l.strip() and not l.startswith("#")]
    with ThreadPoolExecutor(4) as ex:
        print("\n".join(ex.map(read, texts)))


if __name__ == "__main__":
    main(sys.argv[1])
