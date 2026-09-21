use std::fs::File;
use std::io::BufReader;
use vibrato::{SystemDictionaryBuilder, Tokenizer};

fn main() -> anyhow::Result<()> {
    let mode = std::env::args().nth(1).unwrap();
    match mode.as_str() {
        "bigramgen" => {
            let dir = std::env::args().nth(2).unwrap();
            vibrato::mecab::generate_bigram_info(
                BufReader::new(File::open(format!("{dir}/feature.def"))?),
                BufReader::new(File::open(format!("{dir}/right-id.def"))?),
                BufReader::new(File::open(format!("{dir}/left-id.def"))?),
                BufReader::new(File::open(format!("{dir}/model.def"))?),
                700.0,
                &mut File::create(format!("{dir}/bigram.right"))?,
                &mut File::create(format!("{dir}/bigram.left"))?,
                &mut File::create(format!("{dir}/bigram.cost"))?,
            )?;
            println!("bigram generated");
        }
        "compile" => {
            let lex = std::env::args().nth(2).unwrap();
            let dir = std::env::args().nth(3).unwrap();
            let out = std::env::args().nth(4);
            let dict = SystemDictionaryBuilder::from_readers_with_bigram_info(
                BufReader::new(File::open(&lex)?),
                BufReader::new(File::open(format!("{dir}/bigram.right"))?),
                BufReader::new(File::open(format!("{dir}/bigram.left"))?),
                BufReader::new(File::open(format!("{dir}/bigram.cost"))?),
                BufReader::new(File::open(format!("{dir}/char.def"))?),
                BufReader::new(File::open(format!("{dir}/unk.def"))?),
                false,
            )?;
            if let Some(path) = out {
                let n = dict.write(&mut File::create(&path)?)?;
                println!("dict written: {} bytes", n);
            }
            let mut tok = Tokenizer::new(dict);
            for s in ["豚骨ラーメンが食べたい","日本の首都","私は学生です"] {
                let mut w = tok.new_worker();
                w.reset_sentence(s);
                w.tokenize();
                let line: Vec<String> = w.token_iter().map(|t| {
                    let f: Vec<&str> = t.feature().split(',').collect();
                    format!("{}({})", t.surface(), f.get(7).copied().unwrap_or("?"))
                }).collect();
                println!("{s} => {}", line.join(" "));
            }
        }
        "diff" => {
            let dic_a = std::env::args().nth(2).unwrap();
            let dic_b = std::env::args().nth(3).unwrap();
            let file = std::env::args().nth(4).unwrap();
            let da = vibrato::Dictionary::read(&mut BufReader::new(File::open(&dic_a)?))?;
            let db = vibrato::Dictionary::read(&mut BufReader::new(File::open(&dic_b)?))?;
            let mut ta = Tokenizer::new(da);
            let mut tb = Tokenizer::new(db);
            fn to_hira(s: &str) -> String {
                s.chars().map(|c| {
                    if ('\u{30A1}'..='\u{30F6}').contains(&c) { char::from_u32(c as u32 - 0x60).unwrap() } else { c }
                }).collect()
            }
            fn kana_of(tok: &mut Tokenizer, s: &str) -> (String, String, usize) {
                let mut w = tok.new_worker();
                w.reset_sentence(s);
                w.tokenize();
                let mut out = String::new();
                let mut seg = String::new();
                let mut unk = 0usize;
                for t in w.token_iter() {
                    let feats: Vec<&str> = t.feature().split(',').collect();
                    let r = feats.get(7).copied();
                    seg.push_str(t.surface());
                    seg.push('|');
                    match r {
                        Some(v) if v != "*" => out.push_str(&to_hira(v)),
                        _ => {
                            if t.surface().chars().any(|c| ('\u{4E00}'..='\u{9FFF}').contains(&c)) { unk += 1; }
                            out.push_str(&to_hira(t.surface()));
                        }
                    }
                }
                (out, seg, unk)
            }
            let text = std::fs::read_to_string(&file)?;
            let (mut same, mut diff, mut segdiff, mut unka, mut unkb, mut ex) = (0usize,0usize,0usize,0usize,0usize,0usize);
            let mut diff_lines = String::new();
            for line in text.lines() {
                let (ka, sa, ua) = kana_of(&mut ta, line);
                let (kb, sb, ub) = kana_of(&mut tb, line);
                unka += ua; unkb += ub;
                if sa != sb { segdiff += 1; }
                if ka == kb { same += 1 } else {
                    diff += 1;
                    if ex < 30 {
                        diff_lines.push_str(&format!("{}\n  TRIM = {}\n  FULL = {}\n  segT = {}\n  segF = {}\n", line, ka, kb, sa, sb));
                        ex += 1;
                    }
                }
            }
            println!("{diff_lines}");
            println!("lines: same={} diff={} ({:.2}% diff), seg-diff={}", same, diff, 100.0*diff as f64/(same+diff) as f64, segdiff);
            println!("kanji-unk tokens: TRIM={} FULL={}", unka, unkb);
        }
        "tri" => {
            let da = vibrato::Dictionary::read(&mut BufReader::new(File::open(std::env::args().nth(2).unwrap())?))?;
            let db = vibrato::Dictionary::read(&mut BufReader::new(File::open(std::env::args().nth(3).unwrap())?))?;
            let dc = vibrato::Dictionary::read(&mut BufReader::new(File::open(std::env::args().nth(4).unwrap())?))?;
            let file = std::env::args().nth(5).unwrap();
            let mut ta = Tokenizer::new(da);
            let mut tb = Tokenizer::new(db);
            let mut tc = Tokenizer::new(dc);
            fn to_hira(s: &str) -> String {
                s.chars().map(|c| {
                    if ('\u{30A1}'..='\u{30F6}').contains(&c) { char::from_u32(c as u32 - 0x60).unwrap() } else { c }
                }).collect()
            }
            fn kana_of(tok: &mut Tokenizer, s: &str) -> String {
                let mut w = tok.new_worker();
                w.reset_sentence(s);
                w.tokenize();
                let mut out = String::new();
                for t in w.token_iter() {
                    let feats: Vec<&str> = t.feature().split(',').collect();
                    match feats.get(7).copied() {
                        Some(v) if v != "*" => out.push_str(&to_hira(v)),
                        _ => out.push_str(&to_hira(t.surface())),
                    }
                }
                out
            }
            let text = std::fs::read_to_string(&file)?;
            let (mut trim_eq, mut full_eq, mut neither, mut both, mut n_diff) = (0usize,0usize,0usize,0usize,0usize);
            let (mut kanji_a, mut kanji_b, mut kanji_c) = (0usize, 0usize, 0usize);
            let mut detail = String::new();
            let mut shown = 0;
            for line in text.lines() {
                let ka = kana_of(&mut ta, line);
                let kb = kana_of(&mut tb, line);
                if ka == kb { continue }
                n_diff += 1;
                let kc = kana_of(&mut tc, line);
                if ka.chars().any(|c| ('\u{4E00}'..='\u{9FFF}').contains(&c)) { kanji_a += 1; }
                if kb.chars().any(|c| ('\u{4E00}'..='\u{9FFF}').contains(&c)) { kanji_b += 1; }
                if kc.chars().any(|c| ('\u{4E00}'..='\u{9FFF}').contains(&c)) { kanji_c += 1; }
                let ae = ka == kc; let be = kb == kc;
                if ae && be { both += 1 } else if ae { trim_eq += 1 } else if be { full_eq += 1 } else { neither += 1 }
                if shown < 80 {
                    detail.push_str(&format!("{}\n  TRIM = {} {}\n  FULL = {} {}\n  IPAD = {}\n",
                        line, ka, if ae{"[==ip]"}else{""}, kb, if be{"[==ip]"}else{""}, kc));
                    shown += 1;
                }
            }
            println!("{detail}");
            println!("diff sentences: {} | TRIM==ipadic: {} | FULL==ipadic: {} | both: {} | neither: {}",
                n_diff, trim_eq, full_eq, both, neither);
            println!("kanji-left-in-output: TRIM={} FULL={} IPADIC={}", kanji_a, kanji_b, kanji_c);
        }
        "tok" => {
            let dic = std::env::args().nth(2).unwrap();
            let d = vibrato::Dictionary::read(&mut BufReader::new(File::open(&dic)?))?;
            let mut tok = Tokenizer::new(d);
            for s in std::env::args().skip(3) {
                let mut w = tok.new_worker();
                w.reset_sentence(&s);
                w.tokenize();
                let line: Vec<String> = w.token_iter().map(|t| {
                    let f: Vec<&str> = t.feature().split(',').collect();
                    format!("{}({})", t.surface(), f.get(7).copied().unwrap_or("?"))
                }).collect();
                println!("{s} => {}", line.join(" "));
            }
        }
        _ => eprintln!("unknown mode"),
    }
    Ok(())
}
