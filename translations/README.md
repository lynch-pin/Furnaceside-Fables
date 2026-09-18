# translations/

CN 서버 전용(한국 서버 미실장) 텍스트의 한국어 번역 캐시. `scripts/process-data.mjs` 와 `src/pages/story/[id].astro` 가 빌드 시 읽는다.
KR 서버에 실장되면 KR 데이터가 자동으로 우선 적용되고, `npm run translate -- --prune` 으로 불필요해진 파일을 지운다.

```
translations/zh_CN/
  meta.json               이벤트/스토리 이름·태그·줄거리   { groups: {id:{name}}, stories: {id:{name, avgTag, summary}} }
  operators/<charId>.json CN 전용 오퍼레이터 전체 텍스트 (이름, 프로필, 기록, 대사)
  stories-src/<id>.json   스토리 본문 원문 (npm run translate -- --export 로 생성, 번역 입력용)
  stories/<id>.json       스토리 본문 번역 결과  { "source": "zh_CN", "lines": [...] }
```

## 스토리 본문을 API 키 없이 번역하기

캐시는 어떤 방법으로 만들어도 된다. 다른 세션(예: Claude Sonnet)에서 번역할 때는:

1. `translations/zh_CN/stories-src/<storyId>.json` 을 읽는다. `lines` 가 번역할 중국어 줄, `context` 는 같은 인덱스의 화자(대사) 또는 줄 종류(narration/subtitle 등)다. 참고용이며 결과에는 넣지 않는다.
2. `translations/zh_CN/stories/<storyId>.json` 에 아래 형식으로 저장한다. `lines` 는 원문과 **같은 길이·같은 순서**여야 한다.
   ```json
   { "source": "zh_CN", "model": "claude-sonnet-5", "lines": ["번역 줄 1", "번역 줄 2"] }
   ```
3. `npm run translate -- --check` 로 줄 수와 중국어 잔존 여부를 검증하고 커밋한다. 다음 빌드부터 `CN server · 번역` 으로 표시된다.

번역 지침(다른 세션에 붙여 쓸 프롬프트):

> 아크나이츠(明日方舟) 한국 서버 공식 번역 문체를 따르는 게임 텍스트 번역가로서, 주어진 JSON 의 `lines` (중국어 문장 배열)를 같은 길이의 한국어 배열로 번역한다.
> 고유명사는 한국 서버 표기(로도스 아일랜드, 박사, 오리지늄, 광석병, 감염자, 켈시, 아미야, 클로저, 카즈델, 라이타니엔, 컬럼비아, 우르수스, 룽먼, 빅토리아, 이베리아, 사르곤, 카시미어, 시라쿠사, 쉐라그, 라테라노, 사미, 예라군드)를 따른다.
> 인게임 마크업(`<@ba.kw>…</>`, `<i>…</i>`, `\n`)은 보존하고, 선택지 줄의 `A / B` 구분은 유지한다. `context` 의 화자를 참고해 말투(존댓말/반말)를 일관되게 맞춘다.
> 출력은 `{ "source": "zh_CN", "lines": [...] }` JSON 만.

## 용어 메모

오퍼레이터 이름 중 공식 한국어 표기가 없어 추정한 것: 안젤리나 더 멜로우 위시, 미츠네 희소종 오키드, 진오우S 캐터펄트, 크랙본, 비이, 아프리사, 썸피, 타임슬롯, 하신타. 바꾸려면 `operators/<id>.json` 의 `name` 만 수정하면 된다.
