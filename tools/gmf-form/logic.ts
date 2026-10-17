/**
 * 그민페 기록 수집 폼 — 화면과 분리한 순수 로직 (MIN-268)
 *
 * 폼 상태 → 판정 모듈 `UserRecord` 변환, 제출 전 검사, 전송 본문 생성, 서버 측 재검사.
 * 기록과 연락처는 익명 ID만 공유하고 DB에서 별도 테이블에 저장한다 (MIN-267 연락처 분리 보관).
 * 화면(app.ts)과 Vercel 함수(api/gmf-submit.ts)가 같은 검사를 쓴다.
 */
import { validateRecord } from '../../packages/judge/src/judge';
import type { Catalog, Festival, Performance, UserRecord } from '../../packages/judge/src/judge';

export const FORM_VERSION = 'gmf-form v0.3';
export const SUBMIT_PATH = '/api/gmf-submit';
export const ANON_ID_RE = /^g-[2-9A-HJ-NP-Z]{8}$/;
export const CONTACT_MAX = 120;

export interface FormState {
  /** 참가일 (YYYY-MM-DD) */
  days: string[];
  /** 날짜별 본 공연 ID */
  seen: Record<string, string[]>;
  /** 날짜별 최고의 무대 공연 ID (참가일마다 1개) */
  best: Record<string, string | null>;
  contact: string;
  consentResult: boolean;
  consentReshare: boolean;
}

export const emptyState = (): FormState => ({
  days: [],
  seen: {},
  best: {},
  contact: '',
  consentResult: false,
  consentReshare: false,
});

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
  return [...d.performances].sort((a, b) => a.start.localeCompare(b.start) || (order.get(a.stageId)! - order.get(b.stageId)!));
}

/** 참가일에서 빠진 날짜의 체크·최고 무대는 버린다 */
export function toRecord(f: Festival, st: FormState): UserRecord {
  const selections: UserRecord['selections'] = [];
  for (const date of [...st.days].sort()) {
    const valid = new Set(f.days.find((d) => d.date === date)?.performances.map((p) => p.id) ?? []);
    for (const id of st.seen[date] ?? []) {
      if (!valid.has(id)) continue;
      selections.push(st.best[date] === id ? { festivalId: f.id, date, performanceId: id, best: true } : { festivalId: f.id, date, performanceId: id });
    }
  }
  return { selections };
}

export interface Problem {
  step: 'days' | 'seen' | 'best' | 'contact' | 'record';
  message: string;
}

export function check(catalog: Catalog, f: Festival, st: FormState): Problem[] {
  const out: Problem[] = [];
  if (st.days.length === 0) out.push({ step: 'days', message: '참가한 날을 골라 주세요' });
  for (const date of st.days) {
    const n = (st.seen[date] ?? []).length;
    const label = dayLabel(date);
    if (n === 0) out.push({ step: 'seen', message: `${label}에 본 무대를 하나 이상 체크해 주세요` });
    else if (!st.best[date] || !(st.seen[date] ?? []).includes(st.best[date]!)) out.push({ step: 'best', message: `${label} 최고의 무대를 골라 주세요` });
  }
  const contact = st.contact.trim();
  if (contact && !st.consentResult) out.push({ step: 'contact', message: '연락처를 남기려면 연락 동의에 체크해 주세요' });
  if (!contact && (st.consentResult || st.consentReshare)) out.push({ step: 'contact', message: '연락받을 인스타 아이디나 이메일을 적어 주세요 (연락처는 선택이에요)' });
  if (out.length === 0) {
    const { errors } = validateRecord(catalog, toRecord(f, st));
    for (const e of errors) out.push({ step: 'record', message: e.message });
  }
  return out;
}

export function dayLabel(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  const w = '일월화수목금토'[new Date(Date.UTC(+date.slice(0, 4), m - 1, d)).getUTCDay()];
  return `${m}/${d}(${w})`;
}

export interface Submission {
  anonId: string;
  festivalId: string;
  formVersion: string;
  record: UserRecord;
  contact: { value: string; consentResult: boolean; consentReshare: boolean } | null;
}

/** 전송 본문. 연락처가 비어 있으면 contact는 null */
export function toSubmission(f: Festival, st: FormState, anonId: string): Submission {
  const c = st.contact.trim();
  return {
    anonId,
    festivalId: f.id,
    formVersion: FORM_VERSION,
    record: toRecord(f, st),
    contact: c ? { value: c, consentResult: st.consentResult, consentReshare: st.consentReshare } : null,
  };
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
  const bestPerDay = new Map<string, number>();
  for (const x of rec.selections as unknown[]) {
    const s = x as Record<string, unknown>;
    if (!s || s.festivalId !== festivalId || typeof s.date !== 'string' || typeof s.performanceId !== 'string') return fail('본 무대 기록 형식이 올바르지 않아요');
    if (s.best !== undefined && s.best !== true) return fail('최고의 무대 표시가 올바르지 않아요');
    if (s.best) bestPerDay.set(s.date, (bestPerDay.get(s.date) ?? 0) + 1);
    selections.push(s.best ? { festivalId, date: s.date, performanceId: s.performanceId, best: true } : { festivalId, date: s.date, performanceId: s.performanceId });
  }
  const record: UserRecord = { selections };
  const { errors } = validateRecord(catalog, record);
  if (errors.length) return fail(errors[0].message);
  const days = new Set(selections.map((s) => s.date));
  for (const d of days) if (bestPerDay.get(d) !== 1) return fail(`${dayLabel(d)} 최고의 무대는 하나만 골라 주세요`);
  let contact: Submission['contact'] = null;
  if (b.contact !== null && b.contact !== undefined) {
    const c = b.contact as Record<string, unknown>;
    const value = typeof c.value === 'string' ? c.value.trim() : '';
    if (!value || value.length > CONTACT_MAX) return fail('연락처가 올바르지 않아요');
    if (c.consentResult !== true) return fail('결과를 받으려면 연락 동의에 체크해 주세요');
    contact = { value, consentResult: true, consentReshare: c.consentReshare === true };
  }
  const formVersion = typeof b.formVersion === 'string' ? b.formVersion.slice(0, 40) : 'unknown';
  return { ok: true, value: { anonId: b.anonId, festivalId, formVersion, record, contact } };
}
