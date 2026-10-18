/**
 * 결과 카드 피드백 — 화면과 서버가 같이 쓰는 값·검사 (MIN-306)
 *
 * 저장 값은 영문 키로만 받는다. 연락처는 받지 않는다.
 */
import { ANON_ID_RE } from './logic';
import type { TitleId } from './titles';

export const FEEDBACK_PATH = '/api/gmf-feedback';
export const COMMENT_MAX = 300;

export const TITLE_IDS: TitleId[] = ['resident', 'mainPref', 'subPref', 'oneStage', 'early', 'late', 'watchTime', 'streak', 'headliner', 'rookie'];

export const FIT = [
  ['yes', '완전 나'],
  ['partly', '반쯤'],
  ['no', '아닌데'],
] as const;
export const UNDERSTOOD = [
  ['yes', '알겠어'],
  ['no', '잘 모르겠어'],
] as const;
export const SHARE = [
  ['story', '올릴래'],
  ['friends', '친구한테만 보낼래'],
  ['no', '안 올릴래'],
] as const;
export const SHOW_PARTS = [
  ['title', '칭호'],
  ['evidence', '근거 문구'],
  ['best', '최고의 무대'],
  ['stats', '숫자'],
] as const;
/** 결과 2페이지 피드백 문항 (해요체) */
export const QUESTIONS = {
  fit: '이 칭호, 나랑 맞나요?',
  understood: '왜 이 칭호인지 알겠나요?',
  share: '스토리에 올릴 건가요?',
  showParts: '(선택) 보여주고 싶은 것',
  chips: '만든 사람에게 한마디',
};

export const CHIPS = [
  ['more', '이런 거 계속 만들어줘'],
  ['input_tedious', '입력이 좀 귀찮았어'],
  ['funny_title', '칭호 이름 웃김'],
  ['other_festivals', '다른 페스티벌도 해줘'],
  ['experience_titles', '맥주·부스 같은 것도 칭호로 받고 싶어'],
] as const;

type Key<T extends readonly (readonly [string, string])[]> = T[number][0];
export type Fit = Key<typeof FIT>;
export type Understood = Key<typeof UNDERSTOOD>;
export type Share = Key<typeof SHARE>;
export type ShowPart = Key<typeof SHOW_PARTS>;
export type Chip = Key<typeof CHIPS>;

export interface Feedback {
  anonId: string;
  festivalId: string;
  formVersion: string;
  judgeVersion: string;
  titleId: TitleId;
  titleLabel: string | null;
  fit: Fit;
  understood: Understood;
  share: Share;
  showParts: ShowPart[];
  chips: Chip[];
  comment: string | null;
}

const keys = (list: readonly (readonly [string, string])[]) => list.map(([k]) => k);

/** 필수 문항 1·2·3이 다 찼는지 — 화면의 [보내기] 활성화 기준 (rookie 포함 모든 칭호 같음) */
export function feedbackReady(fit: string | null, understood: string | null, share: string | null): boolean {
  return !!fit && !!understood && !!share;
}

/** 서버 측 재검사. 통과하면 저장할 값만 추린 Feedback을 돌려준다 */
export function parseFeedback(festivalId: string, body: unknown): { ok: true; value: Feedback } | { ok: false; error: string } {
  const fail = (error: string) => ({ ok: false as const, error });
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('본문이 비어 있어요');
  const b = body as Record<string, unknown>;
  if (typeof b.anonId !== 'string' || !ANON_ID_RE.test(b.anonId)) return fail('익명 ID 형식이 올바르지 않아요');
  if (b.festivalId !== festivalId) return fail('수집 대상 페스티벌이 아니에요');
  if (typeof b.titleId !== 'string' || !TITLE_IDS.includes(b.titleId as TitleId)) return fail('칭호 값이 올바르지 않아요');
  const titleId = b.titleId as TitleId;
  const oneOf = (v: unknown, list: readonly (readonly [string, string])[]) => typeof v === 'string' && keys(list).includes(v);
  if (!oneOf(b.fit, FIT)) return fail('“이 칭호, 나랑 맞나요?” 값이 올바르지 않아요');
  if (!oneOf(b.understood, UNDERSTOOD)) return fail('“왜 이 칭호인지 알겠나요?” 값이 올바르지 않아요');
  if (!oneOf(b.share, SHARE)) return fail('“스토리에 올릴 건가요?” 값이 올바르지 않아요');
  const list = <T extends string>(v: unknown, allowed: readonly (readonly [string, string])[], name: string): T[] | string => {
    if (v == null) return [];
    if (!Array.isArray(v) || v.length > 20) return `${name} 값이 올바르지 않아요`;
    const ok = keys(allowed);
    if (v.some((x) => typeof x !== 'string' || !ok.includes(x))) return `${name} 값이 올바르지 않아요`;
    return ok.filter((k) => v.includes(k)) as T[];
  };
  const showParts = list<ShowPart>(b.showParts, SHOW_PARTS, '보여주고 싶은 것');
  if (typeof showParts === 'string') return fail(showParts);
  const chips = list<Chip>(b.chips, CHIPS, '한마디');
  if (typeof chips === 'string') return fail(chips);
  let comment: string | null = null;
  if (b.comment != null) {
    if (typeof b.comment !== 'string') return fail('한마디 형식이 올바르지 않아요');
    const c = b.comment.trim();
    if ([...c].length > COMMENT_MAX) return fail(`한마디는 ${COMMENT_MAX}자까지 쓸 수 있어요`);
    comment = c || null;
  }
  const short = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);
  return {
    ok: true,
    value: {
      anonId: b.anonId,
      festivalId,
      formVersion: short(b.formVersion, 40) ?? 'unknown',
      judgeVersion: short(b.judgeVersion, 20) ?? 'unknown',
      titleId,
      titleLabel: short(b.titleLabel, 60),
      fit: b.fit as Fit,
      understood: b.understood as Understood,
      share: b.share as Share,
      showParts,
      chips,
      comment,
    },
  };
}
