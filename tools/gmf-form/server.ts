/**
 * 그민페 기록 수집 API — POST /api/gmf-submit (Vercel 함수, MIN-268)
 *
 * 화면과 같은 검사(parseSubmission)를 서버에서 다시 돌린 뒤 Neon에 저장한다.
 * 기록(gmf_records)과 연락처(gmf_contacts)는 익명 ID만 공유하는 별도 테이블이고,
 * 같은 기기에서 다시 제출하면 같은 익명 ID 행을 덮어쓴다.
 * DB 접속은 두 테이블에 INSERT/UPDATE만 허용한 전용 계정(GMF_DATABASE_URL)으로 한다.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { neon } from '@neondatabase/serverless';
import catalogJson from '../../data/gmf2026/catalog.json';
import type { Catalog } from '../../packages/judge/src/judge';
import { parseSubmission } from './logic';
import type { Submission } from './logic';

const catalog = catalogJson as Catalog;
const FESTIVAL_ID = 'gmf2026';
const BODY_LIMIT = 16 * 1024;

export interface Store {
  save(s: Submission, userAgent: string): Promise<void>;
}

export function neonStore(url: string): Store {
  const sql = neon(url);
  return {
    async save(s, userAgent) {
      const days = [...new Set(s.record.selections.map((x) => x.date))].sort();
      const queries = [
        sql`insert into gmf_records (anon_id, festival_id, form_version, record, selection_count, days, user_agent)
            values (${s.anonId}, ${s.festivalId}, ${s.formVersion}, ${JSON.stringify(s.record)}::jsonb, ${s.record.selections.length}, ${days}, ${userAgent})
            on conflict (anon_id) do update set
              form_version = excluded.form_version, record = excluded.record, selection_count = excluded.selection_count,
              days = excluded.days, user_agent = excluded.user_agent, updated_at = now(), submit_count = gmf_records.submit_count + 1`,
      ];
      if (s.contact)
        queries.push(sql`insert into gmf_contacts (anon_id, contact, consent_result, consent_reshare)
            values (${s.anonId}, ${s.contact.value}, ${s.contact.consentResult}, ${s.contact.consentReshare})
            on conflict (anon_id) do update set
              contact = excluded.contact, consent_result = excluded.consent_result,
              consent_reshare = excluded.consent_reshare, updated_at = now()`);
      await sql.transaction(queries);
    },
  };
}

/** 저장소를 주입받는 순수 처리부 — 테스트에서 가짜 저장소로 돌린다 */
export async function handleSubmit(rawBody: string, userAgent: string, store: Store): Promise<{ status: number; body: Record<string, unknown> }> {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { error: '요청 형식이 올바르지 않아요' } };
  }
  const parsed = parseSubmission(catalog, FESTIVAL_ID, json);
  if (!parsed.ok) return { status: 400, body: { error: parsed.error } };
  try {
    await store.save(parsed.value, userAgent.slice(0, 300));
  } catch (e) {
    console.error('gmf-submit save failed', e);
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
  const r = await handleSubmit(raw, String(req.headers['user-agent'] ?? ''), neonStore(url));
  send(res, r.status, r.body);
}
