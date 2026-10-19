-- 결과 카드 피드백 (MIN-306). 검수 측에서 적용함 — 기록용으로만 커밋. 이 파일을 다시 실행하지 않는다.
-- 앱 계정 gmf_app은 INSERT만 가능 (SELECT 없음 → RETURNING·upsert 사용 안 함)
create table public.gmf_feedback (
  id uuid primary key default gen_random_uuid(),
  anon_id text not null check (anon_id ~ '^g-[2-9A-HJ-NP-Z]{8}$'),
  festival_id text not null,
  form_version text not null,
  judge_version text not null,
  title_id text not null,
  title_label text,
  fit text check (fit in ('yes','partly','no')),
  understood text check (understood in ('yes','no')),
  share text not null check (share in ('story','friends','no')),
  show_parts text[] not null default '{}',
  chips text[] not null default '{}',
  comment text check (char_length(comment) <= 300),
  created_at timestamptz not null default now()
);
create index gmf_feedback_anon_id_idx on public.gmf_feedback (anon_id);
grant insert on public.gmf_feedback to gmf_app;
