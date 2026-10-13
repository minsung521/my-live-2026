/** 폼 로직·서버 처리 검사: 상태 → record 변환, 서버 재검사, 저장 호출 (npm run test:form) */
import { readFileSync } from 'node:fs';
import { judge, validateRecord } from '../../packages/judge/src/judge';
import type { Catalog } from '../../packages/judge/src/judge';
import { check, emptyState, makeAnonId, parseSubmission, toRecord, toSubmission } from './logic';
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
const p1 = f.days[0].performances.map((p) => p.id);
const p2 = f.days[1].performances.map((p) => p.id);

const st = emptyState();
ok(check(catalog, f, st).some((p) => p.step === 'days'), '참가일 없으면 막음');
st.days = [d1, d2];
st.seen = { [d1]: [p1[0], p1[1], p1[5]], [d2]: [p2[2]] };
st.best = { [d1]: p1[1], [d2]: null };
ok(check(catalog, f, st).some((p) => p.step === 'best'), '최고 무대 안 고른 날 막음');
st.best[d2] = p2[2];
ok(check(catalog, f, st).length === 0, '연락처 없이도 제출 가능');
st.contact = '@someone';
ok(check(catalog, f, st).some((p) => p.step === 'contact'), '연락처만 있고 동의 없으면 막음');
st.consentResult = true;
ok(check(catalog, f, st).length === 0, '연락처 + 동의면 통과');

const rec = toRecord(f, st);
ok(rec.selections.length === 4, 'selections 4개');
ok(rec.selections.filter((s) => s.best).length === 2, '참가일마다 best 1개');
ok(validateRecord(catalog, rec).errors.length === 0, 'validateRecord 오류 없음');
const r = judge(catalog, rec);
ok(r.status !== 'blocked', `judge 실행됨 (status: ${r.status})`);

st.days = [d1];
ok(toRecord(f, st).selections.every((s) => s.date === d1), '참가일에서 뺀 날짜의 체크는 버림');

const id = makeAnonId();
ok(/^g-[2-9A-HJ-NP-Z]{8}$/.test(id), `익명 ID 형식 (${id})`);
const sub = toSubmission(f, st, id);
ok(sub.contact?.value === '@someone' && sub.record.selections.length === 3, '전송 본문: 기록 3개 + 연락처');
ok(parseSubmission(catalog, 'gmf2026', JSON.parse(JSON.stringify(sub))).ok, '서버 재검사 통과');

// 서버 재검사 — 화면을 거치지 않은 요청
const bad = (mut: (x: any) => void, msg: string) => {
  const x = JSON.parse(JSON.stringify(sub));
  mut(x);
  ok(!parseSubmission(catalog, 'gmf2026', x).ok, `서버가 막음: ${msg}`);
};
bad((x) => (x.anonId = 'g-1234'), '익명 ID 형식');
bad((x) => (x.festivalId = 'other'), '다른 페스티벌');
bad((x) => (x.record.selections = []), '빈 기록');
bad((x) => (x.record.selections[0].performanceId = 'nope'), '없는 공연');
bad((x) => (x.record.selections[0].best = true), '하루에 최고 무대 2개');
bad((x) => x.record.selections.forEach((s: any) => delete s.best), '최고 무대 없음');
bad((x) => (x.contact.consentResult = false), '연락처 + 동의 없음');
bad((x) => (x.contact.value = 'a'.repeat(200)), '너무 긴 연락처');
bad((x) => (x.record.selections = Array(61).fill(x.record.selections[0])), '선택 61개');

// 처리부 — 가짜 저장소
const saved: Submission[] = [];
const store = { save: async (s: Submission) => void saved.push(s) };
const r1 = await handleSubmit(JSON.stringify(sub), 'test-agent', store);
ok(r1.status === 200 && saved.length === 1, '정상 요청 저장 (200)');
const r2 = await handleSubmit('{not json', 'ua', store);
ok(r2.status === 400 && saved.length === 1, '깨진 JSON은 저장 안 함 (400)');
const r3 = await handleSubmit(JSON.stringify({ ...sub, anonId: 'x' }), 'ua', store);
ok(r3.status === 400 && typeof r3.body.error === 'string', `검사 실패 시 오류 문구 반환 (${r3.body.error})`);
const r4 = await handleSubmit(JSON.stringify(sub), 'ua', { save: async () => { throw new Error('db down'); } });
ok(r4.status === 500, 'DB 오류는 500');
const noContact = await handleSubmit(JSON.stringify({ ...sub, contact: null }), 'ua', store);
ok(noContact.status === 200 && saved[1].contact === null, '연락처 없이 저장');

console.log(fail ? `\n${fail}개 실패` : '\n모두 통과');
process.exit(fail ? 1 : 0);
