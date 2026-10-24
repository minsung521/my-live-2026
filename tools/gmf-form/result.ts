/**
 * 결과 화면 (MIN-316): 판정 → 칭호 → 카드 PNG → 2페이지 구조
 *
 * 1페이지 (기기 화면 높이): 카드 + [이미지 저장][공유하기] + [배경 사진 넣기/바꾸기] + ⌄
 * 2페이지 (스크롤 스냅으로 이어짐): 획득한 칭호 · 30초 피드백 · 연락처 · [보내기] · 처음으로
 *
 * 판정은 브라우저에서 바로 돌린다(판정 모듈·catalog가 이미 화면 번들에 있음). 서버는 기록·피드백·연락처 저장만 한다.
 * 사진은 이 기기 안에서만 카드에 합성하고 서버로 보내지 않는다.
 * 연락처는 /api/gmf-contact로만 보내고 이벤트·피드백·카드·브라우저 저장소에 넣지 않는다.
 */
import { VERSION as JUDGE_VERSION, judge } from '../../packages/judge/src/judge';
import type { Catalog, JudgeResult, UserRecord } from '../../packages/judge/src/judge';
import { GLYPHS, GLYPH_BASE, drawCard, loadCardFonts, loadGlyphs, loadPhoto } from './card';
import type { CardInput } from './card';
import { CHIPS, COMMENT_MAX, FEEDBACK_PATH, FIT, QUESTIONS, SHARE, SHOW_PARTS, UNDERSTOOD, feedbackReady } from './feedback';
import { CONTACT_MAX, CONTACT_OPEN, FORM_VERSION } from './logic';
import { TITLE_COLORS, cardSummary, pickTitle, streakSubline } from './titles';
import type { Pick, TitleResult } from './titles';
import { track } from './analytics';

export const CONTACT_PATH = '/api/gmf-contact';
const FEEDBACK_SENT_KEY = 'gmf2026-feedback-sent';
/** 보낸 피드백 요약 (연락처 제외) — 새로고침 뒤 완료 상태에 다시 보여준다 */
const FEEDBACK_SUMMARY_KEY = 'gmf2026-feedback-summary';
const FILE_NAME = 'mylive-gmf2026.png';
const PAGE_PATH = '/gmf';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** 인스타그램·카카오톡·페이스북·네이버·라인 등 인앱 브라우저 (파일 저장·공유가 막혀 있음) */
export function isInApp(ua: string): boolean {
  return /Instagram|FBAN|FBAV|KAKAOTALK|NAVER\(inapp|Line\/|DaumApps|everytimeApp|Whale\/.*inapp|; wv\)/i.test(ua);
}

interface Rendered {
  dataUrl: string;
  file: File | null;
}

interface Shown {
  anonId: string;
  festivalId: string;
  result: JudgeResult;
  title: TitleResult;
  /** 같은 결과에 피드백 1회 — 기록이 같으면 같은 키 */
  key: string;
  input: CardInput;
  glyphs: Map<string, HTMLImageElement> | null;
  card: Rendered | null;
  /** 미리보기 중인 사진 (아직 적용 전) */
  pending: HTMLCanvasElement | null;
  page2Seen: boolean;
}

interface FbState {
  fit: string | null;
  understood: string | null;
  share: string | null;
  showParts: string[];
  chips: string[];
  comment: string;
  contact: string;
  consentResult: boolean;
  consentReshare: boolean;
  sending: boolean;
  fbSent: boolean;
  contactSent: boolean;
  /** 완료 상태 요약 줄 */
  summary: string[];
  error: string;
}

let shown: Shown | null = null;
let fb: FbState = blankFb();
let wired = false;
let onRestart: () => void = () => {};

function blankFb(): FbState {
  return {
    fit: null,
    understood: null,
    share: null,
    showParts: [],
    chips: [],
    comment: '',
    contact: '',
    consentResult: false,
    consentReshare: false,
    sending: false,
    fbSent: false,
    contactSent: false,
    summary: [],
    error: '',
  };
}

const recordKey = (r: UserRecord, pick?: Pick | null) =>
  r.selections
    .map((s) => `${s.date}|${s.performanceId}${s.best ? '*' : ''}`)
    .sort()
    .join(',') + (pick ? `#${pick.performanceId}` : '');

/**
 * 결과 화면을 연다. restored = 새로고침 뒤 마지막 결과를 다시 보여주는 경우.
 * pick: 대표 무대 (2단계 기록). undefined면 v1 기록으로 보고 best 중 마지막 참가일 것을 최고 무대로 쓴다
 */
export async function showResult(catalog: Catalog, record: UserRecord, anonId: string, opts: { restored: boolean; pick?: Pick | null; onRestart: () => void }) {
  onRestart = opts.onRestart;
  wire();
  const result = judge(catalog, record);
  const title = pickTitle(catalog, record, result, opts.pick);
  const key = recordKey(record, opts.pick);
  const input: CardInput = {
    title,
    sublineShort: title.id === 'streak' ? streakSubline(catalog, record, result, 2, opts.pick) : null,
    summary: cardSummary(catalog, record, result, opts.pick),
  };
  shown = { anonId, festivalId: record.selections[0]?.festivalId ?? '', result, title, key, input, glyphs: null, card: null, pending: null, page2Seen: false };
  fb = blankFb();
  try {
    if (localStorage.getItem(FEEDBACK_SENT_KEY) === key) {
      fb.fbSent = fb.contactSent = true;
      fb.summary = JSON.parse(localStorage.getItem(FEEDBACK_SUMMARY_KEY) ?? '[]');
    }
  } catch {}

  for (const id of ['#intro', '#grid', '#pick', '#progress', '#lsheet']) {
    const el = document.querySelector(id) as HTMLElement | null;
    if (el) el.hidden = true;
  }
  const box = $('#result');
  box.hidden = false;
  box.scrollTop = 0;
  document.documentElement.classList.add('on-result');
  renderTitles();
  renderFeedback();
  renderPhotoBtn();
  track('gmf_result_shown', {
    title_id: title.id,
    title_label: title.label,
    tier: title.tier,
    others: title.others,
    rookie: title.id === 'rookie',
    has_best: !!input.summary.best,
    judge_version: JUDGE_VERSION,
    views: result.stats.views,
    restored: opts.restored,
  });

  const img = $('#card-img') as HTMLImageElement;
  const status = $('#card-status');
  img.hidden = true;
  setActions(false);
  status.hidden = false;
  status.textContent = '카드를 만드는 중…';
  try {
    const [, glyphs] = await Promise.all([loadCardFonts(input), loadGlyphs(input)]);
    if (shown?.key !== key) return; // 그사이 다른 결과로 바뀜
    shown.glyphs = glyphs;
    await refreshCard();
    status.hidden = true;
  } catch (e) {
    status.textContent = '카드 이미지를 만들지 못했어요. 이 화면을 스크린샷으로 저장해 주세요.';
    track('gmf_card_render_failed', { error: String((e as Error).message).slice(0, 120) });
  }
}

async function render(input: CardInput): Promise<Rendered> {
  const canvas = document.createElement('canvas');
  const { overflow } = drawCard(canvas, input, shown!.glyphs!);
  if (overflow) track('gmf_card_overflow', { title_id: input.title.id });
  const dataUrl = canvas.toDataURL('image/png');
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  return { dataUrl, file: blob && typeof File === 'function' ? new File([blob], FILE_NAME, { type: 'image/png' }) : null };
}

/** 지금 입력(사진 포함)으로 카드를 다시 그려 1페이지에 건다 */
async function refreshCard() {
  if (!shown?.glyphs) return;
  const key = shown.key;
  const card = await render(shown.input);
  if (shown?.key !== key) return;
  shown.card = card;
  const img = $('#card-img') as HTMLImageElement;
  const t = shown.title;
  img.src = card.dataUrl;
  img.alt = `그민페 결과 카드: ${t.label}. ${t.evidence}`;
  img.hidden = false;
  setActions(true);
}

function setActions(on: boolean) {
  for (const id of ['#save', '#share', '#photo-btn']) ($(id) as HTMLButtonElement).disabled = !on;
}

/** S1 소개의 예시 카드 — 같은 카드 코드로 예시 기록을 그린다 */
export async function exampleCard(catalog: Catalog, record: UserRecord, pick: Pick | null): Promise<string> {
  const result = judge(catalog, record);
  const title = pickTitle(catalog, record, result, pick);
  const input: CardInput = { title, sublineShort: null, summary: cardSummary(catalog, record, result, pick) };
  const [, glyphs] = await Promise.all([loadCardFonts(input), loadGlyphs(input)]);
  const canvas = document.createElement('canvas');
  drawCard(canvas, input, glyphs);
  return canvas.toDataURL('image/jpeg', 0.86);
}

/* ───────── 저장·공유 ───────── */

function canShareFile(file: File | null): boolean {
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  try {
    return !!file && !!nav.canShare?.({ files: [file] });
  } catch {
    return false;
  }
}

/**
 * 휴대폰·태블릿인지 (iPadOS는 Mac UA라 터치 포인트로 구분).
 * PC 브라우저(Windows·Mac의 Chrome·Edge·Safari)도 Web Share가 있지만 OS 공유 창이 떠서 저장이 안 되거나 조용히 실패하므로 쓰지 않는다
 */
export function isMobile(ua: string, maxTouchPoints: number): boolean {
  return /Android|iPhone|iPad|iPod|Mobi/i.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
}
const onMobile = () => isMobile(navigator.userAgent, navigator.maxTouchPoints || 0);

/** Web Share로 파일 공유. 취소가 아닌 실패면 false (호출한 쪽이 다운로드로 넘어간다) */
async function shareFile(file: File, button: 'save' | 'share'): Promise<boolean> {
  track('gmf_card_save_clicked', { method: 'share', button });
  try {
    await navigator.share({ files: [file] });
    track('gmf_card_share_result', { outcome: 'shared', button });
    return true;
  } catch (e) {
    const cancelled = (e as Error).name === 'AbortError';
    track('gmf_card_share_result', { outcome: cancelled ? 'cancelled' : 'error', button });
    return cancelled;
  }
}

/** PNG 파일 내려받기. 큰 data URL 대신 blob URL을 쓴다 (data URL 다운로드는 일부 브라우저에서 막힘) */
function download(card: Rendered, button: 'save' | 'share') {
  track('gmf_card_save_clicked', { method: 'download', button });
  const url = card.file ? URL.createObjectURL(card.file) : card.dataUrl;
  const a = document.createElement('a');
  a.href = url;
  a.download = FILE_NAME;
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (card.file) setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/**
 * 이미지 저장
 *  - 인앱 브라우저: 길게 눌러 저장 안내
 *  - 휴대폰: Web Share 파일(사진에 저장) → 실패하면 다운로드
 *  - PC: 바로 PNG 다운로드
 */
async function saveCard() {
  const card = shown?.card;
  if (!card) return;
  if (isInApp(navigator.userAgent)) return openInAppGuide();
  if (onMobile() && card.file && canShareFile(card.file) && (await shareFile(card.file, 'save'))) return;
  download(card, 'save');
}

/**
 * 공유하기
 *  - 휴대폰: Web Share 파일 → (인앱이면 안내) → 다운로드
 *  - PC: 페이지 링크 복사 (카드 이미지는 [이미지 저장]으로)
 */
async function shareCard() {
  const card = shown?.card;
  if (!card) return;
  if (!onMobile()) {
    track('gmf_card_save_clicked', { method: 'link', button: 'share' });
    return copyLink('링크를 복사했어요. 카드 이미지는 [이미지 저장]으로 받을 수 있어요');
  }
  if (card.file && canShareFile(card.file) && (await shareFile(card.file, 'share'))) return;
  if (isInApp(navigator.userAgent)) return openInAppGuide();
  download(card, 'share');
}

/* ───────── 시트·토스트 ───────── */

function openSheet(html: string, cls = '') {
  const s = $('#sheet');
  $('#sheet-panel').className = `sheet-panel ${cls}`;
  $('#sheet-panel').innerHTML = html;
  s.hidden = false;
}

function closeSheet() {
  $('#sheet').hidden = true;
  $('#sheet-panel').innerHTML = '';
  if (shown) shown.pending = null;
}

let toastTimer = 0;
export function toast(msg: string) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (t.hidden = true), Math.max(2200, msg.length * 80));
}

function openInAppGuide() {
  if (!shown?.card) return;
  track('gmf_inapp_save_guide_shown');
  openSheet(`<h2 class="sh-title">카드를 길게 눌러 저장해 주세요</h2>
<p class="sh-desc">인스타그램·카카오톡 안에서 열면 [이미지 저장]이 막혀 있어요. 아래 카드를 길게 누르고 "사진에 저장"을 고르면 돼요</p>
<div class="sh-card"><img src="${shown.card.dataUrl}" alt="그민페 결과 카드"><span class="sh-press">꾹 눌러서 저장</span></div>
<button type="button" class="btn wide" data-act="copy-link">링크 복사해서 Safari·Chrome으로 열기</button>
<button type="button" class="btn accent wide" data-act="close">확인</button>`);
}

async function copyLink(done = '링크를 복사했어요') {
  const url = `${location.origin}${PAGE_PATH}`;
  let ok = false;
  try {
    await navigator.clipboard.writeText(url);
    ok = true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = url;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      ok = document.execCommand('copy');
    } catch {}
    ta.remove();
  }
  if (ok) {
    track('gmf_link_copied');
    toast(done);
  } else toast(url);
}

/* ───────── 배경 사진 ───────── */

function renderPhotoBtn() {
  const b = $('#photo-btn');
  b.textContent = shown?.input.photo ? '배경 사진 바꾸기' : '+ 배경 사진 넣기';
}

function pickPhoto() {
  const input = $('#photo-input') as HTMLInputElement;
  input.value = '';
  input.click();
}

async function onPhotoChosen(file: File) {
  if (!shown?.glyphs) return;
  closeSheet();
  toast('사진을 불러오는 중…');
  try {
    const photo = await loadPhoto(file);
    if (!shown) return;
    const preview = await render({ ...shown.input, photo });
    shown.pending = photo;
    $('#toast').hidden = true;
    openSheet(
      `<h2 class="sh-title">카드 미리보기</h2>
<div class="sh-card"><img src="${preview.dataUrl}" alt="사진을 넣은 카드 미리보기"></div>
<button type="button" class="btn accent wide" data-act="photo-apply">이 사진으로 적용</button>
<button type="button" class="btn wide" data-act="photo-pick">다른 사진 고르기</button>`,
      'tall',
    );
    shown.pending = photo;
  } catch (e) {
    toast('사진을 읽지 못했어요. 다른 사진을 골라 주세요');
    track('gmf_photo_failed', { error: String((e as Error).message).slice(0, 120) });
  }
}

async function applyPhoto(photo: HTMLCanvasElement | null) {
  if (!shown) return;
  const had = !!shown.input.photo;
  shown.input = { ...shown.input, photo: photo ?? undefined };
  closeSheet();
  renderPhotoBtn();
  await refreshCard();
  if (photo) track('gmf_photo_added', { replaced: had });
  else if (had) track('gmf_photo_removed');
}

/* ───────── 2페이지: 획득한 칭호 ───────── */

function renderTitles() {
  if (!shown) return;
  const t = shown.title;
  const rows = t.list
    .map((it, i) => {
      const g = GLYPHS.titles[it.id].inline;
      const url = `${GLYPH_BASE}${g.file}`;
      const color = TITLE_COLORS[it.id];
      return `<li class="trow">
  <div class="tline"><span class="tdot" style="background:${color}"></span><span class="tglyph" role="img" aria-label="${esc(it.label)}" style="background:${color};width:min(${Math.round((g.w * 28) / GLYPHS.height)}px,100%);aspect-ratio:${g.w}/${GLYPHS.height};-webkit-mask-image:url(${url});mask-image:url(${url})"></span>${i === 0 ? '<span class="ttag">대표</span>' : ''}</div>
  <p class="tev">${esc(it.evidence)}</p>
</li>`;
    })
    .join('');
  $('#titles').innerHTML = `<div class="bhead"><h2>획득한 칭호</h2><span class="bside">${t.list.length}개</span></div><ul class="tlist">${rows}</ul>`;
}

/* ───────── 2페이지: 피드백 + 연락처 ───────── */

function chipRow(name: 'fit' | 'understood' | 'share' | 'showParts' | 'chips', list: readonly (readonly [string, string])[], multi: boolean) {
  const cur = fb[name];
  return list
    .map(([v, label]) => {
      const on = multi ? (cur as string[]).includes(v) : cur === v;
      return `<button type="button" class="chip${on ? ' on' : ''}" data-fb="${name}" data-v="${v}" aria-pressed="${on}">${esc(label)}</button>`;
    })
    .join('');
}

const labelOf = (list: readonly (readonly [string, string])[], v: string | null) => list.find(([k]) => k === v)?.[1] ?? '';

function summaryLines(): string[] {
  const lines = [
    `${QUESTIONS.fit} · ${labelOf(FIT, fb.fit)}`,
    `${QUESTIONS.understood} · ${labelOf(UNDERSTOOD, fb.understood)}`,
    `${QUESTIONS.share} · ${labelOf(SHARE, fb.share)}`,
  ];
  if (fb.showParts.length) lines.push(`${QUESTIONS.showParts.replace('(선택) ', '')} · ${fb.showParts.map((v) => labelOf(SHOW_PARTS, v)).join(', ')}`);
  const words = [...fb.chips.map((v) => labelOf(CHIPS, v))];
  if (fb.comment.trim()) words.push(`“${fb.comment.trim()}”`);
  if (words.length) lines.push(`${QUESTIONS.chips} · ${words.join(', ')}`);
  return lines;
}

function renderFeedback() {
  if (!shown) return;
  const done = fb.fbSent && fb.contactSent;
  $('#fbwrap').hidden = done;
  $('#done').hidden = !done;
  if (done) {
    $('#done').innerHTML = `<h2>의견 고마워요!</h2><p class="hint">보내 준 의견은 칭호와 카드를 다듬는 데 쓸게요.</p>${
      fb.summary.length ? `<ul class="sum">${fb.summary.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''
    }`;
    return;
  }
  const q = (title: string, body: string) => `<div class="q"><p class="qt">${esc(title)}</p><div class="chips">${body}</div></div>`;
  $('#fb').innerHTML = fb.fbSent
    ? '<div class="bhead"><h2>30초 피드백</h2><span class="bside">보냈어요</span></div><p class="hint">피드백은 보냈어요. 연락처만 다시 보내 주세요.</p>'
    : `<div class="bhead"><h2>30초 피드백</h2><span class="bside">선택</span></div>
${q(QUESTIONS.fit, chipRow('fit', FIT, false))}
${q(QUESTIONS.understood, chipRow('understood', UNDERSTOOD, false))}
${q(QUESTIONS.share, chipRow('share', SHARE, false))}
${q(QUESTIONS.showParts, chipRow('showParts', SHOW_PARTS, true))}
${q(QUESTIONS.chips, chipRow('chips', CHIPS, true))}
<textarea id="fb-comment" maxlength="${COMMENT_MAX}" rows="3" placeholder="직접 쓸래요">${esc(fb.comment)}</textarea>`;
  const cbox = $('#contactbox');
  cbox.hidden = !CONTACT_OPEN;
  cbox.innerHTML = !CONTACT_OPEN ? '' : `<div class="bhead"><h2>다음 페스티벌 결과도 받아볼래요?</h2><span class="bside">선택</span></div>
<input type="text" id="c-value" maxlength="${CONTACT_MAX}" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="인스타 아이디 또는 이메일" value="${esc(fb.contact)}">
<label class="check"><input type="checkbox" id="c-result"${fb.consentResult ? ' checked' : ''}><span>결과 소식을 받는 데 동의해요</span></label>
<label class="check"><input type="checkbox" id="c-reshare"${fb.consentReshare ? ' checked' : ''}><span>다음 페스티벌 안내도 받을래요</span></label>`;
  renderSend();
}

function renderSend() {
  const ready = fb.fbSent || feedbackReady(fb.fit, fb.understood, fb.share);
  const b = $('#fb-send') as HTMLButtonElement;
  b.disabled = !ready || fb.sending;
  b.textContent = fb.sending ? '보내는 중…' : '보내기';
  const err = $('#fb-err');
  err.hidden = !fb.error;
  err.textContent = fb.error;
}

async function post(path: string, body: unknown) {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let msg = '';
  try {
    msg = ((await res.json()) as { error?: string }).error ?? '';
  } catch {}
  if (!res.ok) throw new Error(msg || `HTTP ${res.status}`);
}

async function send() {
  if (!shown || fb.sending) return;
  const t = shown.title;
  const contact = CONTACT_OPEN ? fb.contact.trim() : '';
  if (!fb.fbSent && !feedbackReady(fb.fit, fb.understood, fb.share)) return;
  if (contact && !fb.consentResult) {
    fb.error = '연락처를 남기려면 결과 소식 받기에 동의해 주세요';
    return renderSend();
  }
  fb.sending = true;
  fb.error = '';
  renderSend();
  try {
    if (!fb.fbSent) {
      const comment = fb.comment.trim();
      const body = {
        anonId: shown.anonId,
        festivalId: shown.festivalId,
        formVersion: FORM_VERSION,
        judgeVersion: JUDGE_VERSION,
        titleId: t.id,
        titleLabel: t.label,
        fit: fb.fit,
        understood: fb.understood,
        share: fb.share,
        showParts: fb.showParts,
        chips: fb.chips,
        comment: comment || null,
      };
      await post(FEEDBACK_PATH, body);
      fb.fbSent = true;
      fb.summary = summaryLines();
      track('gmf_feedback_submitted', {
        title_id: t.id,
        fit: body.fit,
        understood: body.understood,
        share: body.share,
        show_parts: body.showParts,
        chips: body.chips,
        has_comment: !!body.comment,
        has_contact: !!contact,
      });
    }
    if (contact && !fb.contactSent) {
      await post(CONTACT_PATH, { anonId: shown.anonId, festivalId: shown.festivalId, contact, consentResult: true, consentReshare: fb.consentReshare });
      track('gmf_contact_submitted', { consent_reshare: fb.consentReshare });
    }
    fb.contactSent = true;
    try {
      localStorage.setItem(FEEDBACK_SENT_KEY, shown.key);
      localStorage.setItem(FEEDBACK_SUMMARY_KEY, JSON.stringify(fb.summary));
    } catch {}
    // 연락처 줄은 화면에만 (저장소에 남기지 않음)
    if (contact) fb.summary = [...fb.summary, `연락처 · ${contact} (결과 소식 받기 동의)`];
  } catch (e) {
    const m = String((e as Error).message);
    fb.error = `보내지 못했어요: ${m}. 잠시 뒤 다시 눌러 주세요.`;
    track(fb.fbSent ? 'gmf_contact_failed' : 'gmf_feedback_failed', { error: m.slice(0, 120) });
  }
  fb.sending = false;
  renderFeedback();
}

/* ───────── 연결 ───────── */

function wire() {
  if (wired) return;
  wired = true;
  $('#save').addEventListener('click', () => void saveCard());
  $('#share').addEventListener('click', () => void shareCard());
  $('#photo-btn').addEventListener('click', () => {
    if (!shown?.input.photo) return pickPhoto();
    openSheet(`<h2 class="sh-title">배경 사진 바꾸기</h2>
<button type="button" class="btn wide" data-act="photo-pick">다른 사진 고르기</button>
<button type="button" class="btn wide" data-act="photo-remove">사진 빼기</button>
<button type="button" class="btn ghost wide" data-act="close">취소</button>`);
  });
  $('#photo-input').addEventListener('change', (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) void onPhotoChosen(f);
  });
  $('#more').addEventListener('click', () => $('.pg2').scrollIntoView({ behavior: 'smooth' }));
  $('#restart').addEventListener('click', () => {
    track('gmf_edit_clicked');
    shown = null;
    closeSheet();
    $('#result').hidden = true;
    document.documentElement.classList.remove('on-result');
    onRestart();
    window.scrollTo({ top: 0 });
  });
  $('#sheet').addEventListener('click', (e) => {
    const el = e.target as HTMLElement;
    if (el.classList.contains('sheet-bg')) return closeSheet();
    const act = (el.closest('[data-act]') as HTMLElement | null)?.dataset.act;
    if (act === 'close') closeSheet();
    else if (act === 'copy-link') void copyLink();
    else if (act === 'photo-pick') pickPhoto();
    else if (act === 'photo-remove') void applyPhoto(null);
    else if (act === 'photo-apply') void applyPhoto(shown?.pending ?? null);
  });
  const pg2 = $('.pg2');
  if ('IntersectionObserver' in window)
    new IntersectionObserver(
      (es) => {
        if (shown && !shown.page2Seen && es.some((x) => x.isIntersecting)) {
          shown.page2Seen = true;
          track('gmf_result_page2_viewed');
        }
      },
      { root: $('#result'), threshold: 0.25 },
    ).observe(pg2);
  $('#fbwrap').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    if (!b || fb.sending) return;
    if (b.id === 'fb-send') return void send();
    const name = b.dataset.fb;
    const v = b.dataset.v!;
    if (name === 'showParts' || name === 'chips') {
      const list = fb[name];
      fb[name] = list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
    } else if (name === 'fit' || name === 'understood' || name === 'share') fb[name] = fb[name] === v ? null : v;
    else return;
    b.classList.toggle('on');
    b.setAttribute('aria-pressed', String(b.classList.contains('on')));
    if (name === 'fit' || name === 'understood' || name === 'share')
      b.parentElement!.querySelectorAll('button').forEach((x) => {
        if (x !== b) {
          x.classList.remove('on');
          x.setAttribute('aria-pressed', 'false');
        }
      });
    renderSend();
  });
  $('#fbwrap').addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.id === 'fb-comment') fb.comment = t.value;
    else if (t.id === 'c-value') fb.contact = t.value;
    else if (t.id === 'c-result') fb.consentResult = t.checked;
    else if (t.id === 'c-reshare') fb.consentReshare = t.checked;
    else return;
    if (fb.error) {
      fb.error = '';
      renderSend();
    }
  });
}
