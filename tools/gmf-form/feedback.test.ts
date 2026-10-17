/** 피드백 검사·처리부 (npm run test:form) */
import { feedbackReady, parseFeedback } from './feedback';
import type { Feedback } from './feedback';
import { handleFeedback } from './feedback-server';

let fail = 0;
const ok = (cond: unknown, msg: string) => {
  if (cond) console.log(`  ✓ ${msg}`);
  else (fail++, console.log(`  ✗ ${msg}`));
};

const base = {
  anonId: 'g-7KQ2M9XA',
  festivalId: 'gmf2026',
  formVersion: 'gmf-form v0.3',
  judgeVersion: 'v0.1.1',
  titleId: 'streak',
  titleLabel: '화장실은 언제 가요?',
  fit: 'yes',
  understood: 'yes',
  share: 'story',
  showParts: ['best', 'title', 'title'],
  chips: ['more'],
  comment: '  재밌어요  ',
};
const with_ = (patch: Record<string, unknown>) => ({ ...base, ...patch });

const good = parseFeedback('gmf2026', base);
ok(good.ok, '정상 본문 통과');
if (good.ok) {
  ok(good.value.showParts.join() === 'title,best', `배열 중복 제거·허용 순서 (${good.value.showParts})`);
  ok(good.value.comment === '재밌어요', 'comment trim');
}
const so = parseFeedback('gmf2026', with_({ titleId: 'statsOnly', titleLabel: null, fit: null, understood: null }));
ok(so.ok && so.value.fit === null && so.value.titleLabel === null, 'statsOnly + fit·understood null 통과');
const blank = parseFeedback('gmf2026', with_({ comment: '   ' }));
ok(blank.ok && blank.value.comment === null, '빈 comment → null');
const c300 = parseFeedback('gmf2026', with_({ comment: '가'.repeat(300) }));
ok(c300.ok, 'comment 300자 통과');

const bad = (patch: Record<string, unknown>, msg: string) => ok(!parseFeedback('gmf2026', with_(patch)).ok, `막음: ${msg}`);
bad({ fit: 'maybe' }, 'fit enum 위반');
bad({ share: 'everyone' }, 'share enum 위반');
bad({ understood: undefined }, '칭호 카드인데 understood 없음');
bad({ chips: ['more', 'free_text'] }, '허용 안 된 칩');
bad({ showParts: 'title' }, 'showParts가 배열 아님');
bad({ titleId: 'nomad' }, '없는 칭호');
bad({ titleId: 'statsOnly', fit: 'yes', understood: null }, 'statsOnly인데 fit 있음');
bad({ comment: '가'.repeat(301) }, 'comment 301자');
bad({ anonId: 'g-1234' }, '잘못된 anonId');
bad({ anonId: 'g-7KQ2M9X0' }, 'anonId에 혼동 문자(0)');
bad({ festivalId: 'other' }, '다른 페스티벌');

ok(!feedbackReady('streak', 'yes', null, 'story') && feedbackReady('streak', 'yes', 'no', 'no'), '필수 문항 1·2·3');
ok(feedbackReady('statsOnly', null, null, 'friends') && !feedbackReady('statsOnly', null, null, null), 'statsOnly는 3번만 필수');

const saved: Feedback[] = [];
const store = { save: async (f: Feedback) => void saved.push(f) };
const r1 = await handleFeedback(JSON.stringify(base), store);
ok(r1.status === 200 && saved.length === 1, '정상 요청 저장 (200)');
const r2 = await handleFeedback('{oops', store);
ok(r2.status === 400 && saved.length === 1, '깨진 JSON (400)');
const r3 = await handleFeedback(JSON.stringify(with_({ fit: 'nah' })), store);
ok(r3.status === 400 && typeof r3.body.error === 'string' && saved.length === 1, `enum 위반 (400, ${r3.body.error})`);
const r4 = await handleFeedback(JSON.stringify(with_({ comment: 'x'.repeat(301) })), store);
ok(r4.status === 400 && saved.length === 1, 'comment 301자 (400)');
const r5 = await handleFeedback(JSON.stringify(with_({ anonId: 'nope' })), store);
ok(r5.status === 400 && saved.length === 1, '잘못된 anonId (400)');
const r6 = await handleFeedback(JSON.stringify(with_({ titleId: 'statsOnly', fit: 'yes' })), store);
ok(r6.status === 400 && saved.length === 1, 'statsOnly인데 fit 있음 (400)');
const r7 = await handleFeedback(JSON.stringify(base), { save: async () => { throw new Error('db down'); } });
ok(r7.status === 500, 'DB 오류는 500');
ok(!('contact' in saved[0]), '저장 값에 연락처 없음');

console.log(fail ? `\n${fail}개 실패` : '\n모두 통과');
process.exit(fail ? 1 : 0);
