/**
 * 결과 화면 연락처 API — POST /api/gmf-contact (Vercel 함수, MIN-316)
 *
 * v1에서는 연락처를 기록 제출 본문에 같이 받았지만, v2부터 결과 2페이지에서 따로 받는다.
 * 검사는 v1과 같은 규칙(parseContactFields), 저장은 server.ts와 같은 gmf_contacts upsert.
 * 전용 계정(gmf_app)은 SELECT 권한이 없으므로 SET에 excluded.* 를 쓰지 않고 같은 값을 매개변수로 다시 넘긴다.
 * 연락처 값은 로그에 남기지 않는다.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { neon } from '@neondatabase/serverless';
import { ANON_ID_RE, parseContactFields } from './logic';

const FESTIVAL_ID = 'gmf2026';
const BODY_LIMIT = 4 * 1024;

export interface ContactSubmission {
  anonId: string;
  festivalId: string;
  contact: string;
  consentResult: true;
  consentReshare: boolean;
}

export interface ContactStore {
  save(c: ContactSubmission): Promise<void>;
}

export function parseContact(festivalId: string, body: unknown): { ok: true; value: ContactSubmission } | { ok: false; error: string } {
  const fail = (error: string) => ({ ok: false as const, error });
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('본문이 비어 있어요');
  const b = body as Record<string, unknown>;
  if (typeof b.anonId !== 'string' || !ANON_ID_RE.test(b.anonId)) return fail('익명 ID 형식이 올바르지 않아요');
  if (b.festivalId !== festivalId) return fail('수집 대상 페스티벌이 아니에요');
  const c = parseContactFields(b.contact, b.consentResult, b.consentReshare);
  if (!c.ok) return fail(c.error);
  return { ok: true, value: { anonId: b.anonId, festivalId, contact: c.value.value, consentResult: true, consentReshare: c.value.consentReshare } };
}

export function neonContactStore(url: string): ContactStore {
  const sql = neon(url);
  return {
    async save(c) {
      await sql`insert into gmf_contacts (anon_id, contact, consent_result, consent_reshare)
          values (${c.anonId}, ${c.contact}, ${c.consentResult}, ${c.consentReshare})
          on conflict (anon_id) do update set
            contact = ${c.contact}, consent_result = ${c.consentResult},
            consent_reshare = ${c.consentReshare}, updated_at = now()`;
    },
  };
}

/** 저장소를 주입받는 순수 처리부 — 테스트에서 가짜 저장소로 돌린다 */
export async function handleContact(rawBody: string, store: ContactStore): Promise<{ status: number; body: Record<string, unknown> }> {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { error: '요청 형식이 올바르지 않아요' } };
  }
  const parsed = parseContact(FESTIVAL_ID, json);
  if (!parsed.ok) return { status: 400, body: { error: parsed.error } };
  try {
    await store.save(parsed.value);
  } catch (e) {
    // 오류 객체에 매개변수(연락처)가 실릴 수 있어 이름·코드만 남긴다
    console.error('gmf-contact save failed', (e as { name?: string })?.name, (e as { code?: string })?.code);
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
  const r = await handleContact(raw, neonContactStore(url));
  send(res, r.status, r.body);
}
