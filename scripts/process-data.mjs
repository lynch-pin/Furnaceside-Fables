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

const operators = new Map(); // id → operator
const spriteKeyToId = new Map(); // "130_doberm" → "char_130_doberm"
const nameToId = new Map(); // "도베르만" → "char_130_doberm" (ko / cn 이름 모두)

for (const id of unionKeys(character)) {
  if (!id.startsWith('char_')) continue;
  const src = pick(byLocale(character, id));
  const c = src.value;
  if (!c || EXCLUDED_PROFESSIONS.has(c.profession)) continue;

  const name = text(character, id, 'name');
  const op = {
    id,
    name: name.text,
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
    tags: c.tagList ?? [],
    description: stripRichText(text(character, id, 'description').text),
    itemUsage: text(character, id, 'itemUsage').text,
    itemDesc: text(character, id, 'itemDesc').text,
    obtainApproach: text(character, id, 'itemObtainApproach').text,
    obtainable: !c.isNotObtainable,
    locale: name.locale,
    needsTranslation: name.needsTranslation,
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
      const isStamp = text.length <= 80 && (m.index <= 30 || STAMP_HINT_RE.test(after.slice(0, 20)));
      const w = isStamp ? 5 : 1;
      weights[year] = (weights[year] ?? 0) + w;
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
  const gname = text(storyReview, groupId, 'name');
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
    mainColor: g.storyMainColor ?? null,
    locale: gname.locale,
    needsTranslation: gname.needsTranslation,
    storyIds: [],
  };

  // infoUnlockDatas 는 로케일별로 합집합 (storyId 기준, ko 우선)
  const unlockByLocale = byLocale(storyReview, groupId, 'infoUnlockDatas');
  const unlockMap = new Map();
  for (const locale of [...LOCALES].reverse()) {
    for (const d of unlockByLocale[locale] ?? []) unlockMap.set(d.storyId, { ...(unlockMap.get(d.storyId) ?? {}), [locale]: d });
  }

  for (const [storyId, perLocale] of unlockMap) {
    const d = pick(perLocale).value;
    const sname = pickText({ ko_KR: perLocale.ko_KR?.storyName, zh_CN: perLocale.zh_CN?.storyName });
    const avgTag = pickText({ ko_KR: perLocale.ko_KR?.avgTag, zh_CN: perLocale.zh_CN?.avgTag });

    // 스크립트 원문 → 파싱 → 등장 캐릭터
    const script = d.storyTxt ? readStoryText(d.storyTxt) : null;
    const info = readStoryInfo(d.storyInfo);
    let characters = [];
    let speakers = [];
    let lineCount = 0;
    let dialogueCount = 0;
    let years = { weights: {}, evidence: [] };

    if (script) {
      const { lines, cast } = parseStoryWithMeta(script.text);
      lineCount = lines.length;
      years = extractYears(lines);
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
      summary: info?.text ?? null,
      summaryLocale: info?.locale ?? null,
      locale: script?.locale ?? null,
      needsTranslation: Boolean(script?.needsTranslation || sname.needsTranslation),
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
  groups.push(group);
}
log(`  그룹 ${groups.length}개, 스토리 ${stories.length}편 (원문 없음 ${missingText}편)`);

// ---------------------------------------------------------------------------
// 4. 연표 (timeline.json) — 세계관 연도(테라 력) 기준
// ---------------------------------------------------------------------------
log('연표…');

/**
 * 연표 정렬 기준은 "스토리 안에서 벌어지는 연도" 이다. (게임 출시일이 아님)
 * 연도 결정 우선순위:
 *   1. overrides/timeline.json 의 loreYear  (수동, 최우선)
 *   2. 인게임 아카이브 연표 (story_review_meta_table.actArchiveData, 일부 이벤트만 존재)
 *   3. 스크립트 텍스트의 날짜 스탬프에서 자동 추출 (extractYears)
 *   4. 없음 → 연표 끝의 "연대 미상" 구역에 출시 순으로 배치
 *
 * overrides/timeline.json 형식:
 *   { "<groupId>": { "loreYear": 1098, "loreLabel": "1098년 봄", "loreOrder": 3,
 *                    "stories": { "<storyId>": { "loreYear": 1030 } } } }
 *   - loreOrder: 같은 연도 안에서의 순서 (작을수록 앞). 없으면 출시 시각 순.
 *   - stories: 회상/과거편 등 그룹과 다른 연도의 개별 스토리 보정.
 *
 * TODO(timeline): 자동 추출은 연도가 텍스트에 명시된 이벤트만 잡는다. meta.json 의
 *   counts.timelineUnresolved 와 timeline.json 의 loreSource === null 항목을 보고 overrides 를 채울 것.
 *   각 항목의 loreEvidence 에 추출 근거 문장이 들어 있으니 검수에 활용.
 */
let overrides = {};
const overridesFile = path.join(OVERRIDES_DIR, 'timeline.json');
if (fs.existsSync(overridesFile)) {
  overrides = JSON.parse(fs.readFileSync(overridesFile, 'utf8'));
  log(`  overrides/timeline.json 적용 (${Object.keys(overrides).length}건)`);
}

function resolveGroupYear(g) {
  const ov = overrides[g.id] ?? {};
  if (Number.isInteger(ov.loreYear)) return { loreYear: ov.loreYear, loreSource: 'override', evidence: [] };

  const fromArchive = archiveYears(g.id);
  if (fromArchive.length) {
    return { loreYear: Math.min(...fromArchive), loreSource: 'archive', evidence: fromArchive.map((y) => ({ year: y, text: '인게임 아카이브 연표' })) };
  }

  const weights = {};
  const evidence = [];
  for (const sid of g.storyIds) {
    const st = storyIndex.get(sid);
    for (const [y, w] of Object.entries(st.loreYearWeights ?? {})) weights[y] = (weights[y] ?? 0) + w;
    for (const e of st.loreEvidence ?? []) if (e.stamp && evidence.length < 8) evidence.push({ ...e, storyId: sid });
  }
  const year = topYear(weights);
  return { loreYear: year, loreSource: year ? 'text' : null, evidence };
}

const timeline = groups
  .filter((g) => g.kind !== 'record')
  .map((g) => {
    const ov = overrides[g.id] ?? {};
    const { loreYear, loreSource, evidence } = resolveGroupYear(g);
    return {
      id: g.id,
      name: g.name,
      kind: g.kind,
      displayType: g.displayType,
      chapter: g.chapter,
      // 세계관 연도
      loreYear,
      loreLabel: ov.loreLabel ?? (loreYear ? `${loreYear}년` : null),
      loreSource,
      loreOrder: Number.isFinite(ov.loreOrder) ? ov.loreOrder : null,
      loreEvidence: evidence,
      // 참고용 출시 정보
      releaseDate: g.date,
      releaseTimestamp: g.timestamp,
      releaseLocale: g.timestampLocale,
      locale: g.locale,
      needsTranslation: g.needsTranslation,
      stories: g.storyIds.map((sid) => {
        const s = storyIndex.get(sid);
        const sov = ov.stories?.[sid] ?? {};
        const storyYear = Number.isInteger(sov.loreYear) ? sov.loreYear : s.loreYear;
        return {
          id: s.id,
          code: s.code,
          name: s.name,
          avgTag: s.avgTag,
          available: s.available,
          // 그룹 연도와 다를 때만 표시용으로 의미 있음 (회상 등)
          loreYear: storyYear,
        };
      }),
    };
  })
  .sort((a, b) => {
    // 연도 있는 것 먼저(오름차순), 없는 것은 뒤로(출시 순)
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
log(`  연도 확정 ${timeline.length - unresolved.length}건 / 미상 ${unresolved.length}건`);

// 스토리에 연표 순번 부여 (오퍼레이터 등장 목록 정렬용)
const groupOrder = new Map(timeline.map((g, i) => [g.id, i]));
for (const s of stories) s.timelineOrder = groupOrder.get(s.groupId) ?? null;

// ---------------------------------------------------------------------------
// 5. 오퍼레이터 상세 (기록 / 대사 / 오퍼레이터 레코드 / 등장 스토리)
// ---------------------------------------------------------------------------
log('오퍼레이터 상세…');

// 5-a. 기록(handbook) + 오퍼레이터 레코드(handbookAvgList)
for (const [id, op] of operators) {
  const hbPick = pick(byLocale(handbook, 'handbookDict', id));
  const hb = hbPick.value;
  if (hb) {
    op.records = (hb.storyTextAudio ?? []).map((sec) => ({
      title: sec.storyTitle,
      // 승급/신뢰도 조건별로 여러 story 가 있을 수 있음 (patchIdList 는 형태 변경 캐릭터용)
      entries: (sec.stories ?? []).map((st) => ({
        text: st.storyText,
        unlock: st.unLockType,
        unlockParam: st.unLockParam ?? null,
        unlockString: st.unLockString || null,
      })),
      locale: hbPick.locale,
    }));
    const avgList = Array.isArray(hb.handbookAvgList) ? hb.handbookAvgList : Object.values(hb.handbookAvgList ?? {});
    op.operatorRecords = avgList
      .sort((a, b) => (a.sortId ?? 0) - (b.sortId ?? 0))
      .map((set) => ({
        setId: set.storySetId,
        name: set.storySetName,
        date: toKstDate(set.storyGetTime),
        unlock: set.unlockParam ?? [],
        stories: (set.avgList ?? []).map((a) => ({
          id: a.storyId,
          name: a.storyIntro,
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
    op.words = [...sets.entries()].map(([wordKey, lines]) => ({
      wordKey,
      isDefault: wordKey === id,
      lines,
      locale: wp.locale,
      needsTranslation: wp.needsTranslation,
    }));
  }
  // 성우 정보
  const vl = pick(byLocale(charword, 'voiceLangDict', id)).value;
  if (vl?.dict) {
    for (const [lang, v] of Object.entries(vl.dict)) op.cv[lang] = v.cvName ?? [];
  }

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
    storiesFallback: stories.filter((s) => s.needsTranslation).length,
    operators: operatorList.length,
    timeline: timeline.length,
    timelineUnresolved: unresolved.length,
    timelineBySource: timeline.reduce((acc, t) => ((acc[t.loreSource ?? 'none'] = (acc[t.loreSource ?? 'none'] ?? 0) + 1), acc), {}),
  },
});

log(`완료 (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
