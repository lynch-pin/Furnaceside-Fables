#!/usr/bin/env node
/**
 * scripts/process-data.mjs
 * gamedata/ 원본(JSON + 스토리 스크립트) → src/data/*.json 가공.
 *
 *   src/data/stories.json    story_review_table 기반 스토리 목록 (+ 등장 캐릭터, 줄거리)
 *   src/data/operators.json  character_table 기반 오퍼레이터 (+ 기록 / 대사 / 오퍼레이터 레코드 / 등장 스토리)
 *   src/data/timeline.json   activity_table + story_review 조합, 시간순 정렬
 *   src/data/meta.json       데이터 버전 / 생성 시각 / 통계
 *
 * 사용: npm run process   (사전에 npm run sync 필요)
 * 환경변수: GAMEDATA_DIR (원본 위치), OUT_DIR (출력 위치, 기본 src/data)
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  LOCALES,
  PRIMARY,
  gamedataRoot,
  hasLocale,
  loadExcelAll,
  pick,
  pickText,
  readStoryInfo,
  readStoryText,
  excelPath,
} from '../src/lib/i18n.mjs';
import { parseStoryWithMeta, spriteToCharKey, stripRichText } from '../src/lib/story-parser.mjs';
import { loadTranslation } from '../src/lib/i18n.mjs';
import { operatorAvatar, operatorPortrait, chapterBanner, storyEntryPic, storyMainPic, avgBackground, avgImage } from '../src/lib/assets.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT_DIR = process.env.OUT_DIR ? path.resolve(process.env.OUT_DIR) : path.join(ROOT, 'src', 'data');
const OVERRIDES_DIR = path.join(ROOT, 'overrides');

const log = (...a) => console.log('[process-data]', ...a);
const t0 = Date.now();

// ---------------------------------------------------------------------------
// 0. 사전 점검
// ---------------------------------------------------------------------------
if (!hasLocale(PRIMARY) && !hasLocale(LOCALES[1])) {
  console.error(`[process-data] gamedata 를 찾을 수 없습니다: ${gamedataRoot()}\n  → 먼저 \`npm run sync\` 를 실행하세요.`);
  process.exit(1);
}
for (const locale of LOCALES) {
  log(`${locale}: ${hasLocale(locale) ? '있음' : '없음 (폴백 불가)'}`);
}

/** 로케일별 테이블에서 같은 키의 값을 { ko_KR: v, zh_CN: v } 로 */
const byLocale = (tables, ...keys) => {
  const out = {};
  for (const locale of LOCALES) {
    let v = tables[locale];
    for (const k of keys) v = v?.[k];
    out[locale] = v;
  }
  return out;
};

/** ko 우선 텍스트 + 폴백 표시 */
const text = (tables, ...keys) => pickText(byLocale(tables, ...keys));

/**
 * 번역 캐시 (translations/zh_CN/meta.json). ko_KR 값이 없어 zh_CN 으로 폴백한 텍스트에만 적용한다.
 * @returns {{ text, locale, needsTranslation, translated }}
 */
const TR_META = loadTranslation('meta') ?? { groups: {}, stories: {} };
function withTranslation(picked, translatedText) {
  if (!picked.needsTranslation || !translatedText) return { ...picked, translated: false };
  return { ...picked, text: translatedText, original: picked.text, translated: true };
}

/** unix epoch(초) → KST 날짜 문자열 (YYYY-MM-DD) */
const toKstDate = (sec) =>
  sec > 0 ? new Date(sec * 1000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }) : null;

const RARITY = { TIER_1: 1, TIER_2: 2, TIER_3: 3, TIER_4: 4, TIER_5: 5, TIER_6: 6 };

// ---------------------------------------------------------------------------
// 1. 테이블 로드
// ---------------------------------------------------------------------------
log('테이블 로드…');
const storyReview = loadExcelAll('story_review_table');
const activity = loadExcelAll('activity_table');
const character = loadExcelAll('character_table');
const charword = loadExcelAll('charword_table', { required: false });
const handbook = loadExcelAll('handbook_info_table', { required: false });
const handbookTeam = loadExcelAll('handbook_team_table', { required: false });
const zone = loadExcelAll('zone_table', { required: false });
const itemTable = loadExcelAll('item_table', { required: false });
const uniequip = loadExcelAll('uniequip_table', { required: false });
const storyReviewMeta = loadExcelAll('story_review_meta_table', { required: false });

/** 모든 로케일에 걸친 키 합집합 (ko 순서 우선) */
const unionKeys = (tables) => {
  const seen = new Set();
  const out = [];
  for (const locale of LOCALES) {
    for (const k of Object.keys(tables[locale] ?? {})) {
      if (!seen.has(k)) {
        seen.add(k);
        out.push(k);
      }
    }
  }
  return out;
};

// ---------------------------------------------------------------------------
// 2. 오퍼레이터 인덱스 (스토리 등장 매칭에 먼저 필요)
// ---------------------------------------------------------------------------
log('오퍼레이터 인덱스…');
const EXCLUDED_PROFESSIONS = new Set(['TOKEN', 'TRAP']);
const teamNames = {};
for (const [id, v] of Object.entries(handbookTeam[PRIMARY] ?? handbookTeam[LOCALES[1]] ?? {})) {
  teamNames[id] = v.powerName;
}

const staleTranslations = []; // ko_KR 데이터가 생겨 더 이상 필요 없는 번역 캐시
const operators = new Map(); // id → operator
const spriteKeyToId = new Map(); // "130_doberm" → "char_130_doberm"
const nameToId = new Map(); // "도베르만" → "char_130_doberm" (ko / cn 이름 모두)

for (const id of unionKeys(character)) {
  if (!id.startsWith('char_')) continue;
  const src = pick(byLocale(character, id));
  const c = src.value;
  if (!c || EXCLUDED_PROFESSIONS.has(c.profession)) continue;

  const trOp = loadTranslation(`operators/${id}`); // CN 전용 오퍼레이터 번역본 (ko_KR 데이터가 있으면 무시됨)
  const name = withTranslation(text(character, id, 'name'), trOp?.name);
  if (trOp?.name && !name.needsTranslation) staleTranslations.push(`operators/${id}`);
  // 초상화: 기본(_1) / 정예 1 변경(_1+) / 정예 2(_2). 있는 것만.
  // TODO(portrait): 스킨 일러스트는 skin_table.json 의 portraitId 로 같은 방식으로 붙일 수 있다 (검토 중).
  const portraits = [
    { key: 'e1', label: '정예 1', url: operatorPortrait(`${id}_1`) },
    { key: 'e1plus', label: '정예 1+', url: operatorPortrait(`${id}_1+`) },
    { key: 'e2', label: '정예 2', url: operatorPortrait(`${id}_2`) },
  ].filter((p) => p.url);

  const op = {
    id,
    name: name.text,
    avatar: operatorAvatar(id),
    portraits,
    appellation: c.appellation ?? '',
    displayNumber: c.displayNumber ?? null,
    rarity: RARITY[c.rarity] ?? null,
    profession: c.profession,
    subProfession: c.subProfessionId ?? null,
    position: c.position ?? null,
    nation: c.nationId ?? null,
    group: c.groupId ?? null,
    team: c.teamId ?? null,
    nationName: teamNames[c.nationId] ?? null,
    groupName: teamNames[c.groupId] ?? null,
    teamName: teamNames[c.teamId] ?? null,
    tags: name.translated && trOp?.tags ? trOp.tags : (c.tagList ?? []),
    description: stripRichText(withTranslation(text(character, id, 'description'), trOp?.description).text),
    itemUsage: withTranslation(text(character, id, 'itemUsage'), trOp?.itemUsage).text,
    itemDesc: withTranslation(text(character, id, 'itemDesc'), trOp?.itemDesc).text,
    obtainApproach: withTranslation(text(character, id, 'itemObtainApproach'), trOp?.obtainApproach).text,
    obtainable: !c.isNotObtainable,
    // sourceLocale: 원문 서버. translated: 번역본이 적용됨. needsTranslation: 원문이 CN 이지만 번역본 없음
    sourceLocale: name.locale,
    translated: name.translated,
    needsTranslation: name.needsTranslation && !name.translated,
    // 아래는 이후 단계에서 채움
    records: [],
    operatorRecords: [],
    words: [],
    cv: {},
    appearances: [],
  };
  operators.set(id, op);

  const key = spriteToCharKey(id);
  if (key) spriteKeyToId.set(key.key, id);
  for (const locale of LOCALES) {
    const n = character[locale]?.[id]?.name;
    if (n && !nameToId.has(n)) nameToId.set(n, id);
  }
}
log(`  오퍼레이터 ${operators.size}명`);

// ---------------------------------------------------------------------------
// 3. 스토리 (story_review_table)
// ---------------------------------------------------------------------------
log('스토리 파싱…');
const activityInfo = (groupId) => pick(byLocale(activity, 'basicInfo', groupId)).value ?? null;
const zoneInfo = (groupId) => pick(byLocale(zone, 'zones', groupId)).value ?? null;

const KIND_BY_ENTRY = { MAINLINE: 'main', ACTIVITY: 'side', MINI_ACTIVITY: 'mini', NONE: 'record' };

// 썸네일로 쓰기에 무의미한 배경 (검정/흰색/단색 화면)
const GENERIC_BG_RE = /^(bg_)?(black|white|dark|grey|gray|blank|empty|none)(_|\d|$)/i;
const isGenericBg = (name) => !name || GENERIC_BG_RE.test(name);

/** 인게임 아카이브(actArchiveResData.pics)의 이벤트 KV 이미지 → avg/images/<assetPath>.png */
function archiveKeyVisual(groupId) {
  const pics = pick(byLocale(storyReviewMeta, 'actArchiveResData', 'pics')).value ?? {};
  const mine = Object.values(pics).filter((p) => p.id?.startsWith(`${groupId}_pic_`) && p.assetPath);
  if (!mine.length) return null;
  const kv = mine.find((p) => /_kv$/i.test(p.assetPath)) ?? mine[0];
  return avgImage(kv.assetPath);
}

// ---------------------------------------------------------------------------
// 세계관 연도(테라 력) 추출
// ---------------------------------------------------------------------------
/**
 * 스토리 스크립트에서 "이 이야기가 벌어지는 연도"를 추정한다.
 *   - 대상 줄: narration / caption(animtext) / subtitle / sticker  (대사는 과거 회상 언급이 많아 제외)
 *   - 패턴: 1000~1199년 (한국어 "1098년", 중국어 "1098年")
 *   - 가중치: 날짜 스탬프 형태("1098년 12월 21일 5:05 P.M.", "1091년 겨울", 줄 첫머리의 연도) 5, 그 외 1
 *   - "600년 전", "100년 만에" 같은 기간 표현은 제외
 * 반환: { weights: {연도: 가중치}, evidence: [{year, text}] }
 */
const YEAR_RE = /(1[01]\d{2})\s*(년|年)/g;
const RELATIVE_AFTER_RE = /^\s*(전|만|간|동안|후|넘|가까이|이상|이하|前|后|後|间|多|来)/;
const STAMP_HINT_RE = /(\d{1,2}\s*(월|月)|\d{1,2}\s*(일|日)|[AP]\.?M\.?|봄|여름|가을|겨울|초|말|春|夏|秋|冬)/;
const YEAR_LINE_TYPES = new Set(['narration', 'caption', 'subtitle', 'sticker']);

function extractYears(lines) {
  const weights = {};
  const evidence = [];
  for (const line of lines) {
    if (!YEAR_LINE_TYPES.has(line.type) || !line.text) continue;
    const text = stripRichText(line.text).replace(/\s+/g, ' ').trim();
    let m;
    YEAR_RE.lastIndex = 0;
    while ((m = YEAR_RE.exec(text))) {
      const after = text.slice(m.index + m[0].length);
      if (RELATIVE_AFTER_RE.test(after)) continue; // "600년 전" 등 기간 표현
      const year = Number(m[1]);
      // 날짜 스탬프 판정: 짧은 장소/시각 표기("1098년 12월 21일 5:05 P.M.", "1091년 겨울", "1100년, 라이타니엔 북부")
      //   - 문장(…다. / …요. / 。)으로 끝나면 서술문이므로 제외
      //   - 60자 이내이고, 연도가 앞부분(5자 이내)에 있거나 월/일/시각/계절 힌트가 바로 뒤따라야 함
      const isSentence = /(다|요|까|네|지|어|아)\.?$|。$|[.!?]$/.test(text) && !/[AP]\.?M\.?$/.test(text);
      const isStamp = !isSentence && text.length <= 60 && (m.index <= 5 || STAMP_HINT_RE.test(after.slice(0, 20)));
      // 날짜 스탬프만 정렬 근거로 사용. 본문 중 언급(회상 등)은 근거 목록에만 남긴다.
      if (isStamp) weights[year] = (weights[year] ?? 0) + 5;
      if (evidence.length < 6) evidence.push({ year, text: text.slice(0, 80), stamp: isStamp });
    }
  }
  return { weights, evidence };
}

/** 가중치 맵에서 대표 연도 (동률이면 더 큰 연도 = 현재 시점에 가까운 쪽) */
function topYear(weights) {
  let best = null;
  for (const [y, w] of Object.entries(weights)) {
    const year = Number(y);
    if (best === null || w > best.w || (w === best.w && year > best.year)) best = { year, w };
  }
  return best ? best.year : null;
}

/** 인게임 아카이브(story_review_meta_table.actArchiveData) 의 연표에서 연도 목록 */
function archiveYears(groupId) {
  const comps = pick(byLocale(storyReviewMeta, 'actArchiveData', 'components')).value ?? {};
  const list = comps[groupId]?.timeline?.timelineList ?? [];
  const years = [];
  for (const t of list) {
    const m = String(t.timelineTitle ?? '').match(/_year_(\d{4})/);
    if (m) years.push(Number(m[1]));
  }
  return years;
}

/**
 * 그룹의 "공개 시각" 결정.
 *   우선순위: activity_table.basicInfo.startTime(이벤트 시작) → story_review.startTime → startShowTime
 *   ko_KR 값을 먼저 보고, 없거나 placeholder(먼 미래, 예: 2099-xx) 이면 zh_CN 값으로 폴백.
 *   ※ 한국 서버 미출시 콘텐츠는 zh_CN 날짜(중국 서버 출시일)가 들어가며 timestampLocale 로 구분 가능.
 */
const PLACEHOLDER_AFTER = Math.floor(Date.now() / 1000) + 365 * 86400; // 1년 이상 미래면 placeholder 로 간주
function resolveTimestamp(groupId) {
  for (const locale of LOCALES) {
    const g = storyReview[locale]?.[groupId];
    const act = activity[locale]?.basicInfo?.[groupId];
    const candidates = [act?.startTime, g?.startTime, g?.startShowTime];
    for (const ts of candidates) {
      if (typeof ts === 'number' && ts > 0 && ts < PLACEHOLDER_AFTER) return { timestamp: ts, timestampLocale: locale };
    }
  }
  return { timestamp: 0, timestampLocale: null };
}

const groups = []; // 스토리 그룹(이벤트/챕터/오퍼레이터 레코드 세트)
const stories = []; // 개별 스토리
const storyIndex = new Map(); // storyId → story
const appearanceIndex = new Map(); // charId → Set<storyId>
let missingText = 0;

for (const groupId of unionKeys(storyReview)) {
  const picked = pick(byLocale(storyReview, groupId));
  const g = picked.value;
  const gname = withTranslation(text(storyReview, groupId, 'name'), TR_META.groups?.[groupId]?.name);
  const act = activityInfo(groupId);
  const zn = zoneInfo(groupId);

  const { timestamp, timestampLocale } = resolveTimestamp(groupId);

  const group = {
    id: groupId,
    name: gname.text,
    kind: KIND_BY_ENTRY[g.entryType] ?? 'other',
    entryType: g.entryType,
    actType: g.actType,
    displayType: act?.displayType ?? null,
    timestamp,
    timestampLocale,
    date: toKstDate(timestamp),
    // 메인 스토리는 zone_table 의 "에피소드 N" 라벨 사용
    chapter: zn ? { label: zn.zoneNameFirst, code: zn.zoneNameThird, title: zn.zoneNameSecond } : null,
    entryPic: g.storyEntryPicId ?? null,
    // 썸네일: 이벤트 대표 이미지 → 메인 챕터 배너 → (없으면 첫 스토리의 배경으로 아래에서 보충)
    image: storyEntryPic(g.storyEntryPicId) ?? (g.entryType === 'MAINLINE' ? chapterBanner(groupId) : null),
    mainColor: g.storyMainColor ?? null,
    sourceLocale: gname.locale,
    translated: gname.translated,
    needsTranslation: gname.needsTranslation && !gname.translated,
    storyIds: [],
  };

  const groupImageCandidates = []; // [{cg, bg}] 소속 스토리 순서대로
  // infoUnlockDatas 는 로케일별로 합집합 (storyId 기준, ko 우선)
  const unlockByLocale = byLocale(storyReview, groupId, 'infoUnlockDatas');
  const unlockMap = new Map();
  for (const locale of [...LOCALES].reverse()) {
    for (const d of unlockByLocale[locale] ?? []) unlockMap.set(d.storyId, { ...(unlockMap.get(d.storyId) ?? {}), [locale]: d });
  }

  for (const [storyId, perLocale] of unlockMap) {
    const d = pick(perLocale).value;
    const trStory = TR_META.stories?.[storyId] ?? {};
    const sname = withTranslation(pickText({ ko_KR: perLocale.ko_KR?.storyName, zh_CN: perLocale.zh_CN?.storyName }), trStory.name);
    const avgTag = withTranslation(pickText({ ko_KR: perLocale.ko_KR?.avgTag, zh_CN: perLocale.zh_CN?.avgTag }), trStory.avgTag);
    const hasScriptTranslation = Boolean(loadTranslation(`stories/${storyId}`));

    // 스크립트 원문 → 파싱 → 등장 캐릭터
    const script = d.storyTxt ? readStoryText(d.storyTxt) : null;
    const info = readStoryInfo(d.storyInfo);
    let characters = [];
    let speakers = [];
    let lineCount = 0;
    let dialogueCount = 0;
    let years = { weights: {}, evidence: [] };
    let image = storyMainPic(groupId, d.storyPic);
    const imageCandidates = groupImageCandidates; // 그룹 대표 이미지 후보 수집용

    if (script) {
      const { lines, cast } = parseStoryWithMeta(script.text);
      lineCount = lines.length;
      years = extractYears(lines);
      if (hasScriptTranslation && script.locale === PRIMARY) staleTranslations.push(`stories/${storyId}`);
      // 썸네일 보충: 스크립트의 첫 CG(Image) → 단색이 아닌 첫 배경 → 아무 배경
      const cgs = lines.filter((l) => l.type === 'image' && l.image).map((l) => avgImage(l.image)).filter(Boolean);
      const bgs = lines.filter((l) => l.type === 'scene' && l.image).map((l) => l.image);
      const goodBg = bgs.filter((b) => !isGenericBg(b)).map((b) => avgBackground(b)).filter(Boolean);
      const anyBg = bgs.map((b) => avgBackground(b)).filter(Boolean);
      if (!image) image = cgs[0] ?? goodBg[0] ?? anyBg[0] ?? null;
      imageCandidates.push({ cg: cgs[0] ?? null, bg: goodBg[0] ?? null });
      const charLines = new Map(); // charId → { lines, viaSprite }
      const bump = (charId, n, viaSprite) => {
        const cur = charLines.get(charId) ?? { lines: 0, viaSprite: false };
        cur.lines += n;
        cur.viaSprite = cur.viaSprite || viaSprite;
        charLines.set(charId, cur);
      };
      // (a) 화자 이름 → 오퍼레이터
      for (const [speaker, n] of Object.entries(cast.speakers)) {
        dialogueCount += n;
        const charId = nameToId.get(speaker);
        if (charId) bump(charId, n, false);
        else speakers.push({ name: speaker, lines: n });
      }
      // (b) 스프라이트 / 아바타 ID → 오퍼레이터 (대사 없이 등장만 하는 경우 포함)
      for (const sprite of cast.sprites) {
        const key = spriteToCharKey(sprite);
        const charId = key && spriteKeyToId.get(key.key);
        if (charId) bump(charId, 0, true);
      }
      characters = [...charLines.entries()]
        .map(([id, v]) => ({ id, lines: v.lines, viaSprite: v.viaSprite }))
        .sort((a, b) => b.lines - a.lines || a.id.localeCompare(b.id));
      speakers.sort((a, b) => b.lines - a.lines);
      speakers = speakers.slice(0, 30); // 오퍼레이터가 아닌 주요 화자(NPC) 상위 30명만 보존

      for (const c of characters) {
        if (!appearanceIndex.has(c.id)) appearanceIndex.set(c.id, new Set());
        appearanceIndex.get(c.id).add(storyId);
      }
    } else if (d.storyTxt) {
      missingText++;
    }

    const story = {
      id: storyId,
      groupId,
      groupName: group.name,
      kind: group.kind,
      code: d.storyCode || null,
      name: sname.text,
      avgTag: avgTag.text || null,
      sort: d.storySort ?? 0,
      txt: d.storyTxt ?? null,
      infoPath: d.storyInfo ?? null,
      summary: info?.locale === PRIMARY ? info.text : (trStory.summary ?? info?.text ?? null),
      summaryLocale: info?.locale ?? null,
      // 메타(이름/줄거리) 번역 상태 — translate.mjs --export-meta 가 번역 필요 항목을 고를 때 사용
      metaNeedsTranslation: Boolean((sname.needsTranslation && !sname.translated) || (info && info.locale !== PRIMARY && !trStory.summary)),
      image,
      // locale: 스크립트 원문 서버. translated: 본문 번역 캐시 존재. needsTranslation: CN 원문인데 본문 번역 없음
      locale: script?.locale ?? null,
      translated: Boolean(script && script.locale !== PRIMARY && hasScriptTranslation),
      needsTranslation: Boolean(script && script.locale !== PRIMARY && !hasScriptTranslation),
      available: Boolean(script),
      timestamp: group.timestamp,
      date: group.date,
      lineCount,
      dialogueCount,
      characters,
      speakers,
      // 세계관 연도 (자동 추출). overrides 적용은 연표 단계에서.
      loreYear: topYear(years.weights),
      loreYearWeights: years.weights,
      loreEvidence: years.evidence,
    };
    stories.push(story);
    storyIndex.set(storyId, story);
    group.storyIds.push(storyId);
  }

  group.storyIds.sort((a, b) => storyIndex.get(a).sort - storyIndex.get(b).sort);
  // 그룹 대표 이미지 보충: 아카이브 KV → 소속 스토리의 첫 CG → 단색 아닌 첫 배경 → 스토리 이미지 아무 것
  if (!group.image) {
    group.image =
      archiveKeyVisual(groupId) ??
      groupImageCandidates.map((c) => c.cg).find(Boolean) ??
      groupImageCandidates.map((c) => c.bg).find(Boolean) ??
      group.storyIds.map((sid) => storyIndex.get(sid).image).find(Boolean) ??
      null;
  }
  // 스토리 이미지가 없거나 단색 배경이면 그룹 이미지로 대체
  for (const sid of group.storyIds) {
    const st = storyIndex.get(sid);
    if (!st.image || /\/(bg_)?(black|white|dark|grey|gray|blank|empty)(_|\d)*\.png$/i.test(st.image)) st.image = group.image ?? st.image;
  }
  groups.push(group);
}
log(`  그룹 ${groups.length}개, 스토리 ${stories.length}편 (원문 없음 ${missingText}편)`);

// ---------------------------------------------------------------------------
// 4. 연표 (timeline.json) — 이벤트(스토리 그룹) 단위, 세계관 연도(테라 력) 기준
// ---------------------------------------------------------------------------
log('연표…');

/**
 * 연표는 이벤트(메인 챕터 / 사이드 / 미니) 단위로 나열하고, 각 이벤트 안에 스토리 목록을 둔다.
 * 회상·과거편이 섞여 있어도 이벤트는 "대부분의 사건이 벌어지는 시기" 한 곳에만 놓는다.
 * 이벤트 연도 결정 우선순위:
 *   1. overrides/timeline.json 의 <groupId>.loreYear   (수동, 최우선)
 *   2. 인게임 아카이브 연표 (story_review_meta_table.actArchiveData)
 *   3. 소속 스토리 2편 이상이 같은 연도의 날짜 스탬프를 가질 때 그 연도        (source: 'group-text')
 *   4. 소속 스토리 1편만 날짜 스탬프가 있을 때 그 연도 (회상일 수 있음, 검수 필요) (source: 'text-weak')
 *   5. 없음 → 연표 끝의 "연대 미상" 구역에 출시 순으로 배치
 * 같은 연도 안의 순서: overrides 의 loreOrder → 출시 시각.
 * 개별 스토리의 날짜 스탬프(loreYear)는 참고용으로 스토리 항목에 함께 내보낸다.
 *
 * overrides/timeline.json 형식은 overrides/README.md 참고.
 * TODO(timeline): meta.json 의 counts.timelineUnresolved 와 loreSource === null / 'text-weak' 항목을 보고 overrides 를 채울 것.
 */
let overrides = {};
const overridesFile = path.join(OVERRIDES_DIR, 'timeline.json');
if (fs.existsSync(overridesFile)) {
  overrides = JSON.parse(fs.readFileSync(overridesFile, 'utf8'));
  delete overrides._comment;
  log(`  overrides/timeline.json 적용 (${Object.keys(overrides).length}건)`);
}

function resolveGroupYear(g) {
  const gov = overrides[g.id] ?? {};
  if (Number.isInteger(gov.loreYear)) return { loreYear: gov.loreYear, loreSource: 'override', evidence: [] };

  const fromArchive = archiveYears(g.id);
  if (fromArchive.length) {
    return { loreYear: Math.min(...fromArchive), loreSource: 'archive', evidence: [{ year: Math.min(...fromArchive), text: '인게임 아카이브 연표' }] };
  }

  const weights = {};
  const supporters = {};
  const evidence = [];
  for (const sid of g.storyIds) {
    const st = storyIndex.get(sid);
    for (const [y, w] of Object.entries(st.loreYearWeights ?? {})) {
      weights[y] = (weights[y] ?? 0) + w;
      (supporters[y] ??= new Set()).add(sid);
    }
    for (const e of st.loreEvidence ?? []) if (e.stamp && evidence.length < 6) evidence.push({ ...e, storyId: sid });
  }
  const strong = Object.fromEntries(Object.entries(weights).filter(([y]) => supporters[y].size >= 2));
  const strongYear = topYear(strong);
  if (strongYear) return { loreYear: strongYear, loreSource: 'group-text', evidence };
  const weakYear = topYear(weights);
  if (weakYear) return { loreYear: weakYear, loreSource: 'text-weak', evidence };
  return { loreYear: null, loreSource: null, evidence };
}

// 그룹에도 콜라보 표시를 달아 /story 목록에서 쓴다
for (const g of groups) g.collab = overrides[g.id]?.collab ?? null;

const timeline = groups
  .filter((g) => g.kind !== 'record')
  .map((g) => {
    const gov = overrides[g.id] ?? {};
    const { loreYear, loreSource, evidence } = resolveGroupYear(g);
    return {
      id: g.id,
      name: g.name,
      kind: g.kind,
      chapter: g.chapter,
      image: g.image,
      // 콜라보 작품명 (overrides 에서 지정). 연도가 없으면 연표의 '콜라보' 구역에 묶인다.
      collab: gov.collab ?? null,
      // 세계관 연도
      loreYear,
      loreLabel: gov.loreLabel ?? (loreYear ? `${loreYear}년` : null),
      loreSource,
      loreOrder: Number.isFinite(gov.loreOrder) ? gov.loreOrder : null,
      loreEvidence: evidence,
      // 참고용 출시 정보
      releaseDate: g.date,
      releaseTimestamp: g.timestamp,
      sourceLocale: g.sourceLocale,
      translated: g.translated,
      needsTranslation: g.needsTranslation,
      stories: g.storyIds.map((sid) => {
        const s = storyIndex.get(sid);
        const sov = gov.stories?.[sid] ?? {};
        return {
          id: s.id,
          code: s.code,
          name: s.name,
          avgTag: s.avgTag,
          available: s.available,
          image: s.image,
          sourceLocale: s.locale,
          translated: s.translated,
          // 개별 스토리의 연도 (회상 등, 이벤트 연도와 다를 때 참고 표시)
          loreYear: Number.isInteger(sov.loreYear) ? sov.loreYear : (s.loreYear ?? null),
        };
      }),
    };
  })
  .sort((a, b) => {
    if (a.loreYear !== b.loreYear) {
      if (a.loreYear === null) return 1;
      if (b.loreYear === null) return -1;
      return a.loreYear - b.loreYear;
    }
    const ao = a.loreOrder ?? Number.POSITIVE_INFINITY;
    const bo = b.loreOrder ?? Number.POSITIVE_INFINITY;
    if (ao !== bo) return ao - bo;
    return a.releaseTimestamp - b.releaseTimestamp || a.id.localeCompare(b.id);
  });

const unresolved = timeline.filter((t) => t.loreYear === null);
const weak = timeline.filter((t) => t.loreSource === 'text-weak');
log(`  연표 ${timeline.length}개 이벤트: 연도 확정 ${timeline.length - unresolved.length} (검수 필요 ${weak.length}) / 미상 ${unresolved.length}`);

// 스토리에 연표 순번 부여 (오퍼레이터 등장 목록 정렬용): 이벤트 순서 × 스토리 순서
let order = 0;
for (const t of timeline) for (const st of t.stories) storyIndex.get(st.id).timelineOrder = order++;

// ---------------------------------------------------------------------------
// 5. 오퍼레이터 상세 (기록 / 대사 / 오퍼레이터 레코드 / 등장 스토리)
// ---------------------------------------------------------------------------
log('오퍼레이터 상세…');

// 5-a. 기록(handbook) + 오퍼레이터 레코드(handbookAvgList)
for (const [id, op] of operators) {
  const hbPick = pick(byLocale(handbook, 'handbookDict', id));
  const hb = hbPick.value;
  // 번역 캐시는 항상 읽는다. CN 서버에만 있는 모듈·증표·패러독스는 KR 오퍼레이터에게도 있을 수 있다.
  const trOp = loadTranslation(`operators/${id}`);
  if (hb) {
    op.records = (hb.storyTextAudio ?? []).map((sec, si) => ({
      title: trOp?.records?.[si]?.title ?? sec.storyTitle,
      // 승급/신뢰도 조건별로 여러 story 가 있을 수 있음 (patchIdList 는 형태 변경 캐릭터용)
      entries: (sec.stories ?? []).map((st, ei) => ({
        text: trOp?.records?.[si]?.entries?.[ei]?.text ?? st.storyText,
        unlock: st.unLockType,
        unlockParam: st.unLockParam ?? null,
        unlockString: trOp?.records?.[si]?.entries?.[ei]?.unlockString ?? (st.unLockString || null),
      })),
      locale: hbPick.locale,
      translated: Boolean(trOp?.records?.[si]),
    }));
    const avgList = Array.isArray(hb.handbookAvgList) ? hb.handbookAvgList : Object.values(hb.handbookAvgList ?? {});
    op.operatorRecords = avgList
      .sort((a, b) => (a.sortId ?? 0) - (b.sortId ?? 0))
      .map((set, si) => ({
        setId: set.storySetId,
        name: trOp?.operatorRecords?.[si]?.name ?? set.storySetName,
        date: toKstDate(set.storyGetTime),
        unlock: set.unlockParam ?? [],
        stories: (set.avgList ?? []).map((a, ai) => ({
          id: a.storyId,
          name: trOp?.operatorRecords?.[si]?.stories?.[ai]?.name ?? a.storyIntro,
          txt: a.storyTxt,
          available: storyIndex.get(a.storyId)?.available ?? false,
        })),
      }));
  }

  // 5-b. 대사 (charword_table). wordKey 단위(기본/스킨 보이스 세트)로 묶는다.
  const wordsByLocale = {};
  for (const locale of LOCALES) {
    const cw = charword[locale]?.charWords;
    if (!cw) continue;
    const list = Object.values(cw).filter((w) => w.charId === id);
    if (list.length) wordsByLocale[locale] = list;
  }
  const wp = pick(wordsByLocale);
  if (wp.value) {
    const sets = new Map();
    for (const w of wp.value.sort((a, b) => a.voiceIndex - b.voiceIndex)) {
      if (!sets.has(w.wordKey)) sets.set(w.wordKey, []);
      sets.get(w.wordKey).push({
        id: w.voiceId,
        title: w.voiceTitle,
        text: w.voiceText,
        place: w.placeType,
        unlock: w.unlockType,
        lockDescription: w.lockDescription || null,
      });
    }
    op.words = [...sets.entries()].map(([wordKey, lines]) => {
      const trSet = trOp?.words?.find((w) => w.wordKey === wordKey);
      const trById = new Map((trSet?.lines ?? []).map((l) => [l.id, l]));
      return {
        wordKey,
        isDefault: wordKey === id,
        lines: lines.map((l) => (trById.has(l.id) ? { ...l, title: trById.get(l.id).title ?? l.title, text: trById.get(l.id).text ?? l.text } : l)),
        sourceLocale: wp.locale,
        translated: Boolean(trSet),
        needsTranslation: wp.needsTranslation && !trSet,
      };
    });
  }
  // 성우 정보
  const vl = pick(byLocale(charword, 'voiceLangDict', id)).value;
  if (vl?.dict) {
    for (const [lang, v] of Object.entries(vl.dict)) op.cv[lang] = v.cvName ?? [];
  }

  // 5-b2. 증표 (잠재능력 아이템) / 커널 증표
  const tokenOf = (itemId, trKey) => {
    const picked = pick(byLocale(itemTable, 'items', itemId));
    const v = picked.value;
    if (!v) return null;
    const tr = trOp?.[trKey];
    return {
      id: itemId,
      name: tr?.name ?? v.name,
      description: tr?.description ?? v.description ?? null,
      usage: tr?.usage ?? v.usage ?? null,
      obtain: tr?.obtain ?? v.obtainApproach ?? null,
      sourceLocale: picked.locale,
      needsTranslation: picked.needsTranslation && !tr,
    };
  };
  op.token = tokenOf(`p_${id}`, 'token');
  op.tokenKernel = tokenOf(`class_p_${id}`, 'tokenKernel');

  // 5-b3. 패러독스 시뮬레이션 (handbookStageData)
  const paradoxPick = pick(byLocale(handbook, 'handbookStageData', id));
  if (paradoxPick.value) {
    const v = paradoxPick.value;
    const tr = trOp?.paradox;
    op.paradox = {
      stageId: v.stageId,
      code: v.code ?? null,
      name: tr?.name ?? v.name,
      description: tr?.description ?? v.description ?? null,
      unlock: v.unlockParam ?? [],
      sourceLocale: paradoxPick.locale,
      needsTranslation: paradoxPick.needsTranslation && !tr,
    };
  } else {
    op.paradox = null;
  }

  // 5-b4. 모듈 (uniequip). 기본 장비(INITIAL)는 특성 설명이므로 제외하고 모듈 스토리가 있는 것만.
  const equipIds = pick(byLocale(uniequip, 'charEquip', id)).value ?? [];
  op.modules = equipIds
    .map((eid, i) => {
      const picked = pick(byLocale(uniequip, 'equipDict', eid));
      const v = picked.value;
      if (!v || v.type === 'INITIAL') return null;
      const tr = trOp?.modules?.find((m) => m.id === eid);
      return {
        id: eid,
        name: tr?.name ?? v.uniEquipName,
        typeName: [v.typeName1, v.typeName2].filter(Boolean).join('-'),
        // 모듈 스토리 (uniEquipDesc)
        story: tr?.story ?? v.uniEquipDesc ?? null,
        unlockLevel: v.unlockLevel ?? null,
        phase: v.unlockEvolvePhase ?? null,
        order: v.charEquipOrder ?? i,
        sourceLocale: picked.locale,
        needsTranslation: picked.needsTranslation && !tr,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.order - b.order);

  // 5-c. 등장 스토리 (연표 순)
  op.appearances = [...(appearanceIndex.get(id) ?? [])]
    .map((sid) => storyIndex.get(sid))
    .sort((a, b) => (a.timelineOrder ?? 1e9) - (b.timelineOrder ?? 1e9) || a.sort - b.sort)
    .map((s) => {
      const me = s.characters.find((c) => c.id === id);
      return { id: s.id, groupId: s.groupId, groupName: s.groupName, code: s.code, name: s.name, avgTag: s.avgTag, date: s.date, lines: me?.lines ?? 0 };
    });
}

// ---------------------------------------------------------------------------
// 6. 출력
// ---------------------------------------------------------------------------
fs.mkdirSync(OUT_DIR, { recursive: true });
const write = (name, data) => {
  const file = path.join(OUT_DIR, name);
  fs.writeFileSync(file, JSON.stringify(data));
  log(`  → ${path.relative(ROOT, file)} (${(fs.statSync(file).size / 1024 / 1024).toFixed(1)} MB)`);
};

const readVersion = (locale) => {
  const f = excelPath(locale, 'data_version').replace(/\.json$/, '.txt');
  if (!fs.existsSync(f)) return null;
  const m = fs.readFileSync(f, 'utf8').match(/VersionControl:(\S+)/);
  return m ? m[1] : null;
};
let gamedataCommit = null;
try {
  gamedataCommit = execSync('git rev-parse HEAD', { cwd: gamedataRoot(), stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
} catch {
  /* gamedata 가 git 저장소가 아닐 수 있음 */
}

const operatorList = [...operators.values()].sort((a, b) => (b.rarity ?? 0) - (a.rarity ?? 0) || a.name.localeCompare(b.name, 'ko'));

write('stories.json', { groups, stories });
write('operators.json', operatorList);
write('timeline.json', timeline);
write('meta.json', {
  generatedAt: new Date().toISOString(),
  gamedataCommit,
  versions: Object.fromEntries(LOCALES.map((l) => [l, readVersion(l)])),
  counts: {
    groups: groups.length,
    stories: stories.length,
    storiesWithText: stories.filter((s) => s.available).length,
    storiesFromCn: stories.filter((s) => s.locale === 'zh_CN').length,
    storiesTranslated: stories.filter((s) => s.translated).length,
    storiesUntranslated: stories.filter((s) => s.needsTranslation).length,
    staleTranslations: staleTranslations.length,
    operators: operatorList.length,
    timeline: timeline.length,
    timelineUnresolved: unresolved.length,
    timelineWeak: weak.length,
    timelineBySource: timeline.reduce((acc, t) => ((acc[t.loreSource ?? 'none'] = (acc[t.loreSource ?? 'none'] ?? 0) + 1), acc), {}),
  },
});

if (staleTranslations.length) {
  log(`ko_KR 데이터가 생겨 불필요해진 번역 캐시 ${staleTranslations.length}개: ${staleTranslations.slice(0, 5).join(', ')}${staleTranslations.length > 5 ? ' …' : ''}`);
  log('  → `npm run translate -- --prune` 으로 정리하거나 translations/zh_CN/ 에서 직접 삭제');
}
log(`완료 (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
