#!/usr/bin/env node
/**
 * scripts/build-asset-catalog.mjs — 이미지 검색용 경량 카탈로그 생성.
 *
 * gamedata/ 는 저장소에 커밋하지 않기 때문에, 새 세션에서도 바로 이미지를 찾을 수 있도록
 * "경로 목록 + 이름 대응표" 만 뽑아 assets-catalog/ 에 커밋한다. 이미지 자체는 담지 않는다.
 *
 *   assets-catalog/paths-assets.txt   ArknightsAssets(cn) 의 arts/·avg/ 경로
 *   assets-catalog/paths-resource.txt yuanyan3060/ArknightsGameResource 의 이미지 경로
 *   assets-catalog/operators.json     오퍼레이터 한국어·중국어 이름 ↔ charId
 *   assets-catalog/events.json        이벤트·스토리 이름 ↔ id, 대표 이미지
 *
 * 사용: npm run catalog (npm run process 에 포함)
 */
import fs from 'node:fs';
import path from 'node:path';
import { gamedataRoot } from '../src/lib/i18n.mjs';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'assets-catalog');
const DATA = process.env.OUT_DIR ? path.resolve(process.env.OUT_DIR) : path.join(ROOT, 'src', 'data');
const log = (...a) => console.log('[catalog]', ...a);

fs.mkdirSync(OUT, { recursive: true });

// 1. 경로 목록 (sync-data.sh 가 만든 색인을 그대로 옮긴다)
const copyIndex = (from, to, strip) => {
  const src = path.join(gamedataRoot(), from);
  if (!fs.existsSync(src)) {
    log(`  ${from} 없음 — 건너뜀 (npm run sync 필요)`);
    return 0;
  }
  const lines = fs
    .readFileSync(src, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => (strip ? l.replace(strip, '') : l));
  fs.writeFileSync(path.join(OUT, to), lines.join('\n') + '\n');
  return lines.length;
};
const nAssets = copyIndex('assets-index.txt', 'paths-assets.txt', /^assets\/torappu\/dynamicassets\//);
const nRes = copyIndex('avatar-index.txt', 'paths-resource.txt', null);
log(`  경로: ArknightsAssets ${nAssets} · ArknightsGameResource ${nRes}`);

// 2. 오퍼레이터 이름 대응표
const operators = JSON.parse(fs.readFileSync(path.join(DATA, 'operators.json'), 'utf8')).map((o) => ({
  id: o.id,
  name: o.name,
  nameCn: o.nameCn,
  appellation: o.appellation,
  rarity: o.rarity,
  profession: o.profession,
}));
fs.writeFileSync(path.join(OUT, 'operators.json'), JSON.stringify(operators));
log(`  오퍼레이터 ${operators.length}명`);

// 3. 이벤트·스토리 이름 대응표 (대표 이미지 포함)
const { groups, stories } = JSON.parse(fs.readFileSync(path.join(DATA, 'stories.json'), 'utf8'));
const events = groups
  .filter((g) => g.kind !== 'record')
  .map((g) => ({
    id: g.id,
    name: g.name,
    kind: g.kind,
    image: g.image,
    stories: g.storyIds
      .map((sid) => stories.find((s) => s.id === sid))
      .filter(Boolean)
      .map((s) => ({ id: s.id, code: s.code, name: s.name, image: s.image })),
  }));
fs.writeFileSync(path.join(OUT, 'events.json'), JSON.stringify(events));
log(`  이벤트 ${events.length}개`);

const size = fs.readdirSync(OUT).reduce((n, f) => n + fs.statSync(path.join(OUT, f)).size, 0);
log(`완료 — assets-catalog/ ${(size / 1024 / 1024).toFixed(1)} MB`);
