/**
 * 그민페 칭호 매핑 (MIN-306) — 판정 모듈 결과 위에서 그민페용 대표 칭호 하나를 고르는 순수 함수
 *
 * 판정 모듈(packages/judge)은 고치지 않고, 그 결과(metrics·days)에 그민페 전용 조건만 덧씌운다.
 *  - resident(올림픽공원 거주민)는 판정 모듈에 없는 특별 칭호로, 충족하면 최우선
 *  - subPref는 추가 조건을 통과해야 후보가 되고, 한 스테이지에 몰렸으면 oneStage로 바꿔 노출
 *  - 판정 모듈의 특별 칭호(repeat·festivals·japan·foreign)와 moves·viewRate는 쓰지 않는다
 *  - 같은 단계면 그민페 전용 순서(GMF_TITLE_ORDER)로 고른다
 * 라벨·근거 문구는 MIN-314에서 다시 정할 수 있게 상수로 모아 둔다.
 */
import { DEFAULT_CONFIG, fmtDuration, fmtTime, parseTime, unionIntervals } from '../../packages/judge/src/judge';
import type { Catalog, Festival, JudgeResult, MetricId, MetricResult, Segment, UserRecord } from '../../packages/judge/src/judge';

export type TitleId = 'resident' | 'mainPref' | 'subPref' | 'oneStage' | 'early' | 'late' | 'watchTime' | 'streak' | 'headliner' | 'rookie';

export interface TitleItem {
  id: TitleId;
  label: string;
  evidence: string;
}

export interface TitleResult {
  id: TitleId;
  label: string;
  /** 근거 한 줄 (26자 이하, 해요체) */
  evidence: string;
  /** 보조 줄 (streak의 공연 이름 등) */
  subline: string | null;
  /** 대표 선정에 쓴 단계 (resident는 3, rookie는 0) */
  tier: number;
  /** 대표 외에 조건을 충족한 칭호 (카드엔 개수만) */
  others: TitleId[];
  /** 획득한 칭호 전부 (대표 먼저, 결과 2페이지 목록용) */
  list: TitleItem[];
}

/** 라벨 — 공동 후보 중 첫 번째. 교체는 여기서만 */
export const TITLE_LABELS: Record<TitleId, string> = {
  resident: '올림픽공원 거주민',
  mainPref: '메인스테이지 지박령',
  subPref: '메인스테이지는 거부한다',
  oneStage: '한 무대 지박령',
  early: '선크림 덧바르는 중',
  late: '해 지고 출근',
  watchTime: '고막 초과근무',
  streak: '화장실은 언제 가요?',
  headliner: '헤드라이너 절대 사수',
  rookie: '그민페 신생아',
};

/** 성향색 — 칭호 글자·카드 빛번짐 (MIN-316) */
export const TITLE_COLORS: Record<TitleId, string> = {
  resident: '#84C030',
  mainPref: '#00C89D',
  subPref: '#FF7A93',
  oneStage: '#FF8432',
  early: '#D0A500',
  late: '#60B0FF',
  watchTime: '#00C0D7',
  streak: '#E87CE0',
  headliner: '#AA99FF',
  rookie: '#F2EBDD',
};

export const STAGE_SHORT: Record<string, string> = {
  'mint-breeze': 'MBS',
  'club-midnight-sunset': 'CMS',
  'loving-forest-garden': 'LFG',
};

/** 그민페 전용 추가 조건 (판정 모듈 결과 위에서만 거른다) */
export const TITLE_RULES = {
  resident: { minShare: 0.9, minViewsPerDay: 5, maxGapMin: 120 },
  subPref: { minTier: 2, maxMainShare: 0.2, minViews: 6 },
  oneStage: { minShare: 0.7, minDeltaPp: 35 },
};

/**
 * 같은 단계일 때 대표를 고르는 그민페 전용 순서 (판정 모듈 DEFAULT_CONFIG.order.base와 별개).
 * oneStage·subPref는 한 사람에게 둘 중 하나만 나오므로 같은 자리. resident는 이 순서와 무관하게 최우선
 */
export const GMF_TITLE_ORDER: TitleId[] = ['oneStage', 'subPref', 'mainPref', 'early', 'late', 'streak', 'watchTime', 'headliner'];

export const EVIDENCE_MAX = 26;

/** 대표 후보가 되는 판정 모듈 지표 */
const BASE_IDS: MetricId[] = ['mainPref', 'subPref', 'early', 'late', 'watchTime', 'streak', 'headliner'];

const EPS = 1e-9;

function festivalOf(catalog: Catalog, record: UserRecord): Festival | null {
  const id = record.selections[0]?.festivalId;
  return catalog.festivals.find((f) => f.id === id) ?? null;
}

/** 공연 시각(분). 자정을 넘기면 +24h */
function span(p: { start: string; end: string }): [number, number] {
  const start = parseTime(p.start);
  let end = parseTime(p.end);
  if (end <= start) end += 24 * 60;
  return [start, end];
}

/** 날짜별 선택 공연 (catalog에 있는 것만, 중복 제거) */
function viewsByDate(f: Festival, record: UserRecord) {
  const out = new Map<string, { id: string; stageId: string; start: number; end: number; best: boolean }[]>();
  for (const d of f.days) {
    const picked = new Map<string, boolean>();
    for (const s of record.selections) if (s.festivalId === f.id && s.date === d.date) picked.set(s.performanceId, (picked.get(s.performanceId) ?? false) || !!s.best);
    const list = d.performances
      .filter((p) => picked.has(p.id))
      .map((p) => {
        const [start, end] = span(p);
        return { id: p.id, stageId: p.stageId, start, end, best: picked.get(p.id)! };
      });
    if (list.length) out.set(d.date, list);
  }
  return out;
}

/** 합집합 구간 사이의 가장 긴 공백 (구간이 하나면 0) */
export function maxInnerGap(intervals: [number, number][]): number {
  const u = unionIntervals(intervals);
  let gap = 0;
  for (let i = 1; i < u.length; i++) gap = Math.max(gap, u[i][0] - u[i - 1][1]);
  return gap;
}

export interface ResidentDay {
  date: string;
  /** 체류 = 그날 체크한 공연의 첫 시작 ~ 마지막 종료 (분) */
  start: number;
  end: number;
  /** 그날 프로그램 = 취소 공연을 뺀 첫 공연 시작 ~ 마지막 공연 종료 (분) */
  program: number;
  views: number;
  maxGap: number;
}

/**
 * resident 조건 (MIN-316 핫픽스): 참가일 체류 합계 ÷ 참가일 프로그램 합계 ≥ 90% · 참가한 날마다 체크 5개 이상 · 그날 최장 공백 ≤ 120분.
 * 하루만 참가해도 받을 수 있다
 */
export function residentShare(f: Festival, record: UserRecord): { ok: boolean; share: number; days: ResidentDay[] } {
  const byDate = viewsByDate(f, record);
  const days: ResidentDay[] = [];
  for (const d of f.days) {
    const views = byDate.get(d.date);
    if (!views) continue;
    const prog = d.performances.filter((p) => !(p as { canceled?: boolean }).canceled).map(span);
    days.push({
      date: d.date,
      start: Math.min(...views.map((v) => v.start)),
      end: Math.max(...views.map((v) => v.end)),
      program: prog.length ? Math.max(...prog.map(([, e]) => e)) - Math.min(...prog.map(([st]) => st)) : 0,
      views: views.length,
      maxGap: maxInnerGap(views.map((v) => [v.start, v.end])),
    });
  }
  const stay = days.reduce((s, d) => s + d.end - d.start, 0);
  const program = days.reduce((s, d) => s + d.program, 0);
  const share = program ? stay / program : 0;
  const R = TITLE_RULES.resident;
  const ok = days.length > 0 && share + EPS >= R.minShare && days.every((d) => d.views >= R.minViewsPerDay && d.maxGap <= R.maxGapMin);
  return { ok, share, days };
}

/** 메인/비메인 스테이지별 관람 수 — 스테이지 2개 이상·메인이 있는 참가일만 (판정 모듈 메인/서브 선호와 같은 범위) */
function stageShares(f: Festival, record: UserRecord, result: JudgeResult) {
  const byDate = viewsByDate(f, record);
  const eligible = result.days.filter((d) => d.festivalId === f.id && d.mainStageId && d.stageCount >= 2);
  let n = 0;
  let main = 0;
  const per = new Map<string, { k: number; bw: number }>();
  for (const d of eligible) {
    const views = byDate.get(d.date) ?? [];
    const lineup = f.days.find((x) => x.date === d.date)!.performances;
    n += views.length;
    main += views.filter((v) => v.stageId === d.mainStageId).length;
    for (const s of f.stages) {
      if (s.id === d.mainStageId) continue;
      const cur = per.get(s.id) ?? { k: 0, bw: 0 };
      cur.k += views.filter((v) => v.stageId === s.id).length;
      cur.bw += (views.length * lineup.filter((p) => p.stageId === s.id).length) / lineup.length;
      per.set(s.id, cur);
    }
  }
  return { n, main, per };
}

/** oneStage 조건을 충족한 비메인 스테이지 (없으면 null) */
function oneStageOf(f: Festival, record: UserRecord, result: JudgeResult): { stageId: string; k: number; n: number } | null {
  const { n, per } = stageShares(f, record, result);
  if (!n) return null;
  for (const [stageId, { k, bw }] of per) {
    const share = k / n;
    const delta = (share - bw / n) * 100;
    if (share + EPS >= TITLE_RULES.oneStage.minShare && delta + EPS >= TITLE_RULES.oneStage.minDeltaPp) return { stageId, k, n };
  }
  return null;
}

function subPrefPasses(m: MetricResult, f: Festival, record: UserRecord, result: JudgeResult): boolean {
  if (m.tier < TITLE_RULES.subPref.minTier || (m.denominator ?? 0) < TITLE_RULES.subPref.minViews) return false;
  const { n, main } = stageShares(f, record, result);
  return n > 0 && main / n <= TITLE_RULES.subPref.maxMainShare + EPS;
}

/** 판정 모듈이 고른 연결 구간과 같은 규칙 (공연 minPerformances개 이상, 구간 내 공연시간 최대 → 같으면 길이 최대, 먼저 나온 것) */
export function longestSegment(result: JudgeResult): { date: string; seg: Segment } | null {
  let best: { date: string; seg: Segment } | null = null;
  for (const d of result.days)
    for (const s of d.segments) {
      if (s.count < DEFAULT_CONFIG.streak.minPerformances) continue;
      if (!best || s.inner > best.seg.inner || (s.inner === best.seg.inner && s.length > best.seg.length)) best = { date: d.date, seg: s };
    }
  return best;
}

/** 대표 무대(★) — 2단계 기록의 pick. 2단계 전 기록(v1)은 undefined로 두고 best를 쓴다 */
export interface Pick {
  date: string;
  performanceId: string;
}

/**
 * streak 보조 줄: 구간 안 공연 중 최대 maxTeams팀.
 * 우선순위 ① 구간 안의 대표 무대 ★ ② 구간 안의 좋아요 무대 ③ 구간 첫 공연 ④ 구간 마지막 공연, 겹치면 구간 안 다음 공연으로 채움.
 * 표시는 시작 시각 순, 구분자 ` · `, 남은 팀이 있으면 ` 외 {x}팀`
 */
export function streakSubline(catalog: Catalog, record: UserRecord, result: JudgeResult, maxTeams = 3, pick?: Pick | null): string | null {
  const f = festivalOf(catalog, record);
  const ls = longestSegment(result);
  if (!f || !ls) return null;
  const ids = ls.seg.perfKeys.map((k) => k.split('|')[2]);
  const picked: string[] = [];
  const add = (id: string | undefined) => {
    if (id && !picked.includes(id) && picked.length < maxTeams) picked.push(id);
  };
  if (pick && pick.date === ls.date && ids.includes(pick.performanceId)) add(pick.performanceId);
  for (const s of record.selections) if (s.best && s.date === ls.date && ids.includes(s.performanceId)) add(s.performanceId);
  add(ids[0]);
  add(ids[ids.length - 1]);
  for (const id of ids) add(id);
  const day = f.days.find((d) => d.date === ls.date)!;
  const names = ids
    .filter((id) => picked.includes(id))
    .map((id) => {
      const p = day.performances.find((x) => x.id === id)!;
      return catalog.artists[p.artistId]?.name ?? p.artistId;
    });
  const rest = ids.length - names.length;
  return names.join(' · ') + (rest > 0 ? ` 외 ${rest}팀` : '');
}

function evidenceFor(id: TitleId, m: MetricResult | undefined, ctx: { f: Festival; record: UserRecord; result: JudgeResult }): string {
  const n = m?.denominator ?? 0;
  const k = m?.numerator ?? 0;
  switch (id) {
    case 'resident': {
      const r = residentShare(ctx.f, ctx.record);
      return r.days.length === 1
        ? `${fmtTime(r.days[0].start)}~${fmtTime(r.days[0].end)}, 올림픽공원에 있었어요`
        : `이틀 시간표의 ${Math.floor(r.share * 100 + EPS)}%, 올림픽공원에 있었어요`;
    }
    case 'mainPref':
      return `본 무대 ${n}개 중 ${k}개가 메인 스테이지였어요`;
    case 'subPref': {
      const main = n - k;
      return main === 0 ? '메인 스테이지는 한 번도 안 갔어요' : `본 무대 ${n}개 중 메인은 ${main}개뿐이었어요`;
    }
    case 'oneStage': {
      const o = oneStageOf(ctx.f, ctx.record, ctx.result)!;
      const s = STAGE_SHORT[o.stageId] ?? o.stageId;
      return o.k === o.n ? `${o.n}개 무대 모두 ${s}였어요` : `본 무대 ${o.n}개 중 ${o.k}개가 ${s}였어요`;
    }
    case 'early':
      return `본 무대 ${n}개 중 ${k}개가 해 지기 전이었어요`;
    case 'late':
      return `본 무대 ${n}개 중 ${k}개가 해 진 뒤였어요`;
    case 'watchTime': {
      // metric 값은 프로그램 길이 대비 % (0~100). 단계 경계를 넘어 보이지 않게 내림
      const p = Math.floor((m?.value ?? 0) + EPS);
      return ctx.result.stats.validDays > 1 ? `하루 공연 시간의 평균 ${p}%를 채웠어요` : `하루 공연 시간의 ${p}%를 채웠어요`;
    }
    case 'streak':
      // 구간 내 공연시간(합집합, 공백 제외, 분) — 2시간 / 45분 / 3시간 20분
      return `${fmtDuration(longestSegment(ctx.result)?.seg.inner ?? 0)} 동안 쉬지 않고 무대를 봤어요`;
    case 'headliner':
      return '이틀 모두 헤드라이너 무대를 봤어요';
    case 'rookie':
      return `${ctx.result.stats.views}개 무대를 봤어요. 내년엔 더 달려봐요`;
  }
}

export function pickTitle(catalog: Catalog, record: UserRecord, result: JudgeResult, pick?: Pick | null): TitleResult {
  const f = festivalOf(catalog, record);
  const views = result.stats?.views ?? record.selections.length;
  const rookie: TitleResult = {
    id: 'rookie',
    label: TITLE_LABELS.rookie,
    evidence: `${views}개 무대를 봤어요. 내년엔 더 달려봐요`,
    subline: null,
    tier: 0,
    others: [],
    list: [],
  };
  rookie.list = [{ id: 'rookie', label: rookie.label, evidence: rookie.evidence }];
  if (!f || result.status !== 'ok') return rookie;
  const ctx = { f, record, result };

  // 후보: 판정 모듈 기본 칭호 중 계산 가능·1단계 이상 (+ 그민페 추가 조건)
  const cands: { id: TitleId; metric: MetricResult }[] = [];
  for (const m of result.metrics) {
    if (!BASE_IDS.includes(m.id) || m.mode !== 'active' || !m.computable || m.tier < 1) continue;
    if (m.id === 'subPref') {
      if (!subPrefPasses(m, f, record, result)) continue;
      cands.push({ id: oneStageOf(f, record, result) ? 'oneStage' : 'subPref', metric: m });
    } else cands.push({ id: m.id as TitleId, metric: m });
  }
  cands.sort((a, b) => b.metric.tier - a.metric.tier || GMF_TITLE_ORDER.indexOf(a.id) - GMF_TITLE_ORDER.indexOf(b.id));
  const item = (id: TitleId, metric: MetricResult | undefined): TitleItem => ({ id, label: TITLE_LABELS[id], evidence: evidenceFor(id, metric, ctx) });

  const make = (top: TitleItem, tier: number, rest: TitleItem[]): TitleResult => ({
    ...top,
    subline: top.id === 'streak' ? streakSubline(catalog, record, result, 3, pick) : null,
    tier,
    others: rest.map((r) => r.id),
    list: [top, ...rest],
  });

  if (residentShare(f, record).ok) return make(item('resident', undefined), 3, cands.map((c) => item(c.id, c.metric)));
  if (!cands.length) return rookie;
  const [top, ...rest] = cands;
  return make(item(top.id, top.metric), top.metric.tier, rest.map((c) => item(c.id, c.metric)));
}

/* ───────────── 카드용 요약 (칭호와 무관한 공통 부분) ───────────── */

export interface BestStage {
  /** M/D */
  date: string;
  name: string;
  stageId: string;
  /** MBS · CMS · LFG */
  stage: string;
  start: string;
}

export interface CardSummary {
  /** 고른 공연 수 (ARTISTS) */
  views: number;
  /** 고른 공연 시간 합집합 합계 (MINUTES) */
  minutes: number;
  /** 체크한 날 기준: 10.17—18 / 10.17 / 10.18 */
  dateLabel: string;
  /** 페스티벌 스테이지 순서 그대로, 0 포함 */
  stages: { id: string; short: string; count: number }[];
  /** 이번 그민페 최고의 무대 — 대표 무대 1개 (없으면 null) */
  best: BestStage | null;
}

/** 10.17—18 (이틀) / 10.17 (하루). 달이 다르면 10.31—11.1 */
export function dateLabel(dates: string[]): string {
  const ds = [...new Set(dates)].sort().map((d) => d.split('-').map(Number));
  if (!ds.length) return '';
  const [, m1, d1] = ds[0];
  if (ds.length === 1) return `${m1}.${d1}`;
  const [, m2, d2] = ds[ds.length - 1];
  return m1 === m2 ? `${m1}.${d1}—${d2}` : `${m1}.${d1}—${m2}.${d2}`;
}

/**
 * 카드 공통 요약.
 * pick: 대표 무대 (2단계). undefined면 v1 기록으로 보고 best 중 마지막 참가일 것을 쓴다. null이면 최고 무대 없음
 */
export function cardSummary(catalog: Catalog, record: UserRecord, result: JudgeResult, pick?: Pick | null): CardSummary {
  const f = festivalOf(catalog, record);
  if (!f) return { views: 0, minutes: 0, dateLabel: '', stages: [], best: null };
  const byDate = viewsByDate(f, record);
  const all = [...byDate.values()].flat();
  let chosen: Pick | null = pick ?? null;
  if (pick === undefined) {
    const last = [...byDate].sort(([a], [b]) => b.localeCompare(a)).find(([, views]) => views.some((v) => v.best));
    if (last) chosen = { date: last[0], performanceId: last[1].find((v) => v.best)!.id };
  }
  let best: BestStage | null = null;
  const v = chosen ? byDate.get(chosen.date)?.find((x) => x.id === chosen!.performanceId) : undefined;
  if (chosen && v) {
    const p = f.days.find((d) => d.date === chosen!.date)!.performances.find((x) => x.id === v.id)!;
    const [, m, d] = chosen.date.split('-').map(Number);
    best = {
      date: `${m}/${d}`,
      name: catalog.artists[p.artistId]?.name ?? p.artistId,
      stageId: p.stageId,
      stage: STAGE_SHORT[p.stageId] ?? p.stageId,
      start: fmtTime(v.start),
    };
  }
  return {
    views: result.stats.views,
    minutes: result.days.filter((d) => d.festivalId === f.id).reduce((s, d) => s + d.unionMin, 0),
    dateLabel: dateLabel([...byDate.keys()]),
    stages: f.stages.map((s) => ({ id: s.id, short: STAGE_SHORT[s.id] ?? s.name, count: all.filter((x) => x.stageId === s.id).length })),
    best,
  };
}
