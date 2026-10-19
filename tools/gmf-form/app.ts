/**
 * 그민페 v2 입력 화면 (MIN-316): S1 소개 → S2 타임테이블 그리드 → S3 좋아요·아쉬움 시트 → S4 대표 무대 → 결과
 *
 * 참가일 선택 단계는 없다 — 체크한 공연의 날짜가 참가일이다.
 * 입력은 이 기기에 임시 저장하고(DRAFT_KEY), 제출에 성공한 뒤에만 결과를 보여준다.
 */
import catalogJson from '../../data/gmf2026/catalog.json';
import type { Catalog, Performance } from '../../packages/judge/src/judge';
import { validateRecord } from '../../packages/judge/src/judge';
import type { UserRecord } from '../../packages/judge/src/judge';
import { ANON_ID_RE, FORM_VERSION, SUBMIT_PATH, checkedKeys, dayCount, dayLabel, dayNo, droppedDays, effectivePick, emptyInput, makeAnonId, nextButton, normalize, parseKey, restoreInput, selectedDays, setDays, toSubmission, toggleCheck } from './logic';
import type { GmfPerformance, GmfRecord, InputState } from './logic';
import { identify, initAnalytics, track } from './analytics';
import { exampleCard, showResult, toast } from './result';
import { STAGE_SHORT } from './titles';
import type { Pick } from './titles';

const catalog = catalogJson as Catalog;
const fest = catalog.festivals.find((f) => f.id === 'gmf2026')!;
const stageIdx = new Map(fest.stages.map((s, i) => [s.id, i]));
const STAGE_COLOR = ['#519E98', '#F17A7C', '#EF96AB'];
const DRAFT_KEY = 'gmf2026-input-v2';
/** 같은 기기에서 다시 제출하면 같은 익명 ID로 덮어쓰도록 제출 후에도 남겨 둔다 */
const ANON_KEY = 'gmf2026-anon-id';
const SUBMITTED_KEY = 'gmf2026-submitted';
/** 새로고침해도 마지막 결과를 다시 보여주도록 마지막으로 제출에 성공한 기록을 남긴다 (연락처 없음) */
const LAST_KEY = 'gmf2026-last-record';
/** 칸 높이 = 공연 길이(분) × 1.5px */
const PX_PER_MIN = 1.5;

let st: InputState = emptyInput();
let anonId = makeAnonId();
let sending = false;
/** 진행도: 첫 체크 25% → 시트 완료 50% → 대표 선택 완료 100% */
let sheetDone = false;
let firstCheckSent = false;

try {
  const saved = localStorage.getItem(ANON_KEY);
  if (saved && ANON_ID_RE.test(saved)) anonId = saved;
  else localStorage.setItem(ANON_KEY, anonId);
  const raw = localStorage.getItem(DRAFT_KEY);
  if (raw) {
    // 참가일이 없는 예전 상태: 체크가 있는 날을 참가일로 (체크도 없으면 시트를 띄운다)
    st = restoreInput(fest, JSON.parse(raw));
  }
} catch {}

function save() {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(st));
  } catch {}
}

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const mins = (t: string) => +t.slice(0, 2) * 60 + +t.slice(3, 5);
const perf = (date: string, id: string) => fest.days.find((d) => d.date === date)?.performances.find((p) => p.id === id);
const artist = (p: Performance) => catalog.artists[p.artistId]?.name ?? p.artistId;
const total = () => checkedKeys(fest, st).length;
const metaOf = (date: string, p: Performance) => {
  const [, m, d] = date.split('-').map(Number);
  return `${m}/${d} · ${STAGE_SHORT[p.stageId] ?? p.stageId} · ${p.start}`;
};

/* ───────── 화면 전환·진행도 ───────── */

type Screen = 'intro' | 'grid' | 'pick';
function show(screen: Screen) {
  for (const s of ['intro', 'grid', 'pick'] as const) $(`#${s}`).hidden = s !== screen;
  $('#progress').hidden = screen === 'intro';
  renderProgress();
}

function renderProgress(done = false) {
  const pct = done ? 100 : sheetDone ? 50 : total() > 0 ? 25 : 0;
  ($('#progress').firstElementChild as HTMLElement).style.width = `${pct}%`;
}

/* ───────── S1 소개 ───────── */

let exampleDrawn = false;
function showIntro() {
  show('intro');
  window.scrollTo({ top: 0 });
  if (exampleDrawn) return;
  exampleDrawn = true;
  // 예시 기록: 이틀 12무대씩 (올림픽공원 거주민) · 대표 십란
  const D1 = ['mint-breeze-1220', 'mint-breeze-1320', 'mint-breeze-1420', 'mint-breeze-1530', 'mint-breeze-1640', 'mint-breeze-1750', 'mint-breeze-1910', 'mint-breeze-2040', 'club-midnight-sunset-1250', 'club-midnight-sunset-1830', 'club-midnight-sunset-2000', 'club-midnight-sunset-2130'];
  const D2 = ['mint-breeze-1220', 'mint-breeze-1310', 'mint-breeze-1410', 'mint-breeze-1520', 'mint-breeze-1630', 'mint-breeze-1740', 'club-midnight-sunset-1240', 'club-midnight-sunset-1330', 'club-midnight-sunset-1920', 'club-midnight-sunset-2050', 'loving-forest-garden-1850', 'loving-forest-garden-2020'];
  const [d1, d2] = fest.days.map((d) => d.date);
  const pick = { date: d2, performanceId: 'club-midnight-sunset-2050' };
  const record: UserRecord = {
    selections: [
      ...D1.map((performanceId) => ({ festivalId: fest.id, date: d1, performanceId })),
      ...D2.map((performanceId) => (performanceId === pick.performanceId ? { festivalId: fest.id, date: d2, performanceId, best: true } : { festivalId: fest.id, date: d2, performanceId })),
    ],
  };
  exampleCard(catalog, record, pick)
    .then((src) => {
      const img = $('#ex-img') as HTMLImageElement;
      img.src = src;
      img.hidden = false;
    })
    .catch(() => {});
}

/* ───────── S2 그리드 (참가일 선택 · 하루씩 체크, Figma S2 v3) ───────── */

/** 지금 보는 날 */
let viewDay = fest.days[0].date;

function renderHead() {
  const days = selectedDays(fest, st);
  const chosen = days.length > 0;
  $('#days-change').hidden = !chosen;
  $('#tabs').hidden = days.length < 2;
  $('#dateline').hidden = days.length !== 1;
  if (days.length === 1) $('#dateline').textContent = `DAY ${dayNo(fest, days[0])} · ${dayLabel(days[0])}`;
  if (days.length >= 2)
    $('#tabs').innerHTML = days
      .map((d) => {
        const n = dayCount(fest, st, d);
        const on = d === viewDay;
        return `<button type="button" class="tab${on ? ' on' : ''}" data-tab="${d}" aria-pressed="${on}"><b>DAY ${dayNo(fest, d)}</b><span${n ? ' class="cnt"' : ''}>${n ? `✓ ${n}개 체크` : dayLabel(d)}</span></button>`;
      })
      .join('');
  const nb = nextButton(fest, st, viewDay);
  const btn = $('#grid-next');
  btn.textContent = nb.label;
  btn.classList.toggle('dim', !nb.enabled);
}

/** 보는 날 하루만 그린다 (이틀을 이어 붙이지 않음) */
function renderGrid() {
  const check = '<svg viewBox="0 0 12 12" fill="none" stroke="#F2EBDD" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6.2l2.3 2.3 4.7-5"/></svg>';
  const d = fest.days.find((x) => x.date === viewDay) ?? fest.days[0];
  const ps = d.performances;
  const t0 = Math.floor(Math.min(...ps.map((p) => mins(p.start))) / 60) * 60;
  const t1 = Math.ceil(Math.max(...ps.map((p) => mins(p.end))) / 60) * 60;
  const h = (t1 - t0) * PX_PER_MIN;
  const on = new Set(st.checked[d.date] ?? []);
  const hours: number[] = [];
  for (let t = t0; t <= t1; t += 60) hours.push(t);
  const cols = fest.stages
    .map((s) => {
      const cells = ps
        .filter((p) => p.stageId === s.id)
        .map((p) => {
          const top = (mins(p.start) - t0) * PX_PER_MIN;
          const ht = (mins(p.end) - mins(p.start)) * PX_PER_MIN - 3;
          // 취소 공연: 위치·높이 그대로, 회색 칸 + 취소 태그, 탭해도 체크되지 않음
          if ((p as GmfPerformance).canceled)
            return `<button type="button" class="cell canceled" style="top:${top}px;height:${ht}px" data-date="${d.date}" data-perf="${p.id}" aria-disabled="true" aria-label="${esc(artist(p))} ${p.start}–${p.end} ${STAGE_SHORT[p.stageId] ?? ''} 취소됨"><span class="nm">${esc(artist(p))}</span><span class="cx">취소</span></button>`;
          const c = on.has(p.id);
          return `<button type="button" class="cell s${stageIdx.get(p.stageId)}${c ? ' on' : ''}" style="top:${top}px;height:${ht}px" data-date="${d.date}" data-perf="${p.id}" aria-pressed="${c}" aria-label="${esc(artist(p))} ${p.start}–${p.end} ${STAGE_SHORT[p.stageId] ?? ''}"><span class="nm">${esc(artist(p))}</span><span class="ck">${check}</span></button>`;
        })
        .join('');
      return `<div class="g-col" style="height:${h}px">${cells}</div>`;
    })
    .join('');
  $('#days').innerHTML = `<section class="g-day" data-day="${d.date}">
  <p class="hint">잠깐 들른 무대도, 시간이 겹치는 무대도 모두 체크해 주세요</p>${ps.some((p) => (p as GmfPerformance).canceled) ? '\n  <p class="hint-canceled">비 때문에 취소된 무대는 체크할 수 없어요</p>' : ''}
  <div class="g-stages"><span></span>${fest.stages.map((s, j) => `<span><i style="background:${STAGE_COLOR[j]}"></i>${STAGE_SHORT[s.id] ?? s.name}</span>`).join('')}</div>
  <div class="g-body">
    <div class="g-lines">${hours.map((t) => `<i style="top:${(t - t0) * PX_PER_MIN}px"></i>`).join('')}</div>
    <div class="g-axis" style="height:${h}px">${hours.map((t) => `<span style="top:${(t - t0) * PX_PER_MIN}px">${String(t / 60).padStart(2, '0')}:00</span>`).join('')}</div>
    ${cols}
  </div>
</section>`;
  renderHead();
}

function toggleCell(b: HTMLButtonElement) {
  const { date, perf: id } = b.dataset as { date: string; perf: string };
  const t = toggleCheck(fest, st, date, id);
  if (t.ignored) return; // 취소 공연
  const on = t.on;
  st = t.state;
  const cur = new Set(st.checked[date] ?? []);
  b.classList.toggle('on', on);
  b.setAttribute('aria-pressed', String(on));
  save();
  renderHead();
  renderProgress();
  const p = perf(date, id);
  track('gmf_performance_toggled', { date, performance_id: id, artist_id: p?.artistId, stage_id: p?.stageId, start: p?.start, on, checked_count: cur.size });
  if (on && !firstCheckSent) {
    firstCheckSent = true;
    track('gmf_grid_first_check');
  }
}

/** 날 전환: 그 날 그리드로 바꾸고 맨 위로 */
function switchDay(to: string, via: 'tab' | 'button') {
  if (to !== viewDay) track('gmf_grid_day_switch', { to, via });
  viewDay = to;
  renderGrid();
  window.scrollTo({ top: 0 });
}

function gridNext() {
  const nb = nextButton(fest, st, viewDay);
  if (!nb.enabled) {
    // 흐림 버튼도 누를 수 있다: 체크 없는 날로 이동 + 위쪽 토스트
    track('gmf_next_blocked', { reason: nb.blocked.reason, day: nb.blocked.day });
    if (nb.blocked.to !== viewDay) switchDay(nb.blocked.to, 'button');
    toast(nb.blocked.message);
    return;
  }
  if (nb.action.kind === 'nextDay') return switchDay(nb.action.to, 'button');
  track('gmf_grid_next', { checked: total(), days: selectedDays(fest, st) });
  openLikes();
}

/* ───────── 참가일 선택 시트 ───────── */

/** 시트에서 고르는 중인 날 */
let pickingDays: string[] = [];
let daysChanged = false;

function openDays(changed: boolean) {
  daysChanged = changed;
  pickingDays = selectedDays(fest, st);
  renderDays();
  $('#dsheet').hidden = false;
}

function renderDays() {
  const tick = '<svg viewBox="0 0 12 12" fill="none" stroke="#14110F" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6.2l2.3 2.3 4.7-5"/></svg>';
  $('#dsheet .sheet-panel').innerHTML = `<h2 class="l-title">언제 다녀왔어요?</h2>
<p class="l-sub">다녀온 날을 모두 골라 주세요</p>
<div class="d-opts">${fest.days
    .map((d) => {
      const on = pickingDays.includes(d.date);
      return `<button type="button" class="d-opt${on ? ' on' : ''}" data-dayopt="${d.date}" aria-pressed="${on}"><b>DAY ${dayNo(fest, d.date)}</b><span>${dayLabel(d.date)}</span><i class="d-ck">${on ? tick : ''}</i></button>`;
    })
    .join('')}</div>
<button type="button" id="days-ok" class="cta${pickingDays.length ? '' : ' dim'}"${pickingDays.length ? '' : ' disabled'}>확인</button>`;
}

function renderDropConfirm(drop: { day: number; count: number }) {
  $('#dsheet .sheet-panel').innerHTML = `<h2 class="l-title">DAY ${drop.day}를 빼면<br>체크한 ${drop.count}개가 지워져요</h2>
<div class="d-confirm"><button type="button" id="drop-cancel" class="cta ghost">취소</button><button type="button" id="drop-ok" class="cta">빼기</button></div>`;
}

function applyDays() {
  const before = selectedDays(fest, st);
  st = setDays(fest, st, pickingDays);
  save();
  $('#dsheet').hidden = true;
  const days = selectedDays(fest, st);
  // 보는 날이 빠졌으면 남은 첫 날로, 날을 추가했으면 보는 날은 그대로
  if (!days.includes(viewDay) || !before.length) viewDay = days[0];
  track('gmf_days_selected', { days: days.length === 2 ? 'both' : String(dayNo(fest, days[0])), changed: daysChanged });
  renderGrid();
  renderProgress();
  window.scrollTo({ top: 0 });
}

function daysOk() {
  if (!pickingDays.length) return;
  const drop = droppedDays(fest, st, pickingDays);
  if (drop.length) return renderDropConfirm(drop[0]);
  applyDays();
}

function startGrid() {
  show('grid');
  window.scrollTo({ top: 0 });
  const days = selectedDays(fest, st);
  if (!days.includes(viewDay)) viewDay = days[0] ?? fest.days[0].date;
  renderGrid();
  if (!days.length) openDays(false);
}

/* ───────── S3 좋아요·아쉬움 시트 ───────── */

function openLikes() {
  renderLikes();
  $('#lsheet').hidden = false;
  ($('#lsheet .sheet-panel') as HTMLElement).scrollTop = 0;
}

function renderLikes() {
  const likes = new Set(st.likes);
  const regrets = new Set(st.regrets);
  $('#l-list').innerHTML = fest.days
    .map((d, i) => {
      const keys = checkedKeys(fest, st).filter((k) => k.startsWith(`${d.date}|`));
      if (!keys.length) return '';
      const rows = keys
        .map((k) => {
          const { date, performanceId } = parseKey(k);
          const p = perf(date, performanceId)!;
          const lk = likes.has(k);
          const rg = regrets.has(k);
          return `<div class="l-row"><span class="l-dot" style="background:${STAGE_COLOR[stageIdx.get(p.stageId)!]}"></span>
  <div class="l-info"><b>${esc(artist(p))}</b><span>${p.start} · ${STAGE_SHORT[p.stageId] ?? ''}</span></div>
  <button type="button" class="pill like${lk ? ' on' : ''}" data-like="${k}" aria-pressed="${lk}">좋아요</button>
  <button type="button" class="pill regret${rg ? ' on' : ''}" data-regret="${k}" aria-pressed="${rg}">아쉬움</button></div>`;
        })
        .join('');
      return `<p class="l-day">DAY ${i + 1} · ${dayLabel(d.date)} · ${keys.length}개</p>${rows}`;
    })
    .join('');
}

function likesDone() {
  st = normalize(fest, st);
  save();
  $('#lsheet').hidden = true;
  sheetDone = true;
  track('gmf_sheet_done', { likes: st.likes.length, regrets: st.regrets.length });
  if (st.likes.length >= 2) {
    if (!st.pick) st.pick = effectivePick(fest, st);
    save();
    showPick();
  } else {
    track('gmf_pick_done', { likes: st.likes.length, skipped: true });
    void submit();
  }
}

/* ───────── S4 대표 무대 ───────── */

function showPick() {
  show('pick');
  renderPick();
  window.scrollTo({ top: 0 });
}

function renderPick() {
  const cur = effectivePick(fest, st);
  if (cur) {
    const { date, performanceId } = parseKey(cur);
    const p = perf(date, performanceId)!;
    $('#pick-preview').innerHTML = `<div class="lb">이번 그민페 최고의 무대</div><div class="nm">${esc(artist(p))}</div><div class="mt"><span class="l-dot" style="background:${STAGE_COLOR[stageIdx.get(p.stageId)!]}"></span>${metaOf(date, p)}</div>`;
  }
  const likes = [...st.likes].sort((a, b) => {
    const pa = parseKey(a);
    const pb = parseKey(b);
    return `${pa.date} ${perf(pa.date, pa.performanceId)!.start}`.localeCompare(`${pb.date} ${perf(pb.date, pb.performanceId)!.start}`);
  });
  $('#pick-count').textContent = `좋아요한 무대 ${likes.length}개`;
  $('#pick-list').innerHTML = likes
    .map((k) => {
      const { date, performanceId } = parseKey(k);
      const p = perf(date, performanceId)!;
      const on = k === cur;
      return `<button type="button" class="p-row${on ? ' on' : ''}" data-pick="${k}" aria-pressed="${on}"><span class="l-dot" style="background:${STAGE_COLOR[stageIdx.get(p.stageId)!]}"></span>
  <span class="l-info"><b>${esc(artist(p))}</b><span>${metaOf(date, p)}</span></span><span class="st" aria-hidden="true">${on ? '★' : '☆'}</span></button>`;
    })
    .join('');
}

/* ───────── 제출 ───────── */

async function submit() {
  if (sending) return;
  sending = true;
  const btns = ['#pick-done', '#l-done', '#grid-next'].map((s) => $(s) as HTMLButtonElement);
  btns.forEach((b) => (b.disabled = true));
  const doneBtn = $('#pick-done') as HTMLButtonElement;
  doneBtn.textContent = '결과 만드는 중…';
  if (!$('#grid').hidden) toast('결과 만드는 중…');
  renderProgress(true);
  const body = toSubmission(fest, st, anonId);
  const summary = { day_count: new Set(body.record.selections.map((s) => s.date)).size, selection_count: body.record.selections.length, likes: st.likes.length, regrets: st.regrets.length };
  try {
    const res = await fetch(SUBMIT_PATH, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let msg = '';
    try {
      msg = ((await res.json()) as { error?: string }).error ?? '';
    } catch {}
    if (!res.ok) throw new Error(msg || `HTTP ${res.status}`);
    identify(anonId);
    let resubmit = false;
    try {
      resubmit = localStorage.getItem(SUBMITTED_KEY) === '1';
      localStorage.setItem(SUBMITTED_KEY, '1');
      localStorage.setItem(LAST_KEY, JSON.stringify(body.record));
    } catch {}
    track('gmf_submit_succeeded', { ...summary, resubmit });
    sending = false;
    btns.forEach((b) => (b.disabled = false));
    doneBtn.textContent = '결과 보기';
    await showResult(catalog, { selections: body.record.selections }, anonId, { restored: false, pick: body.record.pick, onRestart: restart });
  } catch (err) {
    const m = String((err as Error).message);
    track('gmf_submit_failed', { ...summary, error: m.slice(0, 120) });
    toast(`보내지 못했어요: ${m}. 입력한 내용은 이 기기에 남아 있으니 잠시 뒤 다시 눌러 주세요.`);
    sending = false;
    btns.forEach((b) => (b.disabled = false));
    doneBtn.textContent = '결과 보기';
    renderProgress();
  }
}

function restart() {
  sheetDone = false;
  showIntro();
}

/* ───────── 연결 ───────── */

document.addEventListener('click', (e) => {
  const el = e.target as HTMLElement;
  const b = el.closest('button') as HTMLButtonElement | null;
  if (el.classList.contains('sheet-bg') && el.parentElement?.id === 'lsheet') {
    $('#lsheet').hidden = true;
    return;
  }
  if (!b) return;
  if (b.id === 'start') {
    track('gmf_intro_started');
    startGrid();
  } else if (b.dataset.perf) toggleCell(b);
  else if (b.dataset.tab) switchDay(b.dataset.tab, 'tab');
  else if (b.id === 'grid-next') gridNext();
  else if (b.id === 'days-change') openDays(true);
  else if (b.dataset.dayopt) {
    const d = b.dataset.dayopt;
    pickingDays = pickingDays.includes(d) ? pickingDays.filter((x) => x !== d) : [...pickingDays, d];
    renderDays();
  } else if (b.id === 'days-ok') daysOk();
  else if (b.id === 'drop-ok') applyDays();
  else if (b.id === 'drop-cancel') $('#dsheet').hidden = true; // [취소] = 그대로
  else if (b.dataset.like || b.dataset.regret) {
    const k = (b.dataset.like ?? b.dataset.regret)!;
    const like = !!b.dataset.like;
    const list = like ? st.likes : st.regrets;
    const on = !list.includes(k);
    if (like) {
      st.likes = on ? [...st.likes, k] : st.likes.filter((x) => x !== k);
      if (on) st.regrets = st.regrets.filter((x) => x !== k);
    } else {
      st.regrets = on ? [...st.regrets, k] : st.regrets.filter((x) => x !== k);
      if (on) st.likes = st.likes.filter((x) => x !== k);
    }
    st = normalize(fest, st);
    save();
    renderLikes();
  } else if (b.id === 'l-done') likesDone();
  else if (b.dataset.pick) {
    st.pick = b.dataset.pick;
    save();
    renderPick();
  } else if (b.id === 'pick-back') {
    show('grid');
    renderGrid();
    openLikes();
  } else if (b.id === 'pick-done') {
    track('gmf_pick_done', { likes: st.likes.length, skipped: false });
    void submit();
  }
});

/** 마지막 결과 — v2 기록은 { selections, regrets, pick }, v1 기록은 { selections } (pick 없음 → best로 최고 무대) */
function lastRecord(): { record: UserRecord; pick?: Pick | null } | null {
  try {
    const raw = localStorage.getItem(LAST_KEY);
    if (!raw) return null;
    const r = JSON.parse(raw) as Partial<GmfRecord>;
    if (!r || !Array.isArray(r.selections) || !r.selections.length) return null;
    const record: UserRecord = { selections: r.selections };
    if (validateRecord(catalog, record).errors.length) return null;
    return 'pick' in r ? { record, pick: r.pick ?? null } : { record };
  } catch {
    return null;
  }
}

initAnalytics({ surface: 'gmf-test', festival_id: fest.id, form_version: FORM_VERSION });
renderGrid();
const last = lastRecord();
if (last) void showResult(catalog, last.record, anonId, { restored: true, pick: last.pick, onRestart: restart });
else showIntro();
