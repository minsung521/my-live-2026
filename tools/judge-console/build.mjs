import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = await build({
  entryPoints: [join(here, 'app.ts')],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  write: false,
  legalComments: 'none',
});
const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const html = readFileSync(join(here, 'template.html'), 'utf8').replace('/*__APP__*/', () => js);
mkdirSync(join(here, 'dist'), { recursive: true });
writeFileSync(join(here, 'dist/index.html'), html);
console.log(`tools/judge-console/dist/index.html ${(html.length / 1024).toFixed(1)} KB`);
