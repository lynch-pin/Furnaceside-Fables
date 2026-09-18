/**
 * src/lib/assets.mjs — 이미지 에셋 URL 헬퍼.
 *
 * 이미지는 저장소에 넣지 않고 ArknightsAssets/ArknightsAssets 의 raw 파일을 직접 링크한다.
 * TODO(assets): 트래픽이 커지면 (1) ASSET_BASE 를 jsDelivr 로 바꾸거나
 *   (https://cdn.jsdelivr.net/gh/ArknightsAssets/ArknightsAssets@cn/assets/torappu/dynamicassets)
 *   (2) 빌드 시 public/img/ 로 내려받아 셀프 호스팅하는 스크립트를 추가할 것.
 *
 * 존재 여부는 scripts/sync-data.sh 가 만든 gamedata/assets-index.txt 로 확인한다 (없으면 존재한다고 가정).
 */
import fs from 'node:fs';
import path from 'node:path';
import { gamedataRoot } from './i18n.mjs';

export const ASSET_BASE =
  process.env.ASSET_BASE ??
  'https://raw.githubusercontent.com/ArknightsAssets/ArknightsAssets/cn/assets/torappu/dynamicassets';

let index = null; // Set<relative path> | false(인덱스 없음)
function loadIndex() {
  if (index !== null) return index;
  const file = path.join(gamedataRoot(), 'assets-index.txt');
  if (!fs.existsSync(file)) {
    index = false;
    return index;
  }
  index = new Set(
    fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((p) => p.replace(/^assets\/torappu\/dynamicassets\//, '')),
  );
  return index;
}

/** 상대 경로가 인덱스에 있으면 URL, 없으면 null. 인덱스가 없으면 검증 없이 URL. */
export function assetUrl(relPath) {
  if (!relPath) return null;
  const idx = loadIndex();
  if (idx && !idx.has(relPath)) return null;
  return `${ASSET_BASE}/${relPath}`;
}

/**
 * 오퍼레이터 아바타 (정사각 아이콘).
 * 1순위 yuanyan3060/ArknightsGameResource (최신 오퍼레이터 반영이 빠름) → 2순위 ArknightsAssets.
 */
export const AVATAR_BASE =
  process.env.AVATAR_BASE ?? 'https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/main';

let avatarIndex = null;
function loadAvatarIndex() {
  if (avatarIndex !== null) return avatarIndex;
  const file = path.join(gamedataRoot(), 'avatar-index.txt');
  avatarIndex = fs.existsSync(file) ? new Set(fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)) : false;
  return avatarIndex;
}
export function operatorAvatar(charId) {
  const idx = loadAvatarIndex();
  const rel = `avatar/${charId}.png`;
  if (idx === false || idx.has(rel)) return `${AVATAR_BASE}/${rel}`;
  return assetUrl(`arts/charavatars/${charId}.png`);
}

/** 메인 스토리 챕터 배너 (main_0 … main_14) */
export const chapterBanner = (zoneId) => assetUrl(`arts/ui/homebanners/zone/${zoneId}.png`);

/** 이벤트 대표 이미지 (story_review_table.storyEntryPicId) */
export function storyEntryPic(picId) {
  if (!picId) return null;
  return (
    assetUrl(`arts/ui/storyreview/hubs/activity/${picId}.png`) ??
    assetUrl(`arts/ui/storyreview/hubs/mini/storyentrypic/${picId}.png`)
  );
}

/** 개별 스토리 이미지 (infoUnlockDatas.storyPic) — 미니 스토리 위주 */
export const storyMainPic = (groupId, picId) =>
  picId ? assetUrl(`arts/ui/storyreview/hubs/minichar/${groupId}/${picId}.png`) : null;

/** 스토리 스크립트의 배경/CG 이미지 */
export const avgBackground = (image) => (image ? assetUrl(`avg/backgrounds/${image}.png`) : null);
export const avgImage = (image) => (image ? assetUrl(`avg/images/${image}.png`) : null);
