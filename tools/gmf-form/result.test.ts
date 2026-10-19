/** 결과 화면 순수 함수: PC/휴대폰·인앱 판별 (npm run test:form) */
import { readFileSync } from 'node:fs';
import { CARD, CARD_PX, EXPORT_CARD_SCALE, EXPORT_FACE, SCREEN_CROP_PAD, screenCrop } from './card';
import { isInApp, isMobile } from './result';

let fail = 0;
const ok = (cond: unknown, msg: string) => {
  if (cond) console.log(`  ✓ ${msg}`);
  else (fail++, console.log(`  ✗ ${msg}`));
};

const UA = {
  winChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  winEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  insta: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0.0.0',
  kakao: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36 KAKAOTALK 10.8.0',
};
ok(!isMobile(UA.winChrome, 0) && !isMobile(UA.winEdge, 10), 'Windows Chrome·Edge(터치 노트북 포함) = PC');
ok(!isMobile(UA.macSafari, 0), 'Mac Safari = PC');
ok(isMobile(UA.macSafari, 5), 'iPadOS(Mac UA + 터치) = 휴대폰·태블릿');
ok(isMobile(UA.iphone, 5) && isMobile(UA.android, 5), '아이폰·안드로이드 = 휴대폰');
ok(isInApp(UA.insta) && isInApp(UA.kakao), '인스타·카톡 = 인앱');
ok(!isInApp(UA.iphone) && !isInApp(UA.winChrome) && !isInApp(UA.android), 'Safari·Chrome = 인앱 아님');

console.log('· 저장 PNG 구도·화면 자르기');
const near = (a: number, b: number, eps = 0.01) => Math.abs(a - b) <= eps;
ok(CARD_PX.W === 1080 && CARD_PX.H === 1920, 'PNG 1080×1920');
ok(EXPORT_CARD_SCALE === 0.85, 'EXPORT_CARD_SCALE 0.85');
ok(near(EXPORT_FACE.w, 795.6) && near(EXPORT_FACE.h, 1292) && near(EXPORT_FACE.x, 142.2) && near(EXPORT_FACE.y, 314), `카드 면 약 796×1292 · x 142 · y 314 (${EXPORT_FACE.x}, ${EXPORT_FACE.y}, ${EXPORT_FACE.w}×${EXPORT_FACE.h})`);
ok(near(EXPORT_FACE.x * 2 + EXPORT_FACE.w, CARD_PX.W) && near(EXPORT_FACE.y * 2 + EXPORT_FACE.h, CARD_PX.H), '캔버스 가운데');
const c = screenCrop();
const pad = SCREEN_CROP_PAD * EXPORT_CARD_SCALE;
ok(near(EXPORT_FACE.x - c.x, pad) && near(c.x + c.w - (EXPORT_FACE.x + EXPORT_FACE.w), pad) && near(EXPORT_FACE.y - c.y, pad) && near(c.y + c.h - (EXPORT_FACE.y + EXPORT_FACE.h), pad), `화면 자르기 = 카드 면 + 사방 ${SCREEN_CROP_PAD}px(축소 비율 적용 ${pad.toFixed(1)}px)`);
// 손그림 테두리: 두께 3 + 흔들림 최대 1.1px → 카드 면 경계에서 바깥으로 3px 안쪽에 들어와야 함
ok(SCREEN_CROP_PAD > CARD.outline.w + 1.1, '여유가 테두리 두께·흔들림보다 큼');
ok(c.x >= 0 && c.y >= 0 && c.x + c.w <= CARD_PX.W && c.y + c.h <= CARD_PX.H, '자르기 영역이 PNG 안');
const css = readFileSync(new URL('./template.html', import.meta.url), 'utf8');
const v = (name: string) => css.match(new RegExp(`--crop-${name}: ([^;]+);`))?.[1].trim() ?? '';
const pct = (s: string) => parseFloat(s);
ok(v('ar') === c.css.ar, `--crop-ar = ${c.css.ar} (${v('ar')})`);
ok(near(pct(v('hw')), c.h / c.w, 1e-4), `--crop-hw = ${(c.h / c.w).toFixed(5)} (${v('hw')})`);
ok(near(pct(v('w')), c.css.width, 1e-3) && near(pct(v('l')), c.css.left, 1e-3) && near(pct(v('t')), c.css.top, 1e-3), `--crop-w·l·t (${v('w')}, ${v('l')}, ${v('t')})`);
const [rx, ry] = v('r').split('/').map(pct);
ok(near(rx, c.css.radiusX, 1e-3) && near(ry, c.css.radiusY, 1e-3), `--crop-r (${v('r')})`);

console.log(fail ? `\n${fail}개 실패` : '\n모두 통과');
process.exit(fail ? 1 : 0);
