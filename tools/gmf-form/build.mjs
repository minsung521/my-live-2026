/**
 * 폼 빌드.
 * - tools/gmf-form/dist/index.html: 화면 (로컬 미리보기용)
 * - .vercel/output: Vercel Build Output API v3 — 정적 화면 + 제주돌담체 글자 이미지(/gmf/glyphs) + POST /api/gmf-submit·/api/gmf-feedback·/api/gmf-contact 함수 (esbuild로 한 파일씩 묶음)
 *
 * 경로 (Vercel 프로젝트 하나에서 그민페 테스트와 앞으로의 본 서비스를 함께 운영)
 * - /gmf          그민페 기록 수집 폼
 * - /             본 서비스 자리. 앱이 생기기 전까지는 /gmf로 임시 이동(307)
 * - /ingest/*     PostHog(US) 프록시
 */
import { build } from 'esbuild';
import { cpSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');

const client = await build({
  entryPoints: [join(here, 'app.ts')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  write: false,
  legalComments: 'none',
});
const js = client.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const html = readFileSync(join(here, 'template.html'), 'utf8').replace('/*__APP__*/', () => js);
mkdirSync(join(here, 'dist'), { recursive: true });
writeFileSync(join(here, 'dist/index.html'), html);
console.log(`tools/gmf-form/dist/index.html ${(html.length / 1024).toFixed(1)} KB`);

const out = join(root, '.vercel/output');
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'static/gmf'), { recursive: true });
writeFileSync(join(out, 'static/gmf/index.html'), html);
// 글자 이미지는 번들 밖 정적 파일 (카드를 그릴 때 필요한 것만 받는다)
const glyphFilter = (src) => !src.endsWith('.md');
cpSync(join(here, 'assets/glyphs'), join(out, 'static/gmf/glyphs'), { recursive: true, filter: glyphFilter });
const routes = [
  { src: '^/ingest/static/(.*)$', dest: 'https://us-assets.i.posthog.com/static/$1' },
  { src: '^/ingest/(.*)$', dest: 'https://us.i.posthog.com/$1' },
  { src: '^/gmf/$', status: 308, headers: { Location: '/gmf' } },
  { src: '^/gmf$', dest: '/gmf/index.html' },
  // 본 서비스가 생기면 이 줄을 지운다
  { src: '^/$', status: 307, headers: { Location: '/gmf' } },
  { handle: 'filesystem' },
];
writeFileSync(join(out, 'config.json'), JSON.stringify({ version: 3, routes }, null, 2));

// 함수: 기록 저장(gmf-submit) + 피드백 저장(gmf-feedback) + 연락처 저장(gmf-contact). 같은 설정으로 한 파일씩 묶는다
for (const [name, entry] of [
  ['gmf-submit', 'server.ts'],
  ['gmf-feedback', 'feedback-server.ts'],
  ['gmf-contact', 'contact-server.ts'],
]) {
  const fn = join(out, `functions/api/${name}.func`);
  mkdirSync(fn, { recursive: true });
  await build({
    entryPoints: [join(here, entry)],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    outfile: join(fn, 'index.mjs'),
    legalComments: 'none',
    // esm 번들 안에서 require를 쓰는 의존성 대비
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  });
  writeFileSync(
    join(fn, '.vc-config.json'),
    JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false, regions: ['sin1'] }, null, 2),
  );
}
console.log('.vercel/output (/gmf + /gmf/glyphs + /api/gmf-submit + /api/gmf-feedback + /api/gmf-contact + /ingest 프록시)');
