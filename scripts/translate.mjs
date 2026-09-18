#!/usr/bin/env node
/**
 * scripts/translate.mjs — CN 서버 전용 스토리 스크립트를 한국어로 번역해 translations/zh_CN/stories/<storyId>.json 에 캐시.
 *
 *   npm run translate                # 캐시 없는 CN 전용 스토리 전부 번역 (ANTHROPIC_API_KEY 필요)
 *   npm run translate -- --limit 5   # 5편만
 *   npm run translate -- --only act53side_level_act53side_01_beg
 *   npm run translate -- --prune     # ko_KR 데이터가 생겨 더 이상 쓰이지 않는 캐시 삭제 (API 호출 없음)
 *   npm run translate -- --dry-run   # 대상 목록만 출력
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
