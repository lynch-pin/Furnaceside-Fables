#!/usr/bin/env node
/**
 * scripts/translate.mjs — CN 서버 전용 스토리 스크립트를 한국어로 번역해 translations/zh_CN/stories/<storyId>.json 에 캐시.
 *
 *   npm run translate                # 캐시 없는 CN 전용 스토리 전부 번역 (ANTHROPIC_API_KEY 필요)
 *   npm run translate -- --limit 5   # 5편만
 *   npm run translate -- --only act53side_level_act53side_01_beg
 *   npm run translate -- --prune     # ko_KR 데이터가 생겨 더 이상 쓰이지 않는 캐시 삭제 (API 호출 없음)
 *   npm run translate -- --dry-run   # 대상 목록만 출력
 *   npm run translate -- --export    # API 없이: 번역 원문을 translations/zh_CN/stories-src/<storyId>.json 로 내보내기
 *                                    #   → 다른 도구/세션에서 번역한 뒤 같은 파일명으로 translations/zh_CN/stories/ 에 저장
 *   npm run translate -- --check     # 캐시 검증 (줄 수 일치, 중국어 잔존 여부)
 *   npm run translate -- --export-meta  # 번역본이 없는 CN 전용 이벤트/스토리 이름·줄거리와 오퍼레이터 텍스트를
 *                                       #   translations/zh_CN/todo/ 에 내보내기 (현재 운영 범위: 본문 제외, 이 수준까지만 번역)
 *                                       #   → 번역 후 meta.json 에 병합 / operators/<id>.json 으로 저장
 *
 * 캐시는 반드시 API 로 만들 필요가 없다. 아래 형식만 맞으면 어떤 방법으로 번역해도 된다.
 *   translations/zh_CN/stories/<storyId>.json = { "source": "zh_CN", "lines": ["번역 줄", ...] }
 *   lines 는 --export 가 만든 src 파일의 lines 와 같은 길이·순서 (parseStory 결과에서 text 가 있는 줄만).
 *
 * 메타(이름/줄거리)와 CN 전용 오퍼레이터 텍스트는 translations/zh_CN/meta.json, operators/*.json 에 수동/일괄 번역본을 둔다.
 * 캐시 포맷: { "source": "zh_CN", "model": "...", "lines": ["번역 줄", ...] } — parseStory 결과 중 text 가 있는 줄 순서와 1:1.
 *
 * 모델 호출은 Anthropic Messages API 를 fetch 로 직접 사용한다 (의존성 없음).
 * TODO(translate): 용어집(overrides/glossary.json) 을 프롬프트에 주입해 고유명사 일관성 강화.
 */
import fs from 'node:fs';
import path from 'node:path';
import { LOCALES, PRIMARY, readStoryText, translationsRoot } from '../src/lib/i18n.mjs';
import { parseStory } from '../src/lib/story-parser.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const ROOT = process.cwd();
const DATA = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/stories.json'), 'utf8'));
const OUT = path.join(translationsRoot('zh_CN'), 'stories');
fs.mkdirSync(OUT, { recursive: true });

const MODEL = process.env.TRANSLATE_MODEL ?? 'claude-sonnet-5';
const API_KEY = process.env.ANTHROPIC_API_KEY;

// 대상: 원문이 zh_CN 인 스토리
const targets = DATA.stories.filter((s) => s.available && s.locale !== PRIMARY && LOCALES.includes(s.locale));
const cached = new Set(fs.readdirSync(OUT).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')));

if (flag('--prune')) {
  // ko_KR 원문이 생긴 스토리의 캐시 제거
  const stillCn = new Set(targets.map((s) => s.id));
  let n = 0;
  for (const id of cached) {
    if (!stillCn.has(id)) {
      fs.unlinkSync(path.join(OUT, `${id}.json`));
      n++;
      console.log(`[translate] prune ${id} (ko_KR 데이터 있음)`);
    }
  }
  console.log(`[translate] ${n}개 캐시 삭제`);
  process.exit(0);
}

const textLines = (s) => {
  const raw = readStoryText(s.txt);
  if (!raw) return null;
  return parseStory(raw.text).filter((l) => typeof l.text === 'string' && l.text.length > 0);
};
const linesOf = (s) => textLines(s)?.map((l) => l.text) ?? null;

if (flag('--export-meta')) {
  // 운영 방침: 스토리 본문은 번역하지 않고, 이벤트/스토리 이름·태그·줄거리와 CN 전용 오퍼레이터 텍스트까지만 번역한다.
  // 이 명령은 그 범위에서 아직 번역본이 없는 항목만 골라 내보낸다. (npm run process 이후 실행)
  const TODO = path.join(translationsRoot('zh_CN'), 'todo');
  fs.mkdirSync(TODO, { recursive: true });
  const meta = { groups: {}, stories: {} };
  for (const g of DATA.groups) if (g.needsTranslation) meta.groups[g.id] = { name: g.name };
  for (const s of DATA.stories) {
    if (s.metaNeedsTranslation) {
      meta.stories[s.id] = { name: s.name, avgTag: s.avgTag ?? undefined, summary: s.summaryLocale === 'zh_CN' ? s.summary : undefined };
    }
  }
  const nMeta = Object.keys(meta.groups).length + Object.keys(meta.stories).length;
  if (nMeta) fs.writeFileSync(path.join(TODO, 'meta.src.json'), JSON.stringify(meta, null, 1));
  const ops = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/operators.json'), 'utf8'));
  let nOps = 0;
  for (const o of ops) {
    if (!o.needsTranslation) continue;
    const src = {
      id: o.id, name: o.name, appellation: o.appellation, description: o.description, itemUsage: o.itemUsage, itemDesc: o.itemDesc,
      obtainApproach: o.obtainApproach, tags: o.tags,
      records: o.records.map((r) => ({ title: r.title, entries: r.entries.map((e) => ({ text: e.text, unlockString: e.unlockString })) })),
      operatorRecords: o.operatorRecords.map((r) => ({ setId: r.setId, name: r.name, stories: r.stories.map((x) => ({ id: x.id, name: x.name })) })),
      words: o.words.map((w) => ({ wordKey: w.wordKey, lines: w.lines.map((l) => ({ id: l.id, title: l.title, text: l.text })) })),
    };
    fs.writeFileSync(path.join(TODO, `op.${o.id}.src.json`), JSON.stringify(src, null, 1));
    nOps++;
  }
  console.log(`[translate] 번역 필요: 메타 ${nMeta}건, 오퍼레이터 ${nOps}명 → ${path.relative(ROOT, TODO)}/`);
  console.log('  번역 후: meta.src.json 은 translations/zh_CN/meta.json 에 병합, op.<id>.src.json 은 translations/zh_CN/operators/<id>.json 으로 저장 (구조 동일, 값만 번역).');
  process.exit(0);
}

if (flag('--export')) {
  const SRC = path.join(translationsRoot('zh_CN'), 'stories-src');
  fs.mkdirSync(SRC, { recursive: true });
  let n = 0;
  for (const s of targets) {
    if (cached.has(s.id)) continue;
    const tl = textLines(s);
    if (!tl) continue;
    // context: 번역 참고용 (화자/줄 종류). 결과 파일에는 lines 만 필요.
    fs.writeFileSync(
      path.join(SRC, `${s.id}.json`),
      JSON.stringify(
        {
          id: s.id,
          group: s.groupName,
          name: s.name,
          source: 'zh_CN',
          lineCount: tl.length,
          context: tl.map((l) => (l.type === 'dialogue' ? l.speaker : l.type)),
          lines: tl.map((l) => l.text),
        },
        null,
        1,
      ),
    );
    n++;
  }
  console.log(`[translate] ${n}편 원문을 ${path.relative(ROOT, SRC)}/ 에 내보냈습니다.`);
  console.log('  번역 결과는 같은 파일명으로 translations/zh_CN/stories/<storyId>.json 에 { "source": "zh_CN", "lines": [...] } 형식으로 저장하세요.');
  process.exit(0);
}

if (flag('--check')) {
  let ok = 0, bad = 0;
  const CJK = /[\u4e00-\u9fff]/;
  for (const s of targets) {
    if (!cached.has(s.id)) continue;
    const tr = JSON.parse(fs.readFileSync(path.join(OUT, `${s.id}.json`), 'utf8'));
    const src = linesOf(s) ?? [];
    const problems = [];
    if (!Array.isArray(tr.lines)) problems.push('lines 없음');
    else if (tr.lines.length !== src.length) problems.push(`줄 수 ${tr.lines.length} ≠ 원문 ${src.length}`);
    else {
      const cjk = tr.lines.filter((l) => CJK.test(l)).length;
      if (cjk) problems.push(`중국어 잔존 ${cjk}줄`);
    }
    if (problems.length) { bad++; console.log(`  ✗ ${s.id}: ${problems.join(', ')}`); } else ok++;
  }
  console.log(`[translate] 검증: 정상 ${ok}, 문제 ${bad}`);
  process.exit(bad ? 1 : 0);
}

let todo = targets.filter((s) => !cached.has(s.id));
if (opt('--only')) todo = todo.filter((s) => s.id === opt('--only'));
if (opt('--limit')) todo = todo.slice(0, Number(opt('--limit')));
console.log(`[translate] CN 전용 ${targets.length}편, 캐시 ${cached.size}편, 대상 ${todo.length}편`);
if (flag('--dry-run')) {
  for (const s of todo) console.log(`  ${s.id}  ${s.name}`);
  process.exit(0);
}
if (!todo.length) process.exit(0);
if (!API_KEY) {
  console.error('[translate] ANTHROPIC_API_KEY 가 없습니다. 환경변수로 넣거나 GitHub Actions secrets 로 주입하세요.');
  process.exit(1);
}

const SYSTEM = `당신은 아크나이츠(明日方舟) 한국 서버의 공식 번역 문체를 따르는 게임 텍스트 번역가입니다.
- 입력은 JSON 배열(중국어 문장 목록)이며, 같은 길이의 JSON 배열(한국어)만 출력합니다. 설명 금지.
- 고유명사는 한국 서버 표기를 따릅니다: 로도스 아일랜드, 박사, 오리지늄, 광석병, 감염자, 켈시, 아미야, 클로저, 카즈델, 라이타니엔, 컬럼비아, 우르수스, 룽먼, 빅토리아, 이베리아, 사르곤, 카시미어, 시라쿠사, 쉐라그, 라테라노, 사미, 예라군드.
- 인게임 마크업(<@ba.kw>…</>, <i>…</i>, \\n)은 그대로 보존합니다.
- 화자 표기("A;B" 선택지 구분자 포함)는 원문 형식을 유지합니다.`;

async function translateBatch(texts) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      messages: [{ role: 'user', content: JSON.stringify(texts) }],
    }),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const text = json.content.map((c) => c.text ?? '').join('');
  const arr = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1));
  if (!Array.isArray(arr) || arr.length !== texts.length) throw new Error(`길이 불일치 ${arr?.length} vs ${texts.length}`);
  return arr;
}

const BATCH = 60; // 줄 단위 배치
for (const s of todo) {
  const raw = readStoryText(s.txt);
  if (!raw) continue;
  const lines = parseStory(raw.text);
  const texts = lines.filter((l) => typeof l.text === 'string' && l.text.length > 0).map((l) => l.text);
  const out = [];
  try {
    for (let i = 0; i < texts.length; i += BATCH) {
      out.push(...(await translateBatch(texts.slice(i, i + BATCH))));
      process.stdout.write(`\r[translate] ${s.id} ${Math.min(i + BATCH, texts.length)}/${texts.length}`);
    }
    fs.writeFileSync(path.join(OUT, `${s.id}.json`), JSON.stringify({ source: 'zh_CN', model: MODEL, lines: out }, null, 0));
    console.log(`\r[translate] ${s.id} 완료 (${texts.length}줄)`);
  } catch (e) {
    console.error(`\n[translate] ${s.id} 실패: ${e.message}`);
  }
}
