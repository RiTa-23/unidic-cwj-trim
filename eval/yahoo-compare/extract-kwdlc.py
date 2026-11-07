import glob, sys, json, re
sys.path.insert(0, sys.argv[2])
from common import eligible, KANJI, NUMERAL
root=sys.argv[1]; out=open(sys.argv[3],'w')
total=kept=0; seen=set(); reason={'num':0,'readkanji':0,'dup':0}
for path in sorted(glob.glob(f"{root}/knp/*/*.knp")):
    surface,reading,sid=[],[],""
    for line in open(path,encoding="utf-8"):
        line=line.rstrip("\n")
        if line.startswith("# S-ID:"):
            sid=line.split()[1][len("S-ID:"):]; surface,reading=[],[]
        elif line=="EOS":
            total+=1
            t,k="".join(surface),"".join(reading)
            if not eligible(t):
                if NUMERAL.search(t) : reason['num']+=1
                continue
            if KANJI.search(k): reason['readkanji']+=1; continue
            if t in seen: reason['dup']+=1; continue
            seen.add(t); kept+=1
            out.write(json.dumps({"id":sid,"doc":sid.rsplit('-',1)[0],"text":t,"gold":k},ensure_ascii=False)+"\n")
        elif line and line[0] not in "#*+@":
            f=line.split(" "); surface.append(f[0]); reading.append(f[1])
print(total,kept,reason)
