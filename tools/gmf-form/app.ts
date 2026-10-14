import catalogJson from '../../data/gmf2026/catalog.json';
import type { Catalog } from '../../packages/judge/src/judge';
import { ANON_ID_RE, SUBMIT_PATH, check, dayLabel, emptyState, makeAnonId, sortedDay, toSubmission } from './logic';
import type { FormState } from './logic';
import { FORM_VERSION } from './logic';
import { identify, initAnalytics, track } from './analytics';

const catalog = catalogJson as Catalog;
const fest = catalog.festivals.find((f) => f.id === 'gmf2026')!;
const stageIdx = new Map(fest.stages.map((s, i) => [s.id, i]));
const DRAFT_KEY = 'gmf2026-form-draft';
/** 같은 기기에서 다시 제출하면 같은 익명 ID로 덮어쓰도록 제출 후에도 남겨 둔다 */
const ANON_KEY = 'gmf2026-anon-id';
const SUBMITTED_KEY = 'gmf2026-submitted';

let st: FormState = emptyState();
let anonId = makeAnonId();
let showProblems = false;
let sending = false;

try {
  const saved = localStorage.getItem(ANON_KEY);
  if (saved && ANON_ID_RE.test(saved)) anonId = saved;
  else localStorage.setItem(ANON_KEY, anonId);
  const raw = localStorage.getItem(DRAFT_KEY);
  if (raw) {
    const d = JSON.parse(raw);
    if (d && d.state) st = { ...emptyState(), ...d.state };
  }
} catch {}

function save() {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ state: st }));
  } catch {}
}

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function render() {
  const problems = check(catalog, fest, st);
  const dates = fest.days.map((d) => d.date);

  $('#days').innerHTML = dates
    .map((d) => `<button type="button" class="chip${st.days.includes(d) ? ' on' : ''}" data-day="${d}" aria-pressed="${st.days.includes(d)}">${dayLabel(d)}</button>`)
    .join('');

  $('#lists').innerHTML = [...st.days]
    .sort()
    .map((date) => {
      const seen = new Set(st.seen[date] ?? []);
      const rows = sortedDay(fest, date)
        .map((p) => {
          const a = catalog.artists[p.artistId];
          const on = seen.has(p.id);
          const star = st.best[date] === p.id;
          const stage = fest.stages[stageIdx.get(p.stageId)!];
          return `<li class="row${on ? ' on' : ''}">
  <button type="button" class="pick" data-date="${date}" data-perf="${p.id}" aria-pressed="${on}">
    <span class="box" aria-hidden="true"></span>
    <span class="time mono">${p.start}–${p.end}</span>
    <span class="name">${esc(a?.name ?? p.artistId)}</span>
    <span class="stage s${stageIdx.get(p.stageId)}">${esc(stage.name.replace(/ Stage$/, ''))}</span>
  </button>
  <button type="button" class="star${star ? ' on' : ''}" data-date="${date}" data-best="${p.id}" ${on ? '' : 'disabled'} aria-pressed="${star}" aria-label="${esc(a?.name ?? '')} 최고의 무대로 고르기">★</button>
</li>`;
        })
        .join('');
      const n = seen.size;
      const bestName = st.best[date] ? catalog.artists[fest.days.find((d) => d.date === date)!.performances.find((p) => p.id === st.best[date])!.artistId]?.name : null;
      return `<section class="card day">
  <h2>${dayLabel(date)} 본 무대</h2>
  <p class="hint">조금이라도 본 공연은 모두 체크해 주세요. 시간이 겹쳐도 괜찮아요. 그중 최고의 무대 하나에 ★를 눌러 주세요.</p>
  <p class="dayhead tally">${dayLabel(date)} · <span class="mono">${n}</span>개 체크 · ${bestName ? `★ ${esc(bestName)}` : '<span class="need">★ 아직 안 고름</span>'}</p>
  <ul class="list">${rows}</ul>
</section>`;
    })
    .join('');

  ($('#contact') as unknown as HTMLInputElement).value = st.contact;
  ($('#consent-result') as unknown as HTMLInputElement).checked = st.consentResult;
  ($('#consent-reshare') as unknown as HTMLInputElement).checked = st.consentReshare;

  const box = $('#problems');
  box.hidden = !(showProblems && problems.length);
  box.innerHTML = problems.map((p) => `<li>${esc(p.message)}</li>`).join('');

  const total = st.days.reduce((s, d) => s + (st.seen[d] ?? []).length, 0);
  $('#count').textContent = st.days.length ? `${st.days.length}일 · ${total}개 무대` : '참가일을 먼저 골라 주세요';
  const btn = $('#submit') as HTMLButtonElement;
  btn.disabled = sending;
  btn.textContent = sending ? '보내는 중…' : '기록 보내기';
}

document.addEventListener('click', (e) => {
  const t = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
  if (!t) return;
  if (t.dataset.day) {
    const d = t.dataset.day;
    const on = !st.days.includes(d);
    st.days = on ? [...st.days, d] : st.days.filter((x) => x !== d);
    track('gmf_day_toggled', { date: d, on });
  } else if (t.dataset.perf) {
    const { date, perf } = t.dataset as { date: string; perf: string };
    const cur = new Set(st.seen[date] ?? []);
    const on = !cur.has(perf);
    if (!on) {
      cur.delete(perf);
      if (st.best[date] === perf) st.best[date] = null;
    } else cur.add(perf);
    st.seen[date] = [...cur];
    track('gmf_performance_toggled', { date, performance_id: perf, ...perfProps(date, perf), on, checked_count: cur.size });
  } else if (t.dataset.best) {
    const { date, best } = t.dataset as { date: string; best: string };
    st.best[date] = st.best[date] === best ? null : best;
    if (st.best[date]) track('gmf_best_selected', { date, performance_id: best, ...perfProps(date, best) });
  } else return;
  save();
  render();
});

document.addEventListener('input', (e) => {
  const t = e.target as HTMLInputElement;
  if (t.id === 'contact') st.contact = t.value;
  else if (t.id === 'consent-result') st.consentResult = t.checked;
  else if (t.id === 'consent-reshare') st.consentReshare = t.checked;
  else return;
  save();
  const box = $('#problems');
  if (showProblems) {
    const problems = check(catalog, fest, st);
    box.hidden = !problems.length;
    box.innerHTML = problems.map((p) => `<li>${esc(p.message)}</li>`).join('');
  }
});

async function submit() {
  const res = await fetch(SUBMIT_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(toSubmission(fest, st, anonId)),
  });
  let msg = '';
  try {
    msg = ((await res.json()) as { error?: string }).error ?? '';
  } catch {}
  if (!res.ok) throw new Error(msg || `HTTP ${res.status}`);
}

function perfProps(date: string, perfId: string) {
  const p = fest.days.find((d) => d.date === date)?.performances.find((x) => x.id === perfId);
  return p ? { artist_id: p.artistId, stage_id: p.stageId, start: p.start } : {};
}

function summary() {
  const days = [...st.days].sort();
  return {
    days,
    day_count: days.length,
    selection_count: days.reduce((n, d) => n + (st.seen[d] ?? []).length, 0),
    has_contact: st.contact.trim() !== '',
    consent_reshare: st.consentReshare,
  };
}

$('#form').addEventListener('submit', async (e) => {
  e.preventDefault();
  showProblems = true;
  const problems = check(catalog, fest, st);
  track('gmf_submit_clicked', { ...summary(), blocked: problems.length > 0, problem_steps: [...new Set(problems.map((p) => p.step))] });
  if (problems.length) {
    render();
    $('#problems').scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  sending = true;
  render();
  const hasContact = st.contact.trim() !== '';
  try {
    await submit();
    identify(anonId);
    let resubmit = false;
    try {
      resubmit = localStorage.getItem(SUBMITTED_KEY) === '1';
      localStorage.setItem(SUBMITTED_KEY, '1');
      localStorage.removeItem(DRAFT_KEY);
    } catch {}
    track('gmf_submit_succeeded', { ...summary(), resubmit });
    $('#form').hidden = true;
    $('#done').hidden = false;
    $('#done-contact').textContent = hasContact ? '결과 카드는 적어 주신 연락처로 10/18부터 순서대로 보내드릴게요.' : '연락처를 남기지 않아 결과 카드는 따로 보내드리지 않아요. 기록은 판정 검증에만 써요.';
    window.scrollTo({ top: 0 });
  } catch (err) {
    track('gmf_submit_failed', { ...summary(), error: String((err as Error).message).slice(0, 120) });
    sending = false;
    render();
    const box = $('#problems');
    box.hidden = false;
    box.innerHTML = `<li>보내지 못했어요: ${esc(String((err as Error).message))}. 입력한 내용은 이 기기에 남아 있으니 잠시 뒤 다시 눌러 주세요.</li>`;
  }
});

initAnalytics({ surface: 'gmf-test', festival_id: fest.id, form_version: FORM_VERSION });
render();
