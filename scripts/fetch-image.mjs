#!/usr/bin/env node
/**
 * scripts/fetch-image.mjs — 아크나이츠 이미지 찾기·내려받기.
 *
 * assets-catalog/ 의 경로 목록과 이름 대응표만 쓰므로 gamedata/ 동기화 없이 동작한다.
 * (이미지는 저장소에 두지 않고 요청할 때마다 원본에서 받는다.)
 *
 *   node scripts/fetch-image.mjs op 첸                     오퍼레이터 이미지 목록
 *   node scripts/fetch-image.mjs op 첸 --get e2            정예2 초상화 받기
 *   node scripts/fetch-image.mjs op 스즈란 --get skin      스킨 전부 받기
 *   node scripts/fetch-image.mjs op 첸 --get all           아바타·초상화·스킨 전부
 *   node scripts/fetch-image.mjs event 월루몽드            이벤트 이미지 목록
 *   node scripts/fetch-image.mjs event act11d0 --get all   이벤트 대표·스토리 이미지 받기
 *   node scripts/fetch-image.mjs search bg_lt              경로 검색 (부분 일치)
 *   node scripts/fetch-image.mjs get avg/backgrounds/bg_ltstreet1.png [...]  경로로 받기
 *
 * 공통 옵션: --out <디렉터리> (기본 ./downloads), --limit <n>
 *
 * 어느 저장소에서 받는지:
 *   - 오퍼레이터 아바타·초상화·스킨 전신, 아이템·적·스킬 아이콘 → ArknightsGameResource
 *     (ArknightsAssets 의 같은 파일은 Git LFS 라 익명 접근 시 포인터만 온다)
 *   - 스토리 배경·CG, UI, AVG 캐릭터 스프라이트 → ArknightsAssets
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const CATALOG = path.join(ROOT, 'assets-catalog');
const ASSETS_BASE = 'https://raw.githubusercontent.com/ArknightsAssets/ArknightsAssets/cn/assets/torappu/dynamicassets';
const RESOURCE_BASE = 'https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/main';

const args = process.argv.slice(2);
const cmd = args[0];
const flag = (n) => args.includes(n);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : d;
};
const positional = args.slice(1).filter((a, i, arr) => !a.startsWith('--') && !(i > 0 && arr[i - 1].startsWith('--')));

const OUT = path.resolve(opt('--out', path.join(ROOT, 'downloads')));
const LIMIT = Number(opt('--limit', '60'));

const read = (f) => fs.readFileSync(path.join(CATALOG, f), 'utf8');
const readJson = (f) => JSON.parse(read(f));
const assetPaths = () => read('paths-assets.txt').split('\n').filter(Boolean);
const resourcePaths = () => read('paths-resource.txt').split('\n').filter(Boolean);

/** 상대 경로 → 내려받을 URL (repo 는 'assets' | 'resource') */
const urlOf = (rel, repo) =>
  `${repo === 'resource' ? RESOURCE_BASE : ASSETS_BASE}/${rel}`.replace(/#/g, '%23');

async function download(list) {
  fs.mkdirSync(OUT, { recursive: true });
  const saved = [];
  for (const { rel, repo } of list) {
    const url = urlOf(rel, repo);
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`  ✗ ${rel} (HTTP ${res.status})`);
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 200 && buf.toString('utf8').startsWith('version https://git-lfs')) {
      console.error(`  ✗ ${rel} (Git LFS 포인터 — 다른 저장소를 쓸 것)`);
      continue;
    }
    const file = path.join(OUT, path.basename(rel).replace(/#/g, '_'));
    fs.writeFileSync(file, buf);
    saved.push(file);
    console.log(`  ✓ ${path.relative(ROOT, file)} (${(buf.length / 1024).toFixed(0)} KB)`);
  }
  console.log(saved.length ? `\n받은 파일 ${saved.length}개 → ${path.relative(ROOT, OUT)}/` : '\n받은 파일이 없습니다.');
  return saved;
}

/** 오퍼레이터 찾기: 한국어 이름 → 중국어 이름 → 영문 → id 순 */
function findOperator(q) {
  const ops = readJson('operators.json');
  const norm = (s) => (s ?? '').toLowerCase().replace(/\s+/g, '');
  const n = norm(q);
  return (
    ops.find((o) => norm(o.name) === n) ??
    ops.find((o) => norm(o.nameCn) === n) ??
    ops.find((o) => norm(o.appellation) === n) ??
    ops.find((o) => o.id === q) ??
    ops.find((o) => norm(o.name).includes(n)) ??
    ops.find((o) => norm(o.appellation).includes(n)) ??
    null
  );
}

/** 오퍼레이터의 이미지 목록 */
function operatorImages(op) {
  const res = resourcePaths();
  const pick = (re) => res.filter((p) => re.test(p)).map((rel) => ({ rel, repo: 'resource' }));
  const esc = op.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return {
    avatar: pick(new RegExp(`^avatar/${esc}\\.png$`)),
    portrait: pick(new RegExp(`^portrait/${esc}_(1|1\\+|2)\\.png$`)),
    skinAvatar: pick(new RegExp(`^avatar/${esc}_.*#`)),
    skinPortrait: pick(new RegExp(`^portrait/${esc}_.*#`)),
    art: pick(new RegExp(`^skin/${esc}_`)),
  };
}

function showOperator(op) {
  const img = operatorImages(op);
  console.log(`${op.name} (${op.nameCn ?? '-'} / ${op.appellation}) — ${op.id}, ${op.rarity ?? '?'}성 ${op.profession}`);
  const line = (label, list) => list.length && console.log(`  ${label.padEnd(12)} ${list.map((x) => path.basename(x.rel)).join(', ')}`);
  line('아바타', img.avatar);
  line('초상화', img.portrait);
  line('스킨 아바타', img.skinAvatar);
  line('스킨 초상화', img.skinPortrait);
  line('전신', img.art);
  console.log('\n받기: --get avatar | portrait | e1 | e2 | skin | art | all');
}

function operatorSelection(op, what) {
  const img = operatorImages(op);
  const byName = (list, re) => list.filter((x) => re.test(x.rel));
  switch (what) {
    case 'avatar':
      return img.avatar;
    case 'portrait':
      return img.portrait;
    case 'e1':
      return byName(img.portrait, /_1\+?\.png$/);
    case 'e2':
      return byName(img.portrait, /_2\.png$/);
    case 'skin':
      return [...img.skinPortrait, ...img.skinAvatar];
    case 'art':
      return img.art;
    case 'all':
      return [...img.avatar, ...img.portrait, ...img.skinAvatar, ...img.skinPortrait, ...img.art];
    default:
      return [];
  }
}

/** 이벤트 찾기 */
function findEvent(q) {
  const events = readJson('events.json');
  const n = q.toLowerCase();
  return (
    events.find((e) => e.id === q) ??
    events.find((e) => e.name.toLowerCase() === n) ??
    events.find((e) => e.name.toLowerCase().includes(n)) ??
    null
  );
}

/** URL → {rel, repo} */
function fromUrl(url) {
  if (!url) return null;
  if (url.startsWith(ASSETS_BASE)) return { rel: decodeURIComponent(url.slice(ASSETS_BASE.length + 1)), repo: 'assets' };
  if (url.startsWith(RESOURCE_BASE)) return { rel: decodeURIComponent(url.slice(RESOURCE_BASE.length + 1)), repo: 'resource' };
  return null;
}

// ---------------------------------------------------------------------------

const help = () => {
  console.log(fs.readFileSync(new URL(import.meta.url)).toString().split('\n').slice(2, 26).join('\n').replace(/^ \* ?/gm, ''));
};

if (!cmd || cmd === 'help') {
  help();
  process.exit(0);
}

if (cmd === 'op') {
  const op = findOperator(positional[0] ?? '');
  if (!op) {
    console.error(`오퍼레이터를 찾지 못했습니다: ${positional[0]}`);
    process.exit(1);
  }
  const what = opt('--get', null);
  if (!what) {
    showOperator(op);
  } else {
    const list = operatorSelection(op, what);
    if (!list.length) {
      console.error(`해당하는 이미지가 없습니다: ${what}`);
      process.exit(1);
    }
    console.log(`${op.name} — ${what} (${list.length}개)`);
    await download(list.slice(0, LIMIT));
  }
} else if (cmd === 'event') {
  const ev = findEvent(positional[0] ?? '');
  if (!ev) {
    console.error(`이벤트를 찾지 못했습니다: ${positional[0]}`);
    process.exit(1);
  }
  const urls = [ev.image, ...ev.stories.map((s) => s.image)].filter(Boolean);
  const list = [...new Set(urls)].map(fromUrl).filter(Boolean);
  if (!opt('--get', null)) {
    console.log(`${ev.name} (${ev.id}) — 이미지 ${list.length}개`);
    for (const x of list.slice(0, LIMIT)) console.log(`  ${x.rel}`);
    console.log('\n받기: --get all');
  } else {
    await download(list.slice(0, LIMIT));
  }
} else if (cmd === 'search') {
  const q = positional[0] ?? '';
  const hits = [
    ...assetPaths().filter((p) => p.includes(q)).map((rel) => ({ rel, repo: 'assets' })),
    ...resourcePaths().filter((p) => p.includes(q)).map((rel) => ({ rel, repo: 'resource' })),
  ];
  console.log(`"${q}" — ${hits.length}개`);
  for (const h of hits.slice(0, LIMIT)) console.log(`  [${h.repo}] ${h.rel}`);
  if (hits.length > LIMIT) console.log(`  … 외 ${hits.length - LIMIT}개 (--limit 으로 조절)`);
} else if (cmd === 'get') {
  const res = new Set(resourcePaths());
  const list = positional.map((p) => {
    const fromUrlHit = fromUrl(p);
    if (fromUrlHit) return fromUrlHit;
    return { rel: p, repo: res.has(p) ? 'resource' : 'assets' };
  });
  await download(list);
} else {
  help();
  process.exit(1);
}
