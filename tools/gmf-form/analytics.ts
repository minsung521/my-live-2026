/**
 * PostHog 계측 (프로젝트 "MY LIVE 2026", US 클라우드)
 *
 * 그민페 테스트 폼과 앞으로의 본 서비스가 같은 PostHog 프로젝트를 쓰고, `surface` 슈퍼 속성으로 구분한다.
 * 이벤트는 같은 도메인의 /ingest 로 보내 Vercel이 PostHog로 넘긴다 (광고 차단기 회피, .vercel/output/config.json 라우트).
 *
 * 개인정보: 연락처는 어떤 이벤트에도 넣지 않는다. 입력창 내용은 세션 녹화에서도 가려진다(maskAllInputs 기본값).
 * 제출에 성공하면 DB와 같은 익명 ID로 identify 해서 이벤트와 DB 기록을 이어 볼 수 있게 한다.
 * 로컬 파일 미리보기(file://)에서는 아무것도 보내지 않는다.
 *
 * 무게: npm 패키지를 번들하면 화면이 300KB를 넘어서(축제 현장 모바일 데이터 기준 과함),
 * PostHog 스니펫과 같은 방식으로 호출을 큐에 쌓아 두고 SDK(array.js)는 화면이 뜬 뒤 비동기로 불러온다.
 * array.js가 로드되면 window.posthog._i(초기화)와 큐에 쌓인 호출을 그대로 재생한다.
 */
type Stub = unknown[] & { _i: unknown[][]; __SV?: number; [method: string]: unknown };
type Win = { posthog?: Stub };

export const POSTHOG_TOKEN = 'phc_vf7SqHhSkrWQazCaEj7qUsiNcXmbBHQqvQBQV54n2VX9';

let enabled = false;

function stub(): Stub {
  const w = window as unknown as Win;
  if (w.posthog) return w.posthog;
  const q = [] as unknown as Stub;
  q._i = [];
  for (const m of ['capture', 'register', 'identify']) q[m] = (...args: unknown[]) => void q.push([m, ...args]);
  q.init = (token: unknown, config: unknown) => {
    q._i.push([token, config, 'posthog']);
    const s = document.createElement('script');
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.src = '/ingest/static/array.js';
    document.head.appendChild(s);
  };
  q.__SV = 1;
  w.posthog = q;
  return q;
}

// SDK가 로드되면 window.posthog가 실제 인스턴스로 교체되므로 매번 window에서 다시 꺼낸다
function call(method: string, ...args: unknown[]) {
  const p = (window as unknown as Win).posthog as unknown as Record<string, ((...a: unknown[]) => void) | undefined> | undefined;
  p?.[method]?.(...args);
}

export function initAnalytics(superProps: Record<string, string>) {
  if (location.protocol === 'file:') return;
  try {
    const q = stub();
    (q.init as (token: string, config: object) => void)(POSTHOG_TOKEN, {
      api_host: '/ingest',
      ui_host: 'https://us.posthog.com',
      person_profiles: 'identified_only',
      capture_pageview: true,
      capture_pageleave: true,
      autocapture: false,
    });
    call('register', superProps);
    enabled = true;
  } catch {}
}

export function track(event: string, props: Record<string, unknown> = {}) {
  if (!enabled) return;
  try {
    call('capture', event, props);
  } catch {}
}

export function identify(anonId: string) {
  if (!enabled) return;
  try {
    call('identify', anonId);
  } catch {}
}
