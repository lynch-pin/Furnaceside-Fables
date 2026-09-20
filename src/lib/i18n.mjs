/**
 * src/lib/i18n.mjs
 * 게임 데이터 언어 처리 모듈.
 *
 *   - ko_KR(한국 서버 데이터)을 우선 사용하고, 없으면 zh_CN(중국 서버 데이터)으로 폴백한다.
 *   - zh_CN 폴백 시 번역 API 를 붙일 수 있도록 translate() 자리를 비워 두었다.
 *   - 빌드 타임(node) 전용: fs 로 gamedata/ 원본을 직접 읽는다.
 *
 * 이 모듈은 scripts/process-data.mjs 와 src/pages/** 양쪽에서 사용된다.
 */
import fs from 'node:fs';
import path from 'node:path';

/** 로케일 우선순위. 첫 번째가 주 언어, 이후는 폴백 순서. */
export const LOCALES = /** @type {const} */ (['ko_KR', 'zh_CN']);
export const PRIMARY = LOCALES[0];

/**
 * 로케일 → gamedata 저장소 내 폴더명.
 * ArknightsAssets/ArknightsGamedata 는 `kr/`, `cn/` 을 쓴다.
 * (다른 미러를 쓰면 여기만 수정: 예) Kengxxiao 포크는 { ko_KR: 'ko_KR', zh_CN: 'zh_CN' })
 */
export const LANG_DIRS = {
  ko_KR: 'kr',
  zh_CN: 'cn',
};

// Astro 빌드 시 이 모듈은 dist/ 아래로 번들되므로 import.meta.url 기준 경로 대신 cwd(프로젝트 루트)를 쓴다.
const PROJECT_ROOT = process.cwd();

/** gamedata 원본 루트. GAMEDATA_DIR 환경변수로 재지정 가능. */
export function gamedataRoot() {
  return process.env.GAMEDATA_DIR
    ? path.resolve(process.env.GAMEDATA_DIR)
    : path.join(PROJECT_ROOT, 'gamedata');
}

/** 로케일별 gamedata 폴더 (…/gamedata/kr/gamedata) */
export function langRoot(locale) {
  const dir = LANG_DIRS[locale];
  if (!dir) throw new Error(`알 수 없는 로케일: ${locale}`);
  return path.join(gamedataRoot(), dir, 'gamedata');
}

/** excel 테이블 파일 경로. table 은 'story_review_table' 처럼 확장자 없이. */
export function excelPath(locale, table) {
  return path.join(langRoot(locale), 'excel', `${table}.json`);
}

/**
 * story_review_table 의 storyTxt ("activities/a001/level_a001_01_beg") → 실제 스크립트 파일 경로.
 * 원본 확장자는 .txt (.asc 도 있으면 함께 탐색).
 */
export function storyPath(locale, storyTxt) {
  return path.join(langRoot(locale), 'story', `${storyTxt}.txt`);
}

/**
 * storyInfo ("info/activities/a001/level_a001_01_beg") → 줄거리 요약 파일 경로.
 * 저장소에서는 `info/` 폴더가 `[uc]info/` 로 되어 있다.
 */
export function storyInfoPath(locale, storyInfo) {
  const rel = storyInfo.replace(/^info\//, '[uc]info/');
  return path.join(langRoot(locale), 'story', `${rel}.txt`);
}

/** 해당 로케일의 데이터가 로컬에 존재하는지 */
export function hasLocale(locale) {
  return fs.existsSync(path.join(langRoot(locale), 'excel'));
}

// ---------------------------------------------------------------------------
// 파일 로딩
// ---------------------------------------------------------------------------

const excelCache = new Map();

/** excel 테이블을 로케일별로 읽는다. 없으면 null. (프로세스 내 캐시) */
export function loadExcel(locale, table) {
  const key = `${locale}:${table}`;
  if (excelCache.has(key)) return excelCache.get(key);
  const file = excelPath(locale, table);
  let data = null;
  if (fs.existsSync(file)) {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  excelCache.set(key, data);
  return data;
}

/**
 * 모든 로케일의 같은 테이블을 한 번에. → { ko_KR: {...}|null, zh_CN: {...}|null }
 * 주 언어 테이블이 없으면 명확한 에러를 던진다 (npm run sync 안내).
 */
export function loadExcelAll(table, { required = true } = {}) {
  const out = {};
  for (const locale of LOCALES) out[locale] = loadExcel(locale, table);
  if (required && !out[PRIMARY] && !out[LOCALES[1]]) {
    throw new Error(
      `${table}.json 을 찾을 수 없습니다. 먼저 \`npm run sync\` 를 실행하세요. (검색 위치: ${gamedataRoot()})`,
    );
  }
  return out;
}

/**
 * 여러 로케일 파일 중 처음으로 존재하는 파일을 읽는다.
 * @param {(locale: string) => string} pathFor 로케일 → 경로
 * @returns {{ text: string, locale: string, path: string } | null}
 */
export function readFirstExisting(pathFor) {
  for (const locale of LOCALES) {
    const candidates = [pathFor(locale)];
    // .asc 확장자도 시도 (일부 미러/구버전 데이터)
    if (candidates[0].endsWith('.txt')) candidates.push(candidates[0].replace(/\.txt$/, '.asc'));
    for (const file of candidates) {
      if (fs.existsSync(file)) {
        return { text: fs.readFileSync(file, 'utf8'), locale, path: file };
      }
    }
  }
  return null;
}

/**
 * 스토리 스크립트 원문을 ko_KR 우선으로 읽는다.
 * @returns {{ text: string, locale: string, needsTranslation: boolean } | null}
 */
export function readStoryText(storyTxt) {
  const found = readFirstExisting((locale) => storyPath(locale, storyTxt));
  if (!found) return null;
  return {
    text: found.text,
    locale: found.locale,
    needsTranslation: found.locale !== PRIMARY,
  };
}

/** 스토리 줄거리 요약(info) 을 ko_KR 우선으로 읽는다. */
export function readStoryInfo(storyInfo) {
  if (!storyInfo) return null;
  const found = readFirstExisting((locale) => storyInfoPath(locale, storyInfo));
  if (!found) return null;
  return {
    text: found.text.trim(),
    locale: found.locale,
    needsTranslation: found.locale !== PRIMARY,
  };
}

// ---------------------------------------------------------------------------
// 값 단위 폴백
// ---------------------------------------------------------------------------

/**
 * 로케일별 값 맵 { ko_KR: v, zh_CN: v } 에서 우선순위대로 첫 유효값을 고른다.
 * @returns {{ value: any, locale: string|null, needsTranslation: boolean }}
 */
export function pick(byLocale) {
  for (const locale of LOCALES) {
    const v = byLocale?.[locale];
    if (v !== undefined && v !== null && v !== '') {
      return { value: v, locale, needsTranslation: locale !== PRIMARY };
    }
  }
  return { value: null, locale: null, needsTranslation: false };
}

/**
 * 텍스트 폴백 + (필요시) 번역. 동기 버전: 번역은 하지 않고 표시용 메타만 붙인다.
 * @returns {{ text: string, locale: string|null, needsTranslation: boolean }}
 */
export function pickText(byLocale) {
  const { value, locale, needsTranslation } = pick(byLocale);
  return { text: value ?? '', locale, needsTranslation };
}

// ---------------------------------------------------------------------------
// 번역 API 연동 자리 (placeholder)
// ---------------------------------------------------------------------------

/**
 * zh_CN 폴백 텍스트를 한국어로 번역한다. (런타임 placeholder)
 *
 * 실제 번역은 빌드 전에 scripts/translate.mjs 가 수행해 translations/ 에 캐시한다.
 * TODO(translate): 필요하면 이 함수에서 캐시 미스 시 API 를 바로 호출하도록 연결.
 *   - 후보: DeepL / Google Cloud Translation / Papago / LLM(Claude 등)
 *   - 빌드 타임 호출이므로 결과를 `src/data/translations/<hash>.json` 같은 곳에 캐시해
 *     매 빌드마다 API 를 다시 호출하지 않도록 할 것 (비용 + 속도).
 *   - 인게임 리치 텍스트 태그(<@ba.kw>…</>, <i>, <color=…>) 를 보존하려면 태그를 placeholder 로
 *     치환 → 번역 → 복원하는 전처리가 필요하다. (src/lib/story-parser.mjs 의 stripRichText 참고)
 *   - API 키는 환경변수(TRANSLATE_API_KEY)로만 주입하고, GitHub Actions 에서는 secrets 로 넘긴다.
 *
 * 현재는 원문을 그대로 반환한다.
 *
 * @param {string} text
 * @param {{ from?: string, to?: string }} [opts]
 * @returns {Promise<string>}
 */
export async function translate(text, { from = 'zh', to = 'ko' } = {}) {
  void from;
  void to;
  return text;
}

/**
 * pickText 의 비동기 버전: zh_CN 폴백이면 translate() 를 거친다.
 * translate() 가 placeholder 인 동안에는 pickText 와 동일한 결과.
 */
export async function pickTextTranslated(byLocale) {
  const picked = pickText(byLocale);
  if (picked.needsTranslation && picked.text) {
    return { ...picked, text: await translate(picked.text), original: picked.text };
  }
  return picked;
}

/** 로케일 표시용 라벨 (서버 기준) */
export const LOCALE_LABELS = {
  ko_KR: 'KR server',
  zh_CN: 'CN server',
};

// ---------------------------------------------------------------------------
// 번역 캐시 (translations/zh_CN/**)
//   - meta.json                : 그룹/스토리 이름·태그·줄거리   { groups: {id:{name}}, stories: {id:{name, avgTag, summary}} }
//   - operators/<charId>.json  : CN 전용 오퍼레이터 전체 텍스트 (process-data 의 operator 구조와 동일)
//   - stories/<storyId>.json   : 스크립트 라인 번역 { lines: string[] } (parseStory 결과에서 text 가 있는 줄 순서)
//   ko_KR 데이터가 생기면 해당 캐시는 자동으로 무시된다 (ko 우선). 정리는 `npm run translate -- --prune`.
// ---------------------------------------------------------------------------
export function translationsRoot(locale = 'zh_CN') {
  return path.join(PROJECT_ROOT, 'translations', locale);
}

const trCache = new Map();

let speakerMapCache;
/** src/data/speakers.json (process-data 가 만든 중국어 → 한국어 화자 이름 대응표) */
function loadSpeakerMap() {
  if (speakerMapCache !== undefined) return speakerMapCache;
  const file = path.join(PROJECT_ROOT, 'src', 'data', 'speakers.json');
  speakerMapCache = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  return speakerMapCache;
}
/** translations/<locale>/<rel>.json 을 읽는다. 없으면 null. */
export function loadTranslation(rel, locale = 'zh_CN') {
  const key = `${locale}:${rel}`;
  if (trCache.has(key)) return trCache.get(key);
  const file = path.join(translationsRoot(locale), `${rel}.json`);
  const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  trCache.set(key, data);
  return data;
}

/**
 * 파싱된 스토리 라인에 번역 캐시를 적용한다. 캐시가 없거나 줄 수가 맞지 않으면 원문 그대로.
 * @returns {{ lines: any[], translated: boolean }}
 */
export function applyStoryTranslation(storyId, lines, locale = 'zh_CN') {
  const tr = loadTranslation(`stories/${storyId}`, locale);
  if (!tr?.lines) return { lines, translated: false };
  // 화자 이름: 스토리별 지정(tr.speakers) → 전체 대응표(src/data/speakers.json) 순
  const speakerMap = { ...(loadSpeakerMap() ?? {}), ...(tr.speakers ?? {}) };
  const translateSpeaker = (name) => (name && speakerMap[name]) || name;
  const targets = lines.filter((l) => typeof l.text === 'string' && l.text.length > 0);
  if (targets.length !== tr.lines.length) {
    console.warn(`[i18n] ${storyId}: 번역 줄 수 불일치 (${tr.lines.length} vs ${targets.length}) — 원문 표시`);
    return { lines, translated: false };
  }
  let i = 0;
  const out = lines.map((l) => {
    const speaker = l.speaker ? translateSpeaker(l.speaker) : l.speaker;
    if (typeof l.text === 'string' && l.text.length > 0) {
      const t = tr.lines[i++];
      return { ...l, speaker, text: t, original: l.text };
    }
    return speaker === l.speaker ? l : { ...l, speaker };
  });
  // 선택지 옵션 텍스트도 함께 번역되어 있으면 적용
  if (tr.options) {
    for (const l of out) if (l.type === 'decision' && tr.options[l.text]) l.options = l.options.map((o) => ({ ...o, text: tr.options[l.text][o.value] ?? o.text }));
  }
  return { lines: out, translated: true };
}
