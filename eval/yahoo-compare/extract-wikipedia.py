import bz2, sys, json, random, re, hashlib, xml.etree.ElementTree as ET
sys.path.insert(0, sys.argv[2])
from common import eligible, split_sentences, NUMERAL, TYPABLE, KANJI
NS="{http://www.mediawiki.org/xml/export-0.11/}"
def strip_nested(t,o,c,mark):
    out=[];d=0;i=0
    while i<len(t):
        if t.startswith(o,i): d+=1;i+=2;continue
        if t.startswith(c,i) and d>0:
            d-=1;i+=2
            if d==0: out.append(mark)
            continue
        if d==0: out.append(t[i])
        i+=1
    return "".join(out)
def clean(t):
    t=re.sub(r"<!--.*?-->","",t,flags=re.S)
    t=re.sub(r"<ref[^>]*/>","",t)
    t=re.sub(r"<ref.*?</ref>","",t,flags=re.S)
    t=re.sub(r"\{\|.*?\|\}","\n",t,flags=re.S)
    t=strip_nested(t,"{{","}}","")
    return t
def links(l):
    l=re.sub(r"\[\[(?:[^\]|]*\|)?([^\]|]*)\]\]",r"\1",l)
    return l.replace("'''","").replace("''","")
main=[];head=[];pages=0
KANA=re.compile(r"^[ぁ-ゖァ-ヺー]+$")
LEAD=re.compile(r"^'''([^']+)'''(?:\s*)（([^）]*)）(.*)$")
for path in sys.argv[3:]:
    tag=path.split('/')[-1].split('.')[0]
    for ev,el in ET.iterparse(bz2.open(path)):
        if el.tag!=NS+"page": continue
        ns=el.findtext(NS+"ns"); title=el.findtext(NS+"title") or ""; txt=el.findtext(f"{NS}revision/{NS}text") or ""
        pid=el.findtext(NS+"id"); el.clear()
        if ns!="0" or txt.lstrip().upper().startswith(("#REDIRECT","#転送")) or "曖昧さ回避" in title or "{{Aimai" in txt or "{{aimai" in txt: continue
        pages+=1
        c=clean(txt); got=[]
        doneLead=False
        for line in c.split("\n"):
            line=line.strip()
            if not line or line[0] in "*#:;=|!{}<" or "<" in line or "[[ファイル" in line or "[[File" in line or "[[Category" in line or "[[カテゴリ" in line: continue
            # 脚注の位置は消して読み、テンプレートが抜けた行は文が欠けるので捨てる
            if "" in line: continue
            line=line.replace("","")
            if not doneLead:
                m=LEAD.match(re.sub(r"\[\[(?:[^\]|]*\|)?([^\]|]*)\]\]",r"\1",line))
                if m:
                    doneLead=True
                    x=m.group(1); rd=re.split(r"[、,，；;：:／/]",m.group(2))[0].replace(" ","").replace("　","")
                    rest=split_sentences(links(m.group(3))) or [""]
                    s=x+rest[0]
                    if KANJI.search(x) and TYPABLE.match(x) and KANA.match(rd) and eligible(s):
                        head.append({"id":f"{tag}:{pid}:h","doc":pid,"text":s,"headword":x,"gold_head":rd})
            for s in split_sentences(links(line)):
                if eligible(s): got.append(s)
        random.Random(pid).shuffle(got)
        for i,s in enumerate(got[:3]): main.append({"id":f"{tag}:{pid}:{i}","doc":pid,"text":s})
print("pages",pages,"main",len(main),"head",len(head))
seen=set(); r=random.Random(20261106); r.shuffle(main); r.shuffle(head)
def dedup(rows,n):
    o=[]
    for x in rows:
        if x["text"] in seen: continue
        seen.add(x["text"]); o.append(x)
        if len(o)==n: break
    return o
m=dedup(main,10000); h=dedup(head,3000)
with open(sys.argv[1],'w') as a:
    for x in m: a.write(json.dumps(x,ensure_ascii=False)+"\n")
with open(sys.argv[1].replace('.jsonl','_head.jsonl'),'w') as a:
    for x in h: a.write(json.dumps(x,ensure_ascii=False)+"\n")
