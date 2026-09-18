# src/data/

`npm run process` (scripts/process-data.mjs) 가 생성하는 파일. 직접 편집하지 않는다.

| 파일 | 원본 | 내용 |
| --- | --- | --- |
| stories.json | story_review_table + story/*.txt | `{ groups, stories }` 스토리 그룹/개별 스토리, 등장 캐릭터, 줄거리 |
| operators.json | character_table + handbook_info_table + charword_table | 오퍼레이터 목록 + 기록/대사/오퍼레이터 레코드/등장 스토리 |
| timeline.json | activity_table + story_review_table (+ overrides/timeline.json) | 공개 시간순 연표 |
| meta.json | data_version.txt | 데이터 버전, 생성 시각, 통계 |

커밋 여부는 `.gitignore` 의 주석 참고.
