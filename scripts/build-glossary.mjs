#!/usr/bin/env node
/**
 * scripts/build-glossary.mjs — 중국어-한국어 단어집 생성.
 *
 * 한국 서버(kr)와 중국 서버(cn)의 스토리 스크립트는 줄 구조가 같아서 줄 단위로 1:1 정렬된다.
 * 이 병렬 말뭉치에서 다음을 뽑는다.
 *
 *   1. 회화 표현  glossary/phrases.json 에 정리한 문장(병음·직역·단어별 해설) + 자동 빈도·출처
 *   2. 단어       glossary/words.json 에 정리한 뜻풀이 + 자동 빈도·예문
 *   3. 후보       아직 정리하지 않은 표현·단어 → glossary/candidates.json, glossary/phrase-candidates.json
 *
 * 오퍼레이터·아이템 등 게임 데이터의 고유명사는 단어집에 넣지 않는다.
 * (오퍼레이터의 중국어 이름은 /operator 에서 바로 볼 수 있다.)
 *
 * 출력: src/data/glossary.json
 * 사용: npm run glossary (npm run process 에 포함)
 */
import fs from 'node:fs';
import path from 'node:path';
import { LOCALES, PRIMARY, storyPath, loadExcel } from '../src/lib/i18n.mjs';
import { parseStory, stripRichText } from '../src/lib/story-parser.mjs';

const ROOT = process.cwd();
const OUT_DIR = process.env.OUT_DIR ? path.resolve(process.env.OUT_DIR) : path.join(ROOT, 'src', 'data');
const GLOSSARY_DIR = path.join(ROOT, 'glossary');
const log = (...a) => console.log('[glossary]', ...a);
const t0 = Date.now();

// 표현으로 뽑을 대사 길이 (중국어 글자 수)
const EXPR_MIN = 2;
const EXPR_MAX = 24;
// 결과에 남길 최소 등장 스토리 수
const EXPR_MIN_DOCS = 3;
const TERM_MIN_DOCS = 2;
// 후보 n-gram 길이
const NGRAM_MIN = 2;
const NGRAM_MAX = 4;

const CJK = /[㐀-鿿]/;
const onlyCjkPunct = (s) => !CJK.test(s);
const cjkCount = (s) => (s.match(/[\u3400-\u9fff]/g) ?? []).length;
/** 표현 키: 앞뒤 말줄임표·문장부호를 떼어 같은 표현을 한데 모은다 */
const exprKey = (s) => s.replace(/^[…。，,！!？?、·\-\s.]+/, '').replace(/[…。，,！!？?、·\-\s.]+$/, '');

// ---------------------------------------------------------------------------
// 1. 고유명사 대응표 (게임 데이터에서 kr/cn 이름을 짝지어 만든다)
// ---------------------------------------------------------------------------
log('고유명사 대응표…');

/** 같은 키를 가진 kr/cn 테이블에서 name 쌍을 뽑는다 */
function pairsFrom(table, pick, category, { root = null } = {}) {
  const kr = loadExcel(PRIMARY, table);
  const cn = loadExcel(LOCALES[1], table);
  const krRoot = root ? kr?.[root] : kr;
  const cnRoot = root ? cn?.[root] : cn;
  if (!krRoot || !cnRoot) return [];
  const out = [];
  for (const [id, krVal] of Object.entries(krRoot)) {
    const cnVal = cnRoot[id];
    if (!cnVal) continue;
    const krName = pick(krVal);
    const cnName = pick(cnVal);
    if (!krName || !cnName || krName === cnName) continue;
    if (!CJK.test(cnName)) continue;
    out.push({ id, cn: cnName.trim(), kr: krName.trim(), category });
  }
  return out;
}

const properNouns = [
  ...pairsFrom('character_table', (v) => (v.profession === 'TOKEN' || v.profession === 'TRAP' ? null : v.name), '오퍼레이터'),
  ...pairsFrom('handbook_team_table', (v) => v.powerName, '세력'),
  ...pairsFrom('zone_table', (v) => v.zoneNameSecond, '지역', { root: 'zones' }),
  ...pairsFrom('handbook_info_table', (v) => v.name, '인물', { root: 'npcDict' }),
  ...pairsFrom('enemy_handbook_table', (v) => v.name, '적'),
  ...pairsFrom('item_table', (v) => v.name, '아이템', { root: 'items' }),
];
// 중복 제거 (같은 중국어 표기는 하나만)
const termByCn = new Map();
for (const p of properNouns) {
  if (p.cn.length < 2 || p.cn.length > 12) continue;
  if (!termByCn.has(p.cn)) termByCn.set(p.cn, p);
}
log(`  고유명사 후보 ${termByCn.size}개`);

// ---------------------------------------------------------------------------
// 2. 직접 정리한 일반 단어 (glossary/words.json)
// ---------------------------------------------------------------------------
const phrasesFile = path.join(GLOSSARY_DIR, 'phrases.json');
/** @type {{cn:string,pinyin:string,kr:string,literal?:string,words:{cn:string,pinyin:string,kr:string}[],note?:string}[]} */
const curatedPhrases = fs.existsSync(phrasesFile) ? JSON.parse(fs.readFileSync(phrasesFile, 'utf8')) : [];

const curatedFile = path.join(GLOSSARY_DIR, 'words.json');
/** @type {{cn:string, pinyin?:string, kr:string, category?:string, note?:string}[]} */
const curated = fs.existsSync(curatedFile) ? JSON.parse(fs.readFileSync(curatedFile, 'utf8')).filter((w) => w.cn) : [];
log(`  직접 정리한 단어 ${curated.length}개 · 회화 표현 ${curatedPhrases.length}개`);

// 빈도·예문을 붙일 대상 (고유명사 + 정리 단어)
const lookup = new Map(); // cn → entry
// 고유명사는 회화 표현 후보에서 인명·지명을 걸러내는 용도로만 쓴다 (출력에는 넣지 않는다)
for (const [cn, p] of termByCn) lookup.set(cn, { cn, kr: p.kr, category: p.category, source: 'data', docs: 0, count: 0, example: null });
for (const w of curated) {
  lookup.set(w.cn, {
    cn: w.cn,
    kr: w.kr,
    pinyin: w.pinyin ?? null,
    category: w.category ?? '일반',
    note: w.note ?? null,
    source: 'curated',
    docs: 0,
    count: 0,
    example: null,
  });
}

// ---------------------------------------------------------------------------
// 3. 스토리 순회 (kr/cn 줄 정렬)
// ---------------------------------------------------------------------------
const { stories } = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'stories.json'), 'utf8'));
const storyMeta = new Map(stories.map((s) => [s.id, { name: s.name, groupName: s.groupName }]));

const readLines = (file) => {
  if (!fs.existsSync(file)) return null;
  return parseStory(fs.readFileSync(file, 'utf8')).filter((l) => typeof l.text === 'string' && l.text.trim());
};

/** 표현: 중국어 대사 → { count, docs, kr: Map<번역, 횟수>, story } */
const expressions = new Map();
/** n-gram 후보: cn → { docs, count } */
const ngrams = new Map();
/** 화자 이름 쌍: cn 화자 → Map<kr 화자, 횟수>. 정렬된 대본에서 직접 뽑으므로 NPC 이름까지 잡힌다. */
const speakerPairs = new Map();

let aligned = 0;
let skipped = 0;
let processed = 0;

for (const s of stories) {
  if (!s.txt) continue;
  const krLines = readLines(storyPath(PRIMARY, s.txt));
  const cnLines = readLines(storyPath(LOCALES[1], s.txt));
  if (!krLines || !cnLines) continue;
  if (krLines.length !== cnLines.length) {
    skipped++;
    continue;
  }
  aligned++;

  const seenTerms = new Set();
  const seenNgrams = new Set();

  for (let i = 0; i < cnLines.length; i++) {
    // 화자 이름 (대사 줄에서만, 양쪽 모두 이름이 있을 때)
    const cnSp = cnLines[i].speaker;
    const krSp = krLines[i].speaker;
    if (cnSp && krSp && cnSp !== krSp && CJK.test(cnSp)) {
      let m = speakerPairs.get(cnSp);
      if (!m) speakerPairs.set(cnSp, (m = new Map()));
      m.set(krSp, (m.get(krSp) ?? 0) + 1);
    }

    const cnRaw = stripRichText(cnLines[i].text).replace(/\s+/g, ' ').trim();
    const krRaw = stripRichText(krLines[i].text).replace(/\s+/g, ' ').trim();
    if (!cnRaw || onlyCjkPunct(cnRaw)) continue;

    // (a) 표현: 대사만, 적당한 길이. 앞뒤 말줄임표는 떼어 같은 표현으로 묶는다.
    if (cnLines[i].type === 'dialogue' && cnRaw.length >= EXPR_MIN && cnRaw.length <= EXPR_MAX && krRaw) {
      const key = exprKey(cnRaw);
      if (cjkCount(key) >= 2) {
        let e = expressions.get(key);
        if (!e) {
          e = { count: 0, docs: 0, kr: new Map(), surface: new Map(), story: s.id, speaker: krLines[i].speaker ?? null, lastDoc: null };
          expressions.set(key, e);
        }
        e.count++;
        if (e.lastDoc !== s.id) {
          e.docs++;
          e.lastDoc = s.id;
        }
        e.kr.set(exprKey(krRaw), (e.kr.get(exprKey(krRaw)) ?? 0) + 1);
        e.surface.set(cnRaw, (e.surface.get(cnRaw) ?? 0) + 1);
      }
    }

    // (b) 단어 빈도 + 예문: 사전에 있는 표제어가 이 줄에 있으면
    for (let len = 2; len <= 12; len++) {
      for (let j = 0; j + len <= cnRaw.length; j++) {
        const g = cnRaw.slice(j, j + len);
        const entry = lookup.get(g);
        if (!entry) continue;
        entry.count++;
        // 같은 줄의 한국어 번역에 대응어가 있으면 '확인됨'. 일반 명사와 겹치는 이름(医生 → Doc 등)을 걸러낸다.
        if (krRaw && entry.kr && krRaw.includes(entry.kr)) entry.confirmed = (entry.confirmed ?? 0) + 1;
        if (!seenTerms.has(g)) {
          seenTerms.add(g);
          entry.docs++;
        }
        // 예문: 너무 길지 않은 문장 중 가장 짧은 것
        if (krRaw && cnRaw.length <= 40 && (!entry.example || cnRaw.length < entry.example.cn.length)) {
          entry.example = { cn: cnRaw, kr: krRaw, storyId: s.id };
        }
      }
    }

    // (c) 후보 n-gram (중국어 연속 구간에서만)
    for (const run of cnRaw.match(/[㐀-鿿]+/g) ?? []) {
      for (let len = NGRAM_MIN; len <= NGRAM_MAX; len++) {
        for (let j = 0; j + len <= run.length; j++) {
          const g = run.slice(j, j + len);
          let v = ngrams.get(g);
          if (!v) {
            v = { docs: 0, count: 0 };
            ngrams.set(g, v);
          }
          v.count++;
          if (!seenNgrams.has(g)) {
            seenNgrams.add(g);
            v.docs++;
          }
        }
      }
    }
  }

  processed++;
  // 메모리 보호: 한 번만 나온 후보는 주기적으로 버린다
  if (processed % 300 === 0 && ngrams.size > 1_500_000) {
    for (const [k, v] of ngrams) if (v.count <= 2) ngrams.delete(k);
  }
  if (processed % 300 === 0 && expressions.size > 600_000) {
    for (const [k, v] of expressions) if (v.count <= 1) expressions.delete(k);
  }
}
log(`  정렬된 스토리 ${aligned}편 (줄 수 불일치로 제외 ${skipped}편)`);

// ---------------------------------------------------------------------------
// 4. 정리 및 출력
// ---------------------------------------------------------------------------
const storyRef = (id) => ({ id, name: storyMeta.get(id)?.name ?? null, group: storyMeta.get(id)?.groupName ?? null });

// 자동 추출한 표현 (빈도·출처를 정리한 표현에 붙이고, 나머지는 후보로 남긴다)
const exprByKey = new Map();
for (const [key, v] of expressions) {
  if (v.docs < EXPR_MIN_DOCS) continue;
  const kr = [...v.kr.entries()].sort((a, b) => b[1] - a[1]);
  const surface = [...v.surface.entries()].sort((a, b) => b[1] - a[1])[0][0];
  exprByKey.set(key, { surface, kr: kr[0][0], krAlts: kr.slice(1, 3).map(([t]) => t), count: v.count, docs: v.docs, story: v.story, len: cjkCount(key) });
}

// 정리한 회화 표현 + 자동 빈도
const phraseList = curatedPhrases
  .map((p) => {
    const hit = exprByKey.get(exprKey(p.cn)) ?? null;
    return {
      ...p,
      docs: hit?.docs ?? 0,
      count: hit?.count ?? 0,
      // 스토리에서 실제로 쓰인 번역 (한국 서버 표기). 정리한 번역과 다를 수 있다.
      krInStory: hit && hit.kr !== p.kr ? hit.kr : null,
      story: hit ? storyRef(hit.story) : null,
    };
  })
  .sort((a, b) => b.docs - a.docs || a.cn.localeCompare(b.cn));

// 단어: 직접 정리한 것만 (고유명사는 제외)
const wordList = [...lookup.values()]
  .filter((w) => w.source === 'curated' && w.docs >= 1)
  .map(({ confirmed, source, ...w }) => ({ ...w, example: w.example ? { ...w.example, story: storyRef(w.example.storyId) } : null }))
  .sort((a, b) => b.docs - a.docs || b.count - a.count);

// 아직 정리하지 않은 표현 후보 (인명·지문·말더듬 제외)
const properNames = [...termByCn.keys()].filter((c) => c.length >= 2);
const phraseKeys = new Set(curatedPhrases.map((p) => exprKey(p.cn)));
const INTERJ = /^[嗯啊呃唔哈呼哦噢喔嘿哎唉咦哼吧吗呢的了是]+$/;
const phraseCandidates = [...exprByKey.entries()]
  .filter(([key, v]) => {
    if (v.len < 3 || phraseKeys.has(key) || INTERJ.test(key)) return false;
    if (/[（(].*[）)]/.test(v.surface)) return false;
    if (/(.)、\1/.test(v.surface)) return false;
    return !properNames.some((n) => v.surface.includes(n));
  })
  .map(([, v]) => ({ cn: v.surface, kr: v.kr, docs: v.docs }))
  .sort((a, b) => b.docs - a.docs)
  .slice(0, 800);

// 아직 뜻풀이가 없는 단어 후보 (n-gram). 더 긴 후보에 거의 항상 포함되는 조각은 제외한다.
const known = new Set([...lookup.keys()]);
const rawCandidates = [...ngrams.entries()]
  .filter(([g, v]) => v.docs >= 40 && !known.has(g))
  .map(([cn, v]) => ({ cn, docs: v.docs, count: v.count }))
  .sort((a, b) => b.docs - a.docs)
  .slice(0, 3000);
const byLen = [...rawCandidates].sort((a, b) => b.cn.length - a.cn.length);
const dominated = new Set();
for (const short of rawCandidates) {
  for (const long of byLen) {
    if (long.cn.length <= short.cn.length) break;
    if (long.cn.includes(short.cn) && long.count >= short.count * 0.8) {
      dominated.add(short.cn);
      break;
    }
  }
}
const candidateList = rawCandidates.filter((c) => !dominated.has(c.cn)).slice(0, 1200);

fs.mkdirSync(GLOSSARY_DIR, { recursive: true });
fs.writeFileSync(path.join(GLOSSARY_DIR, 'candidates.json'), JSON.stringify(candidateList, null, 1));
fs.writeFileSync(path.join(GLOSSARY_DIR, 'phrase-candidates.json'), JSON.stringify(phraseCandidates, null, 1));

const out = {
  generatedAt: new Date().toISOString(),
  stats: {
    alignedStories: aligned,
    skippedStories: skipped,
    phrases: phraseList.length,
    words: wordList.length,
    phraseCandidates: phraseCandidates.length,
    wordCandidates: candidateList.length,
  },
  phrases: phraseList,
  words: wordList,
};
// 화자 이름 대응표 보강: 대본에서 직접 확인한 쌍을 우선한다 (NPC·단역까지 포함)
const speakerFile = path.join(OUT_DIR, 'speakers.json');
if (fs.existsSync(speakerFile)) {
  const map = JSON.parse(fs.readFileSync(speakerFile, 'utf8'));
  let added = 0;
  let fixed = 0;
  for (const [cn, krs] of speakerPairs) {
    const [kr, n] = [...krs.entries()].sort((a, b) => b[1] - a[1])[0];
    if (n < 2 || !kr) continue;
    if (!map[cn]) {
      map[cn] = kr;
      added++;
    } else if (map[cn] !== kr && n >= 3) {
      map[cn] = kr;
      fixed++;
    }
  }
  fs.writeFileSync(speakerFile, JSON.stringify(map));
  log(`  화자 이름: 대본에서 ${added}개 추가, ${fixed}개 교정 → 총 ${Object.keys(map).length}개`);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const file = path.join(OUT_DIR, 'glossary.json');
fs.writeFileSync(file, JSON.stringify(out));
log(`  → ${path.relative(ROOT, file)} (${(fs.statSync(file).size / 1024 / 1024).toFixed(1)} MB)`);
log(`  회화 표현 ${phraseList.length} · 단어 ${wordList.length} · 후보(표현 ${phraseCandidates.length} / 단어 ${candidateList.length})`);
log(`완료 (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
