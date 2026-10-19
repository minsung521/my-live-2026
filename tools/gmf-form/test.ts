/** 입력 로직·서버 처리 검사: 입력 상태 → 기록 변환, 서버 재검사, 저장 호출 (npm run test:form) */
import { readFileSync } from 'node:fs';
import { judge, validateRecord } from '../../packages/judge/src/judge';
import type { Catalog } from '../../packages/judge/src/judge';
import { CANCELED_ERROR, checkedKeys, dayCount, droppedDays, nextButton, restoreInput, setDays, defaultPick, effectivePick, emptyInput, isCanceled, makeAnonId, normalize, parseSubmission, refKey, toRecord, toSubmission, toggleCheck } from './logic';
import type { Submission } from './logic';
import { handleSubmit } from './server';

const catalog = JSON.parse(readFileSync(new URL('../../data/gmf2026/catalog.json', import.meta.url), 'utf8')) as Catalog;
const f = catalog.festivals[0];
let fail = 0;
const ok = (cond: unknown, msg: string) => {
  if (cond) console.log(`  ✓ ${msg}`);
  else (fail++, console.log(`  ✗ ${msg}`));
};

const [d1, d2] = f.days.map((d) => d.date);
const byStart = (date: string) => [...f.days.find((d) => d.date === date)!.performances].sort((a, b) => a.start.localeCompare(b.start)).map((p) => p.id);
const p1 = byStart(d1);
const p2 = byStart(d2);

console.log('· 입력 상태 → 기록');
const st = emptyInput();
st.checked = { [d1]: [p1[0], p1[1], p1[5]], [d2]: [p2[2]] };
st.likes = [refKey(d1, p1[1]), refKey(d1, p1[5]), refKey(d2, p2[2])];
st.regrets = [refKey(d1, p1[0]), refKey(d1, p1[1])]; // 좋아요와 겹친 아쉬움은 버림
let rec = toRecord(f, st);
ok(rec.selections.length === 4 && rec.selections.filter((s) => s.best).length === 3, '좋아요 여러 개 (하루 2개 포함)');
ok(rec.regrets.length === 1 && rec.regrets[0].performanceId === p1[0], '좋아요와 겹친 아쉬움은 빠짐');
ok(rec.pick?.date === d2 && rec.pick.performanceId === p2[2], `대표 기본값 = 가장 늦은 좋아요 (${JSON.stringify(rec.pick)})`);
ok(defaultPick(f, [refKey(d1, p1[1]), refKey(d1, p1[5])]) === refKey(d1, p1[5]), '같은 날이면 늦게 시작한 무대');
st.pick = refKey(d1, p1[1]);
ok(toRecord(f, st).pick?.performanceId === p1[1], '고른 대표 유지');
ok(validateRecord(catalog, { selections: rec.selections }).errors.length === 0, 'validateRecord 오류 없음');
ok(judge(catalog, { selections: rec.selections }).status !== 'blocked', '판정 실행됨');
const unchecked = { ...st, checked: { [d1]: [p1[0]], [d2]: [p2[2]] } };
const n = normalize(f, unchecked);
ok(!n.likes.includes(refKey(d1, p1[1])) && n.pick === null, '체크 해제한 공연의 좋아요·대표는 정리');
ok(effectivePick(f, { ...emptyInput(), checked: { [d1]: [p1[0]] }, likes: [refKey(d1, p1[0])] }) === refKey(d1, p1[0]), '좋아요 1개면 그 무대가 대표');
const none = toRecord(f, { ...emptyInput(), checked: { [d1]: [p1[0]] } });
ok(none.pick === null && none.selections.every((s) => !s.best), '좋아요 0개면 대표 없음');
ok(toRecord(f, { ...emptyInput(), checked: { [d2]: [p2[0]] } }).selections.every((s) => s.date === d2), '체크한 날만 참가일');

const id = makeAnonId();
ok(/^g-[2-9A-HJ-NP-Z]{8}$/.test(id), `익명 ID 형식 (${id})`);
const sub = toSubmission(f, st, id);
ok(sub.contact === null && sub.formVersion === 'gmf-form v0.4', '전송 본문: 연락처 없음, v0.4');
const parsed = parseSubmission(catalog, 'gmf2026', JSON.parse(JSON.stringify(sub)));
ok(parsed.ok, '서버 재검사 통과');
if (parsed.ok) ok(JSON.stringify(Object.keys(parsed.value.record)) === '["selections","regrets","pick"]', '저장 기록 = { selections, regrets, pick }');

console.log('· 서버 재검사');
const bad = (mut: (x: any) => void, msg: string) => {
  const x = JSON.parse(JSON.stringify(sub));
  mut(x);
  const r = parseSubmission(catalog, 'gmf2026', x);
  ok(!r.ok, `서버가 막음: ${msg}${r.ok ? '' : ` (${r.error})`}`);
};
const good = (mut: (x: any) => void, msg: string) => {
  const x = JSON.parse(JSON.stringify(sub));
  mut(x);
  const r = parseSubmission(catalog, 'gmf2026', x);
  ok(r.ok, `통과: ${msg}${r.ok ? '' : ` (${r.error})`}`);
  return r;
};
good(() => {}, '좋아요 여러 개 (하루 2개)');
bad((x) => (x.anonId = 'g-1234'), '익명 ID 형식');
bad((x) => (x.festivalId = 'other'), '다른 페스티벌');
bad((x) => (x.record.selections = []), '빈 기록');
bad((x) => (x.record.selections[0].performanceId = 'nope'), '없는 공연');
bad((x) => (x.record.regrets = [{ date: d2, performanceId: p2[5] }]), 'regrets가 selections 밖');
bad((x) => (x.record.regrets = [{ date: d1, performanceId: p1[1] }]), 'regrets가 좋아요');
bad((x) => (x.record.pick = { date: d1, performanceId: p1[0] }), 'pick이 좋아요 밖');
bad((x) => (x.record.pick = null), '좋아요 있는데 pick 없음');
bad((x) => delete x.record.pick, '좋아요 있는데 pick 키 없음');
bad((x) => {
  x.record.selections.forEach((s: any) => delete s.best);
  x.record.pick = { date: d1, performanceId: p1[1] };
}, '좋아요 0개인데 pick 있음');
const noLike = good((x) => {
  x.record.selections.forEach((s: any) => delete s.best);
  x.record.pick = null;
}, '좋아요 0개 + pick null');
if (noLike.ok) ok(noLike.value.record.pick === null, '좋아요 0개면 pick null 저장');
const dedup = good((x) => (x.record.regrets = [x.record.regrets[0], x.record.regrets[0]]), '아쉬움 중복');
if (dedup.ok) ok(dedup.value.record.regrets.length === 1, '아쉬움 중복 제거');
bad((x) => (x.record.regrets = Array(61).fill(x.record.regrets[0])), '아쉬움 61개');
bad((x) => (x.record.regrets = 'x'), '아쉬움이 배열 아님');
bad((x) => (x.record.selections = Array(61).fill(x.record.selections[0])), '선택 61개');
bad((x) => (x.contact = { value: '@a', consentResult: false }), '(v1 호환) 연락처 + 동의 없음');
bad((x) => (x.contact = { value: 'a'.repeat(200), consentResult: true }), '(v1 호환) 너무 긴 연락처');

console.log('· 2일차 우천 취소 공연');
{
  const CANCELED = ['mint-breeze-1520', 'mint-breeze-1630', 'mint-breeze-1740', 'mint-breeze-1900', 'mint-breeze-2030', 'loving-forest-garden-1530'];
  ok(CANCELED.every((id) => isCanceled(f, d2, id)), 'catalog: 2일차 6개 canceled');
  ok(f.days.flatMap((d) => d.performances).filter((p) => (p as { canceled?: boolean }).canceled).length === 6, 'canceled는 딱 6개 (1일차 LFG 15:30은 정상)');
  ok(!isCanceled(f, d1, 'loving-forest-garden-1530') && f.days[1].performances.length === 24, '1일차 같은 ID는 정상, 2일차 공연은 지우지 않음(24개)');
  ok(judge(catalog, { selections: [{ festivalId: f.id, date: d2, performanceId: 'club-midnight-sunset-2050' }] }).days[0].programEnd > 0, '판정 모듈은 그대로 동작');

  // 그리드 탭 무시
  const t1 = toggleCheck(f, emptyInput(), d2, 'mint-breeze-1900');
  ok(t1.ignored && !t1.on && !(t1.state.checked[d2] ?? []).length, '그리드 탭 무시: 취소 공연은 체크 안 됨');
  const t2 = toggleCheck(f, emptyInput(), d2, 'club-midnight-sunset-2050');
  ok(!t2.ignored && t2.on && t2.state.checked[d2].includes('club-midnight-sunset-2050'), '정상 공연은 탭하면 체크');
  ok(!toggleCheck(f, t2.state, d2, 'club-midnight-sunset-2050').on, '정상 공연 다시 탭하면 해제');

  // 예전 초안에 남은 취소 공연 → 시트·대표 목록에서 빠짐
  const stale = { ...emptyInput(), checked: { [d2]: ['mint-breeze-1900', 'club-midnight-sunset-2050', 'mint-breeze-2030'] }, likes: [refKey(d2, 'mint-breeze-1900'), refKey(d2, 'club-midnight-sunset-2050')], regrets: [refKey(d2, 'mint-breeze-2030')], pick: refKey(d2, 'mint-breeze-1900') };
  const n2 = normalize(f, stale);
  ok(checkedKeys(f, stale).join() === refKey(d2, 'club-midnight-sunset-2050'), '시트 목록(checkedKeys)에 취소 공연 없음');
  ok(n2.checked[d2].join() === 'club-midnight-sunset-2050' && n2.likes.join() === refKey(d2, 'club-midnight-sunset-2050') && !n2.regrets.length && n2.pick === null, '예전 초안의 취소 공연 체크·좋아요·아쉬움·대표를 걸러냄');
  const r2 = toRecord(f, stale);
  ok(r2.selections.length === 1 && r2.pick?.performanceId === 'club-midnight-sunset-2050', '전송 기록에도 취소 공연 없음');

  // 서버 재검사
  const base2 = toSubmission(f, { ...emptyInput(), checked: { [d2]: ['club-midnight-sunset-2050', 'mint-breeze-1220'] }, likes: [refKey(d2, 'club-midnight-sunset-2050')], regrets: [refKey(d2, 'mint-breeze-1220')] }, id);
  ok(parseSubmission(catalog, 'gmf2026', JSON.parse(JSON.stringify(base2))).ok, '정상 공연만 있으면 통과');
  const rej = (mut: (x: any) => void, msg: string) => {
    const x = JSON.parse(JSON.stringify(base2));
    mut(x);
    const r = parseSubmission(catalog, 'gmf2026', x);
    ok(!r.ok && r.error === CANCELED_ERROR, `취소 공연 거절: ${msg}${r.ok ? '' : ` (${r.error})`}`);
  };
  rej((x) => x.record.selections.push({ festivalId: 'gmf2026', date: d2, performanceId: 'mint-breeze-1900' }), 'selections');
  rej((x) => x.record.selections.push({ festivalId: 'gmf2026', date: d2, performanceId: 'loving-forest-garden-1530', best: true }), 'selections 좋아요');
  rej((x) => x.record.regrets.push({ date: d2, performanceId: 'mint-breeze-2030' }), 'regrets');
  rej((x) => (x.record.pick = { date: d2, performanceId: 'mint-breeze-1740' }), 'pick');
}

console.log('· 참가일 선택 · 하루씩 체크 (S2 v3)');
{
  const mk = (days: string[], checked: Record<string, string[]>) => ({ ...emptyInput(), days, checked });
  const A = p1[0];
  const B = 'club-midnight-sunset-2050';
  // 하루
  let nb = nextButton(f, mk([d1], {}), d1);
  ok(nb.label === '체크 완료' && !nb.enabled && nb.blocked.reason === 'empty' && nb.blocked.message === '본 무대를 하나 이상 체크해 주세요' && nb.blocked.to === d1, '하루·체크 없음 → 체크 완료 흐림, 토스트');
  nb = nextButton(f, mk([d1], { [d1]: [A] }), d1);
  ok(nb.enabled && nb.action.kind === 'sheet', '하루·체크 있음 → 체크 완료 켜짐 → 시트');
  nb = nextButton(f, mk([d2], { [d2]: ['mint-breeze-1900'] }), d2);
  ok(!nb.enabled && nb.blocked.day === 2, '하루(DAY 2)·취소 공연만 체크 → 체크 수 0, 흐림');
  // 이틀
  nb = nextButton(f, mk([d1, d2], {}), d1);
  ok(nb.label === 'DAY 2로 넘어가기' && !nb.enabled && nb.blocked.to === d1 && nb.blocked.message === 'DAY 1에 본 무대를 하나 이상 체크해 주세요', '이틀·DAY 1·체크 없음 → 넘어가기 흐림, DAY 1 토스트');
  nb = nextButton(f, mk([d1, d2], { [d1]: [A] }), d1);
  ok(nb.enabled && nb.action.kind === 'nextDay' && nb.action.to === d2, '이틀·DAY 1 체크 → DAY 2로 넘어가기 켜짐');
  nb = nextButton(f, mk([d1, d2], { [d1]: [A] }), d2);
  ok(nb.label === '체크 완료' && !nb.enabled && nb.blocked.to === d2 && nb.blocked.reason === 'empty_day' && nb.blocked.message.startsWith('DAY 2에'), '이틀·DAY 2·DAY 2 체크 없음 → 흐림, DAY 2로');
  nb = nextButton(f, mk([d1, d2], { [d2]: [B] }), d2);
  ok(!nb.enabled && nb.blocked.to === d1 && nb.blocked.day === 1, '이틀·DAY 2만 체크 → 흐림, DAY 1로 이동');
  nb = nextButton(f, mk([d1, d2], {}), d2);
  ok(!nb.enabled && nb.blocked.to === d1, '이틀·둘 다 없음 → DAY 1로');
  nb = nextButton(f, mk([d1, d2], { [d1]: [A], [d2]: [B] }), d2);
  ok(nb.enabled && nb.action.kind === 'sheet', '이틀·모두 체크 → 체크 완료 켜짐 → 시트');
  // 날 빼기
  const full = { ...mk([d1, d2], { [d1]: [A], [d2]: [B, 'mint-breeze-1220', 'loving-forest-garden-1240'] }), likes: [refKey(d1, A), refKey(d2, B)], regrets: [refKey(d2, 'mint-breeze-1220')], pick: refKey(d2, B) };
  const drop = droppedDays(f, full, [d1]);
  ok(drop.length === 1 && drop[0].day === 2 && drop[0].count === 3, `DAY 2 빼면 확인: 체크 3개 (${JSON.stringify(drop)})`);
  ok(!droppedDays(f, mk([d1, d2], { [d1]: [A] }), [d1]).length, '체크 없는 날은 확인 없이');
  const after = setDays(f, full, [d1]);
  ok(after.days.join() === d1 && !after.checked[d2] && after.likes.join() === refKey(d1, A) && !after.regrets.length && after.pick === null, '빼기: 그 날의 체크·좋아요·아쉬움·대표 무대 삭제');
  ok(setDays(f, mk([d1], { [d1]: [A] }), [d1, d2]).checked[d1].join() === A, '날 추가: 기존 체크 유지');
  // 예전 localStorage 복원
  const old = restoreInput(f, { checked: { [d2]: [B] }, likes: [refKey(d2, B)], regrets: [], pick: null });
  ok(old.days.join() === d2 && dayCount(f, old, d2) === 1 && old.likes.length === 1, '예전 상태(참가일 없음) → 체크 있는 날이 참가일');
  ok(restoreInput(f, { checked: {}, likes: [], regrets: [], pick: null }).days.length === 0, '체크도 없으면 참가일 비움 (시트)');
  ok(restoreInput(f, { checked: { [d2]: ['mint-breeze-1900'] } }).days.length === 0, '취소 공연만 체크돼 있으면 참가일 비움');
  const kept = restoreInput(f, { days: [d1, d2], checked: { [d1]: [A] } });
  ok(kept.days.join() === `${d1},${d2}`, '참가일 저장돼 있으면 그대로 (체크 없는 날도 유지)');
  ok(restoreInput(f, null).days.length === 0 && restoreInput(f, 'x').checked && true, '깨진 값도 빈 상태로');
}

console.log('· 처리부');
const saved: Submission[] = [];
const store = { save: async (s: Submission) => void saved.push(s) };
const r1 = await handleSubmit(JSON.stringify(sub), 'test-agent', store);
ok(r1.status === 200 && saved.length === 1, '정상 요청 저장 (200)');
ok(saved[0].record.pick?.performanceId === p1[1] && saved[0].record.regrets.length === 1, '저장 값에 대표·아쉬움 포함');
const r2 = await handleSubmit('{not json', 'ua', store);
ok(r2.status === 400 && saved.length === 1, '깨진 JSON은 저장 안 함 (400)');
const r3 = await handleSubmit(JSON.stringify({ ...sub, anonId: 'x' }), 'ua', store);
ok(r3.status === 400 && typeof r3.body.error === 'string', `검사 실패 시 오류 문구 반환 (${r3.body.error})`);
const r4 = await handleSubmit(JSON.stringify(sub), 'ua', { save: async () => { throw new Error('db down'); } });
ok(r4.status === 500, 'DB 오류는 500');
ok(saved[0].contact === null, '연락처 없이 저장');

console.log(fail ? `\n${fail}개 실패` : '\n모두 통과');
process.exit(fail ? 1 : 0);
