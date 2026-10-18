/**
 * 그민페 기록 수집 — 화면과 분리한 순수 로직 (MIN-268 → MIN-316 v2 입력)
 *
 * 입력 상태(그리드 체크·좋아요·아쉬움·대표 무대) → 기록 변환, 전송 본문 생성, 서버 측 재검사.
 * 기록과 연락처는 익명 ID만 공유하고 DB에서 별도 테이블에 저장한다 (MIN-267 연락처 분리 보관).
 * 화면(app.ts)과 Vercel 함수(server.ts)가 같은 검사를 쓴다.
 *
 * v2 기록 (gmf_records.record jsonb에 그대로 저장, 스키마 변경 없음)
 *  { selections: [{ festivalId, date, performanceId, best?: true }], regrets: [{ date, performanceId }], pick: { date, performanceId } | null }
 *  - best: true = 좋아요 (하루 여러 개 가능) / regrets = 아쉬움 / pick = 대표 무대(★)
 *  - 판정 모듈에는 { selections }만 넘긴다
 */
import { validateRecord } from '../../packages/judge/src/judge';
import type { Catalog, Festival, Performance, UserRecord } from '../../packages/judge/src/judge';

export const FORM_VERSION = 'gmf-form v0.4';
export const SUBMIT_PATH = '/api/gmf-submit';
export const ANON_ID_RE = /^g-[2-9A-HJ-NP-Z]{8}$/;
export const CONTACT_MAX = 120;
export const REGRETS_MAX = 60;

export interface PerfRef {
  date: string;
  performanceId: string;
}

export interface GmfRecord extends UserRecord {
  regrets: PerfRef[];
  pick: PerfRef | null;
}

export interface InputState {
  /** 날짜별 체크한 공연 ID (체크한 날 = 참가일) */
  checked: Record<string, string[]>;
  /** 좋아요 `${date}|${performanceId}` */
  likes: string[];
  /** 아쉬움 `${date}|${performanceId}` */
  regrets: string[];
  /** 대표 무대 `${date}|${performanceId}` */
  pick: string | null;
}

export const emptyInput = (): InputState => ({ checked: {}, likes: [], regrets: [], pick: null });

export const refKey = (date: string, performanceId: string) => `${date}|${performanceId}`;
export const parseKey = (k: string): PerfRef => {
  const [date, performanceId] = k.split('|');
  return { date, performanceId };
};

/** 대소문자·혼동 문자를 뺀 8자리 익명 ID (예: g-7KQ2M9XA) */
export function makeAnonId(rand: () => number = Math.random): string {
  const abc = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let s = '';
  for (let i = 0; i < 8; i++) s += abc[Math.floor(rand() * abc.length)];
  return `g-${s}`;
}

export function sortedDay(f: Festival, date: string): Performance[] {
  const d = f.days.find((x) => x.date === date);
  if (!d) return [];
  const order = new Map(f.stages.map((s, i) => [s.id, i]));
  return [...d.performances].sort((a, b) => a.start.localeCompare(b.start) || order.get(a.stageId)! - order.get(b.stageId)!);
}

/** 체크된 공연 키 (catalog에 있는 것만, 날짜·시작 시각 순) */
export function checkedKeys(f: Festival, st: InputState): string[] {
  const out: string[] = [];
  for (const d of f.days) {
    const on = new Set(st.checked[d.date] ?? []);
    for (const p of sortedDay(f, d.date)) if (on.has(p.id)) out.push(refKey(d.date, p.id));
  }
  return out;
}

/** 체크가 풀린 공연의 좋아요·아쉬움·대표를 정리하고, 한 공연에 좋아요·아쉬움 중 하나만 남긴다 */
export function normalize(f: Festival, st: InputState): InputState {
  const valid = new Set(checkedKeys(f, st));
  const likes = [...new Set(st.likes)].filter((k) => valid.has(k));
  const regrets = [...new Set(st.regrets)].filter((k) => valid.has(k) && !likes.includes(k));
  const pick = st.pick && likes.includes(st.pick) ? st.pick : null;
  return { ...st, likes, regrets, pick };
}

/** 대표 무대 기본값: 좋아요 중 가장 늦게 시작한 무대 (자정 넘김 없음 가정, 같은 시각이면 뒤 날짜) */
export function defaultPick(f: Festival, likes: string[]): string | null {
  let best: { k: string; key: string } | null = null;
  for (const k of likes) {
    const { date, performanceId } = parseKey(k);
    const p = f.days.find((d) => d.date === date)?.performances.find((x) => x.id === performanceId);
    if (!p) continue;
    const key = `${date} ${p.start}`;
    if (!best || key > best.key) best = { k, key };
  }
  return best?.k ?? null;
}

/** 실제로 쓸 대표 무대: 좋아요 0개 → null, 1개 → 그 무대, 2개 이상 → 고른 것(없으면 기본값) */
export function effectivePick(f: Festival, st: InputState): string | null {
  const n = normalize(f, st);
  if (!n.likes.length) return null;
  if (n.likes.length === 1) return n.likes[0];
  return n.pick ?? defaultPick(f, n.likes);
}

export function toRecord(f: Festival, st: InputState): GmfRecord {
  const n = normalize(f, st);
  const likes = new Set(n.likes);
  const selections: UserRecord['selections'] = checkedKeys(f, n).map((k) => {
    const { date, performanceId } = parseKey(k);
    return likes.has(k) ? { festivalId: f.id, date, performanceId, best: true } : { festivalId: f.id, date, performanceId };
  });
  const pick = effectivePick(f, n);
  return { selections, regrets: n.regrets.map(parseKey), pick: pick ? parseKey(pick) : null };
}

export function dayLabel(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  const w = '일월화수목금토'[new Date(Date.UTC(+date.slice(0, 4), m - 1, d)).getUTCDay()];
  return `${m}/${d} (${w})`;
}

export interface Submission {
  anonId: string;
  festivalId: string;
  formVersion: string;
  record: GmfRecord;
  /** v1 호환. v2 화면은 null (연락처는 /api/gmf-contact) */
  contact: { value: string; consentResult: boolean; consentReshare: boolean } | null;
}

export function toSubmission(f: Festival, st: InputState, anonId: string): Submission {
  return { anonId, festivalId: f.id, formVersion: FORM_VERSION, record: toRecord(f, st), contact: null };
}

/** 연락처 값·동의 검사 — 제출 본문(v1 호환)과 결과 화면 연락처 API(gmf-contact)가 같이 쓴다 */
export function parseContactFields(
  rawValue: unknown,
  consentResult: unknown,
  consentReshare: unknown,
): { ok: true; value: { value: string; consentResult: true; consentReshare: boolean } } | { ok: false; error: string } {
  const value = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (!value || value.length > CONTACT_MAX) return { ok: false, error: '연락처가 올바르지 않아요' };
  if (consentResult !== true) return { ok: false, error: '결과를 받으려면 연락 동의에 체크해 주세요' };
  return { ok: true, value: { value, consentResult: true, consentReshare: consentReshare === true } };
}

/**
 * 서버 측 재검사. 화면을 거치지 않은 요청도 여기서 걸러낸다.
 * 통과하면 저장할 값만 추린 Submission을, 아니면 오류 메시지를 돌려준다.
 */
export function parseSubmission(catalog: Catalog, festivalId: string, body: unknown): { ok: true; value: Submission } | { ok: false; error: string } {
  const fail = (error: string) => ({ ok: false as const, error });
  if (!body || typeof body !== 'object') return fail('본문이 비어 있어요');
  const b = body as Record<string, unknown>;
  if (typeof b.anonId !== 'string' || !ANON_ID_RE.test(b.anonId)) return fail('익명 ID 형식이 올바르지 않아요');
  if (b.festivalId !== festivalId) return fail('수집 대상 페스티벌이 아니에요');
  const rec = b.record as Record<string, unknown> | undefined;
  if (!rec || !Array.isArray(rec.selections) || rec.selections.length === 0 || rec.selections.length > 60) return fail('본 무대 기록이 올바르지 않아요');
  const selections: UserRecord['selections'] = [];
  for (const x of rec.selections as unknown[]) {
    const s = x as Record<string, unknown>;
    if (!s || s.festivalId !== festivalId || typeof s.date !== 'string' || typeof s.performanceId !== 'string') return fail('본 무대 기록 형식이 올바르지 않아요');
    if (s.best !== undefined && s.best !== true) return fail('좋아요 표시가 올바르지 않아요');
    selections.push(s.best ? { festivalId, date: s.date, performanceId: s.performanceId, best: true } : { festivalId, date: s.date, performanceId: s.performanceId });
  }
  const { errors } = validateRecord(catalog, { selections });
  if (errors.length) return fail(errors[0].message);
  const picked = new Set(selections.map((s) => refKey(s.date, s.performanceId)));
  const liked = new Set(selections.filter((s) => s.best).map((s) => refKey(s.date, s.performanceId)));
  const isRef = (v: unknown): v is PerfRef => !!v && typeof v === 'object' && typeof (v as PerfRef).date === 'string' && typeof (v as PerfRef).performanceId === 'string';

  // 아쉬움: 체크한 공연 안 · 좋아요가 아님 · 중복 제거 · 최대 60
  const regrets: PerfRef[] = [];
  if (rec.regrets !== undefined && rec.regrets !== null) {
    if (!Array.isArray(rec.regrets) || rec.regrets.length > REGRETS_MAX) return fail('아쉬움 기록이 올바르지 않아요');
    const seen = new Set<string>();
    for (const r of rec.regrets as unknown[]) {
      if (!isRef(r)) return fail('아쉬움 기록 형식이 올바르지 않아요');
      const k = refKey(r.date, r.performanceId);
      if (!picked.has(k)) return fail('체크하지 않은 공연에 아쉬움을 표시했어요');
      if (liked.has(k)) return fail('한 공연에 좋아요와 아쉬움을 함께 고를 수 없어요');
      if (seen.has(k)) continue;
      seen.add(k);
      regrets.push({ date: r.date, performanceId: r.performanceId });
    }
  }

  // 대표 무대: 좋아요가 있으면 그중 하나(필수), 없으면 null
  let pick: PerfRef | null = null;
  if (liked.size) {
    if (!isRef(rec.pick)) return fail('이번 그민페 최고의 무대를 골라 주세요');
    if (!liked.has(refKey(rec.pick.date, rec.pick.performanceId))) return fail('최고의 무대는 좋아요한 무대 중에서 골라 주세요');
    pick = { date: rec.pick.date, performanceId: rec.pick.performanceId };
  } else if (rec.pick !== undefined && rec.pick !== null) return fail('좋아요한 무대가 없으면 최고의 무대를 고를 수 없어요');

  let contact: Submission['contact'] = null;
  if (b.contact !== null && b.contact !== undefined) {
    const c = b.contact as Record<string, unknown>;
    const parsed = parseContactFields(c.value, c.consentResult, c.consentReshare);
    if (!parsed.ok) return fail(parsed.error);
    contact = parsed.value;
  }
  const formVersion = typeof b.formVersion === 'string' ? b.formVersion.slice(0, 40) : 'unknown';
  return { ok: true, value: { anonId: b.anonId, festivalId, formVersion, record: { selections, regrets, pick }, contact } };
}
