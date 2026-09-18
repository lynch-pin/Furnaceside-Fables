# overrides/

`scripts/process-data.mjs` 가 병합하는 수동 보정 데이터.

## timeline.json — 세계관 연도(테라 력)

연표(`/timeline`)는 스토리 안에서 벌어지는 연도 기준으로 정렬된다. 연도는 다음 순서로 결정된다.

1. 이 파일의 `loreYear` (수동, 최우선)
2. 인게임 아카이브 연표 (`story_review_meta_table.actArchiveData`, 일부 이벤트만)
3. 스크립트 본문의 날짜 스탬프 자동 추출 ("1098년 12월 21일 5:05 P.M.", "1091년 겨울" 등)
4. 없으면 "연대 미상" 구역

자동 추출(3)은 회상·과거 언급을 잘못 잡을 수 있으므로 `/timeline` 의 "자동 추정" 배지가 붙은 항목과
`src/data/meta.json` 의 `counts.timelineUnresolved` 를 보고 여기에 확정값을 채운다.
`src/data/timeline.json` 각 항목의 `loreEvidence` 에 추출 근거 문장이 들어 있다.

키는 story_review_table 의 그룹 id (예: `act11d0`, `main_8`).

```json
{
  "main_0":   { "loreYear": 1098, "loreLabel": "1098년 봄", "loreOrder": 1 },
  "act11d0":  { "loreYear": 1097 },
  "act33side": {
    "loreYear": 1094,
    "stories": {
      "act33side_level_act33side_01_beg": { "loreYear": 1030 }
    }
  }
}
```

| 필드 | 설명 |
| --- | --- |
| `loreYear` | 연도 (정수). 정렬 키 |
| `loreLabel` | 표시용 라벨 (예: "1098년 봄"). 없으면 "1098년" |
| `loreOrder` | 같은 연도 안에서의 순서. 없으면 출시 시각 순 |
| `stories.<storyId>.loreYear` | 회상/과거편 등 그룹과 다른 연도의 개별 스토리 |
