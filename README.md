# MY LIVE 2026

페스티벌 타임테이블에서 본 무대를 체크하면 올해의 관람 기록과 「나의 페스티벌 성향」을 카드 한 장으로 만들어 주는 시즌성 모바일 웹. 2026년 12월 출시 목표.

## 구조

| 경로 | 내용 |
| --- | --- |
| `packages/judge` | 성향 판정 로직(순수 함수, 의존성 없음) + 가상 사례 + 테스트 |
| `tools/judge-console` | 판정 로직 내부 테스트 화면 |
| `tools/gmf-form` | 그민페 2026 테스트 기록 수집 폼(`/gmf`) + 제출 즉시 칭호 판정·결과 카드(canvas PNG)·피드백 + 저장 API(`/api/gmf-submit`, `/api/gmf-feedback`) + PostHog 계측 |
| `data/<행사>` | 수록 페스티벌 catalog + 대조 출처 (`npm test`가 표시 경고·판정 실행을 함께 검사) |
| `app/` | 서비스 앱 (기술 스택 확정 후 추가) |

## 실행

```bash
npm install
npm test               # 단위 테스트 + 가상 사례 28개 기대값 검사
npm run typecheck
npm run build:console  # tools/judge-console/dist/index.html 생성
npm run test:form      # 기록 수집 폼 로직 + 칭호 매핑 + 피드백 검사
npm run build:form     # tools/gmf-form/dist/index.html + .vercel/output 생성
```

## 인프라

그민페 테스트와 본 서비스를 한 곳에서 운영한다.

| 서비스 | 이름 | 비고 |
| --- | --- | --- |
| Vercel | 프로젝트 `my-live-2026` (main 브랜치 자동 배포) | `/gmf` 폼, `/api/gmf-submit`, `/api/gmf-feedback`, `/ingest/*` PostHog 프록시. 본 서비스 전까지 `/`는 `/gmf`로 임시 이동 |
| Neon | 프로젝트 `my-live-2026` (싱가포르, Vercel 연동) | `gmf_records`·`gmf_contacts`·`gmf_feedback`(`tools/gmf-form/sql/002_gmf_feedback.sql`, INSERT만). 앱은 `gmf_app` 계정(`GMF_DATABASE_URL`)으로 접속 |
| PostHog | 프로젝트 `MY LIVE 2026` (US) | 슈퍼 속성 `surface`로 구분 (`gmf-test` / 본 서비스) |

### 그민페 폼 이벤트

| 이벤트 | 주요 속성 |
| --- | --- |
| `$pageview`, `$pageleave` | 자동 |
| `gmf_day_toggled` | `date`, `on` |
| `gmf_performance_toggled` | `date`, `performance_id`, `artist_id`, `stage_id`, `start`, `on`, `checked_count` |
| `gmf_best_selected` | `date`, `performance_id`, `artist_id`, `stage_id` |
| `gmf_submit_clicked` | `days`, `selection_count`, `has_contact`, `blocked`, `problem_steps` |
| `gmf_submit_succeeded` | 위 요약 + `resubmit` (제출 성공 시 DB와 같은 익명 ID로 identify) |
| `gmf_submit_failed` | 위 요약 + `error` |
| `gmf_result_shown` | `title_id`, `title_label`, `tier`, `others`, `stats_only`, `judge_version`, `views`, `restored`(새로고침 뒤 다시 보여줌) |
| `gmf_card_save_clicked` | `method`: `share` / `download` |
| `gmf_card_share_result` | `outcome`: `shared` / `cancelled` / `error` |
| `gmf_card_render_failed` | `error` (카드 PNG 생성 실패) |
| `gmf_feedback_submitted` | `title_id`, `fit`, `understood`, `share`, `show_parts`, `chips`, `has_comment` (한마디 본문은 넣지 않음) |
| `gmf_feedback_failed` | `error` |
| `gmf_edit_clicked` | 없음 |

연락처는 어떤 이벤트·카드·피드백에도 넣지 않는다.

### 그민페 칭호 (`tools/gmf-form/titles.ts`)

판정 모듈 결과 위에서 그민페용 대표 칭호 하나를 고른다. 올림픽공원 거주민(참가일 체류 합계 ÷ 프로그램 합계 90% 이상·참가한 날마다 5개 이상·그날 최장 공백 120분 이하, 하루만 참가해도 가능)이 최우선, 그다음 판정 모듈 기본 칭호(메인/서브 선호·초반/후반·관람시간·연속 관람·헤드라이너) 중 단계 최대 → 같은 단계면 그민페 전용 순서 `GMF_TITLE_ORDER`(한 무대/서브 선호 → 메인 선호 → 초반 → 후반 → 연속 관람 → 관람시간 → 헤드라이너). 서브 선호는 2단계 이상·메인 20% 이하·관람 6개 이상일 때만, 한 스테이지에 70% 이상 몰렸으면 '한 무대 지박령'으로 바꿔 보여준다. 체류는 그날 체크한 첫 공연 시작 ~ 마지막 공연 종료, 프로그램은 취소 공연을 뺀 그날 첫 공연 시작 ~ 마지막 공연 종료. '화장실은 언제 가요?'(연속 관람)는 공백 10분 이하로 이어진 공연 3개 이상 구간의 실관람 시간(합집합) 160/190/220분 (MIN-316 핫픽스). 라벨은 `TITLE_LABELS`, 카드 좌표·색은 `card.ts`의 `CARD`에 모아 둔다 (MIN-314에서 재결정).

## 판정 로직 v0.1.1

`judge(catalog, record, config?)`는 수록 페스티벌 타임테이블(`catalog`)과 사용자가 선택한 공연(`record`)을 받아 지표별 원시 수치·분모·기준선·단계·계산 제외 사유·추정 여부와 대표 결과를 돌려준다.

- 선택한 공연 = 일부라도 본 공연. 겹친 선택은 일부 관람 후 이동으로 해석하고 각각 관람 1회로 집계
- 반복 관람은 (행사, 날짜) 기준 중복 제거
- 하루 한 페스티벌 입력 정책 위반 기록은 `status: 'blocked'`
- 대표 선정: 기본 최고 단계 B ≥ 특별 최고 단계 S + 1이면 기본, 아니면 S ≥ 1일 때 특별, 둘 다 0이면 통계 카드만. 같은 단계는 잠정 고정 순서
- 헤드라이너 관람: 메인 스테이지 마지막 공연(자동) + 그날 마무리 공연이 메인 외 스테이지일 때 확인을 거쳐 `headliner: true`로 표시한 공연. 하루에 하나라도 보면 1일(둘 다 봐도 1일) — v0.1.1
- 무대 이동은 진단용, 관람률은 대표 선정 제외(재설계 예정)
- 단계 기준값은 모두 잠정값 (`DEFAULT_CONFIG`)이며 실데이터로 보정할 예정

가상 사례의 페스티벌·아티스트·타임테이블은 모두 테스트용 가상 데이터다.

### 입력 형식

```ts
catalog = {
  artists: { [id]: { id, name, shortName?, country: 'KR' | 'JP' | 'OTHER' | 'UNKNOWN' } },
  festivals: [{ id, name, stages: [{ id, name, isMain }], days: [{ date, performances: [{ id, artistId, stageId, start: 'HH:MM', end: 'HH:MM', headliner? }] }] }]
}
record = { selections: [{ festivalId, date, performanceId, best? }] }
```

`isMain`은 페스티벌마다 가장 큰 스테이지 1개만 true. 자정을 넘기는 시각은 `24:30`처럼 적는다.

`headliner`는 메인 외 스테이지의 그날 마무리 공연(시작 시각이 가장 늦은 공연)에만, 공식 자료로 마무리·헤드라이너급 무대임을 확인한 뒤 붙인다. `findCloserCandidates(catalog)`가 후보를 찾고, `validateCatalog(catalog)`가 범위를 벗어난 표시를 경고한다.
