# overrides/

`scripts/process-data.mjs` 가 병합하는 수동 보정 데이터.

## timeline.json

세계관 내 연대(테라 력)는 게임 데이터에 구조화되어 있지 않으므로 직접 입력한다.
키는 story_review_table 의 그룹 id (예: `act11d0`, `main_8`).

```json
{
  "act11d0": { "loreDate": "1097-10", "loreLabel": "1097년 10월", "order": 120 },
  "main_8":  { "loreDate": "1098-03", "order": 130 }
}
```

`timeline.json` 각 항목의 `lore` 필드로 그대로 나가며, `/timeline` 페이지에서 lore 기준 정렬 뷰를 만들 때 사용한다.
(TODO: src/pages/timeline.astro 참고)
