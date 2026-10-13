/** 폼 로직 검사: 상태 → record 변환이 판정 모듈 형식·검사를 통과하는지 (npm run test:form) */
import { readFileSync } from 'node:fs';
import { judge, validateRecord } from '../../packages/judge/src/judge';
import type { Catalog } from '../../packages/judge/src/judge';
import { check, emptyState, makeAnonId, payloads, toRecord } from './logic';

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
const pl = payloads(f, st, id, new Date('2026-10-17T12:00:00Z'));
const recBody = new URLSearchParams(pl.record);
ok(recBody.get('form-name') === 'gmf-record' && !pl.record.includes('someone'), '기록 본문에 연락처 없음');
ok(JSON.parse(recBody.get('record_json')!).selections.length === 3, '기록 본문 record_json 파싱');
ok(new URLSearchParams(pl.contact!).get('anon_id') === id, '연락처 본문은 익명 ID로만 연결');

console.log(fail ? `\n${fail}개 실패` : '\n모두 통과');
process.exit(fail ? 1 : 0);
