/**
 * 판정 로직 v0.1 — 가상 사례
 * 페스티벌·아티스트는 모두 가상 데이터(실제 라인업 아님).
 * 아티스트 ID 접두어로 국적을 정한다: K=국내, J=일본, F=일본 외 해외, U=국적 미상.
 */
import type { Catalog, Festival, FestivalDay, JudgeResult, MetricId, Selection, Stage, UserRecord, Artist, Country } from './judge';
import { METRIC_NAMES } from './judge';

/* ───────────── 공통 타임테이블 템플릿 (12:00~22:00, 3개 스테이지, 17개 공연) ─────────────
 * 초반(공연 중간 시각 < 15:20): M0 M1 A0 A1 B0 B1        (6/17)
 * 후반(공연 중간 시각 ≥ 18:40): M4 M5 A4 A5 B4           (5/17)
 * 메인 비율 6/17, 메인 마지막 공연 = M5
 * 기본 국적 배치: 일본 A1·B3, 해외 M3·A4 → 일본 2/17, 해외 4/17
 */
const TEMPLATE: Record<string, [string, string]> = {
  M0: ['12:00', '12:50'], M1: ['13:30', '14:30'], M2: ['15:10', '16:10'], M3: ['16:50', '18:00'], M4: ['18:40', '19:50'], M5: ['20:30', '22:00'],
  A0: ['12:30', '13:20'], A1: ['14:00', '14:50'], A2: ['15:30', '16:20'], A3: ['17:00', '17:50'], A4: ['18:20', '19:10'], A5: ['19:50', '20:40'],
  B0: ['13:00', '13:40'], B1: ['14:40', '15:20'], B2: ['16:20', '17:00'], B3: ['17:50', '18:30'], B4: ['19:20', '20:00'],
};
const STAGE_OF: Record<string, string> = { M: 'MAIN', A: 'SUB1', B: 'SUB2' };
export const STD_STAGES: Stage[] = [
  { id: 'MAIN', name: '메인', isMain: true },
  { id: 'SUB1', name: '서브1', isMain: false },
  { id: 'SUB2', name: '서브2', isMain: false },
];
type Nat = 'K' | 'J' | 'F' | 'U';
export const DEFAULT_NAT: Record<string, Nat> = { A1: 'J', B3: 'J', M3: 'F', A4: 'F' };

/** 템플릿 하루. overrides: 슬롯 코드 → 아티스트 ID (반복 관람용 공유 아티스트 배치) */
export function stdDay(tag: string, date: string, overrides: Record<string, string> = {}, nat: Record<string, Nat> = DEFAULT_NAT): FestivalDay {
  return {
    date,
    performances: Object.entries(TEMPLATE).map(([code, [start, end]]) => ({
      id: code,
      stageId: STAGE_OF[code[0]],
      start,
      end,
      artistId: overrides[code] ?? `${nat[code] ?? 'K'}-${tag}·${code}`,
    })),
  };
}

export function fest(id: string, name: string, days: FestivalDay[], stages: Stage[] = STD_STAGES): Festival {
  return { id, name, stages, days };
}

const NAT_COUNTRY: Record<Nat, Country> = { K: 'KR', J: 'JP', F: 'OTHER', U: 'UNKNOWN' };
const NAT_LABEL: Record<Nat, string> = { K: '국내', J: '일본', F: '해외', U: '미상' };

export function artistFromId(id: string): Artist {
  const p = (id[0] as Nat) in NAT_COUNTRY ? (id[0] as Nat) : 'U';
  const label = id.slice(2);
  return { id, name: `${NAT_LABEL[p]} ${label}`, country: NAT_COUNTRY[p] };
}

export function mkCatalog(festivals: Festival[]): Catalog {
  const artists: Record<string, Artist> = {};
  for (const f of festivals) for (const d of f.days) for (const p of d.performances) artists[p.artistId] ??= artistFromId(p.artistId);
  return { artists, festivals };
}

export function pick(festivalId: string, date: string, codes: string[], best: string[] = []): Selection[] {
  return codes.map((c) => ({ festivalId, date, performanceId: c, ...(best.includes(c) ? { best: true } : {}) }));
}

/* ───────────── 사례 정의 ───────────── */

export interface Check {
  label: string;
  test: (r: JudgeResult) => boolean;
}

export interface Case {
  id: string;
  group: string;
  title: string;
  /** 무엇을 확인하는 사례인지 */
  focus: string;
  catalog: Catalog;
  record: UserRecord;
  expect: { rep: MetricId | 'statsOnly' | 'blocked'; checks?: Check[] };
}

const tierOf = (r: JudgeResult, id: MetricId) => r.metrics.find((m) => m.id === id)?.tier ?? -1;
const metric = (r: JudgeResult, id: MetricId) => r.metrics.find((m) => m.id === id)!;
const tierIs = (id: MetricId, t: number, label?: string): Check => ({
  label: label ?? `${METRIC_NAMES[id]} ${t}단계`,
  test: (r) => tierOf(r, id) === t,
});

const G = {
  rule: '대표 선정 규칙',
  nat: '국적 선호',
  annual: '반복 관람·활동량 (연간 가상 기록)',
  overlap: '겹침·무대 이동',
  time: '헤드라이너·시간대',
  streak: '연속 관람',
  edge: '기록 부족·입력 정책',
};

const D = { a: '2026-05-16', b: '2026-06-13', c: '2026-07-25' };
const shared = (code: string, id: string) => ({ [code]: id });

export function buildCases(): Case[] {
  const cases: Case[] = [];

  /* ── 대표 선정 규칙 ── */
  {
    const fs = [
      fest('FA', '가상 페스티벌 A', [stdDay('A', D.a, shared('M2', 'K-가'))]),
      fest('FB', '가상 페스티벌 B', [stdDay('B', D.b, shared('M2', 'K-가'))]),
      fest('FC', '가상 페스티벌 C', [stdDay('C', D.c, shared('M2', 'K-가'))]),
    ];
    cases.push({
      id: 'C01',
      group: G.rule,
      title: '약한 특별 칭호 + 강한 기본 칭호',
      focus: '반복 관람 1단계·활동량 1단계 vs 연속 관람 3단계 → 기본이 1단계 이상 높아 기본 칭호가 대표',
      catalog: mkCatalog(fs),
      record: {
        selections: [
          ...pick('FA', D.a, ['M0', 'A0', 'B0', 'M1', 'A1', 'B1', 'M2', 'A2', 'B2', 'M3', 'A3', 'B3', 'M4']),
          ...pick('FB', D.b, ['M2', 'B4']),
          ...pick('FC', D.c, ['M2', 'A5']),
        ],
      },
      expect: { rep: 'streak', checks: [tierIs('repeat', 1), tierIs('festivals', 1), tierIs('streak', 3)] },
    });
  }
  {
    const fs = [fest('FA', '가상 페스티벌 A', [stdDay('A', D.a)]), fest('FB', '가상 페스티벌 B', [stdDay('B', D.b)]), fest('FC', '가상 페스티벌 C', [stdDay('C', D.c)])];
    cases.push({
      id: 'C02',
      group: G.rule,
      title: '약한 특별 칭호 + 한 단계 높은 기본 칭호',
      focus: '활동량 1단계 vs 초반 관람 2단계 → 기본 칭호가 대표',
      catalog: mkCatalog(fs),
      record: {
        selections: [
          ...pick('FA', D.a, ['M0', 'A0', 'B0', 'M1', 'M2', 'B2']),
          ...pick('FB', D.b, ['M0', 'A0', 'B1', 'A2', 'M3']),
          ...pick('FC', D.c, ['A1', 'B0', 'M1', 'B2', 'A3']),
        ],
      },
      expect: { rep: 'early', checks: [tierIs('festivals', 1), tierIs('early', 2)] },
    });
    cases.push({
      id: 'C16',
      group: G.rule,
      title: '특별 1단계 = 기본 1단계',
      focus: '활동량 1단계 vs 초반 관람 1단계 → 같은 단계면 특별 칭호 우선',
      catalog: mkCatalog(fs),
      record: {
        selections: [
          ...pick('FA', D.a, ['M0', 'A0', 'B0', 'M2', 'B2', 'A3']),
          ...pick('FB', D.b, ['M0', 'A0', 'B1', 'A2', 'M3']),
          ...pick('FC', D.c, ['A1', 'B0', 'M1', 'B2', 'A3']),
        ],
      },
      expect: { rep: 'festivals', checks: [tierIs('festivals', 1), tierIs('early', 1)] },
    });
  }
  {
    const nat: Record<string, Nat> = { M1: 'F', M3: 'F', M5: 'F', A5: 'F', M4: 'J' };
    const fs = [fest('FA', '가상 페스티벌 A', [stdDay('A1', '2026-05-16', {}, nat), stdDay('A2', '2026-05-17', {}, nat)])];
    const sel = ['A0', 'M1', 'M2', 'A2', 'M3', 'M4', 'A5', 'M5'];
    cases.push({
      id: 'C03',
      group: G.rule,
      title: '같은 단계의 기본·특별 칭호',
      focus: '해외 선호 2단계 = 관람시간·메인 선호 2단계 → 특별 칭호 우선',
      catalog: mkCatalog(fs),
      record: { selections: [...pick('FA', '2026-05-16', sel), ...pick('FA', '2026-05-17', sel)] },
      expect: { rep: 'foreign', checks: [tierIs('foreign', 2), tierIs('watchTime', 2), tierIs('mainPref', 2)] },
    });
  }
  {
    const fs = [fest('FA', '가상 페스티벌 A', [stdDay('A', '2026-08-15')])];
    cases.push({
      id: 'C11',
      group: G.rule,
      title: '기본 칭호끼리 같은 단계',
      focus: '연속 관람 2단계 = 관람시간 2단계 → 잠정 고정 순서(연속 관람 먼저). 동률 후보 모두 표시',
      catalog: mkCatalog(fs),
      record: { selections: pick('FA', '2026-08-15', ['M0', 'A0', 'B0', 'M1', 'A1', 'B1', 'M2', 'A2', 'B2', 'M3', 'M5']) },
      expect: {
        rep: 'streak',
        checks: [
          tierIs('streak', 2),
          tierIs('watchTime', 2),
          { label: '동률 후보 = 연속 관람·관람시간', test: (r) => r.representative.tieCandidates.join(',') === 'streak,watchTime' },
        ],
      },
    });
  }
  {
    const fs = [
      fest('FA', '가상 페스티벌 A', [stdDay('A', D.a, shared('M2', 'K-가'))]),
      fest('FB', '가상 페스티벌 B', [stdDay('B', D.b, shared('M2', 'K-가'))]),
      fest('FC', '가상 페스티벌 C', [stdDay('C', D.c, shared('M2', 'K-가'))]),
    ];
    cases.push({
      id: 'C09',
      group: G.rule,
      title: '특별 칭호끼리 같은 단계',
      focus: '3곳에서 같은 아티스트 3번 → 반복 관람 1단계 = 활동량 1단계 → 반복 관람 우선',
      catalog: mkCatalog(fs),
      record: { selections: [...pick('FA', D.a, ['M2', 'A0']), ...pick('FB', D.b, ['M2', 'B4']), ...pick('FC', D.c, ['M2'])] },
      expect: { rep: 'repeat', checks: [tierIs('repeat', 1), tierIs('festivals', 1)] },
    });
  }

  /* ── 국적 선호 ── */
  {
    const fs = [fest('FA', '가상 페스티벌 A', [stdDay('A1', '2026-05-16'), stdDay('A2', '2026-05-17')])];
    cases.push({
      id: 'C04',
      group: G.nat,
      title: '일본·기타 해외를 고루 관람',
      focus: '일본 선호 1단계, 해외 전체 2단계 → 둘 다 획득, 더 강한 해외 선호가 대표',
      catalog: mkCatalog(fs),
      record: {
        selections: [...pick('FA', '2026-05-16', ['A1', 'B3', 'M3', 'A4', 'M0', 'B2']), ...pick('FA', '2026-05-17', ['A1', 'B3', 'M3', 'M1', 'A2', 'B1'])],
      },
      expect: { rep: 'foreign', checks: [tierIs('japan', 1), tierIs('foreign', 2)] },
    });
  }
  {
    const nat: Record<string, Nat> = { A1: 'J', B2: 'J', A3: 'J', B3: 'J', A5: 'J', M3: 'F', A4: 'F' };
    const fs = [fest('FA', '가상 페스티벌 A', [stdDay('A1', '2026-05-16', {}, nat), stdDay('A2', '2026-05-17', {}, nat)])];
    const sel = ['A1', 'B2', 'A3', 'B3', 'A5', 'M3', 'M0'];
    cases.push({
      id: 'C05',
      group: G.nat,
      title: '일본 집중',
      focus: '일본 3단계 = 해외 3단계 → 같은 단계면 더 구체적인 일본 선호 우선',
      catalog: mkCatalog(fs),
      record: { selections: [...pick('FA', '2026-05-16', sel), ...pick('FA', '2026-05-17', sel)] },
      expect: {
        rep: 'japan',
        checks: [tierIs('japan', 3), tierIs('foreign', 3), { label: '동률 후보 = 일본·해외', test: (r) => r.representative.tieCandidates.join(',') === 'japan,foreign' }],
      },
    });
  }
  {
    const nat: Record<string, Nat> = { A1: 'J', B1: 'J', B3: 'J' };
    const fs = [fest('FA', '가상 페스티벌 A', [stdDay('A', '2026-05-16', {}, nat)])];
    cases.push({
      id: 'C14',
      group: G.nat,
      title: '소표본 국적',
      focus: '6팀 중 일본 3팀 → 고유 아티스트 8팀 미만이라 국적 지표만 계산 제외, 나머지는 판정',
      catalog: mkCatalog(fs),
      record: { selections: pick('FA', '2026-05-16', ['A1', 'B1', 'B3', 'M2', 'A3', 'M4']) },
      expect: {
        rep: 'statsOnly',
        checks: [
          { label: '일본 선호 계산 제외(고유 6팀)', test: (r) => !metric(r, 'japan').computable && /6팀/.test(metric(r, 'japan').excludedReason ?? '') },
          { label: '초반·후반은 계산됨', test: (r) => metric(r, 'early').computable && metric(r, 'late').computable },
        ],
      },
    });
  }

  /* ── 반복 관람·활동량 ── */
  {
    const dates = ['2026-05-02', '2026-05-16', '2026-05-30', '2026-06-13', '2026-06-27', '2026-07-11', '2026-07-25', '2026-08-08'];
    const plan: Record<number, Record<string, string>> = {
      0: { M2: 'K-가', A2: 'K-나', B2: 'K-다' },
      1: { M2: 'K-라', A2: 'K-마', B2: 'K-바' },
      2: { M2: 'K-사', A2: 'K-아', B2: 'K-자' },
      3: { M2: 'K-가', A2: 'K-나', B2: 'K-차' },
      4: { M2: 'K-다', A2: 'K-라', B2: 'K-마' },
      5: { M2: 'K-바', A2: 'K-사', B2: 'K-차' },
      6: { M2: 'K-아', A2: 'K-자', B2: 'K-차' },
      7: {},
    };
    const letters = 'ABCDEFGH';
    const fs = dates.map((d, i) => fest(`F${letters[i]}`, `가상 페스티벌 ${letters[i]}`, [stdDay(letters[i], d, plan[i])]));
    cases.push({
      id: 'C06',
      group: G.annual,
      title: '참가 페스티벌이 많아 2번 관람 아티스트가 많은 경우',
      focus: '8곳 참가, 2번 본 아티스트 9팀 + 3번 1팀 → 활동량 3단계가 대표. 반복 기록은 전체 유지, 상위 3팀 + 펼치기',
      catalog: mkCatalog(fs),
      record: {
        selections: dates.flatMap((d, i) => pick(`F${letters[i]}`, d, i === 7 ? ['M0', 'A0', 'B4'] : ['M2', 'A2', 'B2', 'M0'])),
      },
      expect: {
        rep: 'festivals',
        checks: [tierIs('festivals', 3), tierIs('repeat', 1), { label: '2번 이상 본 아티스트 10팀 유지', test: (r) => r.repeatArtists.length === 10 }],
      },
    });
  }
  {
    const dates = ['2026-05-02', '2026-05-16', '2026-05-30', '2026-06-13', '2026-06-27', '2026-07-11', '2026-07-25'];
    const letters = 'ABCDEFG';
    const fs = dates.map((d, i) => fest(`F${letters[i]}`, `가상 페스티벌 ${letters[i]}`, [stdDay(letters[i], d, i < 4 ? shared('M2', 'K-가') : {})]));
    cases.push({
      id: 'C07',
      group: G.annual,
      title: "7곳 참가 + 한 아티스트 4번 (D′)",
      focus: '반복 관람 2단계 < 활동량 3단계 → 활동량이 대표 (채택한 원칙대로)',
      catalog: mkCatalog(fs),
      record: { selections: dates.flatMap((d, i) => pick(`F${letters[i]}`, d, i < 4 ? ['M2', 'A0', 'B4'] : ['M1', 'A3', 'B4'])) },
      expect: { rep: 'festivals', checks: [tierIs('repeat', 2), tierIs('festivals', 3)] },
    });
  }
  {
    const fs = [
      fest('FA', '가상 페스티벌 A', [stdDay('A', '2026-05-16', { M2: 'K-가', A3: 'K-나' })]),
      fest('FB', '가상 페스티벌 B', [stdDay('B', '2026-06-13', { M2: 'K-가', A3: 'K-나' })]),
      fest('FC', '가상 페스티벌 C', [stdDay('C', '2026-07-25', { M2: 'K-가' })]),
      fest('FD', '가상 페스티벌 D', [stdDay('D1', '2026-08-08', { M2: 'K-가', A3: 'K-나' }), stdDay('D2', '2026-08-09', { A3: 'K-나' })]),
    ];
    cases.push({
      id: 'C08',
      group: G.annual,
      title: '4번 본 아티스트가 둘 (E)',
      focus: '가 4번(4곳), 나 4번(3곳) → 반복 관람 2단계 > 활동량 1단계. 대표 아티스트는 서로 다른 행사 수가 많은 가',
      catalog: mkCatalog(fs),
      record: {
        selections: [
          ...pick('FA', '2026-05-16', ['M2', 'A3', 'B0']),
          ...pick('FB', '2026-06-13', ['M2', 'A3', 'B0']),
          ...pick('FC', '2026-07-25', ['M2', 'A3', 'B0']),
          ...pick('FD', '2026-08-08', ['M2', 'A3', 'B0']),
          ...pick('FD', '2026-08-09', ['A3', 'M0', 'B4']),
        ],
      },
      expect: {
        rep: 'repeat',
        checks: [tierIs('repeat', 2), tierIs('festivals', 1), { label: '대표 아티스트 = 국내 가', test: (r) => r.representative.featuredArtist?.name === '국내 가' }],
      },
    });
  }
  {
    const fs = [fest('FA', '가상 페스티벌 A', [stdDay('A', D.a, shared('M2', 'K-가'))]), fest('FB', '가상 페스티벌 B', [stdDay('B', D.b, shared('M2', 'K-가'))])];
    cases.push({
      id: 'C10a',
      group: G.annual,
      title: '2곳에서 같은 아티스트 2번 (기존 B)',
      focus: '2번은 칭호 없음(상세 반복 기록만) · 기본 칭호도 모두 0단계 → 통계 카드만',
      catalog: mkCatalog(fs),
      record: { selections: [...pick('FA', D.a, ['M2', 'A1', 'B4', 'A3']), ...pick('FB', D.b, ['M2', 'A1', 'B4', 'A3'])] },
      expect: { rep: 'statsOnly', checks: [tierIs('repeat', 0), { label: '반복 기록 1팀 유지', test: (r) => r.repeatArtists.length === 1 }] },
    });
  }
  {
    const fs = [
      fest('FA', '가상 페스티벌 A (3일)', [
        stdDay('A1', '2026-05-15', shared('M2', 'K-가')),
        stdDay('A2', '2026-05-16'),
        stdDay('A3', '2026-05-17', shared('M2', 'K-가')),
      ]),
    ];
    const sel = ['M2', 'A1', 'B4', 'A3'];
    cases.push({
      id: 'C10b',
      group: G.annual,
      title: '3일권 1곳, 1·3일차에 같은 아티스트 (기존 C)',
      focus: '같은 행사라도 날짜가 다르면 2번 · 칭호는 3번부터 → 통계 카드만',
      catalog: mkCatalog(fs),
      record: { selections: [...pick('FA', '2026-05-15', sel), ...pick('FA', '2026-05-16', sel), ...pick('FA', '2026-05-17', sel)] },
      expect: { rep: 'statsOnly', checks: [{ label: '국내 가 2번', test: (r) => r.repeatArtists[0]?.count === 2 }] },
    });
  }

  /* ── 겹침·무대 이동 ── */
  const ovStages: Stage[] = [
    { id: 'MAIN', name: '메인', isMain: true },
    { id: 'SUB1', name: '서브1', isMain: false },
    { id: 'SUB2', name: '서브2', isMain: false },
  ];
  const ovDay: FestivalDay = {
    date: '2026-09-19',
    performances: [
      ['X1', 'MAIN', '12:00', '13:00'], ['X2', 'MAIN', '14:00', '15:00'], ['X3', 'MAIN', '16:00', '17:00'], ['X4', 'MAIN', '18:00', '19:00'], ['X5', 'MAIN', '20:00', '21:30'],
      ['Y1', 'SUB1', '13:00', '13:50'], ['Y2', 'SUB1', '15:00', '15:50'], ['Y3', 'SUB1', '18:00', '18:50'], ['Y4', 'SUB1', '19:00', '19:50'],
      ['Z1', 'SUB2', '14:30', '15:20'], ['Z2', 'SUB2', '16:30', '17:20'], ['Z3', 'SUB2', '18:30', '19:20'], ['Z4', 'SUB2', '20:30', '21:10'],
    ].map(([id, stageId, start, end]) => ({ id, stageId, start, end, artistId: `K-OV·${id}` })),
  };
  const ovCat = () => mkCatalog([fest('OV', '겹침 실험 페스티벌', [ovDay], ovStages)]);
  const clusterWith = (r: JudgeResult, n: number) => r.days[0]?.clusters.find((c) => c.perfKeys.length === n);
  cases.push({
    id: 'N1',
    group: G.overlap,
    title: '시작 시각이 같은 서로 다른 스테이지 공연 2개',
    focus: 'X4(메인 18:00)·Y3(서브1 18:00) 둘 다 관람 1회씩 집계 · 겹침 추정 이동 1회 · 순서 불확정 · 관람시간은 합집합(60분)',
    catalog: ovCat(),
    record: { selections: pick('OV', '2026-09-19', ['X1', 'Y1', 'X3', 'X4', 'Y3', 'X5']) },
    expect: {
      rep: 'mainPref',
      checks: [
        { label: '관람 6회 (겹친 공연 모두 집계)', test: (r) => r.stats.views === 6 },
        { label: '겹침 묶음 길이 60분', test: (r) => { const c = clusterWith(r, 2); return !!c && c.end - c.start === 60 && c.inferredMin === 1; } },
        { label: '순서 확정 이동 2 · 불확정 경계 2', test: (r) => { const d = metric(r, 'moves').details as any; return d.orderedMoves === 2 && d.uncertainBoundaries === 2; } },
      ],
    },
  });
  cases.push({
    id: 'N2',
    group: G.overlap,
    title: '시간이 일부 겹치는 공연 2개',
    focus: 'X2(14:00~15:00)·Z1(14:30~15:20) → 겹침 추정 이동 1회, 합집합 80분',
    catalog: ovCat(),
    record: { selections: pick('OV', '2026-09-19', ['X1', 'X2', 'Z1', 'X4', 'X5']) },
    expect: {
      rep: 'watchTime',
      checks: [
        { label: '겹침 묶음 80분 · 추정 이동 1', test: (r) => { const c = clusterWith(r, 2); return !!c && c.end - c.start === 80 && c.inferredMin === 1; } },
        { label: 'X4→X5는 확정 비이동', test: (r) => r.days[0].boundaries.some((b) => b.type === 'confirmed-stay') },
      ],
    },
  });
  cases.push({
    id: 'N3',
    group: G.overlap,
    title: '3개 이상 동시·연쇄 겹침',
    focus: 'X4·Y3·Z3 동시 겹침 + Z3·Y4 연쇄 → 한 묶음(스테이지 3개) · 추정 이동 최소 2회 (겹치는 쌍 4개를 각각 세지 않음)',
    catalog: ovCat(),
    record: { selections: pick('OV', '2026-09-19', ['X1', 'X4', 'Y3', 'Z3', 'Y4', 'X5']) },
    expect: {
      rep: 'late',
      checks: [{ label: '4개 공연 한 묶음 · 추정 이동 2', test: (r) => { const c = clusterWith(r, 4); return !!c && c.inferredMin === 2 && c.stages.length === 3; } }],
    },
  });

  /* ── 헤드라이너·시간대 ── */
  {
    const fs3 = () => [fest('FA', '가상 페스티벌 A (3일)', [stdDay('A1', '2026-05-15'), stdDay('A2', '2026-05-16'), stdDay('A3', '2026-05-17')])];
    const days3 = ['2026-05-15', '2026-05-16', '2026-05-17'];
    cases.push({
      id: 'N4a',
      group: G.time,
      title: '마지막 공연만 챙겨 본 적은 관람 기록',
      focus: '3일 모두 메인 마지막(M5) + 하루 2개 → 헤드라이너 2단계 (N4b와 같은 단계여야 함)',
      catalog: mkCatalog(fs3()),
      record: { selections: days3.flatMap((d) => pick('FA', d, ['M5', 'A2', 'B1'])) },
      expect: { rep: 'headliner', checks: [tierIs('headliner', 2)] },
    });
    cases.push({
      id: 'N4b',
      group: G.time,
      title: '마지막 공연도 보고 다른 공연도 많이 본 기록',
      focus: '3일 모두 M5 + 하루 10개 → 헤드라이너는 N4a와 같은 2단계 (다른 공연 수에 영향받지 않음)',
      catalog: mkCatalog(fs3()),
      record: { selections: days3.flatMap((d) => pick('FA', d, ['M0', 'A0', 'B0', 'M1', 'A1', 'B1', 'M2', 'A2', 'B2', 'M3', 'M5'])) },
      expect: { rep: 'streak', checks: [tierIs('headliner', 2)] },
    });
    const lateSel = ['M2', 'M4', 'M5', 'A4', 'A5', 'B4'];
    cases.push({
      id: 'N5a',
      group: G.time,
      title: '하루 기록만 있는 경우',
      focus: '후반 관람 패턴 하루 → 후반은 비율 지표라 3단계 가능, 헤드라이너는 표본 조건(2일)으로 0단계',
      catalog: mkCatalog([fest('FA', '가상 페스티벌 A', [stdDay('A', '2026-05-16')])]),
      record: { selections: pick('FA', '2026-05-16', lateSel) },
      expect: { rep: 'late', checks: [tierIs('late', 3), tierIs('headliner', 0)] },
    });
    cases.push({
      id: 'C12',
      group: G.time,
      title: '같은 성향이 3일 반복 · 후반과 헤드라이너 중복',
      focus: 'N5a 패턴을 3일 반복 → 후반 3단계 그대로, 헤드라이너 2단계. 같은 기록으로 함께 높아지는지 확인',
      catalog: mkCatalog(fs3()),
      record: { selections: days3.flatMap((d) => pick('FA', d, lateSel)) },
      expect: { rep: 'late', checks: [tierIs('late', 3), tierIs('headliner', 2)] },
    });

    /* 마무리 공연이 서브 스테이지인 날: 템플릿 하루에 SUB1 A6(21:00~22:30)을 더한다. M5(20:30~22:00)와 60분 겹침.
     * 하루 3개 중 메인 1개(M2)를 섞어 메인/서브 비율을 기준선(6/18)과 같게 맞춰 헤드라이너 지표만 보이게 한다 */
    const closerDay = (tag: string, date: string, flag: boolean): FestivalDay => {
      const d = stdDay(tag, date);
      d.performances.push({ id: 'A6', stageId: 'SUB1', start: '21:00', end: '22:30', artistId: `K-${tag}·A6`, ...(flag ? { headliner: true } : {}) });
      return d;
    };
    const fsCloser = (flag: boolean) => [fest('FC', '가상 페스티벌 C (서브 마무리)', days3.map((d, i) => closerDay(`C${i + 1}`, d, flag)))];
    const headSeen = (n: number): Check => ({ label: `헤드라이너 본 날 ${n}일`, test: (r) => metric(r, 'headliner').numerator === n });
    cases.push({
      id: 'H1',
      group: G.time,
      title: '서브 스테이지 마무리 공연만 본 기록 (확인 후 헤드라이너 표시)',
      focus: '3일 모두 A6(표시)만 보고 M5는 안 봄 → 헤드라이너로 인정, 2단계 (N4a와 같은 단계)',
      catalog: mkCatalog(fsCloser(true)),
      record: { selections: days3.flatMap((d) => pick('FC', d, ['A6', 'M2', 'B1'])) },
      expect: { rep: 'headliner', checks: [tierIs('headliner', 2), headSeen(3)] },
    });
    cases.push({
      id: 'H2',
      group: G.time,
      title: '메인 헤드라이너와 서브 마무리 공연을 둘 다 고른 기록',
      focus: '3일 모두 M5·A6 둘 다 선택 → 하루 1일로만 집계, H1과 같은 3일·2단계 (둘 다 봤다고 더 높아지지 않음)',
      catalog: mkCatalog(fsCloser(true)),
      record: { selections: days3.flatMap((d) => pick('FC', d, ['M5', 'A6', 'M2', 'B1'])) },
      expect: { rep: 'headliner', checks: [tierIs('headliner', 2), headSeen(3)] },
    });
    cases.push({
      id: 'H3',
      group: G.time,
      title: '서브 마무리 공연을 봤지만 헤드라이너 표시가 없는 경우',
      focus: 'H1과 같은 기록, 데이터에 표시 없음 → 확인 전에는 헤드라이너로 세지 않음, 0단계',
      catalog: mkCatalog(fsCloser(false)),
      record: { selections: days3.flatMap((d) => pick('FC', d, ['A6', 'M2', 'B1'])) },
      expect: { rep: 'statsOnly', checks: [tierIs('headliner', 0), headSeen(0)] },
    });
  }

  /* ── 연속 관람 ── */
  {
    const gapDay: FestivalDay = {
      date: '2026-09-26',
      performances: [
        ['G1', 'MAIN', '13:00', '14:00'], ['G2', 'MAIN', '14:25', '15:25'], ['G3', 'MAIN', '15:50', '16:50'], ['G4', 'MAIN', '17:15', '18:00'],
        ['H1', 'SUB1', '13:50', '14:30'], ['H2', 'SUB1', '15:20', '16:00'], ['H3', 'SUB1', '16:45', '17:20'],
        ['W0', 'SUB2', '12:00', '12:40'], ['W1', 'SUB2', '19:00', '20:00'], ['W2', 'SUB2', '20:30', '21:00'],
      ].map(([id, stageId, start, end]) => ({ id, stageId, start, end, artistId: `K-GP·${id}` })),
    };
    const gpCat = () => mkCatalog([fest('GP', '공백 실험 페스티벌', [gapDay], ovStages)]);
    const streakDetail = (r: JudgeResult) => (metric(r, 'streak').details as any)?.segment;
    cases.push({
      id: 'N6a',
      group: G.streak,
      title: '연결 구간 5시간 · 공백 없음',
      focus: '13:00~18:00 공연이 빈틈없이 이어짐 → 연결 구간 300분, 구간 내 공연시간 300분',
      catalog: gpCat(),
      record: { selections: pick('GP', '2026-09-26', ['G1', 'H1', 'G2', 'H2', 'G3', 'H3', 'G4']) },
      expect: { rep: 'streak', checks: [tierIs('streak', 1), { label: '길이 300 · 공연시간 300', test: (r) => streakDetail(r)?.length === 300 && streakDetail(r)?.inner === 300 }] },
    });
    cases.push({
      id: 'N6b',
      group: G.streak,
      title: '연결 구간 5시간 · 공백 75분',
      focus: '25분 공백 3번 → 연결 구간은 N6a와 같은 300분(같은 단계), 구간 내 공연시간은 225분으로 따로 저장',
      catalog: gpCat(),
      record: { selections: pick('GP', '2026-09-26', ['G1', 'G2', 'G3', 'G4']) },
      expect: { rep: 'streak', checks: [tierIs('streak', 1), { label: '길이 300 · 공연시간 225', test: (r) => streakDetail(r)?.length === 300 && streakDetail(r)?.inner === 225 }] },
    });
  }

  /* ── 기록 부족·입력 정책 ── */
  cases.push({
    id: 'C13',
    group: G.edge,
    title: '기록 부족 (1곳 1일 5개)',
    focus: '비율·국적 지표는 계산 제외, 관람시간·연속 관람은 계산 → 1단계 이상 없음 → 통계 카드만',
    catalog: mkCatalog([fest('FA', '가상 페스티벌 A', [stdDay('A', '2026-05-16')])]),
    record: { selections: pick('FA', '2026-05-16', ['M0', 'A2', 'B3', 'A5', 'M5']) },
    expect: {
      rep: 'statsOnly',
      checks: [
        { label: '초반 관람 계산 제외 (5 < 6)', test: (r) => !metric(r, 'early').computable },
        { label: '관람시간은 계산됨', test: (r) => metric(r, 'watchTime').computable },
      ],
    },
  });
  cases.push({
    id: 'C15',
    group: G.edge,
    title: '같은 날 두 페스티벌 입력 (기존 H)',
    focus: '현재 입력 정책상 하루 한 페스티벌만 → 입력 단계에서 차단, 판정하지 않음',
    catalog: mkCatalog([fest('FA', '가상 페스티벌 A', [stdDay('A', '2026-05-16')]), fest('FB', '가상 페스티벌 B', [stdDay('B', '2026-05-16')])]),
    record: { selections: [...pick('FA', '2026-05-16', ['M2', 'A0', 'B1']), ...pick('FB', '2026-05-16', ['M4', 'M5'])] },
    expect: { rep: 'blocked', checks: [{ label: '날짜 충돌 오류', test: (r) => r.errors.some((e) => e.code === 'DATE_CONFLICT') }] },
  });

  return cases;
}

export const GROUP_ORDER = Object.values(G);
