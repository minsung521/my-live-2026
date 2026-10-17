/**
 * 제출 직후 결과 화면 (MIN-306): 판정 → 칭호 → 카드 PNG → 저장·공유 → 피드백
 *
 * 판정은 브라우저에서 바로 돌린다(판정 모듈·catalog가 이미 화면 번들에 있음). 서버는 기록·피드백 저장만 한다.
 * 연락처는 이 화면의 어떤 이벤트·요청·카드에도 넣지 않는다.
 */
import { VERSION as JUDGE_VERSION, judge } from '../../packages/judge/src/judge';
import type { Catalog, JudgeResult, UserRecord } from '../../packages/judge/src/judge';
import { drawCard, loadCardFonts } from './card';
import type { CardInput } from './card';
import { CHIPS, COMMENT_MAX, FEEDBACK_PATH, FIT, SHARE, SHOW_PARTS, UNDERSTOOD, feedbackReady } from './feedback';
import { FORM_VERSION } from './logic';
import { cardSummary, pickTitle, streakSubline } from './titles';
import type { TitleResult } from './titles';
import { track } from './analytics';

const FEEDBACK_SENT_KEY = 'gmf2026-feedback-sent';
const FILE_NAME = 'mylive-gmf2026.png';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

interface Shown {
  anonId: string;
  festivalId: string;
  result: JudgeResult;
  title: TitleResult;
  /** 같은 결과에 피드백 1회 — 기록이 같으면 같은 키 */
  key: string;
  file: File | null;
  dataUrl: string | null;
}

interface FbState {
  fit: string | null;
  understood: string | null;
  share: string | null;
  showParts: string[];
  chips: string[];
  writing: boolean;
  comment: string;
  sending: boolean;
  sent: boolean;
  error: string;
}

let shown: Shown | null = null;
let fb: FbState = blankFb();
let wired = false;

function blankFb(): FbState {
  return { fit: null, understood: null, share: null, showParts: [], chips: [], writing: false, comment: '', sending: false, sent: false, error: '' };
}

const recordKey = (r: UserRecord) =>
  r.selections
    .map((s) => `${s.date}|${s.performanceId}${s.best ? '*' : ''}`)
    .sort()
    .join(',');

/** 결과 화면을 연다. restored = 새로고침 뒤 마지막 결과를 다시 보여주는 경우 */
export async function showResult(catalog: Catalog, record: UserRecord, anonId: string, opts: { restored: boolean; onEdit: () => void }) {
  wire(opts.onEdit);
  const result = judge(catalog, record);
  const title = pickTitle(catalog, record, result);
  const key = recordKey(record);
  shown = { anonId, festivalId: record.selections[0]?.festivalId ?? '', result, title, key, file: null, dataUrl: null };
  fb = blankFb();
  try {
    fb.sent = localStorage.getItem(FEEDBACK_SENT_KEY) === key;
  } catch {}

  $('#form').hidden = true;
  $('#result').hidden = false;
  renderFeedback();
  window.scrollTo({ top: 0 });
  track('gmf_result_shown', {
    title_id: title.id,
    title_label: title.label,
    tier: title.tier,
    others: title.others,
    stats_only: title.id === 'statsOnly',
    judge_version: JUDGE_VERSION,
    views: result.stats.views,
    restored: opts.restored,
  });

  const input: CardInput = {
    title,
    sublineShort: title.id === 'streak' ? streakSubline(catalog, record, result, 2) : null,
    summary: cardSummary(catalog, record, result),
  };
  const img = $('#card-img') as HTMLImageElement;
  const status = $('#card-status');
  const save = $('#save') as HTMLButtonElement;
  img.hidden = true;
  save.disabled = true;
  status.hidden = false;
  status.textContent = '카드를 만드는 중…';
  try {
    await loadCardFonts(input);
    const canvas = document.createElement('canvas');
    drawCard(canvas, input);
    const dataUrl = canvas.toDataURL('image/png');
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    if (shown?.key !== key) return; // 그사이 다른 결과로 바뀜
    shown.dataUrl = dataUrl;
    shown.file = blob && typeof File === 'function' ? new File([blob], FILE_NAME, { type: 'image/png' }) : null;
    img.src = dataUrl;
    img.alt = title.label ? `그민페 결과 카드: ${title.label}. ${title.evidence ?? ''}` : `그민페 기록 카드: ${result.stats.views}무대`;
    img.hidden = false;
    status.hidden = true;
    save.disabled = false;
  } catch (e) {
    status.textContent = '카드 이미지를 만들지 못했어요. 이 화면을 스크린샷으로 저장해 주세요.';
    track('gmf_card_render_failed', { error: String((e as Error).message).slice(0, 120) });
  }
}

async function saveCard() {
  if (!shown?.dataUrl) return;
  const file = shown.file;
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  let canShareFile = false;
  try {
    canShareFile = !!file && !!nav.canShare?.({ files: [file] });
  } catch {}
  if (canShareFile && file) {
    track('gmf_card_save_clicked', { method: 'share' });
    try {
      await nav.share({ files: [file] });
      track('gmf_card_share_result', { outcome: 'shared' });
    } catch (e) {
      track('gmf_card_share_result', { outcome: (e as Error).name === 'AbortError' ? 'cancelled' : 'error' });
    }
    return;
  }
  track('gmf_card_save_clicked', { method: 'download' });
  const a = document.createElement('a');
  a.href = shown.dataUrl;
  a.download = FILE_NAME;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/* ───────── 피드백 ───────── */

function chipRow(name: keyof FbState, list: readonly (readonly [string, string])[], multi: boolean) {
  const cur = fb[name];
  return list
    .map(([v, label]) => {
      const on = multi ? (cur as string[]).includes(v) : cur === v;
      return `<button type="button" class="chip sm${on ? ' on' : ''}" data-fb="${name}" data-v="${v}" aria-pressed="${on}">${esc(label)}</button>`;
    })
    .join('');
}

function renderFeedback() {
  const box = $('#fb');
  if (!shown) return;
  if (fb.sent) {
    box.innerHTML = '<h2>고마워요!</h2><p class="hint">보내 준 의견은 칭호와 카드를 다듬는 데 쓸게요.</p>';
    return;
  }
  const statsOnly = shown.title.id === 'statsOnly';
  const ready = feedbackReady(shown.title.id, fb.fit, fb.understood, fb.share);
  const q = (title: string, body: string, hint = '') => `<div class="q"><p class="qt">${title}${hint ? ` <span class="opt">${hint}</span>` : ''}</p><div class="chips">${body}</div></div>`;
  box.innerHTML = `<h2>30초 피드백</h2>
<p class="hint">탭만 하면 돼요. 결과를 다듬는 데 큰 도움이 돼요.</p>
${statsOnly ? '' : q('이 칭호, 나 맞아?', chipRow('fit', FIT, false))}
${statsOnly ? '' : q('왜 이 칭호인지 알겠어?', chipRow('understood', UNDERSTOOD, false))}
${q('스토리에 올릴 거야?', chipRow('share', SHARE, false))}
${q('카드에서 보여주고 싶은 것', chipRow('showParts', SHOW_PARTS, true), '선택 · 여러 개')}
${q('만든이에게 한마디', chipRow('chips', CHIPS, true) + `<button type="button" class="chip sm${fb.writing ? ' on' : ''}" data-fb="writing" aria-pressed="${fb.writing}">직접 쓸래요</button>`, '선택 · 여러 개')}
${fb.writing ? `<textarea id="fb-comment" maxlength="${COMMENT_MAX}" rows="3" placeholder="자유롭게 적어 주세요 (${COMMENT_MAX}자까지)">${esc(fb.comment)}</textarea><p class="hint right"><span id="fb-count">${[...fb.comment].length}</span>/${COMMENT_MAX}</p>` : ''}
${fb.error ? `<p class="err">${esc(fb.error)}</p>` : ''}
<button type="button" id="fb-send" class="primary wide"${ready && !fb.sending ? '' : ' disabled'}>${fb.sending ? '보내는 중…' : '보내기'}</button>`;
}

async function sendFeedback() {
  if (!shown || fb.sending || fb.sent) return;
  const t = shown.title;
  if (!feedbackReady(t.id, fb.fit, fb.understood, fb.share)) return;
  const statsOnly = t.id === 'statsOnly';
  const comment = fb.writing ? fb.comment.trim() : '';
  const body = {
    anonId: shown.anonId,
    festivalId: shown.festivalId,
    formVersion: FORM_VERSION,
    judgeVersion: JUDGE_VERSION,
    titleId: t.id,
    titleLabel: t.label,
    fit: statsOnly ? null : fb.fit,
    understood: statsOnly ? null : fb.understood,
    share: fb.share,
    showParts: fb.showParts,
    chips: fb.chips,
    comment: comment || null,
  };
  fb.sending = true;
  fb.error = '';
  renderFeedback();
  try {
    const res = await fetch(FEEDBACK_PATH, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let msg = '';
    try {
      msg = ((await res.json()) as { error?: string }).error ?? '';
    } catch {}
    if (!res.ok) throw new Error(msg || `HTTP ${res.status}`);
    fb.sent = true;
    try {
      localStorage.setItem(FEEDBACK_SENT_KEY, shown.key);
    } catch {}
    track('gmf_feedback_submitted', {
      title_id: t.id,
      fit: body.fit,
      understood: body.understood,
      share: body.share,
      show_parts: body.showParts,
      chips: body.chips,
      has_comment: !!body.comment,
    });
  } catch (e) {
    const m = String((e as Error).message);
    fb.error = `보내지 못했어요: ${m}. 잠시 뒤 다시 눌러 주세요.`;
    track('gmf_feedback_failed', { error: m.slice(0, 120) });
  }
  fb.sending = false;
  renderFeedback();
}

function wire(onEdit: () => void) {
  if (wired) return;
  wired = true;
  $('#save').addEventListener('click', () => void saveCard());
  $('#edit').addEventListener('click', () => {
    track('gmf_edit_clicked');
    shown = null;
    $('#result').hidden = true;
    $('#form').hidden = false;
    onEdit();
    window.scrollTo({ top: 0 });
  });
  $('#fb').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    if (!b || fb.sent || fb.sending) return;
    if (b.id === 'fb-send') return void sendFeedback();
    const name = b.dataset.fb as keyof FbState | undefined;
    if (!name) return;
    if (name === 'writing') fb.writing = !fb.writing;
    else if (name === 'showParts' || name === 'chips') {
      const list = fb[name];
      const v = b.dataset.v!;
      fb[name] = list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
    } else if (name === 'fit' || name === 'understood' || name === 'share') fb[name] = fb[name] === b.dataset.v ? null : b.dataset.v!;
    renderFeedback();
    if (name === 'writing' && fb.writing) ($('#fb-comment') as HTMLTextAreaElement | null)?.focus();
  });
  $('#fb').addEventListener('input', (e) => {
    const t = e.target as HTMLTextAreaElement;
    if (t.id !== 'fb-comment') return;
    fb.comment = t.value;
    const c = $('#fb-count');
    if (c) c.textContent = String([...t.value].length);
  });
}
