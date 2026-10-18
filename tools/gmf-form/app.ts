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
import { ANON_ID_RE, FORM_VERSION, SUBMIT_PATH, checkedKeys, dayLabel, effectivePick, emptyInput, makeAnonId, normalize, parseKey, toSubmission } from './logic';
import type { GmfRecord, InputState } from './logic';
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
    const d = JSON.parse(raw);
    if (d && typeof d === 'object') st = normalize(fest, { ...emptyInput(), ...d });
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
  // 예시 기록: 이틀 12무대씩 (올림픽공원 거주자) · 대표 십란
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

/* ───────── S2 그리드 ───────── */

function renderTabs() {
  $('#tabs').innerHTML = fest.days
    .map((d, i) => {
      const n = (st.checked[d.date] ?? []).length;
      const on = d.date === activeDay;
      return `<button type="button" class="tab${on ? ' on' : ''}" data-tab="${d.date}" aria-pressed="${on}"><b>DAY ${i + 1}</b><span>${dayLabel(d.date)}${n ? ` · ${n}개 체크` : ''}</span></button>`;
    })
    .join('');
}

let activeDay = fest.days[0].date;

function renderGrid() {
  const check = '<svg viewBox="0 0 12 12" fill="none" stroke="#F2EBDD" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6.2l2.3 2.3 4.7-5"/></svg>';
  $('#days').innerHTML = fest.days
    .map((d, i) => {
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
              const c = on.has(p.id);
              return `<button type="button" class="cell s${stageIdx.get(p.stageId)}${c ? ' on' : ''}" style="top:${top}px;height:${ht}px" data-date="${d.date}" data-perf="${p.id}" aria-pressed="${c}" aria-label="${esc(artist(p))} ${p.start}–${p.end} ${STAGE_SHORT[p.stageId] ?? ''}"><span class="nm">${esc(artist(p))}</span><span class="ck">${check}</span></button>`;
            })
            .join('');
          return `<div class="g-col" style="height:${h}px">${cells}</div>`;
        })
        .join('');
      return `<section class="g-day" id="day-${d.date}" data-day="${d.date}">
  <h2>DAY ${i + 1} · ${dayLabel(d.date)}</h2>
  <p class="hint">잠깐 들른 무대도, 시간이 겹치는 무대도 모두 체크해 주세요</p>
  <div class="g-stages"><span></span>${fest.stages.map((s, j) => `<span><i style="background:${STAGE_COLOR[j]}"></i>${STAGE_SHORT[s.id] ?? s.name}</span>`).join('')}</div>
  <div class="g-body">
    <div class="g-lines">${hours.map((t) => `<i style="top:${(t - t0) * PX_PER_MIN}px"></i>`).join('')}</div>
    <div class="g-axis" style="height:${h}px">${hours.map((t) => `<span style="top:${(t - t0) * PX_PER_MIN}px">${String(t / 60).padStart(2, '0')}:00</span>`).join('')}</div>
    ${cols}
  </div>
</section>`;
    })
    .join('');
  renderTabs();
}

function toggleCell(b: HTMLButtonElement) {
  const { date, perf: id } = b.dataset as { date: string; perf: string };
  const cur = new Set(st.checked[date] ?? []);
  const on = !cur.has(id);
  if (on) cur.add(id);
  else cur.delete(id);
  st.checked[date] = [...cur];
  st = normalize(fest, st);
  b.classList.toggle('on', on);
  b.setAttribute('aria-pressed', String(on));
  save();
  renderTabs();
  renderProgress();
  const p = perf(date, id);
  track('gmf_performance_toggled', { date, performance_id: id, artist_id: p?.artistId, stage_id: p?.stageId, start: p?.start, on, checked_count: cur.size });
  if (on && !firstCheckSent) {
    firstCheckSent = true;
    track('gmf_grid_first_check');
  }
}

/** 스크롤 위치에 따라 DAY 탭을 바꾼다 */
function syncTab() {
  if ($('#grid').hidden) return;
  const headH = $('.g-top').getBoundingClientRect().bottom;
  let cur = fest.days[0].date;
  for (const d of fest.days) {
    const el = document.getElementById(`day-${d.date}`);
    if (el && el.getBoundingClientRect().top <= headH + 40) cur = d.date;
  }
  if (cur !== activeDay) {
    activeDay = cur;
    renderTabs();
  }
}

function gotoDay(date: string) {
  const el = document.getElementById(`day-${date}`);
  if (!el) return;
  const headH = $('.g-top').getBoundingClientRect().height;
  activeDay = date;
  renderTabs();
  window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - headH + 4, behavior: 'smooth' });
}

function gridNext() {
  const n = total();
  if (!n) {
    track('gmf_grid_empty_next');
    toast('본 무대를 하나 이상 체크해 주세요');
    return;
  }
  track('gmf_grid_next', { checked: n, days: fest.days.filter((d) => (st.checked[d.date] ?? []).length).map((d) => d.date) });
  openLikes();
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
  renderGrid();
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
    show('grid');
    window.scrollTo({ top: 0 });
    syncTab();
  } else if (b.dataset.perf) toggleCell(b);
  else if (b.dataset.tab) gotoDay(b.dataset.tab);
  else if (b.id === 'grid-next') gridNext();
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
    openLikes();
  } else if (b.id === 'pick-done') {
    track('gmf_pick_done', { likes: st.likes.length, skipped: false });
    void submit();
  }
});
window.addEventListener('scroll', syncTab, { passive: true });

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
