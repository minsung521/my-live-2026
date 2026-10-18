/** 입력 로직·서버 처리 검사: 입력 상태 → 기록 변환, 서버 재검사, 저장 호출 (npm run test:form) */
import { readFileSync } from 'node:fs';
import { judge, validateRecord } from '../../packages/judge/src/judge';
import type { Catalog } from '../../packages/judge/src/judge';
import { defaultPick, effectivePick, emptyInput, makeAnonId, normalize, parseSubmission, refKey, toRecord, toSubmission } from './logic';
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
