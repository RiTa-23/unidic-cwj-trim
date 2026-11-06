import glob, sys, json, random, re, collections
sys.path.insert(0, sys.argv[2])
from common import eligible, split_sentences
seen=set(); rows=[]; total=0; cat=collections.Counter()
for p in sorted(glob.glob(sys.argv[1]+"/x/text/*/*.txt")):
    if p.endswith("LICENSE.txt"): continue
    c=p.split('/')[-2]; doc=p.split('/')[-1][:-4]
    L=open(p,encoding='utf-8').read().split('\n')[3:]  # URL・日付・タイトルを除く
    for line in L:
        for s in split_sentences(line.strip()):
            total+=1
            if eligible(s) and s not in seen:
                seen.add(s); rows.append({"id":doc+":"+str(total),"doc":doc,"cat":c,"text":s}); cat[c]+=1
print(total,len(rows),cat)
random.Random(20261106).shuffle(rows)
with open(sys.argv[3],'w') as o:
    for r in rows[:10000]: o.write(json.dumps(r,ensure_ascii=False)+"\n")
