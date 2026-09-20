# Furnaceside Fables

아크나이츠(明日方舟) 스토리 · 연표 · 오퍼레이터 아카이브. 비상업적 팬 사이트.
[Astro](https://astro.build) 정적 사이트, GitHub Pages + 커스텀 도메인(`fables.lone-trail.com`) 배포.

## 빠른 시작

```bash
npm install        # prepare 훅이 자동으로 실행됨: sync(게임 데이터 sparse-checkout, ~600MB) → process(가공)
npm run dev        # http://localhost:4321
npm run build      # dist/
npm test           # 파서 단위 테스트
```

데이터만 다시 받거나 가공하려면:

```bash
npm run sync       # scripts/sync-data.sh  : gamedata/ 최신화
npm run process    # scripts/process-data.mjs : src/data/*.json 재생성
npm run translate  # CN 전용 스토리 본문 번역 캐시 생성 (ANTHROPIC_API_KEY 필요)
```

## 구조

```
scripts/
  sync-data.sh        ArknightsAssets/ArknightsGamedata 를 gamedata/ 에 sparse-checkout (kr, cn 의 excel + story)
  process-data.mjs    raw JSON + 스토리 스크립트 → src/data/{stories,operators,timeline,meta}.json
src/
  lib/i18n.mjs        ko_KR 우선 → zh_CN 폴백, 번역 API placeholder (translate)
  lib/story-parser.mjs  스토리 스크립트 파서 (dialogue / narration / decision / … + 출연 캐릭터 추출)
  lib/data.mjs        src/data/*.json 로더
  components/StoryReader.astro   파싱된 라인 렌더링
  layouts/Layout.astro           공통 레이아웃 (nav, Noto Serif KR)
  pages/
    index.astro         /            홈 (연표 미리보기, 빠른 이동)
    timeline.astro      /timeline    공개 시간순 연표 (스토리 클릭 → 리더)
    story/index.astro   /story       스토리 목록
    story/[id].astro    /story/:id   스토리 리더
    operator/index.astro /operator   오퍼레이터 목록
    operator/[id].astro  /operator/:id  기록 / 대사 / 오퍼레이터 레코드 / 등장 스토리 탭
  data/               생성물 (커밋 여부는 .gitignore 주석 참고)
overrides/timeline.json   세계관 연대 수동 입력 (선택)
public/CNAME              커스텀 도메인
.github/workflows/deploy.yml  main push / 매주 월 09:00 KST 자동 배포
```

## CN 서버 전용 콘텐츠와 번역

- 한국 서버에 없는 콘텐츠는 zh_CN 데이터로 채워지고 `CN server · 번역` / `CN server · 미번역` 배지가 붙는다.
- 번역 캐시는 `translations/zh_CN/` 에 둔다. 이름·줄거리는 `meta.json`, CN 전용 오퍼레이터는 `operators/<id>.json`,
  스토리 본문은 `stories/<storyId>.json` (`npm run translate`, `ANTHROPIC_API_KEY` 필요).
- KR 서버에 실장되면 KR 데이터가 자동으로 우선 적용되며, `npm run translate -- --prune` 으로 불필요해진 캐시를 지운다.
  `npm run process` 로그에도 불필요해진 캐시 목록이 출력된다.

## 단어집

`/glossary` 는 한국 서버와 중국 서버 스토리 스크립트가 줄 단위로 1:1 대응하는 점을 이용해 만든 중국어-한국어 자료다.
회화 표현에는 병음·직역·단어별 해설이 붙고, 발음 듣기는 브라우저 내장 음성 합성(Web Speech API)을 쓴다.
오디오 파일을 만들지 않으므로 용량이 늘지 않지만, 기기에 중국어 음성이 없으면 버튼이 나타나지 않는다.
자료를 늘리는 방법은 `glossary/README.md` 참고.

## 이미지 가져오기 (별도 용도)

`assets-catalog/` 에 이미지 경로 목록과 이름 대응표만 커밋해 두었다. 이미지 자체는 담지 않는다.
`npm run image` (= `scripts/fetch-image.mjs`) 로 오퍼레이터·이벤트·경로를 찾아 원본에서 내려받을 수 있고,
Claude Code 세션에서는 `.claude/skills/fetch-image/` 스킬이 이 절차를 자동으로 따른다.

```bash
npm run image -- op 첸               # 첸의 이미지 목록
npm run image -- op 첸 --get e2      # 정예2 초상화 받기
npm run image -- event 월루몽드       # 이벤트 이미지 목록
npm run image -- search bg_lt        # 경로 검색
```

## 이미지 (사이트에서 쓰는 것)

이미지는 저장소에 넣지 않고 외부 raw 파일을 직접 링크한다 (`src/lib/assets.mjs`).

| 용도 | 소스 |
| --- | --- |
| 오퍼레이터 아바타 | yuanyan3060/ArknightsGameResource `avatar/` (없으면 ArknightsAssets `arts/charavatars/`) |
| 이벤트 대표 이미지 | ArknightsAssets `arts/ui/storyreview/hubs/{activity,mini}/storyEntryPic_*` |
| 메인 챕터 배너 | ArknightsAssets `arts/ui/homebanners/zone/main_N.png` |
| 개별 스토리 | `storyMainPic_*` → 없으면 스크립트의 첫 CG(`avg/images`) 또는 배경(`avg/backgrounds`) |

존재 여부는 `scripts/sync-data.sh` 가 만드는 `gamedata/assets-index.txt`, `gamedata/avatar-index.txt` 로 확인한다.

## 데이터 소스에 대한 메모

- 저장소: https://github.com/ArknightsAssets/ArknightsGamedata
- 언어 폴더는 `kr/`, `cn/` (ko_KR / zh_CN 이 아님). 매핑은 `src/lib/i18n.mjs` 의 `LANG_DIRS`.
- 스토리 스크립트는 `story/**/*.txt`, 줄거리 요약은 `story/[uc]info/**/*.txt`.
- 스토리 목록의 기준 테이블은 `story_review_table.json`, 오퍼레이터 레코드는 `handbook_info_table.json` 의 `handbookAvgList`.
- 한국 서버에 아직 없는 콘텐츠는 zh_CN 데이터로 채워지며 페이지에 `zh_CN` 배지가 붙는다. 번역은 `i18n.translate()` 에 연결.

## 등장 오퍼레이터 추출 방식

`process-data.mjs` 가 모든 스토리 스크립트를 파싱해

1. `[name="화자"]` 의 화자 이름을 `character_table` 의 오퍼레이터 이름과 정확히 일치시키고 (대사 수 집계)
2. `[Character(name="char_010_chen")]`, `[charslot(name="avg_1050_chen3_1")]`, `avatarId="…"` 의 스프라이트 ID 에서 `char_<번호>_<slug>` 를 복원해

스토리 ↔ 오퍼레이터를 연결한다. 결과는 `stories.json` 의 `characters[]` 와 `operators.json` 의 `appearances[]`.
오퍼레이터가 아닌 주요 화자(NPC)는 `stories.json` 의 `speakers[]` 에 남겨 두었다.

## TODO 위치

코드 안의 `TODO(...)` 주석을 검색하면 다음 작업 힌트가 있다.

| 태그 | 위치 | 내용 |
| --- | --- | --- |
| `TODO(site)` | astro.config.mjs | `site` 설정 (도메인 확정 후) |
| `TODO(translate)` | src/lib/i18n.mjs, story/[id].astro, deploy.yml | 번역 API 연동 + 캐시 |
| `TODO(timeline)` | scripts/process-data.mjs, timeline.astro | 세계관 연대 검수 (overrides/timeline.json) |
| `TODO(assets)` | src/lib/assets.mjs | 이미지 CDN / 셀프 호스팅 |
| `TODO(style)` | src/styles/global.css | 디자인 |
| `TODO(reader)` | StoryReader.astro | 배경/CG, 분기 접기, 폰트 크기 |
| `TODO(appearances)` | operator/[id].astro | 이름 불일치 보정 |
| `TODO(seo)` | Layout.astro | canonical / og |

## 배포

1. 저장소 Settings → Pages → Source: **GitHub Actions**
2. Settings → Pages → Custom domain: `fables.lone-trail.com`, DNS 에 CNAME 레코드 추가
   - `public/CNAME` 에는 도메인 한 줄만 들어 있다 (GitHub 가 그대로 파싱하므로 주석 불가). DNS 준비 전에는 비워 두어도 된다.
3. `main` 에 push 하면 `.github/workflows/deploy.yml` 이 빌드·배포. 매주 월요일 09:00 KST 에도 자동 실행(데이터 갱신).

## 저작권

아크나이츠의 모든 텍스트·명칭·데이터의 권리는 Hypergryph / Yostar 에 있습니다. 이 사이트는 비상업적 팬 프로젝트입니다.
