/**
 * MY LIVE 2026 — 페스티벌 성향 판정 로직 v0.1
 *
 * 앱과 분리된 순수 함수 모듈. 외부 의존성 없음.
 * 입력: 수록 페스티벌 데이터(Catalog) + 사용자의 공연 선택 기록(UserRecord)
 * 출력: 지표별 원시 수치·분모·기준선·단계·제외 사유·추정 여부 + 대표 선정 결과
 *
 * 상위 규칙 (2026-10-11)
 *  - 사용자가 선택한 공연 = 일부라도 본 공연. 겹치는 공연을 함께 고르면 일부 관람 후 이동한 기록으로 해석한다.
 *  - 선택한 공연은 각각 관람 1회로 집계하고 아티스트·국적·메인/서브 지표에 모두 포함한다.
 *  - 같은 아티스트 반복 관람 횟수는 (행사, 날짜) 기준으로 중복 제거한다.
 *  - 하루에는 페스티벌 하나만 입력할 수 있다(입력 정책). 위반 기록은 판정하지 않는다.
 *  - 계산에서 제외한 날짜·공연은 관람 비율과 기준선 양쪽에서 똑같이 제외한다.
 *  - 시간 관련 수치는 선택한 공연의 시간표 기준 추정이며 실제 입·퇴장 시각이 아니다.
 */

export const VERSION = 'v0.1';

/* ───────────────────────────── 입력 타입 ───────────────────────────── */

export type Country = 'KR' | 'JP' | 'OTHER' | 'UNKNOWN';

export interface Artist {
  id: string;
  name: string;
  shortName?: string;
  country: Country;
}

export interface Stage {
  id: string;
  name: string;
  /** 각 페스티벌에서 가장 큰 스테이지 1개만 true */
  isMain: boolean;
}

export interface Performance {
  id: string;
  artistId: string;
  stageId: string;
  /** "HH:MM". 자정을 넘기면 24:30처럼 24 이상으로 적는다 */
  start: string;
  end: string;
}

export interface FestivalDay {
  date: string; // YYYY-MM-DD
  performances: Performance[];
}

export interface Festival {
  id: string;
  name: string;
  stages: Stage[];
  days: FestivalDay[];
}

export interface Catalog {
  artists: Record<string, Artist>;
  festivals: Festival[];
}

export interface Selection {
  festivalId: string;
  date: string;
  performanceId: string;
  /** 그날의 최고 무대(별표) */
  best?: boolean;
}

export interface UserRecord {
  selections: Selection[];
}

/* ───────────────────────────── 설정 (잠정값) ───────────────────────────── */

export type Tiers = [number, number, number];

export interface JudgeConfig {
  /** 일별 지표(관람시간)를 계산하는 참가일의 최소 관람 수 */
  validDayMinViews: number;
  /** 비율 지표(메인/서브, 초반/후반)의 최소 관람 수 */
  ratioMinViews: number;
  nationality: { minUniqueArtists: number; minCategoryArtists: number };
  streak: { maxGapMin: number; minPerformances: number };
  meal: { windows: { label: string; start: string; end: string }[]; minOverlapMin: number };
  tiers: {
    repeat: Tiers; // 번
    festivals: Tiers; // 곳
    japan: Tiers; // Δ %p
    foreign: Tiers; // Δ %p
    mainPref: Tiers; // Δ %p (+)
    subPref: Tiers; // Δ %p (−, 절댓값)
    early: Tiers; // Δ %p
    late: Tiers; // Δ %p
    watchTime: Tiers; // 프로그램 길이 대비 %
    streak: Tiers; // 분
    /** 메인 마지막 공연: 단계별 (본 날 수 하한, 판정 가능 참가일 대비 비율 하한 %) */
    mainLast: [{ days: number; rate: number }, { days: number; rate: number }, { days: number; rate: number }];
  };
  /** 같은 단계 동률일 때 쓰는 잠정 고정 순서 */
  order: { special: MetricId[]; base: MetricId[] };
}

export const DEFAULT_CONFIG: JudgeConfig = {
  validDayMinViews: 3,
  ratioMinViews: 6,
  nationality: { minUniqueArtists: 8, minCategoryArtists: 3 },
  streak: { maxGapMin: 30, minPerformances: 2 },
  meal: {
    windows: [
      { label: '점심', start: '12:00', end: '14:00' },
      { label: '저녁', start: '17:30', end: '19:30' },
    ],
    minOverlapMin: 30,
  },
  tiers: {
    repeat: [3, 4, 5],
    festivals: [3, 5, 7],
    japan: [15, 25, 35],
    foreign: [20, 30, 40],
    mainPref: [15, 25, 35],
    subPref: [15, 25, 35],
    early: [15, 25, 35],
    late: [15, 25, 35],
    watchTime: [50, 65, 80],
    streak: [240, 330, 420],
    mainLast: [
      { days: 2, rate: 60 },
      { days: 3, rate: 75 },
      { days: 4, rate: 90 },
    ],
  },
  order: {
    special: ['repeat', 'festivals', 'japan', 'foreign'],
    base: ['streak', 'subPref', 'early', 'watchTime', 'late', 'mainPref', 'mainLast'],
  },
};

/* ───────────────────────────── 출력 타입 ───────────────────────────── */

export type MetricId =
  | 'repeat'
  | 'festivals'
  | 'japan'
  | 'foreign'
  | 'mainLast'
  | 'mainPref'
  | 'subPref'
  | 'early'
  | 'late'
  | 'watchTime'
  | 'streak'
  | 'moves'
  | 'viewRate';

export type Tier = 0 | 1 | 2 | 3;

export interface MetricResult {
  id: MetricId;
  /** 내부용 중립 이름 (라벨은 별도 작업) */
  name: string;
  category: 'special' | 'base';
  /** active: 대표 선정에 사용 · diagnostic: 진단용 표시만 · disabled: 대표 선정 제외(재설계 예정) */
  mode: 'active' | 'diagnostic' | 'disabled';
  computable: boolean;
  /** 원시 수치 (단위는 unit) */
  value: number | null;
  unit: string;
  valueText: string;
  numerator: number | null;
  denominator: number | null;
  denominatorText: string;
  baseline: number | null; // 0~1 비율
  baselineText: string;
  delta: number | null; // %p
  tier: Tier;
  tierRule: string;
  excludedReason: string | null;
  note: string | null;
  estimated: boolean;
  estimateNote: string | null;
  /** 근거 한 줄 초안 (라벨·문구는 별도 작업에서 재검토) */
  evidence: string | null;
  details?: unknown;
}

export interface RepeatArtist {
  artistId: string;
  name: string;
  count: number; // (행사, 날짜) 기준
  festivals: number;
  bestStars: number;
  lastDate: string;
  occasions: { festivalId: string; festivalName: string; date: string }[];
}

export interface Segment {
  start: number;
  end: number;
  length: number; // 연결 구간 길이 (공백 포함)
  inner: number; // 구간 내 공연시간 (선택 공연 합집합, 공백 제외)
  gap: number;
  count: number;
  perfKeys: string[];
  meals: string[];
}

export interface Cluster {
  start: number;
  end: number;
  perfKeys: string[];
  stages: string[];
  /** 겹침으로 추정한 최소 이동 = 서로 다른 스테이지 수 − 1 */
  inferredMin: number;
  orderUncertain: boolean;
}

export type BoundaryType = 'confirmed-move' | 'confirmed-stay' | 'uncertain';

export interface Boundary {
  fromCluster: number;
  toCluster: number;
  type: BoundaryType;
  fromStages: string[];
  toStages: string[];
}

export interface DaySummary {
  festivalId: string;
  festivalName: string;
  date: string;
  views: number;
  validForDaily: boolean;
  programStart: number;
  programEnd: number;
  earlyEnd: number;
  lateStart: number;
  stageCount: number;
  mainStageId: string | null;
  mainLastKey: string | null;
  mainLastSeen: boolean | null;
  unionMin: number;
  segments: Segment[];
  clusters: Cluster[];
  boundaries: Boundary[];
}

export interface Representative {
  kind: 'special' | 'base' | 'statsOnly' | 'blocked';
  metricId: MetricId | null;
  tier: number;
  S: number;
  B: number;
  reason: string;
  /** 승리한 범주에서 같은 단계인 후보 전체 (고정 순서 적용 전) */
  tieCandidates: MetricId[];
  tieBrokenByOrder: boolean;
  /** 반복 관람이 대표일 때의 대표 아티스트 */
  featuredArtist: RepeatArtist | null;
}

export interface Issue {
  code: 'UNKNOWN_REF' | 'DATE_CONFLICT' | 'DUPLICATE';
  message: string;
}

export interface JudgeResult {
  version: string;
  status: 'ok' | 'blocked';
  errors: Issue[];
  warnings: Issue[];
  stats: {
    festivals: number;
    participationDays: number;
    validDays: number;
    views: number;
    uniqueArtists: number;
    /** 참가일별 선택 공연 합집합의 합 (시간표 기준) */
    unionMinutes: number;
  };
  metrics: MetricResult[];
  representative: Representative;
  repeatArtists: RepeatArtist[];
  days: DaySummary[];
}

/* ───────────────────────────── 유틸 ───────────────────────────── */

export function parseTime(t: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) throw new Error(`시간 형식 오류: ${t}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

export function fmtTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function fmtDuration(min: number): string {
  const total = Math.round(min);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}분`;
  if (m === 0) return `${h}시간`;
  return `${h}시간 ${m}분`;
}

const round6 = (x: number) => Math.round(x * 1e6) / 1e6;
const pct = (x: number) => `${(Math.round(x * 1000) / 10).toFixed(1)}%`;
const pp = (x: number) => `${x >= 0 ? '+' : ''}${(Math.round(x * 10) / 10).toFixed(1)}%p`;

/** value가 단계 하한 이상이면 그 단계 (하한 포함) */
export function tierFrom(value: number, t: Tiers): Tier {
  const v = round6(value);
  if (v >= t[2]) return 3;
  if (v >= t[1]) return 2;
  if (v >= t[0]) return 1;
  return 0;
}

type Interval = [number, number];

export function unionIntervals(list: Interval[]): Interval[] {
  const sorted = list.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const out: Interval[] = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

export const unionLength = (list: Interval[]) => unionIntervals(list).reduce((s, [a, b]) => s + (b - a), 0);

function overlapLength(list: Interval[], win: Interval): number {
  return unionIntervals(list).reduce((s, [a, b]) => s + Math.max(0, Math.min(b, win[1]) - Math.max(a, win[0])), 0);
}

/* ───────────────────────────── 내부 해석 구조 ───────────────────────────── */

interface RPerf {
  key: string;
  festivalId: string;
  festivalName: string;
  date: string;
  id: string;
  artist: Artist;
  stageId: string;
  stageName: string;
  isMain: boolean;
  start: number;
  end: number;
  mid: number;
}

interface View extends RPerf {
  best: boolean;
}

interface RDay {
  festival: Festival;
  date: string;
  perfs: RPerf[];
  views: View[];
  programStart: number;
  programEnd: number;
  earlyEnd: number;
  lateStart: number;
  stageIds: string[];
  mainStageId: string | null;
  mainLast: RPerf | null;
}

const perfKey = (festivalId: string, date: string, perfId: string) => `${festivalId}|${date}|${perfId}`;

function resolveDay(catalog: Catalog, festival: Festival, day: FestivalDay): RDay {
  const stageById = new Map(festival.stages.map((s) => [s.id, s]));
  const perfs: RPerf[] = day.performances.map((p) => {
    let start = parseTime(p.start);
    let end = parseTime(p.end);
    if (end <= start) end += 24 * 60;
    const stage = stageById.get(p.stageId);
    const artist: Artist = catalog.artists[p.artistId] ?? { id: p.artistId, name: p.artistId, country: 'UNKNOWN' };
    return {
      key: perfKey(festival.id, day.date, p.id),
      festivalId: festival.id,
      festivalName: festival.name,
      date: day.date,
      id: p.id,
      artist,
      stageId: p.stageId,
      stageName: stage?.name ?? p.stageId,
      isMain: !!stage?.isMain,
      start,
      end,
      mid: (start + end) / 2,
    };
  });
  const programStart = Math.min(...perfs.map((p) => p.start));
  const programEnd = Math.max(...perfs.map((p) => p.end));
  const L = programEnd - programStart;
  const stageIds = [...new Set(perfs.map((p) => p.stageId))];
  const main = festival.stages.find((s) => s.isMain);
  const mainPerfs = main ? perfs.filter((p) => p.stageId === main.id) : [];
  const mainLast = mainPerfs.length
    ? mainPerfs.reduce((a, b) => (b.start > a.start || (b.start === a.start && b.end > a.end) ? b : a))
    : null;
  return {
    festival,
    date: day.date,
    perfs,
    views: [],
    programStart,
    programEnd,
    earlyEnd: programStart + L / 3,
    lateStart: programStart + (2 * L) / 3,
    stageIds,
    mainStageId: main && mainPerfs.length ? main.id : null,
    mainLast,
  };
}

/** 시간대 구분: 공연 중간 시각이 속한 구간 (앞 1/3 미만 = 초반, 뒤 1/3 이상 = 후반) */
const isEarly = (d: RDay, p: RPerf) => p.mid < d.earlyEnd;
const isLate = (d: RDay, p: RPerf) => p.mid >= d.lateStart;

/* ───────────────────────────── 검증 ───────────────────────────── */

export function validateRecord(catalog: Catalog, record: UserRecord): { errors: Issue[]; warnings: Issue[] } {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const seen = new Set<string>();
  const festByDate = new Map<string, Set<string>>();
  for (const s of record.selections) {
    const f = catalog.festivals.find((x) => x.id === s.festivalId);
    const d = f?.days.find((x) => x.date === s.date);
    const p = d?.performances.find((x) => x.id === s.performanceId);
    if (!f || !d || !p) {
      errors.push({ code: 'UNKNOWN_REF', message: `수록 데이터에 없는 선택: ${s.festivalId} ${s.date} ${s.performanceId}` });
      continue;
    }
    const k = perfKey(s.festivalId, s.date, s.performanceId);
    if (seen.has(k)) warnings.push({ code: 'DUPLICATE', message: `같은 공연 중복 선택(1회로 처리): ${k}` });
    seen.add(k);
    if (!festByDate.has(s.date)) festByDate.set(s.date, new Set());
    festByDate.get(s.date)!.add(s.festivalId);
  }
  for (const [date, fests] of festByDate) {
    if (fests.size > 1) {
      const names = [...fests].map((id) => catalog.festivals.find((f) => f.id === id)?.name ?? id);
      errors.push({
        code: 'DATE_CONFLICT',
        message: `${date}에 ${names.map((n) => `'${n}'`).join(', ')}이(가) 함께 선택됨 — 현재 입력 정책상 하루에는 페스티벌 하나만 입력할 수 있어요`,
      });
    }
  }
  return { errors, warnings };
}

/* ───────────────────────────── 메인 판정 ───────────────────────────── */

const NAMES: Record<MetricId, string> = {
  repeat: '반복 관람',
  festivals: '활동량',
  japan: '일본 선호',
  foreign: '해외 선호',
  mainLast: '메인 마지막 공연 관람',
  mainPref: '메인 선호',
  subPref: '서브 선호',
  early: '초반 관람',
  late: '후반 관람',
  watchTime: '관람시간',
  streak: '연속 관람',
  moves: '무대 이동',
  viewRate: '관람률',
};

function blank(id: MetricId, category: 'special' | 'base', mode: MetricResult['mode'] = 'active'): MetricResult {
  return {
    id,
    name: NAMES[id],
    category,
    mode,
    computable: true,
    value: null,
    unit: '',
    valueText: '—',
    numerator: null,
    denominator: null,
    denominatorText: '—',
    baseline: null,
    baselineText: '—',
    delta: null,
    tier: 0,
    tierRule: '',
    excludedReason: null,
    note: null,
    estimated: false,
    estimateNote: null,
    evidence: null,
  };
}

const exclude = (m: MetricResult, reason: string): MetricResult => ({ ...m, computable: false, tier: 0, excludedReason: reason });

export function judge(catalog: Catalog, record: UserRecord, config: JudgeConfig = DEFAULT_CONFIG): JudgeResult {
  const { errors, warnings } = validateRecord(catalog, record);
  const emptyStats = { festivals: 0, participationDays: 0, validDays: 0, views: 0, uniqueArtists: 0, unionMinutes: 0 };
  if (errors.length) {
    return {
      version: VERSION,
      status: 'blocked',
      errors,
      warnings,
      stats: emptyStats,
      metrics: [],
      representative: {
        kind: 'blocked',
        metricId: null,
        tier: 0,
        S: 0,
        B: 0,
        reason: '입력 단계에서 막히는 기록이라 판정하지 않음',
        tieCandidates: [],
        tieBrokenByOrder: false,
        featuredArtist: null,
      },
      repeatArtists: [],
      days: [],
    };
  }

  /* 1. 참가일 구성 */
  const bestByKey = new Map<string, boolean>();
  for (const s of record.selections) {
    const k = perfKey(s.festivalId, s.date, s.performanceId);
    bestByKey.set(k, (bestByKey.get(k) ?? false) || !!s.best);
  }
  const days: RDay[] = [];
  for (const f of catalog.festivals) {
    for (const d of f.days) {
      const keys = d.performances.map((p) => perfKey(f.id, d.date, p.id)).filter((k) => bestByKey.has(k));
      if (!keys.length) continue;
      const rd = resolveDay(catalog, f, d);
      rd.views = rd.perfs.filter((p) => bestByKey.has(p.key)).map((p) => ({ ...p, best: bestByKey.get(p.key)! }));
      days.push(rd);
    }
  }
  days.sort((a, b) => a.date.localeCompare(b.date) || a.festival.id.localeCompare(b.festival.id));
  const views = days.flatMap((d) => d.views);
  const validDays = days.filter((d) => d.views.length >= config.validDayMinViews);

  const stats = {
    festivals: new Set(days.map((d) => d.festival.id)).size,
    participationDays: days.length,
    validDays: validDays.length,
    views: views.length,
    uniqueArtists: new Set(views.map((v) => v.artist.id)).size,
    unionMinutes: days.reduce((s, d) => s + unionLength(d.views.map((v) => [v.start, v.end] as Interval)), 0),
  };

  const T = config.tiers;
  const metrics: MetricResult[] = [];

  /* 2. 반복 관람 */
  const byArtist = new Map<string, { a: Artist; occ: Map<string, { festivalId: string; festivalName: string; date: string; best: boolean }> }>();
  for (const v of views) {
    if (!byArtist.has(v.artist.id)) byArtist.set(v.artist.id, { a: v.artist, occ: new Map() });
    const occKey = `${v.festivalId}|${v.date}`;
    const occ = byArtist.get(v.artist.id)!.occ;
    const prev = occ.get(occKey);
    occ.set(occKey, { festivalId: v.festivalId, festivalName: v.festivalName, date: v.date, best: (prev?.best ?? false) || v.best });
  }
  const repeatArtists: RepeatArtist[] = [...byArtist.values()]
    .map(({ a, occ }) => {
      const list = [...occ.values()].sort((x, y) => x.date.localeCompare(y.date));
      return {
        artistId: a.id,
        name: a.shortName ?? a.name,
        count: list.length,
        festivals: new Set(list.map((o) => o.festivalId)).size,
        bestStars: list.filter((o) => o.best).length,
        lastDate: list[list.length - 1].date,
        occasions: list.map(({ festivalId, festivalName, date }) => ({ festivalId, festivalName, date })),
      };
    })
    .filter((r) => r.count >= 2)
    .sort(
      (x, y) =>
        y.count - x.count ||
        y.festivals - x.festivals ||
        y.bestStars - x.bestStars ||
        y.lastDate.localeCompare(x.lastDate) ||
        x.name.localeCompare(y.name, 'ko'),
    );
  {
    const m = blank('repeat', 'special');
    const top = repeatArtists[0];
    m.unit = '번';
    m.value = top ? top.count : views.length ? 1 : 0;
    m.valueText = top ? `${top.name} ${top.count}번` : '2번 이상 본 아티스트 없음';
    m.denominatorText = '아티스트별 서로 다른 공연 수 (행사·날짜 중복 제거)';
    m.tier = tierFrom(m.value, T.repeat);
    m.tierRule = `≥ ${T.repeat.join(' / ')}번`;
    m.note = repeatArtists.length ? `2번 이상 본 아티스트 ${repeatArtists.length}팀 (상세 화면: 상위 3팀 + 펼치기)` : null;
    m.evidence = top ? `${top.name}, 올해 ${top.count}번 만났어요` : null;
    m.details = { top3: repeatArtists.slice(0, 3), rest: repeatArtists.slice(3) };
    metrics.push(m);
  }

  /* 3. 활동량 */
  {
    const m = blank('festivals', 'special');
    m.unit = '곳';
    m.value = stats.festivals;
    m.valueText = `${stats.festivals}곳`;
    m.denominatorText = '선택 기록이 있는 페스티벌 수';
    m.tier = tierFrom(m.value, T.festivals);
    m.tierRule = `≥ ${T.festivals.join(' / ')}곳`;
    m.evidence = `올해 페스티벌 ${stats.festivals}곳을 다녔어요`;
    metrics.push(m);
  }

  /* 4. 국적 선호 (일본 / 일본 포함 해외 전체) — 공연 관람 횟수 기준 */
  const natMetric = (id: 'japan' | 'foreign', inCat: (c: Country) => boolean, label: string, tiers: Tiers) => {
    let m = blank(id, 'special');
    let n = 0;
    let k = 0;
    let bw = 0;
    const perDay: { date: string; festival: string; n: number; k: number; b: number }[] = [];
    for (const d of days) {
      const known = d.views.filter((v) => v.artist.country !== 'UNKNOWN');
      if (!known.length) continue;
      const lineupKnown = d.perfs.filter((p) => p.artist.country !== 'UNKNOWN');
      const bd = lineupKnown.filter((p) => inCat(p.artist.country)).length / lineupKnown.length;
      const kd = known.filter((v) => inCat(v.artist.country)).length;
      n += known.length;
      k += kd;
      bw += known.length * bd;
      perDay.push({ date: d.date, festival: d.festival.name, n: known.length, k: kd, b: bd });
    }
    const known = views.filter((v) => v.artist.country !== 'UNKNOWN');
    const uniq = new Set(known.map((v) => v.artist.id)).size;
    const uniqCat = new Set(known.filter((v) => inCat(v.artist.country)).map((v) => v.artist.id)).size;
    const unknownViews = views.length - known.length;
    m.unit = '%p';
    m.numerator = k;
    m.denominator = n;
    m.denominatorText = `국적이 확인된 관람 ${n}개${unknownViews ? ` (국적 미상 ${unknownViews}개 제외)` : ''}`;
    m.tierRule = `Δ ≥ +${tiers.join(' / +')}%p · 최소 고유 ${config.nationality.minUniqueArtists}팀, ${label} ${config.nationality.minCategoryArtists}팀`;
    m.details = { perDay, uniqueArtists: uniq, uniqueCategoryArtists: uniqCat };
    if (n === 0) return exclude(m, '국적이 확인된 관람 없음');
    const r = k / n;
    const b = bw / n;
    m.baseline = b;
    m.baselineText = `${pct(b)} (참가일 라인업 비율을 그날 관람 수로 가중평균)`;
    m.delta = round6((r - b) * 100);
    m.value = m.delta;
    m.valueText = `관람 비율 ${pct(r)} (${k}/${n})`;
    m.evidence = `본 무대 ${n}개 중 ${k}개가 ${label} 아티스트 공연이었어요`;
    if (uniq < config.nationality.minUniqueArtists)
      m = exclude(m, `고유 아티스트 ${uniq}팀 < ${config.nationality.minUniqueArtists}팀`);
    else if (uniqCat < config.nationality.minCategoryArtists)
      m = exclude(m, `${label} 고유 아티스트 ${uniqCat}팀 < ${config.nationality.minCategoryArtists}팀`);
    else m.tier = m.delta > 0 ? tierFrom(m.delta, tiers) : 0;
    return m;
  };
  metrics.push(natMetric('japan', (c) => c === 'JP', '일본', T.japan));
  metrics.push(natMetric('foreign', (c) => c === 'JP' || c === 'OTHER', '해외', T.foreign));

  /* 5. 연속 관람 — 연결 구간 길이(공백 포함)와 구간 내 공연시간(공백 제외)을 따로 저장 */
  const segmentsByDay = new Map<RDay, Segment[]>();
  const mealWins = config.meal.windows.map((w) => ({ label: w.label, win: [parseTime(w.start), parseTime(w.end)] as Interval }));
  for (const d of days) {
    const sorted = [...d.views].sort((a, b) => a.start - b.start || a.end - b.end);
    const segs: { start: number; end: number; items: View[] }[] = [];
    for (const v of sorted) {
      const cur = segs[segs.length - 1];
      if (cur && v.start <= cur.end + config.streak.maxGapMin) {
        cur.end = Math.max(cur.end, v.end);
        cur.items.push(v);
      } else segs.push({ start: v.start, end: v.end, items: [v] });
    }
    segmentsByDay.set(
      d,
      segs.map((s) => {
        const iv = s.items.map((v) => [v.start, v.end] as Interval);
        const inner = unionLength(iv);
        const meals = mealWins.filter((w) => overlapLength(iv, w.win) >= config.meal.minOverlapMin).map((w) => w.label);
        return {
          start: s.start,
          end: s.end,
          length: s.end - s.start,
          inner,
          gap: s.end - s.start - inner,
          count: s.items.length,
          perfKeys: s.items.map((v) => v.key),
          meals,
        };
      }),
    );
  }
  {
    let m = blank('streak', 'base');
    m.unit = '분';
    m.estimated = true;
    m.estimateNote = '선택한 공연 시간표 기준. 연결 구간은 공백(≤30분)을 포함하며 실제 입·퇴장 시각이 아님';
    m.denominatorText = `참가일 전체 중 가장 긴 연결 구간 (공백 ≤ ${config.streak.maxGapMin}분, 공연 ${config.streak.minPerformances}개 이상)`;
    m.tierRule = `연결 구간 ≥ ${T.streak.map(fmtDuration).join(' / ')}`;
    let best: { d: RDay; s: Segment } | null = null;
    for (const d of days)
      for (const s of segmentsByDay.get(d)!) {
        if (s.count < config.streak.minPerformances) continue;
        if (!best || s.length > best.s.length || (s.length === best.s.length && s.inner > best.s.inner)) best = { d, s };
      }
    if (!best) m = exclude(m, `공연 ${config.streak.minPerformances}개 이상이 이어진 구간 없음`);
    else {
      const { d, s } = best;
      m.value = s.length;
      m.valueText = `${fmtDuration(s.length)} (${d.date} ${fmtTime(s.start)}~${fmtTime(s.end)})`;
      m.note = `구간 내 공연시간 ${fmtDuration(s.inner)} · 공백 합계 ${fmtDuration(s.gap)} · 공연 ${s.count}개`;
      m.tier = tierFrom(s.length, T.streak);
      m.evidence = s.meals.length
        ? `${s.meals.join('·')} 시간대에도 공연을 봤어요 · 최장 ${fmtDuration(s.length)} 구간 (공백 포함)`
        : `최장 ${fmtDuration(s.length)} 구간에서 공연을 이어 봤어요 (공백 포함)`;
      m.details = { date: d.date, festival: d.festival.name, segment: s };
    }
    metrics.push(m);
  }

  /* 6. 메인/서브 선호 — 스테이지가 2개 이상인 참가일만, 공연 관람 횟수 기준 */
  {
    const eligible = days.filter((d) => d.mainStageId && d.stageIds.length >= 2);
    let n = 0;
    let k = 0;
    let bw = 0;
    for (const d of eligible) {
      const bd = d.perfs.filter((p) => p.stageId === d.mainStageId).length / d.perfs.length;
      n += d.views.length;
      k += d.views.filter((v) => v.stageId === d.mainStageId).length;
      bw += d.views.length * bd;
    }
    const skipped = days.length - eligible.length;
    const build = (id: 'mainPref' | 'subPref') => {
      let m = blank(id, 'base');
      m.unit = '%p';
      m.numerator = id === 'mainPref' ? k : n - k;
      m.denominator = n;
      m.denominatorText = `스테이지 2개 이상인 참가일의 관람 ${n}개${skipped ? ` (단일 스테이지 참가일 ${skipped}일 제외)` : ''}`;
      const tiers = id === 'mainPref' ? T.mainPref : T.subPref;
      m.tierRule = `Δ ${id === 'mainPref' ? '≥ +' : '≤ −'}${tiers.join(id === 'mainPref' ? ' / +' : ' / −')}%p · 관람 ${config.ratioMinViews}개 이상`;
      if (n === 0) return exclude(m, '스테이지 2개 이상인 참가일 없음');
      const r = k / n;
      const b = bw / n;
      m.baseline = b;
      m.baselineText = `메인 ${pct(b)} (관람 수 가중)`;
      m.delta = round6((r - b) * 100);
      m.value = m.delta;
      m.valueText = id === 'mainPref' ? `메인 ${pct(r)} (${k}/${n})` : `서브 ${pct(1 - r)} (${n - k}/${n})`;
      m.evidence =
        id === 'mainPref'
          ? `본 무대 ${n}개 중 ${k}개가 메인 스테이지 공연이었어요`
          : `본 무대 ${n}개 중 ${n - k}개가 서브 스테이지 공연이었어요`;
      if (n < config.ratioMinViews) m = exclude(m, `해당 관람 ${n}개 < ${config.ratioMinViews}개`);
      else if (id === 'mainPref') m.tier = m.delta > 0 ? tierFrom(m.delta, tiers) : 0;
      else m.tier = m.delta < 0 ? tierFrom(-m.delta, tiers) : 0;
      return m;
    };
    metrics.push(build('mainPref'), build('subPref'));
  }

  /* 7. 초반/후반 관람 — 그날 첫 공연 시작~마지막 공연 종료를 3등분, 공연 중간 시각으로 배정 */
  {
    let n = 0;
    let kE = 0;
    let kL = 0;
    let bE = 0;
    let bL = 0;
    for (const d of days) {
      const nd = d.views.length;
      n += nd;
      kE += d.views.filter((v) => isEarly(d, v)).length;
      kL += d.views.filter((v) => isLate(d, v)).length;
      bE += (nd * d.perfs.filter((p) => isEarly(d, p)).length) / d.perfs.length;
      bL += (nd * d.perfs.filter((p) => isLate(d, p)).length) / d.perfs.length;
    }
    const windows = days.map((d) => `${d.date} 초반 ~${fmtTime(d.earlyEnd)} · 후반 ${fmtTime(d.lateStart)}~`);
    const build = (id: 'early' | 'late') => {
      let m = blank(id, 'base');
      const k = id === 'early' ? kE : kL;
      const bw = id === 'early' ? bE : bL;
      const tiers = id === 'early' ? T.early : T.late;
      m.unit = '%p';
      m.numerator = k;
      m.denominator = n;
      m.denominatorText = `관람 ${n}개`;
      m.tierRule = `Δ ≥ +${tiers.join(' / +')}%p · 관람 ${config.ratioMinViews}개 이상`;
      m.details = { windows };
      if (n === 0) return exclude(m, '관람 없음');
      const r = k / n;
      const b = bw / n;
      m.baseline = b;
      m.baselineText = `${pct(b)} (관람 수 가중)`;
      m.delta = round6((r - b) * 100);
      m.value = m.delta;
      m.valueText = `${id === 'early' ? '초반' : '후반'} ${pct(r)} (${k}/${n})`;
      m.evidence = `본 무대 ${n}개 중 ${k}개가 ${id === 'early' ? '이른' : '늦은'} 시간대 공연이었어요`;
      if (n < config.ratioMinViews) m = exclude(m, `관람 ${n}개 < ${config.ratioMinViews}개`);
      else m.tier = m.delta > 0 ? tierFrom(m.delta, tiers) : 0;
      return m;
    };
    metrics.push(build('early'), build('late'));
  }

  /* 8. 관람시간 — 관람 3개 이상인 참가일의 (선택 공연 합집합 ÷ 그날 프로그램 길이) 평균 */
  {
    let m = blank('watchTime', 'base');
    m.unit = '%';
    m.estimated = true;
    m.estimateNote = '선택한 공연 시간표 기준. 겹친 공연은 합집합으로 계산(중복 합산 없음). 실제 관람 시각 아님';
    m.denominatorText = `관람 ${config.validDayMinViews}개 이상인 참가일 ${validDays.length}일`;
    m.tierRule = `프로그램 대비 ≥ ${T.watchTime.join(' / ')}%`;
    if (!validDays.length) m = exclude(m, `관람 ${config.validDayMinViews}개 이상인 참가일 없음`);
    else {
      const per = validDays.map((d) => {
        const u = unionLength(d.views.map((v) => [v.start, v.end] as Interval));
        return { date: d.date, union: u, program: d.programEnd - d.programStart, share: u / (d.programEnd - d.programStart) };
      });
      const share = per.reduce((s, x) => s + x.share, 0) / per.length;
      const avgMin = per.reduce((s, x) => s + x.union, 0) / per.length;
      m.value = round6(share * 100);
      m.valueText = `${pct(share)} · 하루 평균 ${fmtDuration(avgMin)}`;
      m.tier = tierFrom(m.value, T.watchTime);
      m.evidence = `선택한 공연 시간표 기준 하루 평균 ${fmtDuration(avgMin)}이었어요`;
      m.details = { perDay: per };
    }
    metrics.push(m);
  }

  /* 9. 메인 마지막 공연 관람 — 공식 헤드라이너와 다를 수 있음 */
  {
    let m = blank('mainLast', 'base');
    const judgeable = days.filter((d) => d.mainLast);
    const seen = judgeable.filter((d) => d.views.some((v) => v.key === d.mainLast!.key));
    const k = seen.length;
    const n = judgeable.length;
    const ml = T.mainLast;
    m.unit = '일';
    m.numerator = k;
    m.denominator = n;
    m.denominatorText = `판정 가능한 참가일 ${n}일 (메인 스테이지 마지막 공연이 특정되는 날)`;
    m.tierRule = ml.map((t, i) => `${i + 1}단계 ${t.days}일↑·${t.rate}%↑`).join(' / ');
    if (!n) m = exclude(m, '메인 스테이지가 특정되는 참가일 없음');
    else {
      const rate = (k / n) * 100;
      m.value = k;
      m.valueText = `${k}일 / ${n}일 (${pct(k / n)})`;
      let tier: Tier = 0;
      ml.forEach((t, i) => {
        if (k >= t.days && round6(rate) >= t.rate) tier = (i + 1) as Tier;
      });
      m.tier = tier;
      if (k < ml[0].days) m.note = `본 날 ${k}일 < ${ml[0].days}일 (표본 조건: 하루 관람으로는 단계 없음)`;
      m.evidence = k ? `메인 스테이지 마지막 공연을 ${n}일 중 ${k}일 봤어요` : null;
      m.details = { perDay: judgeable.map((d) => ({ date: d.date, last: `${d.mainLast!.artist.name} ${fmtTime(d.mainLast!.start)}`, seen: seen.includes(d) })) };
    }
    metrics.push(m);
  }

  /* 10. 무대 이동 — 진단용. 겹침 클러스터·경계로 확정/추정/불확정을 구분 */
  const clustersByDay = new Map<RDay, { clusters: Cluster[]; boundaries: Boundary[] }>();
  {
    const m = blank('moves', 'base', 'diagnostic');
    let orderedPairs = 0;
    let orderedMoves = 0;
    let overlapMin = 0;
    let uncertainBoundaries = 0;
    let uncertainClusters = 0;
    let daysCounted = 0;
    for (const d of days) {
      const sorted = [...d.views].sort((a, b) => a.start - b.start || a.end - b.end);
      const raw: { start: number; end: number; items: View[] }[] = [];
      for (const v of sorted) {
        const cur = raw[raw.length - 1];
        if (cur && v.start < cur.end) {
          cur.end = Math.max(cur.end, v.end);
          cur.items.push(v);
        } else raw.push({ start: v.start, end: v.end, items: [v] });
      }
      const clusters: Cluster[] = raw.map((c) => {
        const stages = [...new Set(c.items.map((v) => v.stageId))];
        return {
          start: c.start,
          end: c.end,
          perfKeys: c.items.map((v) => v.key),
          stages,
          inferredMin: stages.length - 1,
          orderUncertain: c.items.length >= 2,
        };
      });
      const boundaries: Boundary[] = [];
      for (let i = 0; i + 1 < clusters.length; i++) {
        const P = clusters[i];
        const Q = clusters[i + 1];
        let type: BoundaryType;
        if (P.stages.length === 1 && Q.stages.length === 1) type = P.stages[0] === Q.stages[0] ? 'confirmed-stay' : 'confirmed-move';
        else if (!P.stages.some((s) => Q.stages.includes(s))) type = 'confirmed-move';
        else type = 'uncertain';
        boundaries.push({ fromCluster: i, toCluster: i + 1, type, fromStages: P.stages, toStages: Q.stages });
      }
      clustersByDay.set(d, { clusters, boundaries });
      if (d.views.length < 2 || d.stageIds.length < 2) continue;
      daysCounted++;
      for (const b of boundaries) {
        if (b.type === 'uncertain') uncertainBoundaries++;
        else {
          orderedPairs++;
          if (b.type === 'confirmed-move') orderedMoves++;
        }
      }
      for (const c of clusters) {
        overlapMin += c.inferredMin;
        if (c.orderUncertain) uncertainClusters++;
      }
    }
    m.unit = '회';
    m.estimated = true;
    m.estimateNote = '선택 기록 기반 추정. 시작 시각순 정렬을 실제 동선으로 보지 않음. 정확한 이동 시각·방향·왕복 횟수는 알 수 없음';
    m.tierRule = '진단용 — 결과 확인 후 대표 선정 포함 여부 결정';
    if (!daysCounted) {
      Object.assign(m, exclude(m, '관람 2개 이상·스테이지 2개 이상인 참가일 없음'));
      m.mode = 'diagnostic';
    } else {
      m.value = orderedMoves + overlapMin;
      m.numerator = orderedMoves;
      m.denominator = orderedPairs;
      m.denominatorText = `순서가 분명한 관람 쌍 ${orderedPairs}개`;
      m.valueText = `최소 ${orderedMoves + overlapMin}회 (확정 ${orderedMoves} + 겹침 추정 ${overlapMin})`;
      m.note = `순서 확정 이동률 ${orderedPairs ? pct(orderedMoves / orderedPairs) : '—'} (관람 쌍 가중) · 불확정 경계 ${uncertainBoundaries}곳 · 순서 불확정 겹침 묶음 ${uncertainClusters}개`;
      m.evidence = `하루 평균 최소 ${(Math.round(((orderedMoves + overlapMin) / daysCounted) * 10) / 10).toFixed(1)}번 스테이지를 옮긴 것으로 추정돼요`;
      m.details = { orderedPairs, orderedMoves, overlapMin, uncertainBoundaries, uncertainClusters, daysCounted };
    }
    metrics.push(m);
  }

  /* 11. 관람률 — 대표 선정 제외, 재설계 예정 */
  {
    const m = blank('viewRate', 'base', 'disabled');
    m.computable = false;
    m.excludedReason = '일부 관람을 인정하는 입력과 "겹치지 않게 볼 수 있는 최대 공연 수" 분모가 맞지 않아 재설계 예정';
    m.tierRule = '대표 선정 제외';
    metrics.push(m);
  }

  /* 12. 표시 순서 정렬: 특별(고정 순서) → 기본(고정 순서) → 진단 → 제외 */
  const orderIdx = (id: MetricId) => {
    const s = config.order.special.indexOf(id);
    if (s >= 0) return s;
    const b = config.order.base.indexOf(id);
    if (b >= 0) return 10 + b;
    return id === 'moves' ? 50 : 60;
  };
  metrics.sort((a, b) => orderIdx(a.id) - orderIdx(b.id));

  /* 13. 대표 선정 */
  const active = metrics.filter((m) => m.mode === 'active' && m.computable);
  const specials = active.filter((m) => m.category === 'special');
  const bases = active.filter((m) => m.category === 'base');
  const S = Math.max(0, ...specials.map((m) => m.tier));
  const B = Math.max(0, ...bases.map((m) => m.tier));
  const pick = (list: MetricResult[], tier: number, order: MetricId[]) => {
    const cands = list.filter((m) => m.tier === tier).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    return { winner: cands[0], cands: cands.map((m) => m.id) };
  };
  let representative: Representative;
  if (B >= S + 1) {
    const { winner, cands } = pick(bases, B, config.order.base);
    representative = {
      kind: 'base',
      metricId: winner.id,
      tier: B,
      S,
      B,
      reason:
        S === 0
          ? `특별 칭호 없음(0단계) → 기본 칭호 최고 ${B}단계를 대표로`
          : `기본 칭호 최고 ${B}단계 ≥ 특별 칭호 최고 ${S}단계 + 1 → 기본 칭호를 대표로`,
      tieCandidates: cands,
      tieBrokenByOrder: cands.length > 1,
      featuredArtist: null,
    };
  } else if (S >= 1) {
    const { winner, cands } = pick(specials, S, config.order.special);
    representative = {
      kind: 'special',
      metricId: winner.id,
      tier: S,
      S,
      B,
      reason:
        S > B
          ? `특별 칭호 최고 ${S}단계 > 기본 칭호 최고 ${B}단계 → 특별 칭호를 대표로`
          : `특별·기본 칭호 모두 최고 ${S}단계 → 같은 단계면 특별 칭호 우선`,
      tieCandidates: cands,
      tieBrokenByOrder: cands.length > 1,
      featuredArtist: winner.id === 'repeat' ? repeatArtists[0] ?? null : null,
    };
  } else {
    representative = {
      kind: 'statsOnly',
      metricId: null,
      tier: 0,
      S,
      B,
      reason: '1단계 이상인 칭호가 없음 → 성향 없이 통계 카드만 제공',
      tieCandidates: [],
      tieBrokenByOrder: false,
      featuredArtist: null,
    };
  }
  if (representative.tieBrokenByOrder) {
    const n = representative.tieCandidates.map((id) => NAMES[id]).join(', ');
    representative.reason += ` · 같은 단계 후보 ${representative.tieCandidates.length}개(${n}) → 잠정 고정 순서로 '${NAMES[representative.metricId!]}'`;
  }

  /* 14. 참가일 요약 */
  const daySummaries: DaySummary[] = days.map((d) => {
    const cb = clustersByDay.get(d)!;
    return {
      festivalId: d.festival.id,
      festivalName: d.festival.name,
      date: d.date,
      views: d.views.length,
      validForDaily: d.views.length >= config.validDayMinViews,
      programStart: d.programStart,
      programEnd: d.programEnd,
      earlyEnd: d.earlyEnd,
      lateStart: d.lateStart,
      stageCount: d.stageIds.length,
      mainStageId: d.mainStageId,
      mainLastKey: d.mainLast?.key ?? null,
      mainLastSeen: d.mainLast ? d.views.some((v) => v.key === d.mainLast!.key) : null,
      unionMin: unionLength(d.views.map((v) => [v.start, v.end] as Interval)),
      segments: segmentsByDay.get(d)!,
      clusters: cb.clusters,
      boundaries: cb.boundaries,
    };
  });

  return { version: VERSION, status: 'ok', errors, warnings, stats, metrics, representative, repeatArtists, days: daySummaries };
}

export const METRIC_NAMES = NAMES;
