import csv, glob, sys, json, random, re, collections
sys.path.insert(0, sys.argv[2])
from common import eligible, modern
# 現代の語彙に絞る: 1900年以降に生まれた日本人著者の、新字新仮名の作品だけを使う。sys.argv[4] は青空文庫の作品一覧の CSV
# 時代小説が中心の著者は除く。「云」は古い表記なので、含む文を除く
PERIOD_AUTHORS = {"山本周五郎", "本庄陸男"}
works = set()
for r in csv.DictReader(open(sys.argv[4], encoding="utf-8-sig")):
    if r["役割フラグ"] == "著者" and r["文字遣い種別"] == "新字新仮名" and r["生年月日"][:4] >= "1900" and f"{r['姓']}{r['名']}" not in PERIOD_AUTHORS:
        works.add(f"{r['姓']}{r['名']}/{r['作品名']}")
labels=collections.Counter(); rows=[]; seen=set(); total=0; bad=0
KANA=re.compile(r"^[ぁ-ゖァ-ヺー]+$")
ENDS=set("。！？")
def flush(segs,doc,idx):
    global total,bad
    if not segs: return
    total+=1
    t="".join(s for s,_ in segs)
    if not eligible(t) or not modern(t) or "云" in t or t in seen: return
    if any(not KANA.search(g) for _,g in segs if g is not None): bad+=1; return
    seen.add(t)
    rows.append({"id":f"{doc}:{idx}","doc":doc,"text":t,"gold":"".join(g if g is not None else s for s,g in segs)})
for p in sorted(glob.glob(sys.argv[1]+"/x/aozora_dataset/*/*/*.txt")):
    doc="/".join(p.split('/')[-3:-1]); segs=[]; idx=0; inbody=False
    if doc not in works: continue
    for line in open(p,encoding='utf-8',errors='replace'):
        c=line.rstrip("\n").split("\t")
        if line.startswith("行番号:"):
            flush(segs,doc,idx); idx+=1; segs=[]; continue
        if len(c)<3: continue
        if c[2].startswith("[入力"): continue
        labels[c[2]]+=1
        if c[2]=="分かち書き": continue
        if c[2]=="漢字": segs.append((c[0],c[1]))
        elif c[2]=="漢数字": segs.append((c[0],"?"))
        else: segs.append((c[0],None))   # かな・記号は本文の表記（は→わ を持ち込まない）
        if c[0] in ENDS or c[0].endswith(("。","！","？")):
            flush(segs,doc,idx); idx+=1; segs=[]
    flush(segs,doc,idx)
print("labels",labels.most_common(12)); print("sentences",total,"eligible",len(rows),"badgold",bad, "works", len({r['doc'] for r in rows}))
random.Random(20261106).shuffle(rows)
with open(sys.argv[3],'w') as o:
    for r in rows[:10000]: o.write(json.dumps(r,ensure_ascii=False)+"\n")
