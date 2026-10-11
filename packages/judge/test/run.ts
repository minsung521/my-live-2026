import { judge, tierFrom, unionLength, parseTime, DEFAULT_CONFIG, METRIC_NAMES } from '../src/judge';
import { buildCases } from '../src/fixtures';

let fail = 0;
const ok = (cond: boolean, label: string) => {
  if (!cond) {
    fail++;
    console.log(`  ✗ ${label}`);
  }
};

/* 단위 테스트: 경계값 */
console.log('· 단위 테스트');
ok(tierFrom(15, [15, 25, 35]) === 1, '15.0은 1단계 (하한 포함)');
ok(tierFrom(14.999, [15, 25, 35]) === 0, '14.999는 0단계');
ok(tierFrom(25.0000000001, [15, 25, 35]) === 2, '부동소수 오차 보정');
ok(tierFrom(24.9999999999, [15, 25, 35]) === 2, '부동소수 오차 보정 (아래쪽)');
ok(tierFrom(3, DEFAULT_CONFIG.tiers.repeat) === 1 && tierFrom(2, DEFAULT_CONFIG.tiers.repeat) === 0, '반복 관람 3번부터');
ok(tierFrom(7, DEFAULT_CONFIG.tiers.festivals) === 3 && tierFrom(4, DEFAULT_CONFIG.tiers.festivals) === 1, '활동량 3·5·7곳');
ok(unionLength([[0, 60], [30, 90], [90, 100]]) === 100, '합집합 (겹침·맞닿음)');
ok(parseTime('24:30') === 1470, '자정 넘는 시각');

/* 가상 사례 */
console.log('· 가상 사례');
const rows: string[] = [];
for (const c of buildCases()) {
  const r = judge(c.catalog, c.record);
  const rep = r.representative.kind === 'special' || r.representative.kind === 'base' ? r.representative.metricId! : r.representative.kind;
  const repOk = rep === c.expect.rep;
  const failed = (c.expect.checks ?? []).filter((ch) => !ch.test(r)).map((ch) => ch.label);
  const pass = repOk && failed.length === 0;
  if (!pass) fail++;
  const tiers = r.metrics
    .filter((m) => m.mode !== 'disabled')
    .map((m) => `${METRIC_NAMES[m.id]}:${m.computable ? m.tier : '×'}`)
    .join(' ');
  rows.push(
    `${pass ? '✓' : '✗'} ${c.id.padEnd(5)} 대표=${rep}${repOk ? '' : ` (기대 ${c.expect.rep})`} S=${r.representative.S} B=${r.representative.B}${failed.length ? `  실패: ${failed.join(' / ')}` : ''}\n        ${tiers}`,
  );
}
console.log(rows.join('\n'));
console.log(fail ? `\n실패 ${fail}건` : '\n모두 통과');
process.exit(fail ? 1 : 0);
