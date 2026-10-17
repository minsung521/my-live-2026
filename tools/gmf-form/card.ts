/**
 * 그민페 결과 카드 — canvas로 1080×1920 PNG를 그린다 (MIN-306)
 *
 * 기준 디자인: Figma `MY LIVE — 그민페 빌드 SNS` › Result Card (예시) node 4:27 (600×1066).
 * 좌표·크기는 600 기준으로 적고 SCALE(1.8)을 곱해 그린다. 디자인은 임시라(MIN-314에서 재결정)
 * 값은 CARD 상수에만 두고 그리기 함수는 위에서 아래로 쌓는 단순한 흐름으로 둔다.
 *
 * html→이미지 라이브러리 대신 canvas를 쓰는 이유: iOS Safari에서 웹폰트·foreignObject 렌더 실패가 잦고 번들이 무겁다.
 * Black Han Sans에 없는 글자(가운뎃점 등)는 글꼴 목록의 Noto Sans KR로 그려진다.
 */
import type { CardSummary, TitleResult } from './titles';

/** PNG는 기기 픽셀 비율과 무관하게 1080×1920 */
export const CARD_PX = { W: 1080, H: 1920 };

export const CARD = {
  W: 600,
  /** 1920 ÷ 1.8 (Figma 프레임은 1066) */
  H: CARD_PX.H / 1.8,
  SCALE: 1.8,
  PAD_X: 48,
  PAD_Y: 44,
  GAP: 20,
  RADIUS: 28,
  color: {
    bg: '#14110F',
    cream: '#F2EBDD',
    creamDim: 'rgba(242, 235, 221, 0.62)',
    coral: '#F17A7C',
    box: 'rgba(242, 235, 221, 0.08)',
  },
  stageColor: { 'mint-breeze': '#519E98', 'club-midnight-sunset': '#F17A7C', 'loving-forest-garden': '#EF96AB' } as Record<string, string>,
  font: { display: '"Black Han Sans", "Noto Sans KR", sans-serif', body: '"Noto Sans KR", "Apple SD Gothic Neo", sans-serif' },
  top: { size: 22, line: 1.4, tagPadX: 16, tagPadY: 6, tagBorder: 2 },
  label: { size: 26, line: 1.3 },
  title: { size: 80, minSize: 44, line: 1.08, maxLines: 3 },
  evidence: { size: 32, line: 1.55 },
  subline: { size: 22, line: 1.4, gap: 8 },
  stats: { size: 128, heroSize: 200, unitSize: 40, gap: 32 },
  bar: { h: 20, gap: 6, r: 6 },
  ratio: { size: 22, line: 1.4 },
  best: { padX: 24, padY: 20, gap: 8, dayGap: 16, r: 16, labelSize: 22, nameSize: 56, nameSizeTwoDays: 40, nameLine: 1.2, metaSize: 22, metaLine: 1.4 },
  foot: { logoSize: 56, line: 1.2, handleSize: 26 },
};

export const CARD_TEXT = {
  festival: 'GRAND MINT FESTIVAL 2026',
  tag: '비공식 테스트',
  label: '나의 그민페 관객 유형',
  labelStatsOnly: '나의 그민페 기록',
  unit: '무대',
  bestLabel: '이번 그민페 최고의 무대',
  logo: 'MY LIVE',
  handle: '@mylive.recap',
};

export interface CardInput {
  title: TitleResult;
  /** 보조 줄이 한 줄을 넘을 때 쓸 2팀 버전 */
  sublineShort: string | null;
  summary: CardSummary;
}

type Ctx = CanvasRenderingContext2D;
interface Block {
  h: number;
  draw(y: number): void;
}

const INNER = CARD.W - CARD.PAD_X * 2;
const font = (weight: number, size: number, family: string) => `${weight} ${size}px ${family}`;

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

/** 띄어쓰기 단위로 줄바꿈, 한 단어가 너비를 넘으면 글자 단위로 자른다 */
export function wrap(ctx: Ctx, text: string, maxW: number): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const word of text.split(' ')) {
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

/** 한 줄 글자를 세로 가운데에 그린다 (lineH = 줄 높이) */
function text(ctx: Ctx, s: string, x: number, y: number, lineH: number, f: string, color: string, align: CanvasTextAlign = 'left') {
  ctx.font = f;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(s, x, y + lineH / 2);
}

/** 너비에 맞을 때까지 글자 크기를 줄인다 */
function fitSize(ctx: Ctx, s: string, weight: number, size: number, family: string, maxW: number, min = 24): number {
  for (let z = size; z > min; z -= 2) {
    ctx.font = font(weight, z, family);
    if (ctx.measureText(s).width <= maxW) return z;
  }
  return min;
}

/* ───────── 영역별 블록 ───────── */

function topBlock(ctx: Ctx): Block {
  const t = CARD.top;
  const lh = t.size * t.line;
  const h = lh + (t.tagPadY + t.tagBorder) * 2;
  return {
    h,
    draw(y) {
      text(ctx, CARD_TEXT.festival, CARD.PAD_X, y + (h - lh) / 2, lh, font(400, t.size, CARD.font.body), CARD.color.cream);
      ctx.font = font(400, t.size, CARD.font.body);
      const w = ctx.measureText(CARD_TEXT.tag).width + (t.tagPadX + t.tagBorder) * 2;
      const x = CARD.W - CARD.PAD_X - w;
      roundRect(ctx, x + t.tagBorder / 2, y + t.tagBorder / 2, w - t.tagBorder, h - t.tagBorder, h / 2);
      ctx.strokeStyle = CARD.color.cream;
      ctx.lineWidth = t.tagBorder;
      ctx.stroke();
      text(ctx, CARD_TEXT.tag, x + w / 2, y + (h - lh) / 2, lh, font(400, t.size, CARD.font.body), CARD.color.cream, 'center');
    },
  };
}

function labelBlock(ctx: Ctx, s: string): Block {
  const lh = CARD.label.size * CARD.label.line;
  return { h: lh, draw: (y) => text(ctx, s, CARD.PAD_X, y, lh, font(700, CARD.label.size, CARD.font.body), CARD.color.cream) };
}

/** 칭호: 자동 줄바꿈, 최대 3줄, 넘치면 글자 크기 축소 */
function titleBlock(ctx: Ctx, label: string, size: number): Block | null {
  ctx.font = font(400, size, CARD.font.display);
  // 단어 중간에서 끊기는 크기는 쓰지 않는다 (더 줄인다)
  if (label.split(' ').some((w) => ctx.measureText(w).width > INNER)) return null;
  const lines = wrap(ctx, label, INNER);
  if (lines.length > CARD.title.maxLines) return null;
  const lh = size * CARD.title.line;
  return {
    h: lh * lines.length,
    draw: (y) => lines.forEach((l, i) => text(ctx, l, CARD.PAD_X, y + i * lh, lh, font(400, size, CARD.font.display), CARD.color.coral)),
  };
}

function evidenceBlock(ctx: Ctx, evidence: string, subline: string | null, sublineShort: string | null): Block {
  const e = CARD.evidence;
  const s = CARD.subline;
  ctx.font = font(500, e.size, CARD.font.body);
  const lines = wrap(ctx, evidence, INNER);
  const lh = e.size * e.line;
  let sub: string[] = [];
  if (subline) {
    ctx.font = font(400, s.size, CARD.font.body);
    const one = ctx.measureText(subline).width <= INNER ? subline : sublineShort ?? subline;
    sub = wrap(ctx, one, INNER);
  }
  const slh = s.size * s.line;
  return {
    h: lh * lines.length + (sub.length ? s.gap + slh * sub.length : 0),
    draw(y) {
      lines.forEach((l, i) => text(ctx, l, CARD.PAD_X, y + i * lh, lh, font(500, e.size, CARD.font.body), CARD.color.cream));
      const y2 = y + lh * lines.length + s.gap;
      sub.forEach((l, i) => text(ctx, l, CARD.PAD_X, y2 + i * slh, slh, font(400, s.size, CARD.font.body), CARD.color.creamDim));
    },
  };
}

function statsBlock(ctx: Ctx, views: number, size: number): Block {
  const st = CARD.stats;
  return {
    h: size,
    draw(y) {
      ctx.fillStyle = CARD.color.cream;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.font = font(400, size, CARD.font.display);
      const n = String(views);
      const base = y + size * 0.86;
      ctx.fillText(n, CARD.PAD_X, base);
      const w = ctx.measureText(n).width;
      ctx.font = font(700, st.unitSize, CARD.font.body);
      ctx.fillText(CARD_TEXT.unit, CARD.PAD_X + w + st.gap, base);
    },
  };
}

function ratioBlocks(ctx: Ctx, s: CardSummary): Block[] {
  const b = CARD.bar;
  const nz = s.stages.filter((x) => x.count > 0);
  const total = nz.reduce((a, x) => a + x.count, 0);
  const lh = CARD.ratio.size * CARD.ratio.line;
  return [
    {
      h: b.h,
      draw(y) {
        const avail = INNER - b.gap * (nz.length - 1);
        let x = CARD.PAD_X;
        for (const st of nz) {
          const w = (st.count / total) * avail;
          roundRect(ctx, x, y, w, b.h, b.r);
          ctx.fillStyle = CARD.stageColor[st.id] ?? CARD.color.cream;
          ctx.fill();
          x += w + b.gap;
        }
      },
    },
    {
      h: lh,
      draw: (y) => text(ctx, s.stages.map((x) => `${x.short} ${x.count}`).join(' · '), CARD.PAD_X, y, lh, font(400, CARD.ratio.size, CARD.font.body), CARD.color.cream),
    },
  ];
}

function bestBlock(ctx: Ctx, s: CardSummary): Block | null {
  if (!s.best.length) return null;
  const b = CARD.best;
  const two = s.best.length > 1;
  const llh = b.labelSize * b.metaLine;
  const mlh = b.metaSize * b.metaLine;
  const items = s.best.map((x) => {
    const size = fitSize(ctx, x.name, 400, two ? b.nameSizeTwoDays : b.nameSize, CARD.font.display, INNER - b.padX * 2);
    return { ...x, size, nlh: size * b.nameLine };
  });
  const itemsH = items.reduce((a, it) => a + b.gap + it.nlh + (two ? 2 : b.gap) + mlh, 0) + (items.length - 1) * (b.dayGap - b.gap);
  const h = b.padY * 2 + llh + itemsH;
  return {
    h,
    draw(y) {
      roundRect(ctx, CARD.PAD_X, y, INNER, h, b.r);
      ctx.fillStyle = CARD.color.box;
      ctx.fill();
      const x = CARD.PAD_X + b.padX;
      let cy = y + b.padY;
      text(ctx, CARD_TEXT.bestLabel, x, cy, llh, font(400, b.labelSize, CARD.font.body), CARD.color.cream);
      cy += llh;
      items.forEach((it, i) => {
        cy += i ? b.dayGap : b.gap;
        text(ctx, it.name, x, cy, it.nlh, font(400, it.size, CARD.font.display), CARD.color.cream);
        cy += it.nlh + (two ? 2 : b.gap);
        text(ctx, `${it.date}  ${it.stage}  ${it.start}`, x, cy, mlh, font(400, b.metaSize, CARD.font.body), two ? CARD.color.creamDim : CARD.color.cream);
        cy += mlh;
      });
    },
  };
}

function footHeight() {
  return CARD.foot.logoSize * CARD.foot.line;
}

function drawFoot(ctx: Ctx) {
  const f = CARD.foot;
  const lh = footHeight();
  const y = CARD.H - CARD.PAD_Y - lh;
  text(ctx, CARD_TEXT.logo, CARD.PAD_X, y, lh, font(400, f.logoSize, CARD.font.display), CARD.color.cream);
  text(ctx, CARD_TEXT.handle, CARD.W - CARD.PAD_X, y, lh, font(700, f.handleSize, CARD.font.body), CARD.color.cream, 'right');
}

/* ───────── 조립 ───────── */

/** 칭호 카드: 칭호 크기 → 간격 순으로 줄여 가며 한 장에 들어가는 첫 배치를 고른다 */
function titleLayout(ctx: Ctx, d: CardInput): { blocks: Block[]; gap: number } {
  const t = d.title;
  const rest = (gap: number, size: number) => {
    const title = titleBlock(ctx, t.label ?? '', size);
    if (!title) return null;
    const blocks = [topBlock(ctx), labelBlock(ctx, CARD_TEXT.label), title, evidenceBlock(ctx, t.evidence ?? '', t.subline, d.sublineShort), statsBlock(ctx, d.summary.views, CARD.stats.size), ...ratioBlocks(ctx, d.summary)];
    const best = bestBlock(ctx, d.summary);
    if (best) blocks.push(best);
    return { blocks, gap };
  };
  let last: { blocks: Block[]; gap: number } | null = null;
  for (const gap of [CARD.GAP, 16, 12])
    for (let size = CARD.title.size; size >= CARD.title.minSize; size -= 4) {
      const l = rest(gap, size);
      if (!l) continue;
      last = l;
      if (fits(l.blocks, gap)) return l;
    }
  return last ?? rest(12, CARD.title.minSize) ?? { blocks: [], gap: 12 };
}

/** 칭호 0개(statsOnly) 카드 — 임시 처리(MIN-314에서 재결정). 칭호·근거 없이 숫자를 주인공으로 */
function statsOnlyLayout(ctx: Ctx, d: CardInput): { blocks: Block[]; gap: number } {
  const blocks = [topBlock(ctx), labelBlock(ctx, CARD_TEXT.labelStatsOnly), statsBlock(ctx, d.summary.views, CARD.stats.heroSize), ...ratioBlocks(ctx, d.summary)];
  const best = bestBlock(ctx, d.summary);
  if (best) blocks.push(best);
  return { blocks, gap: CARD.GAP + 8 };
}

function fits(blocks: Block[], gap: number) {
  const used = blocks.reduce((a, b) => a + b.h, 0) + gap * blocks.length + footHeight();
  return used <= CARD.H - CARD.PAD_Y * 2;
}

export function drawCard(canvas: HTMLCanvasElement, d: CardInput) {
  canvas.width = CARD_PX.W;
  canvas.height = CARD_PX.H;
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(CARD.SCALE, 0, 0, CARD.SCALE, 0, 0);
  ctx.clearRect(0, 0, CARD.W, CARD.H);
  roundRect(ctx, 0, 0, CARD.W, CARD.H, CARD.RADIUS);
  ctx.fillStyle = CARD.color.bg;
  ctx.fill();
  const { blocks, gap } = d.title.id === 'statsOnly' ? statsOnlyLayout(ctx, d) : titleLayout(ctx, d);
  let y = CARD.PAD_Y;
  for (const b of blocks) {
    b.draw(y);
    y += b.h + gap;
  }
  drawFoot(ctx);
}

/** 카드에 쓰는 글자의 웹폰트를 미리 받는다. 느리면 timeoutMs 뒤 대체 글꼴로 그린다 */
export async function loadCardFonts(d: CardInput, timeoutMs = 4000): Promise<boolean> {
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (!fonts?.load) return false;
  const display = [d.title.label ?? '', String(d.summary.views), CARD_TEXT.logo, ...d.summary.best.map((b) => b.name)].join('');
  const body = [
    ...Object.values(CARD_TEXT),
    d.title.evidence ?? '',
    d.title.subline ?? '',
    d.sublineShort ?? '',
    d.summary.stages.map((s) => `${s.short} ${s.count} · `).join(''),
    ...d.summary.best.map((b) => `${b.date}${b.stage}${b.start}${b.name}`),
    '0123456789',
  ].join('');
  const jobs = [
    fonts.load(font(400, 80, '"Black Han Sans"'), display),
    fonts.load(font(400, 22, '"Noto Sans KR"'), body),
    fonts.load(font(500, 32, '"Noto Sans KR"'), body),
    fonts.load(font(700, 26, '"Noto Sans KR"'), body),
  ].map((p) => p.then((l) => l.length > 0).catch(() => false));
  const timeout = new Promise<boolean[]>((r) => setTimeout(() => r([false]), timeoutMs));
  const done = await Promise.race([Promise.all(jobs), timeout]);
  return done.every(Boolean);
}
