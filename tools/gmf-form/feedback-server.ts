/**
 * 결과 카드 피드백 API — POST /api/gmf-feedback (Vercel 함수, MIN-306)
 *
 * 화면과 같은 검사(parseFeedback)를 서버에서 다시 돌린 뒤 Neon gmf_feedback에 INSERT만 한다.
 * 전용 계정(GMF_DATABASE_URL, gmf_app)은 이 테이블에 INSERT 권한만 있고 SELECT가 없으므로
 * RETURNING·upsert·excluded.* 를 쓰지 않는다. 같은 결과에 1회 제한은 화면에서 건다.
 * 테이블은 sql/002_gmf_feedback.sql (검수 측에서 적용).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { neon } from '@neondatabase/serverless';
import { parseFeedback } from './feedback';
import type { Feedback } from './feedback';

const FESTIVAL_ID = 'gmf2026';
const BODY_LIMIT = 16 * 1024;

export interface FeedbackStore {
  save(f: Feedback): Promise<void>;
}

export function neonFeedbackStore(url: string): FeedbackStore {
  const sql = neon(url);
  return {
    async save(f) {
      await sql`insert into gmf_feedback (anon_id, festival_id, form_version, judge_version, title_id, title_label, fit, understood, share, show_parts, chips, comment)
        values (${f.anonId}, ${f.festivalId}, ${f.formVersion}, ${f.judgeVersion}, ${f.titleId}, ${f.titleLabel}, ${f.fit}, ${f.understood}, ${f.share}, ${f.showParts}, ${f.chips}, ${f.comment})`;
    },
  };
}

/** 저장소를 주입받는 순수 처리부 — 테스트에서 가짜 저장소로 돌린다 */
export async function handleFeedback(rawBody: string, store: FeedbackStore): Promise<{ status: number; body: Record<string, unknown> }> {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { error: '요청 형식이 올바르지 않아요' } };
  }
  const parsed = parseFeedback(FESTIVAL_ID, json);
  if (!parsed.ok) return { status: 400, body: { error: parsed.error } };
  try {
    await store.save(parsed.value);
  } catch (e) {
    console.error('gmf-feedback save failed', e);
    return { status: 500, body: { error: '저장하지 못했어요' } };
  }
  return { status: 200, body: { ok: true } };
}

function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size <= BODY_LIMIT) chunks.push(c);
    });
    req.on('end', () => resolve(size > BODY_LIMIT ? null : Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: Record<string, unknown>) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST만 받아요' });
  const url = process.env.GMF_DATABASE_URL;
  if (!url) {
    console.error('GMF_DATABASE_URL is not set');
    return send(res, 500, { error: '서버 설정이 끝나지 않았어요' });
  }
  const raw = await readBody(req);
  if (raw === null) return send(res, 413, { error: '요청이 너무 커요' });
  const r = await handleFeedback(raw, neonFeedbackStore(url));
  send(res, r.status, r.body);
}
