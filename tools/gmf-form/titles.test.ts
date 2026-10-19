/** 칭호 매핑 검사 — 실제 그민페 catalog + 손으로 만든 record (npm run test:form) */
import { readFileSync } from 'node:fs';
import { DEFAULT_CONFIG, judge } from '../../packages/judge/src/judge';
import type { Catalog, UserRecord } from '../../packages/judge/src/judge';
import { EVIDENCE_MAX, GMF_TITLE_ORDER, TITLE_COLORS, TITLE_LABELS, cardSummary, longestSegment, pickTitle, residentShare, streakSubline } from './titles';
import type { TitleResult } from './titles';

const catalog = JSON.parse(readFileSync(new URL('../../data/gmf2026/catalog.json', import.meta.url), 'utf8')) as Catalog;
const f = catalog.festivals[0];
const [D1, D2] = f.days.map((d) => d.date);
let fail = 0;
const ok = (cond: unknown, msg: string) => {
  if (cond) console.log(`  ✓ ${msg}`);
  else (fail++, console.log(`  ✗ ${msg}`));
};

const MBS = 'mint-breeze-';
const CMS = 'club-midnight-sunset-';
const LFG = 'loving-forest-garden-';

/** 날짜별 공연 ID 목록 → record. best를 따로 안 주면 그날 첫 번째가 ★ */
function rec(sel: Record<string, string[]>, best: Record<string, string> = {}): UserRecord {
  return {
    selections: Object.entries(sel).flatMap(([date, ids]) =>
      ids.map((id, i) => ((best[date] ? best[date] === id : i === 0) ? { festivalId: f.id, date, performanceId: id, best: true } : { festivalId: f.id, date, performanceId: id })),
    ),
  };
}
const all = (date: string, pred: (id: string) => boolean = () => true) => f.days.find((d) => d.date === date)!.performances.map((p) => p.id).filter(pred);

const examples: { name: string; r: UserRecord; t: TitleResult }[] = [];
function run(name: string, r: UserRecord): TitleResult {
  const t = pickTitle(catalog, r, judge(catalog, r));
  examples.push({ name, r, t });
  return t;
}

// 1. resident — 체류(그날 체크한 첫 공연 시작 ~ 마지막 공연 종료) 기준 (MIN-316 핫픽스)
//    참가일 체류 합계 ÷ 프로그램 합계 ≥ 90% · 참가한 날마다 5개 이상 · 그날 최장 공백 ≤ 120분
console.log('· resident');
// 12:20~22:30 체류 100%, 8개, 최장 공백 50분 (16:20~17:10)
const D1_8 = [MBS + '1220', MBS + '1320', MBS + '1420', MBS + '1530', CMS + '1710', CMS + '1830', CMS + '2000', CMS + '2130'];
{
  const t0 = run('resident 오프닝 + 마지막 공연만', rec({ [D1]: [MBS + '1220', CMS + '2130'] }));
  ok(residentShare(f, rec({ [D1]: [MBS + '1220', CMS + '2130'] })).share === 1 && t0.id !== 'resident', `오프닝 + 마지막 2개만 → 체류 100%여도 resident 아님 (${t0.id})`);

  const t = run('resident 하루 8개', rec({ [D1]: D1_8 }));
  ok(t.id === 'resident' && t.tier === 3, `하루 5개 이상 · 체류 100% · 공백 50분 → resident (${t.id})`);
  ok(t.evidence === '12:20~22:30, 올림픽공원에 있었어요', `하루 참가 근거 (${t.evidence})`);
  ok(t.list[0].id === 'resident' && t.list.length === t.others.length + 1, '목록 첫 칸 = resident');

  const gap130 = rec({ [D1]: D1_8.filter((id) => id !== CMS + '1710') });
  ok(residentShare(f, gap130).days[0].maxGap === 130 && run('resident 공백 130분', gap130).id !== 'resident', '같은 기록에 130분 공백(16:20~18:30) → resident 아님');
  const gap120 = rec({ [D1]: [MBS + '1220', MBS + '1320', MBS + '1420', CMS + '1710', CMS + '1830', CMS + '2000', CMS + '2130'] });
  ok(residentShare(f, gap120).days[0].maxGap === 120 && run('resident 공백 120분', gap120).id === 'resident', '공백 120분(15:10~17:10)은 허용');

  // 13:20~22:30 = 550 / 610 = 90.2%, 공백 110·110·120분
  const four = [MBS + '1320', CMS + '1550', CMS + '1830', CMS + '2130'];
  const r4 = rec({ [D1]: four });
  ok(residentShare(f, r4).share > 0.9 && run('resident 4개 (체류 90.2%)', r4).id !== 'resident', '체류 90% 이상이어도 하루 4개면 resident 아님');
  const t5 = run('resident 5개 (체류 90.2%)', rec({ [D1]: [...four, MBS + '1420'] }));
  ok(t5.id === 'resident' && t5.evidence === '13:20~22:30, 올림픽공원에 있었어요', `하루 5개 · 90.2% → resident (${t5.id} / ${t5.evidence})`);
}
{
  // 양일 합산: 1일차 610분 + 2일차 490분(13:10~21:20) = 1100 / 1220 = 90.2%, 2일차 480분(12:20~20:20)이면 1090 / 1220 = 89.3%
  const D2_90 = [MBS + '1310', CMS + '1330', MBS + '1410', CMS + '1540', LFG + '1630', LFG + '1740', CMS + '1800', LFG + '1850', LFG + '2020'];
  const D2_89 = [MBS + '1220', LFG + '1240', MBS + '1310', CMS + '1330', MBS + '1410', CMS + '1540', LFG + '1630', LFG + '1740', CMS + '1800', LFG + '1850', CMS + '1920'];
  const r89 = rec({ [D1]: D1_8, [D2]: D2_89 });
  const s89 = residentShare(f, r89).share;
  ok(s89 > 0.89 && s89 < 0.9 && run('resident 양일 89%', r89).id !== 'resident', `양일 합산 ${(s89 * 100).toFixed(1)}% → resident 아님`);
  const r90 = rec({ [D1]: D1_8, [D2]: D2_90 });
  const t90 = run('resident 양일 90%', r90);
  ok(t90.id === 'resident' && t90.evidence === '이틀 시간표의 90%, 올림픽공원에 있었어요', `양일 합산 90.2% → resident, 양일 근거 내림 (${t90.id} / ${t90.evidence})`);
  ok(run('resident 1일차만 충족 + 2일차 4개', rec({ [D1]: D1_8, [D2]: D2_90.slice(0, 4) })).id !== 'resident', '참가한 날 중 하루라도 5개 미만이면 resident 아님');
}
{
  // 분모 = 취소 공연을 뺀 그날 첫 공연 시작 ~ 마지막 공연 종료
  ok(residentShare(f, rec({ [D2]: all(D2) })).days[0].program === 610, '실제 2일차: 첫 공연(산보)·마지막 공연(십란)이 취소가 아니라 분모 610분 그대로');
  const cx = JSON.parse(JSON.stringify(catalog)) as Catalog;
  const cxDay = cx.festivals[0].days.find((d) => d.date === D2)!;
  (cxDay.performances.find((p) => p.id === CMS + '2050') as { canceled?: boolean }).canceled = true; // 십란을 취소로 → 마지막 종료 21:20 (이석원)
  const fx = cx.festivals[0];
  const r = rec({ [D2]: [MBS + '1220', LFG + '1240', MBS + '1310', CMS + '1330', MBS + '1410', CMS + '1540', LFG + '1630', LFG + '1740', CMS + '1800', LFG + '1850', CMS + '1920', LFG + '2020'] });
  const res = judge(cx, r);
  const rs = residentShare(fx, r);
  ok(rs.days[0].program === 540 && res.days[0].programEnd - res.days[0].programStart === 610, `취소 공연 제외 분모 540분 (판정 모듈 프로그램 길이는 610분 그대로) (${rs.days[0].program})`);
  const t = pickTitle(cx, r, res);
  ok(rs.share === 1 && t.id === 'resident' && t.evidence === '12:20~21:20, 올림픽공원에 있었어요', `12:20~21:20 체류 → 540 / 540 = 100% → resident (${t.id} / ${t.evidence})`);
}

console.log('· 메인/서브');
{
  const t = run('MBS 위주', rec({ [D1]: [MBS + '1220', MBS + '1420', MBS + '1640', MBS + '1910'], [D2]: [MBS + '1220', MBS + '1410', MBS + '1630', MBS + '1900'] }));
  ok(t.id === 'mainPref' && t.evidence === '본 무대 8개 중 8개가 메인 스테이지였어요', `MBS 위주 → mainPref (${t.id} / ${t.evidence})`);

  const cms = rec({ [D1]: [CMS + '1250', CMS + '1440', CMS + '1710', CMS + '2000'], [D2]: [CMS + '1240', CMS + '1430', CMS + '1650', CMS + '1920'] });
  const t3 = run('CMS 단일', cms);
  ok(t3.id === 'oneStage' && t3.evidence === '8개 무대 모두 CMS였어요', `CMS 단일 → oneStage (${t3.id} / ${t3.evidence})`);
  ok(t3.label === TITLE_LABELS.oneStage, 'oneStage 라벨');
  const t3b = run('CMS 7 + LFG 1', rec({ [D1]: [CMS + '1250', CMS + '1440', CMS + '1710', CMS + '2000'], [D2]: [CMS + '1240', CMS + '1430', LFG + '1630', CMS + '1920'] }));
  ok(t3b.id === 'oneStage' && t3b.evidence === '본 무대 8개 중 7개가 CMS였어요', `CMS 87.5% → oneStage (${t3b.evidence})`);

  const t4 = run('CMS·LFG 반반, MBS 0', rec({ [D1]: [CMS + '1250', LFG + '1430', CMS + '1710', LFG + '2020'], [D2]: [LFG + '1240', CMS + '1430', LFG + '1630', CMS + '1920'] }));
  ok(t4.id === 'subPref' && t4.evidence === '메인 스테이지는 한 번도 안 갔어요', `반반·MBS 0 → subPref (${t4.id} / ${t4.evidence})`);
  const t4b = run('CMS·LFG 반반, MBS 1', rec({ [D1]: [CMS + '1250', LFG + '1340', CMS + '1440', LFG + '1640', CMS + '2000', LFG + '2020', MBS + '1530'], [D2]: [LFG + '1240', CMS + '1330', LFG + '1530', CMS + '1650', LFG + '1850', CMS + '2050'] }));
  ok(t4b.id === 'subPref' && t4b.evidence === '본 무대 13개 중 메인은 1개뿐이었어요', `반반·MBS 1 → subPref (${t4b.id} / ${t4b.evidence})`);

  const r5 = rec({ [D1]: [CMS + '1250', LFG + '1430', CMS + '1710', LFG + '2020', MBS + '1530'], [D2]: [LFG + '1240', CMS + '1430', LFG + '1630', CMS + '1920'] });
  const sub5 = judge(catalog, r5).metrics.find((m) => m.id === 'subPref')!;
  const t5 = run('subPref 1단계', r5);
  ok(sub5.tier === 1 && t5.id !== 'subPref' && t5.id !== 'oneStage' && !t5.others.includes('subPref'), `subPref 1단계는 탈락 → ${t5.id}`);
}

console.log('· 시간대·헤드라이너');
{
  const late = run('후반 위주', rec({ [D1]: [CMS + '1830', MBS + '1910', CMS + '2000', MBS + '2040', CMS + '2130'], [D2]: [LFG + '1850', MBS + '1900', LFG + '2020', CMS + '2050'] }));
  ok(late.id === 'late' && late.evidence === '본 무대 9개 중 8개가 해 진 뒤였어요', `후반 → late (${late.evidence})`);
  ok(late.others.includes('headliner'), '양일 헤드라이너는 others');
  const early = run('초반 위주', rec({ [D1]: [MBS + '1220', LFG + '1240', CMS + '1340', MBS + '1420', LFG + '1530'], [D2]: [MBS + '1220', LFG + '1330', MBS + '1410', LFG + '1530'] }));
  ok(early.id === 'early' && early.evidence === '본 무대 9개 중 7개가 해 지기 전이었어요', `초반 → early (${early.evidence})`);
  const hl = run('헤드라이너만 양일', rec({ [D1]: [CMS + '2130'], [D2]: [CMS + '2050'] }));
  ok(hl.id === 'headliner' && hl.evidence === '이틀 모두 헤드라이너 무대를 봤어요', `양일 헤드라이너만 → headliner (${hl.id})`);
}

console.log('· 같은 단계 순서 (그민페 전용)');
{
  ok(GMF_TITLE_ORDER.join() === 'oneStage,subPref,mainPref,early,late,streak,watchTime,headliner', '순서 상수');
  // 1일차 17:50~21:40 연결 230분(streak 3단계) + 2일차 MBS만 → 메인 비율 9/12 (mainPref 3단계), 체류 59%라 resident 아님
  const r = rec({
    [D1]: [MBS + '1220', MBS + '1530', MBS + '1640', MBS + '1750', MBS + '1910', MBS + '2040', CMS + '1830', CMS + '2000', LFG + '1640'],
    [D2]: [MBS + '1220', MBS + '1310', MBS + '1410'],
  });
  const res = judge(catalog, r);
  const tiers = Object.fromEntries(res.metrics.map((m) => [m.id, m.tier]));
  const t = run('MBS 위주 + 1일차 저녁 연결', r);
  ok(tiers.mainPref === 3 && tiers.streak === 3 && t.id === 'mainPref' && t.others.includes('streak'), `같은 3단계면 mainPref가 streak보다 앞 (${t.id}, others ${t.others})`);
  const cms = run('CMS 단일 (streak 없음)', rec({ [D1]: [CMS + '1250', CMS + '1440', CMS + '1710', CMS + '2000'], [D2]: [CMS + '1240', CMS + '1430', CMS + '1650', CMS + '1920'] }));
  ok(cms.id === 'oneStage', `oneStage 유지 (${cms.id})`);
}

console.log('· streak');
// 실관람 시간(공백 ≤10분으로 이어진 구간의 합집합) 기준 · 160/190/220분 · 공연 3개 이상 (MIN-316 핫픽스)
// 1일차 12:40~13:20 · 14:30~15:10 · 15:50~17:30 · 17:50~21:20 — 17:50~21:20(알레프·리도어·장기하·홍이삭, 합집합 3시간 20분)이 가장 긴 구간
const STREAK_200 = [MBS + '1640', MBS + '1910', CMS + '1250', CMS + '1550', CMS + '1830', LFG + '1240', LFG + '1430', LFG + '1750', LFG + '2020'];
{
  const r = rec({ [D1]: STREAK_200 });
  const res = judge(catalog, r);
  const t = run('합집합 3시간 20분 체인', r);
  const m = res.metrics.find((x) => x.id === 'streak')!;
  ok(m.tier === 2 && m.value === 200, `합집합 200분 → 연속 관람 2단계 (${m.tier} / ${m.value})`);
  ok(t.id === 'streak' && t.tier === 2 && t.evidence === '3시간 20분 동안 쉬지 않고 무대를 봤어요', `→ streak 2단계, 근거 (${t.id} / ${t.evidence})`);
  ok(t.subline === '알레프 · 리도어 · 홍이삭 외 1팀', `보조 줄은 같은 구간 공연 (${t.subline})`);
  const ls = longestSegment(res)!;
  const ms = (m.details as { segment: { start: number; end: number } }).segment;
  ok(ls.seg.start === ms.start && ls.seg.end === ms.end, '보조 줄 구간 = 판정 모듈이 고른 구간 (inner 우선)');

  // 겹치는 공연 4개를 짧게 이어 체크: 12:40~14:10 합집합 90분
  const short4 = rec({ [D1]: [LFG + '1240', CMS + '1250', MBS + '1320', LFG + '1340'] });
  const sres = judge(catalog, short4);
  const st = run('겹치는 공연 4개 짧게 (합집합 90분)', short4);
  ok(sres.metrics.find((x) => x.id === 'streak')!.tier === 0 && st.id !== 'streak' && !st.others.includes('streak'), `겹치는 4개를 이어 봐도 합집합 2시간 미만 → 화장실 없음 (${st.id})`);

  // 옮겨 다니기만 해서 예전 기준(공백 ≤30분 연결 구간 4시간)은 채우던 기록 → 화장실 대신 다른 칭호
  const hop = rec({ [D1]: [MBS + '1220', MBS + '1640', CMS + '1250', CMS + '1340', LFG + '1430', LFG + '1530', LFG + '2020'] });
  const hres = judge(catalog, hop);
  const ht = run('옮겨 다닌 기록 (예전 화장실)', hop);
  const old = judge(catalog, hop, { ...DEFAULT_CONFIG, ratioMinViews: 6, streak: { maxGapMin: 30, minPerformances: 2 }, tiers: { ...DEFAULT_CONFIG.tiers, streak: [240, 330, 420] } });
  ok(old.representative.metricId === 'streak' && hres.metrics.find((x) => x.id === 'streak')!.tier === 0 && ht.id === 'early', `예전 기준 대표 streak → 지금은 화장실 없음, ${ht.id}`);

  const t2 = run('24개 전부 체크 (양일)', rec({ [D1]: all(D1), [D2]: all(D2) }));
  ok(t2.id === 'resident' && t2.others.includes('streak'), `양일 24개씩은 resident, streak은 others (${t2.id})`);

  // 보조 줄 규칙 — 대표가 streak이 아니어도 streakSubline으로 확인. 1일차 12:20~16:20 공연 7개가 끊김 없이 이어짐
  const chain = [MBS + '1220', CMS + '1250', MBS + '1320', CMS + '1340', MBS + '1420', CMS + '1440', MBS + '1530'];
  const sr = rec({ [D1]: chain }, { [D1]: MBS + '1420' });
  ok(streakSubline(catalog, sr, judge(catalog, sr)) === '연정 · 지소쿠리클럽 · 정준일 외 4팀', '★가 구간 안 → 포함, 시작 시각 순');
  ok(streakSubline(catalog, sr, judge(catalog, sr), 2) === '연정 · 지소쿠리클럽 외 5팀', '2팀으로 줄이면 ★·첫 공연');
  const sr2 = rec({ [D1]: chain });
  ok(streakSubline(catalog, sr2, judge(catalog, sr2)) === '연정 · 퓨처피어클럽 · 정준일 외 4팀', '★가 첫 공연이면 다음 공연으로 채움');
  const sr3 = rec({ [D1]: chain }, { [D1]: CMS + '1340' });
  ok(streakSubline(catalog, sr3, judge(catalog, sr3)) === '연정 · 리브아워티어스 · 정준일 외 4팀', '★가 구간 중간이면 시작 시각 순 가운데');
  // 2일차 18:50~22:30 (★ 십란)
  const r4 = rec({ [D2]: [LFG + '1850', CMS + '1920', LFG + '2020', CMS + '2050'] }, { [D2]: CMS + '2050' });
  const sub4 = streakSubline(catalog, r4, judge(catalog, r4));
  ok(sub4?.includes('십란(십센치X소란)') && !/십란\(십센치X소란\)[가-힣]/.test(sub4 ?? ''), `가장 긴 이름 그대로, 조사 없음 (${sub4})`);
  ok(!/→|->/.test(sub4 ?? ''), '화살표 없음');
}

console.log('· streak 근거 시간 표기');
{
  // 실제 기록으로 만들기 어려운 경계는 judge 결과의 구간 내 공연시간만 바꿔 확인
  const r = rec({ [D1]: STREAK_200 });
  const res = judge(catalog, r);
  for (const [len, want] of [[45, '45분 동안 쉬지 않고 무대를 봤어요'], [120, '2시간 동안 쉬지 않고 무대를 봤어요'], [450, '7시간 30분 동안 쉬지 않고 무대를 봤어요']] as const) {
    for (const d of res.days) for (const seg of d.segments) seg.inner = len;
    const t = pickTitle(catalog, r, res);
    ok(t.evidence === want, `${len}분 → ${t.evidence}`);
  }
}

console.log('· rookie (칭호 0개)');
{
  const r = rec({ [D1]: [MBS + '1220', LFG + '1240', CMS + '1340'] });
  const t = run('3개만', r);
  ok(t.id === 'rookie' && t.label === '그민페 신생아' && t.tier === 0 && !t.others.length, `3개만 → rookie (${t.id})`);
  ok(t.evidence === '3개 무대를 봤어요. 내년엔 더 달려봐요', `rookie 근거 (${t.evidence})`);
  ok(t.list.length === 1 && t.list[0].id === 'rookie', 'rookie 목록은 자기 하나');
  ok(cardSummary(catalog, r, judge(catalog, r)).best?.name === '연정', 'rookie + 최고 무대 있음 (v1 best)');
  ok(cardSummary(catalog, r, judge(catalog, r), null).best === null, 'rookie + 최고 무대 없음 (pick null)');
  ok(run('2개만', rec({ [D2]: [MBS + '1220', CMS + '1920'] })).id === 'rookie', '2개만 → rookie');
  ok(TITLE_COLORS.rookie === '#F2EBDD', 'rookie 성향색 미색');
}

console.log('· 해요체 끝맺음');
{
  const ends = /(어요|었어요|였어요|봐요|봤어요|갔어요)$/;
  for (const { name, t } of examples) for (const it of t.list) if (!ends.test(it.evidence)) ok(false, `해요체 아님: ${name} / ${it.evidence}`);
  ok(examples.every((e) => e.t.list.every((it) => ends.test(it.evidence))), `손 사례 ${examples.length}개 근거 모두 해요체`);
  ok(examples.every((e) => e.t.list[0].id === e.t.id && e.t.list.length === e.t.others.length + 1), '목록 = 대표 + others');
}

console.log('· 카드 요약');
{
  const r = rec({ [D1]: [MBS + '1220', CMS + '1250', LFG + '1240'], [D2]: [CMS + '1920', MBS + '1900'] });
  const res = judge(catalog, r);
  const s = cardSummary(catalog, r, res);
  ok(s.views === 5 && s.stages.map((x) => `${x.short} ${x.count}`).join(' · ') === 'MBS 2 · CMS 2 · LFG 1', `스테이지 비율 (${s.stages.map((x) => x.count)})`);
  ok(s.best?.date === '10/18' && s.best.stage === 'CMS' && s.best.start === '19:20' && s.best.name === '쏜애플', `최고의 무대 = 마지막 참가일 best (${JSON.stringify(s.best)})`);
  ok(s.minutes === res.days.reduce((a, d) => a + d.unionMin, 0) && s.minutes > 0, `MINUTES = unionMin 합 (${s.minutes})`);
  ok(s.dateLabel === '10.17—18', `날짜 이틀 (${s.dateLabel})`);
  const r1 = rec({ [D2]: [CMS + '1920'] });
  ok(cardSummary(catalog, r1, judge(catalog, r1)).dateLabel === '10.18', '날짜 하루');
  const sp = cardSummary(catalog, r, res, { date: D1, performanceId: CMS + '1250' });
  ok(sp.best?.date === '10/17' && sp.best.stage === 'CMS', `pick이 있으면 pick (${JSON.stringify(sp.best)})`);
}

// 무작위 기록 1500개 — 문구 길이·금지 표현·예외 없음
console.log('· 무작위 기록 1500개');
const FORBIDDEN = [/끝까지\s*남/, /개장부터/, /상위\s*\d+\s*%/, /\d+\s*%\s*안에/, /→/];
let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const seenIds = new Map<string, { r: UserRecord; t: TitleResult }>();
let maxLen = 0;
let threw = 0;
for (let i = 0; i < 1500; i++) {
  const p = 0.1 + rand() * 0.8;
  const bias = Math.floor(rand() * 4); // 0: 고르게, 1~3: 한 스테이지 쪽으로
  const stagePref = [MBS, CMS, LFG][bias - 1];
  const sel: Record<string, string[]> = {};
  for (const date of [D1, D2]) {
    if (rand() < 0.25) continue;
    const ids = all(date, (id) => rand() < (stagePref ? (id.startsWith(stagePref) ? 0.9 : p * 0.3) : p));
    if (ids.length) sel[date] = ids;
  }
  if (!Object.keys(sel).length) continue;
  const r = rec(sel);
  try {
    const t = pickTitle(catalog, r, judge(catalog, r));
    for (const s of [t.label, t.evidence, t.subline]) if (s && FORBIDDEN.some((re) => re.test(s))) ok(false, `금지 표현: ${s}`);
    for (const it of t.list) {
      const len = [...it.evidence].length;
      maxLen = Math.max(maxLen, len);
      if (len > EVIDENCE_MAX) ok(false, `근거 ${len}자: ${it.evidence}`);
      if (!/요$/.test(it.evidence)) ok(false, `해요체 아님: ${it.evidence}`);
    }
    if (!t.label || !t.evidence) ok(false, `라벨·근거 비어 있음: ${t.id}`);
    if (t.id === 'streak' && !t.subline) ok(false, 'streak 보조 줄 없음');
    if (!seenIds.has(t.id)) seenIds.set(t.id, { r, t });
  } catch (e) {
    threw++;
    console.log(e);
  }
}
ok(threw === 0, '예외 없음');
ok(maxLen <= EVIDENCE_MAX, `근거 최대 ${maxLen}자 ≤ ${EVIDENCE_MAX}자`);
for (const { t } of examples) {
  const len = [...(t.evidence ?? '')].length;
  if (len > EVIDENCE_MAX || [t.label, t.evidence, t.subline].some((s) => s && FORBIDDEN.some((re) => re.test(s)))) ok(false, `손 사례 문구: ${t.evidence}`);
}
ok(true, `무작위로 나온 칭호: ${[...seenIds.keys()].join(', ')}`);
for (const [id, v] of seenIds) if (!examples.some((e) => e.t.id === id)) examples.push({ name: `무작위 (${id})`, ...v });

if (process.argv.includes('--table'))
  for (const { name, t } of examples) console.log(`| ${name} | ${t.label} | ${t.evidence ?? ''} | ${t.subline ?? ''} | ${[...(t.evidence ?? '')].length} |`);

console.log(fail ? `\n${fail}개 실패` : '\n모두 통과');
process.exit(fail ? 1 : 0);
