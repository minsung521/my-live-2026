/**
 * 그민페 기록 수집 폼 — 화면과 분리한 순수 로직 (MIN-268)
 *
 * 폼 상태 → 판정 모듈 `UserRecord` 변환, 제출 전 검사, Netlify Forms 전송 본문 생성.
 * 기록과 연락처는 익명 ID만 공유하는 별도 폼 두 개로 보낸다 (MIN-267 연락처 분리 보관).
 */
import { validateRecord } from '../../packages/judge/src/judge';
import type { Catalog, Festival, Performance, UserRecord } from '../../packages/judge/src/judge';

export const FORM_VERSION = 'gmf-form v0.1';
export const RECORD_FORM = 'gmf-record';
export const CONTACT_FORM = 'gmf-contact';

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
  if (contact && !st.consentResult) out.push({ step: 'contact', message: '결과를 받으려면 연락 동의에 체크해 주세요' });
  if (!contact && (st.consentResult || st.consentReshare)) out.push({ step: 'contact', message: '연락받을 인스타 아이디나 이메일을 적어 주세요' });
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

const enc = (o: Record<string, string>) =>
  Object.entries(o)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

/** Netlify Forms에 보낼 본문 두 개. 연락처가 없으면 연락처 폼은 보내지 않는다 */
export function payloads(f: Festival, st: FormState, anonId: string, now: Date): { record: string; contact: string | null } {
  const rec = toRecord(f, st);
  const record = enc({
    'form-name': RECORD_FORM,
    anon_id: anonId,
    festival_id: f.id,
    days: [...st.days].sort().join(','),
    selection_count: String(rec.selections.length),
    record_json: JSON.stringify(rec),
    form_version: FORM_VERSION,
    submitted_at: now.toISOString(),
    'bot-field': '',
  });
  const c = st.contact.trim();
  const contact = c
    ? enc({
        'form-name': CONTACT_FORM,
        anon_id: anonId,
        contact: c,
        consent_result: st.consentResult ? 'yes' : 'no',
        consent_reshare: st.consentReshare ? 'yes' : 'no',
        submitted_at: now.toISOString(),
        'bot-field': '',
      })
    : null;
  return { record, contact };
}
