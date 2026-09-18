/**
 * src/lib/data.mjs — 가공된 src/data/*.json 로더 (빌드 타임 전용).
 * 파일이 없으면 `npm run prepare` 안내와 함께 실패한다.
 */
import fs from 'node:fs';
import path from 'node:path';

// Astro 빌드 시 이 모듈은 dist/.prerender/ 로 번들되므로 import.meta.url 기준 상대경로를 쓸 수 없다.
// 빌드는 항상 프로젝트 루트에서 실행되므로 cwd 기준으로 잡는다. (DATA_DIR 환경변수로 재지정 가능)
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(process.cwd(), 'src', 'data');
const cache = new Map();

function loadJson(name) {
  if (cache.has(name)) return cache.get(name);
  const file = path.join(DATA_DIR, name);
  if (!fs.existsSync(file)) {
    throw new Error(
      `src/data/${name} 이 없습니다. \`npm run prepare\` (= sync + process) 를 먼저 실행하세요.`,
    );
  }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  cache.set(name, data);
  return data;
}

/** @returns {{ groups: any[], stories: any[] }} */
export const loadStories = () => loadJson('stories.json');
/** @returns {any[]} */
export const loadOperators = () => loadJson('operators.json');
/** @returns {any[]} */
export const loadTimeline = () => loadJson('timeline.json');
/** @returns {any} */
export const loadMeta = () => loadJson('meta.json');

/** storyId → story */
export function storyById(id) {
  const { stories } = loadStories();
  return stories.find((s) => s.id === id) ?? null;
}

/** groupId → group */
export function groupById(id) {
  const { groups } = loadStories();
  return groups.find((g) => g.id === id) ?? null;
}

/** charId → operator */
export function operatorById(id) {
  return loadOperators().find((o) => o.id === id) ?? null;
}

/** 오퍼레이터 id → 이름 맵 (스토리 리더에서 링크용) */
export function operatorNameMap() {
  if (cache.has('__opNames')) return cache.get('__opNames');
  const map = new Map(loadOperators().map((o) => [o.id, o.name]));
  cache.set('__opNames', map);
  return map;
}

export const KIND_LABEL = {
  main: '메인 스토리',
  side: '사이드 스토리',
  mini: '미니 스토리',
  record: '오퍼레이터 레코드',
  other: '기타',
};

export const PROFESSION_LABEL = {
  PIONEER: '뱅가드',
  WARRIOR: '가드',
  TANK: '디펜더',
  SNIPER: '스나이퍼',
  CASTER: '캐스터',
  MEDIC: '메딕',
  SUPPORT: '서포터',
  SPECIAL: '스페셜리스트',
};
