#!/usr/bin/env bash
# ------------------------------------------------------------------------------
# scripts/sync-data.sh
#   ArknightsAssets/ArknightsGamedata 저장소에서 필요한 폴더만 sparse-checkout 으로 받아온다.
#   - 최초 실행: --filter=blob:none --sparse 로 clone (blob 은 필요한 것만 lazy fetch)
#   - 이후 실행: fetch + reset 으로 최신 상태 동기화
#
#   사용: npm run sync   (또는 bash scripts/sync-data.sh)
#   환경변수:
#     GAMEDATA_DIR   받아올 위치 (기본: ./gamedata)  ※ .gitignore 에 포함되어 있음
#     GAMEDATA_REPO  원격 저장소 URL
#     GAMEDATA_REF   브랜치 (기본: master)
#
#   NOTE(레이아웃): 이 저장소는 언어 폴더가 ko_KR / zh_CN 이 아니라 `kr/` `cn/` 이다.
#     (Kengxxiao/ArknightsGameData 포크는 ko_KR/zh_CN 을 쓴다. 소스를 바꾸면 src/lib/i18n.mjs 의
#      LANG_DIRS 만 함께 수정하면 된다.)
#     스토리 스크립트는 .asc 가 아니라 .txt 확장자이며, 줄거리 요약은 story/[uc]info/ 아래에 있다.
# ------------------------------------------------------------------------------
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GAMEDATA_DIR="${GAMEDATA_DIR:-$ROOT_DIR/gamedata}"
GAMEDATA_REPO="${GAMEDATA_REPO:-https://github.com/ArknightsAssets/ArknightsGamedata}"
GAMEDATA_REF="${GAMEDATA_REF:-master}"

# 받아올 경로 (cone 모드: 디렉터리 단위). 필요한 테이블만 받고 싶으면 --no-cone 으로 바꾸고 파일 패턴을 나열.
SPARSE_PATHS=(
  "kr/gamedata/excel"
  "kr/gamedata/story"
  "cn/gamedata/excel"
  "cn/gamedata/story"
)

# LFS 객체는 필요 없다(텍스트/JSON 만 사용). smudge 를 끄면 LFS 미설치 환경에서도 clone 이 실패하지 않는다.
export GIT_LFS_SKIP_SMUDGE=1

retry() {
  # retry <n> <cmd...> : 네트워크 오류 대비 지수 백오프 재시도
  local n="$1"; shift
  local delay=2
  local i
  for ((i = 1; i <= n; i++)); do
    if "$@"; then return 0; fi
    if (( i == n )); then return 1; fi
    echo "[sync-data] 실패 ($i/$n). ${delay}s 후 재시도..." >&2
    sleep "$delay"; delay=$((delay * 2))
  done
}

if [[ ! -d "$GAMEDATA_DIR/.git" ]]; then
  echo "[sync-data] 최초 clone → $GAMEDATA_DIR"
  rm -rf "$GAMEDATA_DIR"
  retry 4 git clone --depth 1 --filter=blob:none --sparse --branch "$GAMEDATA_REF" \
    "$GAMEDATA_REPO" "$GAMEDATA_DIR"
fi

echo "[sync-data] sparse-checkout 경로 설정: ${SPARSE_PATHS[*]}"
git -C "$GAMEDATA_DIR" sparse-checkout set "${SPARSE_PATHS[@]}"

echo "[sync-data] 원격 최신 커밋 fetch (${GAMEDATA_REF})"
retry 4 git -C "$GAMEDATA_DIR" fetch --depth 1 origin "$GAMEDATA_REF"
git -C "$GAMEDATA_DIR" reset --hard --quiet FETCH_HEAD
# sparse 패턴에 새로 추가된 경로가 있으면 여기서 실제 파일이 체크아웃된다.
git -C "$GAMEDATA_DIR" sparse-checkout reapply

echo "[sync-data] 완료: $(git -C "$GAMEDATA_DIR" rev-parse --short HEAD)"
for lang in kr cn; do
  ver_file="$GAMEDATA_DIR/$lang/gamedata/excel/data_version.txt"
  if [[ -f "$ver_file" ]]; then
    echo "  - $lang: $(grep -m1 VersionControl "$ver_file" || true)"
  fi
done
