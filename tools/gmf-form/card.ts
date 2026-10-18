/**
 * 그민페 결과 카드 — canvas로 1080×1920 PNG를 그린다 (MIN-316 최종 디자인)
 *
 * 기준 디자인: Figma `MY LIVE — 그민페 빌드 SNS` › Result Card (93:48).
 * 좌표는 카드 면(Card, 936×1520) 기준이고 카드 면은 캔버스 (72, 150)에 있다. 값은 CARD 상수에만 둔다.
 *  - 위 덩어리(머리말·칭호·근거)는 위에서부터 흘려 쌓고, 아래 덩어리(숫자·최고 무대·푸터)는 하단에 고정한다
 *  - 칭호와 큰 숫자는 제주돌담체를 미리 그린 흰색 PNG(assets/glyphs)에 성향색을 입혀 그린다 (서체 파일 없음)
 *  - 본문은 Noto Sans KR Bold (Google Fonts)
 *
 * html→이미지 라이브러리 대신 canvas를 쓰는 이유: iOS Safari에서 웹폰트·foreignObject 렌더 실패가 잦고 번들이 무겁다.
 */
import glyphsJson from './assets/glyphs/glyphs.json';
import type { CardSummary, TitleId, TitleResult } from './titles';
import { TITLE_COLORS } from './titles';

/** PNG는 기기 픽셀 비율과 무관하게 1080×1920 */
export const CARD_PX = { W: 1080, H: 1920 };

/** 정적 파일 경로 — build.mjs가 assets/glyphs를 /gmf/glyphs로 배포한다 */
export const GLYPH_BASE = '/gmf/glyphs/';

interface GlyphImg {
  file: string;
  w: number;
  h?: number;
  advance?: number;
}
export const GLYPHS = glyphsJson as unknown as {
  fontSize: number;
  height: number;
  baseline: number;
  padX: number;
  titles: Record<TitleId, { lines: (GlyphImg & { text: string })[]; inline: GlyphImg & { text: string } }>;
  digits: Record<string, GlyphImg & { advance: number }>;
};

const CREAM = '#F2EBDD';
export const CARD = {
  face: { x: 72, y: 150, w: 936, h: 1520, r: 44 },
  padX: 64,
  inner: 808,
  color: {
    canvas: '#0E0C0B',
    face: '#14110F',
    cream: CREAM,
    dim: 'rgba(242, 235, 221, 0.72)',
    line: 'rgba(242, 235, 221, 0.16)',
    box: 'rgba(242, 235, 221, 0.08)',
    pink: '#EF96AB',
    shadow: 'rgba(5, 4, 3, 0.6)',
  },
  stageColor: { 'mint-breeze': '#519E98', 'club-midnight-sunset': '#F17A7C', 'loving-forest-garden': '#EF96AB' } as Record<string, string>,
  font: '"Noto Sans KR", "Apple SD Gothic Neo", sans-serif',
  glow: { cx: 160, cy: 40, rx: 380, ry: 280, alpha: 0.45 },
  top: { y: 60, size: 36, line: 50, dot: 20, dotGap: 8 },
  head: { y: 138, size: 36, line: 50 },
  title: { y: 266, line: 160, minLine: 120 },
  others: { gap: 20, size: 30, h: 66, padX: 24, border: 2 },
  evidence: { gap: 24, size: 44, line: 64, maxLines: 2, spacing: -0.01 },
  subline: { gap: 8, size: 36, line: 50 },
  /** 위 덩어리 아래 끝 한계 (숫자 위 40px) */
  topLimit: 824,
  stats: { y: 864, yNoBest: 1148, num: 140, unitGap: 6, unitSize: 36, unitLine: 50, unitSpacing: 0.1, divider: { w: 3, h: 150, gap: 40 } },
  best: { y: 1108, h: 236, r: 28, pad: 36, border: 2, labelSize: 36, nameSize: 44, metaSize: 36, labelY: 30, nameY: 86, metaY: 156, dot: 20 },
  ticket: { y: 1372, w: 3, dash: [12, 10] },
  foot: { y: 1400, h: 64, size: 44, urlSize: 36 },
  outline: { w: 3 },
  grain: { alpha: 0.12, seed: 20261018 },
  photo: { tint: 0.45, maxSide: 1600, shadowBlur: 18, shadowY: 2 },
};

export const CARD_TEXT = {
  place: '올림픽공원',
  head1: '나의 페스티벌 성향',
  head2: '그랜드 민트 페스티벌 2026',
  others: (n: number) => `외 칭호 ${n}개`,
  artists: 'ARTISTS',
  minutes: 'MINUTES',
  bestLabel: '이번 그민페 최고의 무대',
  logo: 'MY LIVE',
  logoAccent: 'GMF',
  url: 'my-live-2026.vercel.app',
};

export interface CardInput {
  title: TitleResult;
  /** 보조 줄이 한 줄을 넘을 때 쓸 2팀 버전 */
  sublineShort: string | null;
  summary: CardSummary;
  /** 배경 사진 (이미 줄여 둔 것) */
  photo?: CanvasImageSource & { width: number; height: number };
}

type Ctx = CanvasRenderingContext2D;
const font = (size: number) => `700 ${size}px ${CARD.font}`;
const fx = (x: number) => CARD.face.x + x;
const fy = (y: number) => CARD.face.y + y;

/* ───────── 이미지 불러오기 ───────── */

const imgCache = new Map<string, Promise<HTMLImageElement>>();
function loadImg(file: string): Promise<HTMLImageElement> {
  let p = imgCache.get(file);
  if (!p) {
    p = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`글자 이미지를 불러오지 못했어요 (${file})`));
      img.src = GLYPH_BASE + file;
    }).then(async (img) => {
      try {
        await img.decode();
      } catch {}
      return img;
    });
    p.catch(() => imgCache.delete(file));
    imgCache.set(file, p);
  }
  return p;
}

function glyphFiles(d: CardInput): string[] {
  const t = GLYPHS.titles[d.title.id];
  const nums = `${d.summary.views}${fmtNum(d.summary.minutes)}`;
  return [...t.lines.map((l) => l.file), ...[...new Set(nums)].map((c) => GLYPHS.digits[c].file)];
}

/** 카드에 쓰는 글자 이미지를 전부 받아 둔다 */
export async function loadGlyphs(d: CardInput): Promise<Map<string, HTMLImageElement>> {
  const files = glyphFiles(d);
  const imgs = await Promise.all(files.map(loadImg));
  return new Map(files.map((f, i) => [f, imgs[i]]));
}

export const fmtNum = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/* ───────── 그리기 도우미 ───────── */

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** 고정 시드 난수 — 그레인·손그림이 매번 같게 */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

/** 손그림 외곽선: 1px 안팎으로 흔든 둥근 사각형을 두 번 그린다 (도형에만) */
function sketchRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, lineW: number, color: string, seed: number) {
  const rand = rng(seed);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineW;
  ctx.lineJoin = 'round';
  for (let pass = 0; pass < 2; pass++) {
    const j = () => (rand() - 0.5) * 2 * (pass ? 1.1 : 0.6);
    ctx.globalAlpha = pass ? 0.55 : 1;
    roundRect(ctx, x + j(), y + j(), w + j(), h + j(), r + j());
    ctx.stroke();
  }
  ctx.restore();
}

/** 한 줄 글자 (lineH 안에서 세로 가운데). spacing = 자간(글자 크기 대비) */
function text(ctx: Ctx, s: string, x: number, y: number, lineH: number, size: number, color: string, align: CanvasTextAlign = 'left', spacing = 0) {
  ctx.font = font(size);
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  const cy = y + lineH / 2;
  if (!spacing) {
    ctx.textAlign = align;
    ctx.fillText(s, x, cy);
    return ctx.measureText(s).width;
  }
  // 자간: 글자를 하나씩 옮겨 그린다 (canvas letterSpacing은 iOS 16 이하에 없음)
  const gap = size * spacing;
  const chars = [...s];
  const w = chars.reduce((a, c) => a + ctx.measureText(c).width, 0) + gap * (chars.length - 1);
  let cx = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
  ctx.textAlign = 'left';
  for (const c of chars) {
    ctx.fillText(c, cx, cy);
    cx += ctx.measureText(c).width + gap;
  }
  return w;
}

/** 띄어쓰기 단위로 줄바꿈, 한 단어가 너비를 넘으면 글자 단위로 자른다 */
export function wrap(ctx: Ctx, s: string, maxW: number): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const word of s.split(' ')) {
    const next = cur ? `${cur} ${word}` : word;
    if (ctx.measureText(next).width <= maxW) {
      cur = next;
      continue;
    }
    if (cur) lines.push(cur);
    cur = '';
    for (const ch of word) {
      if (cur && ctx.measureText(cur + ch).width > maxW) {
        lines.push(cur);
        cur = '';
      }
      cur += ch;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** 흰 글자 이미지에 색을 입힌 캔버스 */
function tint(img: HTMLImageElement, color: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth || img.width;
  c.height = img.naturalHeight || img.height;
  const g = c.getContext('2d')!;
  g.drawImage(img, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

function grain(ctx: Ctx) {
  const { W, H } = CARD_PX;
  const c = document.createElement('canvas');
  // 반 해상도로 만들어 늘린다 (입자감 + 속도)
  c.width = W / 2;
  c.height = H / 2;
  const g = c.getContext('2d')!;
  const data = g.createImageData(c.width, c.height);
  const rand = rng(CARD.grain.seed);
  for (let i = 0; i < data.data.length; i += 4) {
    const v = rand() < 0.5 ? 0 : 255;
    data.data[i] = data.data[i + 1] = data.data[i + 2] = v;
    data.data[i + 3] = Math.floor(rand() * 255 * CARD.grain.alpha);
  }
  g.putImageData(data, 0, 0);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(c, 0, 0, W, H);
  ctx.restore();
}

/* ───────── 영역 ───────── */

function drawBackground(ctx: Ctx, d: CardInput) {
  const f = CARD.face;
  ctx.fillStyle = CARD.color.canvas;
  ctx.fillRect(0, 0, CARD_PX.W, CARD_PX.H);
  ctx.save();
  roundRect(ctx, f.x, f.y, f.w, f.h, f.r);
  ctx.clip();
  ctx.fillStyle = CARD.color.face;
  ctx.fillRect(f.x, f.y, f.w, f.h);
  if (d.photo) drawPhoto(ctx, d.photo);
  // 빛번짐: 성향색 타원 방사형 그라데이션 (카드 면 밖으로 안 나감)
  const gl = CARD.glow;
  ctx.save();
  ctx.translate(fx(gl.cx), fy(gl.cy));
  ctx.scale(1, gl.ry / gl.rx);
  const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, gl.rx);
  const color = TITLE_COLORS[d.title.id];
  grad.addColorStop(0, hexA(color, gl.alpha));
  grad.addColorStop(1, hexA(color, 0));
  ctx.fillStyle = grad;
  ctx.fillRect(-gl.rx, -gl.rx, gl.rx * 2, gl.rx * 2);
  ctx.restore();
  ctx.restore();
  grain(ctx);
}

function drawPhoto(ctx: Ctx, photo: CanvasImageSource & { width: number; height: number }) {
  const f = CARD.face;
  const s = Math.max(f.w / photo.width, f.h / photo.height);
  const w = photo.width * s;
  const h = photo.height * s;
  ctx.drawImage(photo, f.x + (f.w - w) / 2, f.y + (f.h - h) / 2, w, h);
  ctx.fillStyle = `rgba(0, 0, 0, ${CARD.photo.tint})`;
  ctx.fillRect(f.x, f.y, f.w, f.h);
  const g = ctx.createLinearGradient(0, f.y, 0, f.y + f.h);
  g.addColorStop(0, 'rgba(0, 0, 0, 0.55)');
  g.addColorStop(0.3, 'rgba(0, 0, 0, 0)');
  g.addColorStop(0.6, 'rgba(0, 0, 0, 0)');
  g.addColorStop(1, 'rgba(0, 0, 0, 0.7)');
  ctx.fillStyle = g;
  ctx.fillRect(f.x, f.y, f.w, f.h);
}

function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function drawTop(ctx: Ctx, d: CardInput) {
  const t = CARD.top;
  const x = fx(CARD.padX);
  text(ctx, `${d.summary.dateLabel} · ${CARD_TEXT.place}`, x, fy(t.y), t.line, t.size, CARD.color.dim);
  const ids = ['mint-breeze', 'club-midnight-sunset', 'loving-forest-garden'];
  let dx = fx(CARD.padX + CARD.inner) - ids.length * t.dot - (ids.length - 1) * t.dotGap;
  for (const id of ids) {
    ctx.beginPath();
    ctx.arc(dx + t.dot / 2, fy(t.y) + t.line / 2, t.dot / 2, 0, Math.PI * 2);
    ctx.fillStyle = CARD.stageColor[id];
    ctx.fill();
    dx += t.dot + t.dotGap;
  }
  const h = CARD.head;
  text(ctx, CARD_TEXT.head1, x, fy(h.y), h.line, h.size, CARD.color.cream);
  text(ctx, CARD_TEXT.head2, x, fy(h.y + h.line), h.line, h.size, CARD.color.pink);
}

interface TopLayout {
  line: number;
  bottom: number;
  evidence: string[];
  subline: string | null;
}

/** 위 덩어리 배치 계산 — 칭호 줄 높이(line)를 정하면 각 요소 위치가 나온다 */
function layoutTop(ctx: Ctx, d: CardInput, line: number): TopLayout {
  const t = d.title;
  let y = CARD.title.y + line * GLYPHS.titles[t.id].lines.length;
  if (t.others.length) y += CARD.others.gap + CARD.others.h;
  const e = CARD.evidence;
  ctx.font = font(e.size);
  const evidence = wrap(ctx, t.evidence, CARD.inner).slice(0, e.maxLines);
  y += e.gap + e.line * evidence.length;
  let subline: string | null = null;
  if (t.subline) {
    ctx.font = font(CARD.subline.size);
    subline = ctx.measureText(t.subline).width <= CARD.inner ? t.subline : d.sublineShort ?? t.subline;
    y += CARD.subline.gap + CARD.subline.line;
  }
  return { line, bottom: y, evidence, subline };
}

function drawTitleBlock(ctx: Ctx, d: CardInput, glyphs: Map<string, HTMLImageElement>, l: TopLayout) {
  const t = d.title;
  const color = TITLE_COLORS[t.id];
  const lines = GLYPHS.titles[t.id].lines;
  // 줄 높이 → 이미지 배율 (글자 크기 200 기준 이미지). 가장 긴 줄이 폭을 넘으면 두 줄 모두 같은 비율로 줄인다
  let scale = l.line / GLYPHS.fontSize;
  const widest = Math.max(...lines.map((x) => x.w - GLYPHS.padX * 2));
  if (widest * scale > CARD.inner) scale = CARD.inner / widest;
  let y = fy(CARD.title.y);
  for (const ln of lines) {
    const img = glyphs.get(ln.file)!;
    const c = tint(img, color);
    ctx.drawImage(c, fx(CARD.padX) - GLYPHS.padX * scale, y + (l.line - GLYPHS.height * scale) / 2, c.width * scale, c.height * scale);
    y += l.line;
  }
  if (t.others.length) {
    const o = CARD.others;
    y += o.gap;
    ctx.font = font(o.size);
    const label = CARD_TEXT.others(t.others.length);
    const w = ctx.measureText(label).width + o.padX * 2;
    shapeShadowOff(ctx, () => sketchRect(ctx, fx(CARD.padX) + o.border / 2, y + o.border / 2, w - o.border, o.h - o.border, o.h / 2, o.border, CARD.color.cream, 11));
    text(ctx, label, fx(CARD.padX) + w / 2, y, o.h, o.size, CARD.color.cream, 'center');
    y += o.h;
  }
  const e = CARD.evidence;
  y += e.gap;
  for (const s of l.evidence) {
    text(ctx, s, fx(CARD.padX), y, e.line, e.size, CARD.color.cream, 'left', e.spacing);
    y += e.line;
  }
  if (l.subline) {
    const s = CARD.subline;
    y += s.gap;
    text(ctx, l.subline, fx(CARD.padX), y, s.line, s.size, CARD.color.dim);
  }
}

/** 도형은 그림자 없이 그린다 (사진 카드에서 글자에만 그림자) */
function shapeShadowOff(ctx: Ctx, draw: () => void) {
  ctx.save();
  ctx.shadowColor = 'transparent';
  draw();
  ctx.restore();
}

function drawNumber(ctx: Ctx, glyphs: Map<string, HTMLImageElement>, s: string, x: number, y: number, size: number): number {
  const scale = size / GLYPHS.fontSize;
  let cx = x;
  const cream = new Map<string, HTMLCanvasElement>();
  for (const ch of s) {
    const g = GLYPHS.digits[ch];
    const img = glyphs.get(g.file)!;
    let c = cream.get(ch);
    if (!c) cream.set(ch, (c = tint(img, CARD.color.cream)));
    ctx.drawImage(c, cx - GLYPHS.padX * scale, y + (size - GLYPHS.height * scale) / 2, c.width * scale, c.height * scale);
    cx += g.advance * scale;
  }
  return cx - x;
}

function drawBottom(ctx: Ctx, d: CardInput, glyphs: Map<string, HTMLImageElement>) {
  const st = CARD.stats;
  const best = d.summary.best;
  const sy = fy(best ? st.y : st.yNoBest);
  const x = fx(CARD.padX);
  const unit = (s: string, ux: number) => text(ctx, s, ux, sy + st.num + st.unitGap, st.unitLine, st.unitSize, CARD.color.dim, 'left', st.unitSpacing);
  const w1 = Math.max(drawNumber(ctx, glyphs, String(d.summary.views), x, sy, st.num), measureSpaced(ctx, CARD_TEXT.artists, st.unitSize, st.unitSpacing));
  unit(CARD_TEXT.artists, x);
  const dv = st.divider;
  const divX = x + w1 + dv.gap;
  shapeShadowOff(ctx, () => {
    roundRect(ctx, divX, sy + st.num + st.unitGap + st.unitLine - dv.h, dv.w, dv.h, dv.w / 2);
    ctx.fillStyle = CARD.color.line;
    ctx.fill();
  });
  const x2 = divX + dv.w + dv.gap;
  drawNumber(ctx, glyphs, fmtNum(d.summary.minutes), x2, sy, st.num);
  unit(CARD_TEXT.minutes, x2);

  if (best) {
    const b = CARD.best;
    const by = fy(b.y);
    shapeShadowOff(ctx, () => {
      roundRect(ctx, x, by, CARD.inner, b.h, b.r);
      ctx.fillStyle = CARD.color.box;
      ctx.fill();
      sketchRect(ctx, x + b.border / 2, by + b.border / 2, CARD.inner - b.border, b.h - b.border, b.r, b.border, CARD.color.cream, 23);
    });
    const ix = x + b.pad;
    const iw = CARD.inner - b.pad * 2;
    text(ctx, CARD_TEXT.bestLabel, ix, by + b.labelY, 50, b.labelSize, CARD.color.dim);
    let ns = b.nameSize;
    for (; ns > 28; ns -= 2) {
      ctx.font = font(ns);
      if (ctx.measureText(best.name).width <= iw) break;
    }
    text(ctx, best.name, ix, by + b.nameY, 64, ns, CARD.color.cream);
    shapeShadowOff(ctx, () => {
      ctx.beginPath();
      ctx.arc(ix + b.dot / 2, by + b.metaY + 25, b.dot / 2, 0, Math.PI * 2);
      ctx.fillStyle = CARD.stageColor[best.stageId] ?? CARD.color.cream;
      ctx.fill();
    });
    text(ctx, `${best.date} · ${best.stage} · ${best.start}`, ix + b.dot + 12, by + b.metaY, 50, b.metaSize, CARD.color.dim);
  }

  const tk = CARD.ticket;
  shapeShadowOff(ctx, () => {
    ctx.save();
    ctx.strokeStyle = CARD.color.cream;
    ctx.lineWidth = tk.w;
    ctx.setLineDash(tk.dash);
    ctx.beginPath();
    ctx.moveTo(x, fy(tk.y));
    ctx.lineTo(x + CARD.inner, fy(tk.y));
    ctx.stroke();
    ctx.restore();
  });

  const f = CARD.foot;
  const lw = text(ctx, `${CARD_TEXT.logo} `, x, fy(f.y), f.h, f.size, CARD.color.cream);
  text(ctx, CARD_TEXT.logoAccent, x + lw, fy(f.y), f.h, f.size, CARD.color.pink);
  text(ctx, CARD_TEXT.url, x + CARD.inner, fy(f.y), f.h, f.urlSize, CARD.color.dim, 'right');
}

function measureSpaced(ctx: Ctx, s: string, size: number, spacing: number) {
  ctx.font = font(size);
  const chars = [...s];
  return chars.reduce((a, c) => a + ctx.measureText(c).width, 0) + size * spacing * (chars.length - 1);
}

/* ───────── 조립 ───────── */

/** 위 덩어리가 숫자 위 40px을 넘으면 칭호를 120px까지 줄인다. 그래도 넘치면 overflow = true */
export function topLayout(ctx: Ctx, d: CardInput): TopLayout & { overflow: boolean } {
  const limit = d.summary.best ? CARD.topLimit : CARD.stats.yNoBest - 40;
  let l = layoutTop(ctx, d, CARD.title.line);
  for (let line = CARD.title.line - 8; l.bottom > limit && line >= CARD.title.minLine; line -= 8) l = layoutTop(ctx, d, line);
  return { ...l, overflow: l.bottom > limit };
}

export function drawCard(canvas: HTMLCanvasElement, d: CardInput, glyphs: Map<string, HTMLImageElement>): { overflow: boolean } {
  canvas.width = CARD_PX.W;
  canvas.height = CARD_PX.H;
  const ctx = canvas.getContext('2d')!;
  drawBackground(ctx, d);
  const f = CARD.face;
  sketchRect(ctx, f.x + CARD.outline.w / 2, f.y + CARD.outline.w / 2, f.w - CARD.outline.w, f.h - CARD.outline.w, f.r, CARD.outline.w, CARD.color.cream, 7);
  ctx.save();
  if (d.photo) {
    ctx.shadowColor = CARD.color.shadow;
    ctx.shadowBlur = CARD.photo.shadowBlur;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = CARD.photo.shadowY;
  }
  const l = topLayout(ctx, d);
  drawTop(ctx, d);
  drawTitleBlock(ctx, d, glyphs, l);
  drawBottom(ctx, d, glyphs);
  ctx.restore();
  return { overflow: l.overflow };
}

/** 본문 웹폰트(Noto Sans KR Bold)를 미리 받는다. 느리면 timeoutMs 뒤 대체 글꼴로 그린다 */
export async function loadCardFonts(d: CardInput, timeoutMs = 4000): Promise<boolean> {
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (!fonts?.load) return false;
  const s = d.summary;
  const body = [
    CARD_TEXT.place,
    CARD_TEXT.head1,
    CARD_TEXT.head2,
    CARD_TEXT.others(0),
    CARD_TEXT.artists,
    CARD_TEXT.minutes,
    CARD_TEXT.bestLabel,
    CARD_TEXT.logo,
    CARD_TEXT.logoAccent,
    CARD_TEXT.url,
    d.title.evidence,
    d.title.subline ?? '',
    d.sublineShort ?? '',
    s.dateLabel,
    s.best ? `${s.best.name}${s.best.date}${s.best.stage}${s.best.start}` : '',
    '0123456789 ·—',
  ].join('');
  const job = fonts
    .load(font(36), body)
    .then((l) => l.length > 0)
    .catch(() => false);
  const timeout = new Promise<boolean>((r) => setTimeout(() => r(false), timeoutMs));
  return Promise.race([job, timeout]);
}

/** 사진 파일 → EXIF 회전 반영 + 긴 변 maxSide로 줄인 캔버스 (서버로 보내지 않음) */
export async function loadPhoto(file: File): Promise<HTMLCanvasElement> {
  let src: (CanvasImageSource & { width: number; height: number }) | null = null;
  let close = () => {};
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    src = bmp;
    close = () => bmp.close();
  } catch {
    // createImageBitmap이 없거나 HEIC 등을 못 읽으면 <img>로 (최신 브라우저는 EXIF 회전을 자동 반영)
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      src = img;
    } finally {
      close = () => URL.revokeObjectURL(url);
    }
  }
  if (!src) throw new Error('사진을 읽지 못했어요');
  const w0 = (src as HTMLImageElement).naturalWidth || src.width;
  const h0 = (src as HTMLImageElement).naturalHeight || src.height;
  const s = Math.min(1, CARD.photo.maxSide / Math.max(w0, h0));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w0 * s));
  c.height = Math.max(1, Math.round(h0 * s));
  c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height);
  close();
  return c;
}
