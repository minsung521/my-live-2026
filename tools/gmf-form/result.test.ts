/** 결과 화면 순수 함수: PC/휴대폰·인앱 판별 (npm run test:form) */
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

console.log(fail ? `\n${fail}개 실패` : '\n모두 통과');
process.exit(fail ? 1 : 0);
