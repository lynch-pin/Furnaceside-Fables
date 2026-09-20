---
name: fetch-image
description: 아크나이츠 이미지를 찾아 사용자에게 전달한다. 오퍼레이터 일러스트·초상화·아바타·스킨, 스토리 배경과 CG, 이벤트 대표 이미지, 적·아이템·스킬 아이콘 요청에 사용한다. "첸 정예2 초상화 줘", "스즈란 스킨 전부", "월루몽드 배경 이미지" 처럼 이미지를 달라는 요청이면 이 스킬을 쓴다.
---

# 아크나이츠 이미지 가져오기

이미지는 저장소에 두지 않는다. `assets-catalog/` 의 경로 목록과 이름 대응표로 찾아서, 요청할 때마다 원본에서 받아 전달한다.
`gamedata/` 동기화는 필요 없다.

## 절차

1. `node scripts/fetch-image.mjs` 로 찾고 받는다. 받은 파일은 `--out` 디렉터리(기본 `downloads/`)에 들어간다.
   스크래치패드 디렉터리를 `--out` 으로 주면 저장소가 더러워지지 않는다.
2. **받은 파일은 반드시 SendUserFile 로 전달한다.** 경로만 알려주면 사용자는 파일을 볼 수 없다.
   - 이미지 한두 장: `display: "render"` 로 바로 보이게 한다.
   - 여러 장(대여섯 장 이상): `zip -j 이름.zip 파일...` 로 묶어 `display: "attach"` 로 보낸다.
3. 요청이 모호하면(어느 정예 단계인지, 스킨 포함인지) 목록을 먼저 보여 주고 고르게 한다.

## 명령

```bash
node scripts/fetch-image.mjs op 첸                  # 그 오퍼레이터의 이미지 목록
node scripts/fetch-image.mjs op 첸 --get e2         # 정예2 초상화
node scripts/fetch-image.mjs op 첸 --get all        # 아바타·초상화·스킨·전신 전부
node scripts/fetch-image.mjs event 월루몽드          # 이벤트 이미지 목록
node scripts/fetch-image.mjs event act11d0 --get all
node scripts/fetch-image.mjs search bg_lt           # 경로 부분 일치 검색
node scripts/fetch-image.mjs get avg/backgrounds/bg_ltstreet1.png
```

`op` 의 `--get` 값: `avatar` `portrait` `e1` `e2` `skin` `art` `all`.
이름은 한국어·중국어·영문·charId 모두 받는다. 정확히 일치하는 것이 없으면 부분 일치로 찾는다.

## 어느 저장소에서 받는가

스크립트가 알아서 고르지만, 직접 경로를 다룰 때는 다음을 지킨다.

| 이미지 | 저장소 |
| --- | --- |
| 오퍼레이터 아바타·초상화·스킨 전신, 적·아이템·스킬 아이콘 | yuanyan3060/ArknightsGameResource |
| 스토리 배경·CG(`avg/`), UI(`arts/ui/`), AVG 캐릭터 스프라이트 | ArknightsAssets/ArknightsAssets (cn 브랜치) |

ArknightsAssets 의 `arts/characters/` 같은 대형 파일은 Git LFS 라서 익명으로 받으면 14바이트 포인터만 온다.
전신 일러스트는 반드시 ArknightsGameResource 의 `skin/` 을 쓴다. 스크립트는 포인터를 받으면 경고하고 건너뛴다.

## 크기 감각

아바타 약 55KB, 초상화 약 120KB, 배경 0.5~1.5MB, 전신 일러스트 0.5~3.5MB.
전신 일러스트를 여러 장 요청하면 수십 MB가 되니, 몇 장인지와 대략 용량을 먼저 알리고 진행한다.

## 카탈로그 갱신

`assets-catalog/` 는 `npm run catalog` 로 다시 만든다. 게임 데이터가 갱신되어 새 오퍼레이터나 이벤트가 생겼을 때만 필요하며,
`npm run sync` 로 색인을 먼저 받아야 한다. 평소에는 커밋된 카탈로그만으로 충분하다.

## 저작권

게임 에셋의 권리는 Hypergryph 에 있다. 개인 보관·참고 용도로만 전달하고, 재배포용으로 대량 묶음을 만들지 않는다.
