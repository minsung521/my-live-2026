# MIN-316 결과 보고서

## 1. 요약
- 배포 판단: **가능** (1단계 + 2단계 모두 구현, 검수 피드백으로 PC 저장·공유 수정까지 반영. 단, 실기기 확인 전. 9번 체크리스트를 휴대폰·PC로 확인한 뒤 공개 권장)
- 미리보기 URL: https://my-live-2026-git-claude-new-session-iucst1-minsung521s-projects.vercel.app/gmf (Vercel Authentication 보호, `ddf5800` 기준 READY)
- 브랜치: `claude/new-session-iucst1` — 세션 제약으로 `min-316-gmf-v2`에 푸시할 수 없어 `origin/min-316-gmf-v2`(`58cd795`) 위에서 이 브랜치를 땄어요. main과 PR #1은 건드리지 않았어요.
- PR: https://github.com/minsung521/my-live-2026/pull/2 (이 브랜치 → main, 새 PR. PR #1은 머지하지 않음)
- 커밋 (코드)
  - `525ad41` 1단계 — 카드·결과 화면·연락처 API (16:34 KST 푸시)
  - `1df4592` 2단계 — 입력 화면 (16:39 KST 푸시)
  - `ddf5800` 검수 피드백 — PC에서 [이미지 저장]·[공유하기]가 동작하지 않던 문제 수정 (미리보기 READY)
- 보고서 커밋(`8d852e6` 이후)은 문서만 바뀌어 Vercel `ignoreCommand`가 빌드를 건너뛰어요(CANCELED로 보임, 정상). 미리보기는 마지막 코드 커밋 `ddf5800`이에요

## 2. 구현 범위
| 항목 | 상태 | 메모 |
| -- | -- | -- |
| 칭호 문구·rookie | 완료 | 근거 해요체 통일, statsOnly → rookie(그민페 신생아, #F2EBDD). 대표 + others 전체 목록(`list`)을 칭호 결과에 추가 |
| 카드 (하단 고정·제주돌담체·성향색·GMF 푸터) | 완료 | Figma 93:48 좌표 그대로(상수 `CARD` 하나). 빛번짐·그레인(고정 시드)·손그림 외곽선(도형만) 포함. 최고 무대 없으면 숫자 1148~ |
| 사진 카드 | 완료 | cover + 45% 틴트 + 위·아래 그라데이션, 글자 그림자, EXIF(`createImageBitmap … from-image`, 실패 시 `<img>`), 긴 변 1600px로 축소. 서버 전송 없음 |
| 결과 1페이지·2페이지·스크롤 스냅 | 완료 | `scroll-snap-type: y mandatory`, 1페이지 `100svh`. 375×667·390×844 모두 2페이지 top = 화면 높이(안 비침) |
| 사진 바꾸기 선택지 | 완료 | 다른 사진 고르기 / 사진 빼기 / 취소. 고른 직후 미리보기(이 사진으로 적용 / 다른 사진 고르기) |
| 인앱 저장 안내·링크 복사 | 완료 | UA로 인스타·카톡·페북·네이버·라인 등 판별. `/gmf` 주소 복사 + 토스트 |
| 저장·공유 (PC/휴대폰 분기) | 완료 (검수 후 수정) | PC = 저장은 PNG 다운로드, 공유는 링크 복사. 휴대폰 = Web Share 파일 → 실패 시 다운로드. 4번 참고 |
| 피드백 복원 | 완료 | 질문 해요체, 키는 PR #1 그대로. rookie도 1·2번 필수. 보낸 뒤 요약 표시·다시 보내기 막음 |
| 연락처 API | 완료 | `POST /api/gmf-contact`, `parseContactFields`를 v1 검사와 공유, server.ts와 같은 upsert(`excluded.*` 없음). v1 폼 연락처 영역은 제거(2단계에서 v1 폼 자체가 없어짐) |
| S1 소개 | 완료 | 예시 카드는 같은 카드 코드로 예시 기록(거주자·십란)을 실시간 렌더 |
| S2 그리드 | 완료 | 칸 높이 = 분 × 1.5px, 이름만, 체크 배지·손그림 느낌 테두리, DAY 탭 스크롤 연동·탭 이동, 체크 0개 토스트 |
| S3 시트 | 완료 | 날짜별·시작 순, 좋아요/아쉬움 상호 배타, 좋아요 0개도 진행 |
| S4 대표 선택 | 완료 | 좋아요 2개 이상일 때만. 기본값 = 가장 늦게 시작한 좋아요, 메타 `10/18 · CMS · 20:50` |
| 기록 형식·서버 검사 | 완료 | `{ selections, regrets, pick }` 그대로 저장, `gmf-form v0.4`. 하루 best 1개 검사 삭제, regrets·pick 검사 추가 |
| 이벤트 | 완료 | 5-5·12번 이벤트 전부. `gmf_result_shown.stats_only` → `rookie` |

줄인 것 없음 (14번 축소 단계 미사용).

## 3. 변경 파일
- `tools/gmf-form/titles.ts` — 해요체 근거, rookie, 성향색 `TITLE_COLORS`, 칭호 목록 `list`, 대표 무대(`pick`) 기준 streak 보조 줄·카드 요약(MINUTES·날짜 라벨)
- `tools/gmf-form/card.ts` — 최종 카드 전면 재작성 (제주돌담체 PNG 색 입히기, 하단 고정, 질감, 사진 카드, 사진 읽기)
- `tools/gmf-form/result.ts` — 결과 2페이지 구조, 저장·공유(PC/휴대폰 분기 `isMobile`, blob URL 다운로드)·인앱 안내·링크 복사, 사진 흐름, 칭호 목록, 피드백 + 연락처 전송, 예시 카드
- `tools/gmf-form/app.ts` — v2 입력 화면 (소개·그리드·시트·대표 선택·진행도·제출)
- `tools/gmf-form/logic.ts` — v2 입력 상태·기록 변환·`parseSubmission` 변경·`parseContactFields` 분리 (v1 FormState 제거)
- `tools/gmf-form/contact-server.ts` (신규) — `/api/gmf-contact` 처리부(저장소 주입) + 핸들러
- `tools/gmf-form/feedback.ts` — `rookie` 허용, statsOnly 예외 삭제, 해요체 질문 `QUESTIONS`
- `tools/gmf-form/template.html` — 전체 다크 테마, v2 입력 화면 마크업, 결과 2페이지·시트·토스트, Black Han Sans·IBM Plex 제거
- `tools/gmf-form/build.mjs` — `/gmf/glyphs` 정적 배포, gmf-contact 함수 추가
- `tools/gmf-form/test.ts`, `titles.test.ts`, `feedback.test.ts`, `contact.test.ts`(신규), `result.test.ts`(신규, PC/휴대폰·인앱 판별) — 테스트
- `package.json` — typecheck·test:form에 새 파일 추가
- `docs/reports/MIN-316-report.md`, `docs/reports/MIN-316/*.jpg` — 이 보고서와 스크린샷

## 4. 명세와 다르게 한 것
- **브랜치 이름**: `min-316-gmf-v2` 대신 `claude/new-session-iucst1` (세션 제약, 지시서의 대체 규칙대로)
- **근거 위 간격**: 명세 24px를 따랐어요 (Figma는 28px)
- **칭호 이미지 배율**: 줄 높이 160 = 글자 크기 160 기준(이미지 배율 0.8). Figma 인스턴스(폭 705)보다 약 2% 커요
- **저장·공유 (PC/휴대폰 분기, `ddf5800`, 검수 피드백 "PC에서 이미지 저장·공유하기 작동 안 함" 반영)**
  - 원인: Windows·Mac의 Chrome·Edge, Mac Safari에도 Web Share(`navigator.share`·`canShare`)가 있어서 두 버튼 모두 OS 공유 창을 띄웠어요. 공유 창에서는 사진 저장이 안 되거나 그냥 실패했고, 실패해도 다운로드로 넘어가지 않았어요. 첫 검증 때 쓴 headless Chromium에는 Web Share가 없어 다운로드로만 돌았기 때문에 이 문제를 놓쳤어요
  - PC(Windows·Mac, iPadOS 제외): [이미지 저장] = 바로 PNG 다운로드 / [공유하기] = 페이지 링크(`/gmf`) 복사 + 토스트 `링크를 복사했어요. 카드 이미지는 [이미지 저장]으로 받을 수 있어요`
  - 휴대폰: 명세대로 Web Share 파일 → 취소가 아닌 실패면 다운로드로 넘어감. 인앱이면 저장 안내 시트
  - 다운로드는 큰 data URL 대신 blob URL(약 1.6MB PNG)
  - 이벤트 `gmf_card_save_clicked`의 `method`에 `link` 추가
- **화면 속 카드**: 1페이지·소개에서는 PNG의 바깥 여백(72·150px)을 잘라 카드 면만 보여줘요. 길게 눌러 저장하면 1080×1920 전체가 저장돼요
- **v1 입력 코드 삭제**: 2단계가 v1 입력을 대체하므로 v1 FormState·폼 마크업을 지웠어요. '1단계만 공개'가 필요하면 `525ad41`로 되돌리면 돼요
- **추가 이벤트(명세 밖, 진단용)**: `gmf_card_overflow`(위 덩어리가 120px로 줄여도 넘칠 때), `gmf_photo_failed`, `gmf_contact_failed`. `gmf_result_shown`에 `has_best`, `gmf_card_save_clicked`·`gmf_card_share_result`에 `button`(save/share) 속성 추가. 연락처 값은 어디에도 없음
- **제출 완료 요약을 새로고침 뒤 다시 보여줄 때**: 연락처 줄은 빼요 (연락처를 브라우저 저장소에 남기지 않으려고)

## 5. 테스트 결과
- `npm test` 통과 / `npm run typecheck` 통과 / `npm run build:form` 통과
- `npm run test:form` 5개 파일 모두 통과 (✓ 144개)
  - 칭호: 새 근거 문구 전부, 해요체 끝맺음(손 사례 + 무작위 1500개의 모든 칭호 목록), rookie(최고 무대 있음/없음), 근거 최대 26자 ≤ 26, 금지 표현 없음, MINUTES = unionMin 합, 날짜 라벨, pick 우선
  - `parseSubmission`: 좋아요 여러 개 / regrets가 selections 밖 / regrets가 좋아요 / pick이 좋아요 밖 / 좋아요 있는데 pick 없음(null·키 없음) / 좋아요 0개인데 pick 있음 / 아쉬움 중복 제거·61개
  - `gmf-contact` 처리부: 정상 / 동의 없음 / 121자 / 잘못된 anonId / 깨진 JSON / DB 오류 시 응답에 연락처 없음
  - 피드백: rookie 허용, rookie에 fit·understood 필수, statsOnly 거부
  - PC/휴대폰 판별: Windows Chrome·Edge(터치 노트북 포함)·Mac Safari = PC, iPadOS(Mac UA + 터치)·아이폰·안드로이드 = 휴대폰, 인스타·카톡 = 인앱
- 화면 번들: `dist/index.html` 100.9 KB (JS 약 80 KB) — 300 KB 이하. 글자 PNG 612 KB는 번들 밖 정적 파일(카드에 필요한 것만 받음)
- headless Chromium 렌더 (`docs/reports/MIN-316/`, 로컬 정적 서빙 + API 가짜 응답)
  - 카드: `card-resident.jpg`(외 칭호) · `card-subPref.jpg`(메인스테이지는 거부한다) · `card-streak.jpg`(보조 줄) · `card-rookie-best.jpg` · `card-rookie-nobest.jpg` · `card-photo.jpg`
  - 결과: `result-p1-390x844.jpg` · `result-p1-375x667.jpg` (2페이지 top = 844 / 667, 안 비침) · `result-p2-writing.jpg` · `result-p2-done.jpg` · `result-inapp-guide.jpg` · `photo-preview.jpg` · `photo-change-sheet.jpg`
  - 입력: `s1-intro.jpg` · `s2-grid-checked.jpg` · `s2-grid-day2.jpg` · `s3-sheet.jpg` · `s4-pick.jpg` · `s5-result-after-flow.jpg`
  - PC 저장·공유: 실제 PC처럼 Web Share가 있고 호출하면 실패하는 브라우저를 흉내 내 확인
    - Windows Chrome·Mac Safari: [이미지 저장] → `mylive-gmf2026.png` 다운로드(1,636,461 bytes), 공유 창 호출 0회 / [공유하기] → 클립보드에 `/gmf` 링크 + 토스트 (`pc-share-toast.jpg`)
    - 아이폰(공유 실패): [이미지 저장]·[공유하기] 모두 공유 시도 후 다운로드로 넘어감
  - 전체 흐름 자동 실행: 체크 7개 → 좋아요 3·아쉬움 1 → 대표 변경 → 제출 본문 `{selections, regrets, pick}` 확인 → 결과 → 처음으로 → 소개, 체크 유지 확인

## 6. 미리보기에서 만든 테스트 데이터
- **없음.** 미리보기가 Vercel Authentication으로 보호돼 있어 이 세션에서 POST를 보낼 수 없었어요. 운영 DB(gmf_records / gmf_feedback / gmf_contacts)에 쓴 익명 ID는 0개예요.
- 로컬 렌더에서 쓴 `g-TESTTEST`는 가짜 응답으로만 처리돼 DB에 가지 않았어요.

## 7. 알려진 문제·위험
- **실기기 미확인**: iOS Safari 스크롤 스냅(mandatory) 갇힘, 인앱 브라우저 길게 눌러 저장, Android 공유 시트는 실제 휴대폰에서 확인하지 못했어요. 갇히면 `#result`의 `scroll-snap-type`을 `y proximity`로 바꾸면 돼요 (한 줄)
- **PC 저장·공유도 실제 PC 미확인**: Web Share를 흉내 낸 headless 브라우저로만 확인했어요. 실제 Windows Chrome·Edge, Mac Safari·Chrome에서 다운로드와 링크 복사를 한 번씩 눌러 봐 주세요
- **토스트 위치**: 토스트가 화면 아래쪽(버튼 위)에 떠서 2~4초 동안 [이미지 저장]·[공유하기] 버튼을 가려요 (`pc-share-toast.jpg`). 기능에는 문제없어요
- **`/api/gmf-contact` 운영 DB 미확인**: 쿼리는 v1 server.ts의 gmf_contacts upsert와 같아서 `gmf_app` 권한으로 될 것으로 보지만, 실제 호출은 못 해 봤어요
- **열려 있던 v1 화면**: 배포 순간에 v1 페이지를 열어 둔 사람이 제출하면 `pick`이 없어 서버가 막아요("최고의 무대를 골라 주세요"). 새로고침하면 v2로 바뀌어요. v1 화면의 피드백 `statsOnly`도 이제 거부돼요
- **예전 결과 복원**: v1 기록(`pick` 없음)이 남은 기기는 새로고침하면 v1 best 중 마지막 참가일 것을 최고 무대로 써서 새 카드를 보여줘요
- **위 덩어리 넘침**: 계산상 가장 긴 경우(2줄 근거 + 외 칭호 + 보조 줄)도 120px 축소 안에서 들어와요. 실제로 넘치면 `gmf_card_overflow` 이벤트로 알 수 있어요
- **그리드 배율**: 1.5px/분 고정이라 화면 폭이 달라도 세로 길이는 같아요 (하루 약 945px)
- 예시 카드는 소개 화면에서 글자 PNG 5장 정도를 받아 그려요. 느린 망에서는 잠깐 빈 카드 틀이 보여요

## 8. 판단이 필요한 것
1. **`consent_reshare` 열의 뜻이 바뀌어요**: v1은 '결과 피드백 요청도 받을게요'였고, v2 체크는 '다음 페스티벌 안내도 받을래요'예요. 같은 열에 저장하므로 v1·v2 행을 구분하려면 `gmf_records.form_version`이나 `updated_at`으로 나눠 봐야 해요
2. 배포 순간 열려 있던 v1 화면의 제출을 받아줄지(지금은 막음 — 7번)
3. 그리드를 화면 폭에 비례해 늘릴지 (지금은 390 기준 1.5px 고정)
4. **PC [공유하기]를 링크 복사로 둘지**: 지금은 PC에서 OS 공유 창 대신 링크를 복사해요(이미지는 [이미지 저장]으로). PC에서도 이미지 파일 공유 창을 원하면 Windows·Mac에서 실패 시 다운로드로 넘어가게 바꿀 수 있어요

## 9. 휴대폰 확인 체크리스트 (검수자가 실행)
- [ ] 아이폰 Safari: 소개 → 그리드 → 시트 → 대표 → 결과 → 저장
- [ ] 아이폰 인스타 인앱: 이미지 저장 → 길게 눌러 저장 안내 → 링크 복사
- [ ] 안드로이드 Chrome: 공유 시트
- [ ] PC Chrome·Edge(Windows): [이미지 저장] → PNG 다운로드, [공유하기] → 링크 복사 토스트
- [ ] PC Safari·Chrome(Mac): 위와 같음
- [ ] 결과 1페이지에 2페이지가 비치지 않음 (작은 화면 포함)
- [ ] 스크롤 한 번에 2페이지로 넘어감, 2페이지에 버튼 없음
- [ ] 사진 넣기 → 바꾸기 → 빼기
- [ ] 피드백 + 연락처 보내기 → 완료 상태
- [ ] 처음으로 → 다시 제출 → 결과 갱신
