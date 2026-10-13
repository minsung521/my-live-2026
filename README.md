# MY LIVE 2026

페스티벌 타임테이블에서 본 무대를 체크하면 올해의 관람 기록과 「나의 페스티벌 성향」을 카드 한 장으로 만들어 주는 시즌성 모바일 웹. 2026년 12월 출시 목표.

## 구조

| 경로 | 내용 |
| --- | --- |
| `packages/judge` | 성향 판정 로직(순수 함수, 의존성 없음) + 가상 사례 + 테스트 |
| `tools/judge-console` | 판정 로직 내부 테스트 화면 |
| `data/<행사>` | 수록 페스티벌 catalog + 대조 출처 (`npm test`가 표시 경고·판정 실행을 함께 검사) |
| `app/` | 서비스 앱 (기술 스택 확정 후 추가) |

## 실행

```bash
npm install
npm test               # 단위 테스트 + 가상 사례 28개 기대값 검사
npm run typecheck
npm run build:console  # tools/judge-console/dist/index.html 생성
```

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
