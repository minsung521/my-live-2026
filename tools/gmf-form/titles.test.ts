/** 칭호 매핑 검사 — 실제 그민페 catalog + 손으로 만든 record (npm run test:form) */
import { readFileSync } from 'node:fs';
import { judge } from '../../packages/judge/src/judge';
import type { Catalog, UserRecord } from '../../packages/judge/src/judge';
import { EVIDENCE_MAX, TITLE_LABELS, cardSummary, pickTitle, residentShare, streakSubline } from './titles';
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

// 1. resident — 하루 최소 12개를 스테이지를 오가며 골라야 85%에 도달 (전수 탐색으로 확인한 조합)
const D1_12 = [MBS + '1220', MBS + '1320', MBS + '1420', MBS + '1530', MBS + '1640', MBS + '1750', MBS + '1910', MBS + '2040', CMS + '1250', CMS + '1830', CMS + '2000', CMS + '2130'];
const D2_12 = [MBS + '1220', MBS + '1310', MBS + '1410', MBS + '1520', MBS + '1630', MBS + '1740', CMS + '1240', CMS + '1330', CMS + '1920', CMS + '2050', LFG + '1850', LFG + '2020'];
const D2_11 = D2_12.filter((id) => id !== CMS + '1330'); // 11개로 낼 수 있는 최대 83.6%
console.log('· resident');
{
  const r = rec({ [D1]: D1_12, [D2]: D2_12 });
  const t = run('resident (양일 12개씩)', r);
  ok(t.id === 'resident' && t.tier === 3, `양일 12개씩 → resident (${t.id})`);
  ok(t.evidence === '이틀 시간표의 86%, 올림픽공원에 있었어요', `근거 내림 86% (${t.evidence})`);
  ok(t.others.includes('watchTime') || t.others.includes('streak'), `others에 함께 충족한 칭호 (${t.others.join(',')})`);
  const r2 = rec({ [D1]: D1_12, [D2]: D2_11 });
  const res2 = judge(catalog, r2);
  const share2 = res2.days[1].unionMin / (res2.days[1].programEnd - res2.days[1].programStart);
  ok(share2 > 0.83 && share2 < 0.85, `경계: 둘째 날 ${(share2 * 100).toFixed(1)}%`);
  ok(run('resident 경계 아래 (12+11개)', r2).id !== 'resident', '84% 대 하루가 있으면 resident 아님');
  ok(run('resident 하루만', rec({ [D1]: all(D1) })).id !== 'resident', '하루만 참가하면 resident 아님');
  // 16:40~17:50 70분 공백 (커버리지는 88%)
  const gapRec = rec({ [D1]: all(D1, (id) => ![MBS + '1640', LFG + '1640', CMS + '1710'].includes(id)), [D2]: all(D2) });
  const gapRes = judge(catalog, gapRec);
  ok(residentShare(f, gapRec, gapRes).share > 0.9 && run('resident 공백 70분', gapRec).id !== 'resident', '커버리지가 높아도 공백 60분 초과면 resident 아님');
}

console.log('· 메인/서브');
{
  const t = run('MBS 위주', rec({ [D1]: [MBS + '1220', MBS + '1420', MBS + '1640', MBS + '1910'], [D2]: [MBS + '1220', MBS + '1410', MBS + '1630', MBS + '1900'] }));
  ok(t.id === 'mainPref' && t.evidence === '본 무대 8개 중 8개가 메인 스테이지', `MBS 위주 → mainPref (${t.id} / ${t.evidence})`);

  const cms = rec({ [D1]: [CMS + '1250', CMS + '1440', CMS + '1710', CMS + '2000'], [D2]: [CMS + '1240', CMS + '1430', CMS + '1650', CMS + '1920'] });
  const t3 = run('CMS 단일', cms);
  ok(t3.id === 'oneStage' && t3.evidence === '8개 무대 전부 CMS', `CMS 단일 → oneStage (${t3.id} / ${t3.evidence})`);
  ok(t3.label === TITLE_LABELS.oneStage, 'oneStage 라벨');
  const t3b = run('CMS 7 + LFG 1', rec({ [D1]: [CMS + '1250', CMS + '1440', CMS + '1710', CMS + '2000'], [D2]: [CMS + '1240', CMS + '1430', LFG + '1630', CMS + '1920'] }));
  ok(t3b.id === 'oneStage' && t3b.evidence === '본 무대 8개 중 7개가 CMS', `CMS 87.5% → oneStage (${t3b.evidence})`);

  const t4 = run('CMS·LFG 반반, MBS 0', rec({ [D1]: [CMS + '1250', LFG + '1430', CMS + '1710', LFG + '2020'], [D2]: [LFG + '1240', CMS + '1430', LFG + '1630', CMS + '1920'] }));
  ok(t4.id === 'subPref' && t4.evidence === '메인 스테이지 관람 0회', `반반·MBS 0 → subPref (${t4.id} / ${t4.evidence})`);
  const t4b = run('CMS·LFG 반반, MBS 1', rec({ [D1]: [CMS + '1250', LFG + '1340', CMS + '1440', LFG + '1640', CMS + '2000', LFG + '2020', MBS + '1530'], [D2]: [LFG + '1240', CMS + '1330', LFG + '1530', CMS + '1650', LFG + '1850', CMS + '2050'] }));
  ok(t4b.id === 'subPref' && t4b.evidence === '본 무대 13개 중 메인은 1개뿐', `반반·MBS 1 → subPref (${t4b.id} / ${t4b.evidence})`);

  const r5 = rec({ [D1]: [CMS + '1250', LFG + '1430', CMS + '1710', LFG + '2020', MBS + '1530'], [D2]: [LFG + '1240', CMS + '1430', LFG + '1630', CMS + '1920'] });
  const sub5 = judge(catalog, r5).metrics.find((m) => m.id === 'subPref')!;
  const t5 = run('subPref 1단계', r5);
  ok(sub5.tier === 1 && t5.id !== 'subPref' && t5.id !== 'oneStage' && !t5.others.includes('subPref'), `subPref 1단계는 탈락 → ${t5.id}`);
}

console.log('· 시간대·헤드라이너');
{
  const late = run('후반 위주', rec({ [D1]: [CMS + '1830', MBS + '1910', CMS + '2000', MBS + '2040', CMS + '2130'], [D2]: [LFG + '1850', MBS + '1900', LFG + '2020', CMS + '2050'] }));
  ok(late.id === 'late' && late.evidence === '본 무대 9개 중 8개가 해 진 뒤', `후반 → late (${late.evidence})`);
  ok(late.others.includes('headliner'), '양일 헤드라이너는 others');
  const early = run('초반 위주', rec({ [D1]: [MBS + '1220', LFG + '1240', CMS + '1340', MBS + '1420', LFG + '1530'], [D2]: [MBS + '1220', LFG + '1330', MBS + '1410', LFG + '1530'] }));
  ok(early.id === 'early' && early.evidence === '본 무대 9개 중 7개가 해 지기 전', `초반 → early (${early.evidence})`);
  const hl = run('헤드라이너만 양일', rec({ [D1]: [CMS + '2130'], [D2]: [CMS + '2050'] }));
  ok(hl.id === 'headliner' && hl.evidence === '이틀 모두 헤드라이너 무대를 봤어요', `양일 헤드라이너만 → headliner (${hl.id})`);
}

console.log('· streak');
{
  const mbs1 = all(D1, (id) => id.startsWith(MBS));
  const r = rec({ [D1]: mbs1 }, { [D1]: MBS + '1640' });
  const t = run('MBS 하루 종일 (★ 적재)', r);
  ok(t.id === 'streak' && t.evidence === '8개 무대를 연달아 봤어요', `streak (${t.evidence})`);
  ok(t.subline === '연정 · 적재 · 이소라 외 5팀', `★가 구간 안 → 포함, 시작 시각 순 (${t.subline})`);
  ok(streakSubline(catalog, r, judge(catalog, r), 2) === '연정 · 적재 외 6팀', '2팀으로 줄이면 ★·첫 공연');
  const r2 = rec({ [D1]: mbs1 });
  ok(run('MBS 하루 종일 (★ 첫 공연)', r2).subline === '연정 · 하이파이유니콘 · 이소라 외 5팀', '★가 첫 공연이면 다음 공연으로 채움');
  const r3 = rec({ [D1]: [...mbs1, CMS + '1250'] }, { [D1]: CMS + '1250' });
  ok(run('★가 구간 중간', r3).subline === '연정 · 퓨처피어클럽 · 이소라 외 6팀', '★가 구간 중간이면 시작 시각 순 가운데');
  const r4 = rec({ [D2]: all(D2, (id) => id.startsWith(CMS)) }, { [D2]: CMS + '2050' });
  const t4 = run('CMS 하루 종일 (★ 십란)', r4);
  ok(t4.subline?.includes('십란(십센치X소란)') && !/십란\(십센치X소란\)[가-힣]/.test(t4.subline ?? ''), `가장 긴 이름 그대로, 조사 없음 (${t4.subline})`);
  ok(!/→|->/.test(t4.subline ?? ''), '화살표 없음');
}

console.log('· statsOnly');
{
  const t = run('3개만', rec({ [D1]: [MBS + '1220', LFG + '1240', CMS + '1340'] }));
  ok(t.id === 'statsOnly' && t.label === null && t.evidence === null && t.tier === 0, `3개만 → statsOnly (${t.id})`);
  ok(run('2개만', rec({ [D2]: [MBS + '1220', CMS + '1920'] })).id === 'statsOnly', '2개만 → statsOnly');
}

console.log('· 카드 요약');
{
  const r = rec({ [D1]: [MBS + '1220', CMS + '1250', LFG + '1240'], [D2]: [CMS + '1920', MBS + '1900'] });
  const s = cardSummary(catalog, r, judge(catalog, r));
  ok(s.views === 5 && s.stages.map((x) => `${x.short} ${x.count}`).join(' · ') === 'MBS 2 · CMS 2 · LFG 1', `스테이지 비율 (${s.stages.map((x) => x.count)})`);
  ok(s.best.length === 2 && s.best[1].date === '10/18' && s.best[1].stage === 'CLUB MIDNIGHT SUNSET' && s.best[1].start === '19:20' && s.best[1].name === '쏜애플', `최고의 무대 (${JSON.stringify(s.best[1])})`);
}

// 무작위 기록 1500개 — 문구 길이·금지 표현·예외 없음
console.log('· 무작위 기록 1500개');
const FORBIDDEN = [/끝까지\s*남/, /쉬지\s*않고/, /개장부터/, /상위\s*\d+\s*%/, /\d+\s*%\s*안에/, /→/];
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
    const len = [...(t.evidence ?? '')].length;
    maxLen = Math.max(maxLen, len);
    if (len > EVIDENCE_MAX) ok(false, `근거 ${len}자: ${t.evidence}`);
    if (t.id !== 'statsOnly' && (!t.label || !t.evidence)) ok(false, `라벨·근거 비어 있음: ${t.id}`);
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
  for (const { name, t } of examples) console.log(`| ${name} | ${t.label ?? '(statsOnly)'} | ${t.evidence ?? ''} | ${t.subline ?? ''} | ${[...(t.evidence ?? '')].length} |`);

console.log(fail ? `\n${fail}개 실패` : '\n모두 통과');
process.exit(fail ? 1 : 0);
