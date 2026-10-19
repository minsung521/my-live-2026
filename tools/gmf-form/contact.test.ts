/** 결과 화면 연락처 API 처리부 (npm run test:form) */
import { handleContact, parseContact } from './contact-server';
import type { ContactSubmission } from './contact-server';

let fail = 0;
const ok = (cond: unknown, msg: string) => {
  if (cond) console.log(`  ✓ ${msg}`);
  else (fail++, console.log(`  ✗ ${msg}`));
};

const base = { anonId: 'g-7KQ2M9XA', festivalId: 'gmf2026', contact: '  @mylive  ', consentResult: true, consentReshare: true };
const with_ = (patch: Record<string, unknown>) => ({ ...base, ...patch });

const good = parseContact('gmf2026', base);
ok(good.ok && good.value.contact === '@mylive' && good.value.consentReshare === true, '정상 + trim');
const noReshare = parseContact('gmf2026', with_({ consentReshare: undefined }));
ok(noReshare.ok && noReshare.value.consentReshare === false, '안내 동의는 선택 (없으면 false)');
ok(parseContact('gmf2026', with_({ contact: 'a'.repeat(120) })).ok, '120자 통과');

const bad = (patch: Record<string, unknown>, msg: string) => ok(!parseContact('gmf2026', with_(patch)).ok, `막음: ${msg}`);
bad({ consentResult: false }, '동의 없음');
bad({ consentResult: undefined }, '동의 값 없음');
bad({ contact: 'a'.repeat(121) }, '121자');
bad({ contact: '   ' }, '빈 연락처');
bad({ contact: 123 }, '문자열 아님');
bad({ anonId: 'g-1234' }, '잘못된 anonId');
bad({ festivalId: 'other' }, '다른 페스티벌');

const saved: ContactSubmission[] = [];
const store = { save: async (c: ContactSubmission) => void saved.push(c) };
const r1 = await handleContact(JSON.stringify(base), store);
ok(r1.status === 200 && saved.length === 1 && saved[0].contact === '@mylive', '정상 요청 저장 (200)');
const r2 = await handleContact(JSON.stringify(with_({ consentResult: false })), store);
ok(r2.status === 400 && saved.length === 1, `동의 없음 (400, ${r2.body.error})`);
const r3 = await handleContact(JSON.stringify(with_({ contact: 'x'.repeat(121) })), store);
ok(r3.status === 400 && saved.length === 1, '121자 (400)');
const r4 = await handleContact(JSON.stringify(with_({ anonId: 'nope' })), store);
ok(r4.status === 400 && saved.length === 1, '잘못된 anonId (400)');
const r5 = await handleContact('{oops', store);
ok(r5.status === 400 && saved.length === 1, '깨진 JSON (400)');
const r6 = await handleContact(JSON.stringify(base), { save: async () => { throw new Error('db down @mylive'); } });
ok(r6.status === 500 && !JSON.stringify(r6.body).includes('@mylive'), 'DB 오류는 500, 응답에 연락처 없음');

console.log(fail ? `\n${fail}개 실패` : '\n모두 통과');
process.exit(fail ? 1 : 0);
