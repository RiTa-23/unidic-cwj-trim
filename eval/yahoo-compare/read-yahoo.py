#!/usr/bin/env python3
"""Yahoo! ふりがな API V2（grade=1。旧本番と同じ）で各文を1文ずつ読む。途中から再開できる。

    YAHOO_APP_ID=... python3 read-yahoo.py <cache.jsonl> <コーパス.jsonl> ...

応答は生のまま cache に追記する。4並列・各0.8秒待ち（前回の計測で6並列は 429 が多発した）。
"""
import json, os, sys, threading, time, urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor
URL = "https://jlp.yahooapis.jp/FuriganaService/V2/furigana"
cache_path, files = sys.argv[1], sys.argv[2:]
done = set()
if os.path.exists(cache_path):
    for l in open(cache_path, encoding="utf-8"):
        done.add(json.loads(l)["text"])
queues = [[json.loads(l)["text"] for l in open(f, encoding="utf-8")] for f in files]
# コーパスを交互に流す。途中で止まっても偏らない
texts, seen = [], set(done)
for i in range(max(map(len, queues))):
    for q in queues:
        if i < len(q) and q[i] not in seen:
            seen.add(q[i]); texts.append(q[i])
print(f"todo {len(texts)} done {len(done)}", flush=True)
lock = threading.Lock(); out = open(cache_path, "a", encoding="utf-8")
stats = {"ok": 0, "invalid": 0, "retry": 0}; stop = threading.Event()
HEAD = {"Content-Type": "application/json", "User-Agent": f"Yahoo AppID: {os.environ['YAHOO_APP_ID']}"}
def call(text):
    body = json.dumps({"id": "1", "jsonrpc": "2.0", "method": "jlp.furiganaservice.furigana", "params": {"q": text, "grade": 1}}).encode()
    wait = 5
    for attempt in range(14):
        if stop.is_set(): return
        try:
            req = urllib.request.Request(URL, data=body, headers=HEAD)
            with urllib.request.urlopen(req, timeout=60) as res:
                data = json.load(res)
            if "result" in data:
                return {"text": text, "words": data["result"]["word"]}
            code = data.get("error", {}).get("code")
            if code == -32602:
                return {"text": text, "error": data["error"]}
            print("ERR", data.get("error"), flush=True)
        except urllib.error.HTTPError as e:
            print("HTTP", e.code, flush=True)
        except Exception as e:
            print("EXC", type(e).__name__, str(e)[:120], flush=True)
        stats["retry"] += 1
        time.sleep(wait); wait = min(wait * 2, 600)
    stop.set(); print("GIVEUP", flush=True)
def work(text):
    if stop.is_set(): return
    r = call(text)
    if r is None: return
    with lock:
        out.write(json.dumps(r, ensure_ascii=False) + "\n"); out.flush()
        stats["invalid" if "error" in r else "ok"] += 1
        n = stats["ok"] + stats["invalid"]
        if n % 500 == 0: print(time.strftime("%H:%M:%S"), stats, flush=True)
    time.sleep(0.8)
with ThreadPoolExecutor(4) as ex:
    list(ex.map(work, texts))
print("FINISHED", stats, flush=True)
