import { judge, fmtTime, fmtDuration, DEFAULT_CONFIG, METRIC_NAMES, VERSION, validateCatalog } from '../../packages/judge/src/judge';
import type { Catalog, JudgeResult, MetricResult, UserRecord, MetricId, DaySummary, Selection } from '../../packages/judge/src/judge';
import { buildCases, GROUP_ORDER } from '../../packages/judge/src/fixtures';
import type { Case } from '../../packages/judge/src/fixtures';

/* ───────────── 상태 ───────────── */
type AnyCase = Omit<Case, 'expect'> & { expect?: Case['expect'] };
const builtIn: AnyCase[] = buildCases();
const custom: AnyCase[] = [];
const allCases = () => [...builtIn, ...custom];

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const S = {
  idx: 0,
  record: clone(builtIn[0].record) as UserRecord,
  modified: false,
  mode: 'select' as 'select' | 'best',
  notice: '' as string,
};

const repOf = (r: JudgeResult) =>
  r.representative.kind === 'special' || r.representative.kind === 'base' ? r.representative.metricId! : r.representative.kind;

function evaluate(c: AnyCase, record: UserRecord) {
  const r = judge(c.catalog, record);
  if (!c.expect) return { r, pass: null as boolean | null, repOk: null as boolean | null, checks: [] as { label: string; ok: boolean }[] };
  const repOk = repOf(r) === c.expect.rep;
  const checks = (c.expect.checks ?? []).map((ch) => ({ label: ch.label, ok: safe(() => ch.test(r)) }));
  return { r, pass: repOk && checks.every((x) => x.ok), repOk, checks };
}
const safe = (f: () => boolean) => {
  try {
    return f();
  } catch {
    return false;
  }
};
const baseline = new Map<string, boolean | null>(builtIn.map((c) => [c.id, evaluate(c, c.record).pass]));

/* ───────────── 유틸 ───────────── */
const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
const $ = (sel: string) => document.querySelector(sel) as HTMLElement;
const repName = (rep: string) => (rep === 'statsOnly' ? '통계 카드만' : rep === 'blocked' ? '입력 차단' : METRIC_NAMES[rep as MetricId] ?? rep);
const pips = (t: number, cat: string, off = false) =>
  `<span class="pips ${cat}${off ? ' off' : ''}" aria-label="${t}단계">${[1, 2, 3].map((i) => `<i class="${i <= t ? 'on' : ''}"></i>`).join('')}</span>`;
const pctText = (x: number | null) => (x == null ? '—' : `${(Math.round(x * 1000) / 10).toFixed(1)}%`);

/* ───────────── 사이드바 ───────────── */
function renderSidebar() {
  const cases = allCases();
  const groups = [...GROUP_ORDER, ...(custom.length ? ['직접 입력'] : [])];
  const passCount = builtIn.filter((c) => baseline.get(c.id)).length;
  $('#suite').innerHTML = `<b>${passCount}</b>/${builtIn.length} 사례 통과`;
  $('#suite').className = `suite ${passCount === builtIn.length ? 'ok' : 'bad'}`;
  $('#case-list').innerHTML = groups
    .map((g) => {
      const items = cases.map((c, i) => ({ c, i })).filter(({ c }) => c.group === g);
      if (!items.length) return '';
      return `<div class="grp"><div class="grp-h">${esc(g)}</div>${items
        .map(({ c, i }) => {
          const p = baseline.get(c.id);
          const chip = p == null ? '<span class="chip off">—</span>' : p ? '<span class="chip ok">통과</span>' : '<span class="chip bad">실패</span>';
          return `<button class="case${i === S.idx ? ' cur' : ''}" data-case="${i}"><span class="cid">${esc(c.id)}</span><span class="ctitle">${esc(c.title)}</span>${chip}</button>`;
        })
        .join('')}</div>`;
    })
    .join('');
  const sel = $('#case-select') as HTMLSelectElement;
  sel.innerHTML = cases.map((c, i) => `<option value="${i}"${i === S.idx ? ' selected' : ''}>${esc(c.id)} · ${esc(c.title)}</option>`).join('');
}

/* ───────────── 본문 ───────────── */
function renderMain() {
  const c = allCases()[S.idx];
  const ev = evaluate(c, S.record);
  const r = ev.r;
  const html: string[] = [];

  /* 머리 */
  html.push(`<header class="case-h">
    <div class="eyebrow"><span class="mono">${esc(c.id)}</span> · ${esc(c.group)}</div>
    <h1>${esc(c.title)}</h1>
    <p class="focus">${esc(c.focus)}</p>
    ${S.modified ? `<div class="modified">기록을 수정한 상태예요. 기대값 비교는 원래 기록 기준이라 생략했어요. <button class="btn ghost" data-action="reset">원래 기록으로</button></div>` : ''}
    ${S.notice ? `<div class="notice">${esc(S.notice)}</div>` : ''}
  </header>`);

  /* 판정 */
  const rep = r.representative;
  const repLabel = rep.metricId ? METRIC_NAMES[rep.metricId] : repName(rep.kind);
  const repMetric = rep.metricId ? r.metrics.find((m) => m.id === rep.metricId) : null;
  const cat = rep.kind === 'special' ? 'special' : rep.kind === 'base' ? 'base' : 'none';
  const expectHtml =
    !S.modified && c.expect
      ? `<div class="expect">
          <div class="exp-row ${ev.repOk ? 'ok' : 'bad'}"><span class="mark">${ev.repOk ? '✓' : '✗'}</span>기대 대표: <b>${esc(repName(c.expect.rep))}</b></div>
          ${ev.checks.map((x) => `<div class="exp-row ${x.ok ? 'ok' : 'bad'}"><span class="mark">${x.ok ? '✓' : '✗'}</span>${esc(x.label)}</div>`).join('')}
        </div>`
      : '';
  html.push(`<section class="verdict ${cat}">
    <div class="v-main">
      <div class="v-label">대표 결과</div>
      <div class="v-title">${esc(repLabel)}${rep.tier ? ` <span class="v-tier">${pips(rep.tier, cat)} ${rep.tier}단계</span>` : ''}</div>
      ${rep.featuredArtist ? `<div class="v-artist">대표 아티스트 · ${esc(rep.featuredArtist.name)} ${rep.featuredArtist.count}번 (${rep.featuredArtist.festivals}곳)</div>` : ''}
      ${repMetric?.evidence ? `<div class="v-evidence">“${esc(repMetric.evidence)}”<span class="draft">근거 초안</span></div>` : ''}
      <div class="v-reason">${esc(rep.reason)}</div>
      ${rep.tieCandidates.length > 1 ? `<div class="ties">동률 후보 ${rep.tieCandidates.map((id, i) => `<span class="tie${i === 0 ? ' win' : ''}">${esc(METRIC_NAMES[id])}</span>`).join('')}</div>` : ''}
    </div>
    <div class="v-side">
      <div class="sb">
        <div class="sb-row"><span class="sb-k">특별 최고 S</span>${pips(rep.S, 'special')}<span class="mono">${rep.S}</span></div>
        <div class="sb-row"><span class="sb-k">기본 최고 B</span>${pips(rep.B, 'base')}<span class="mono">${rep.B}</span></div>
        <div class="sb-rule">B ≥ S + 1 → 기본 · S ≥ 1 → 특별 · 둘 다 0 → 통계 카드만</div>
      </div>
      ${expectHtml}
    </div>
  </section>`);

  if (r.status === 'blocked') {
    html.push(`<section class="blocked">${r.errors.map((e) => `<p><b>${esc(e.code)}</b> ${esc(e.message)}</p>`).join('')}</section>`);
  } else {
    /* 통계 */
    const st = r.stats;
    html.push(`<section class="stats">
      ${[
        ['ARTISTS', st.uniqueArtists, '고유 아티스트'],
        ['HOURS', (Math.round((st.unionMinutes / 60) * 10) / 10).toFixed(1), '선택 공연 시간표 기준'],
        ['FESTIVALS', st.festivals, '참가 페스티벌'],
        ['DAYS', st.participationDays, `참가일 (관람 3개↑ ${st.validDays}일)`],
        ['STAGES SEEN', st.views, '선택한 공연 수'],
      ]
        .map(([k, v, s]) => `<div class="stat"><div class="stat-v mono">${v}</div><div class="stat-k">${k}</div><div class="stat-s">${s}</div></div>`)
        .join('')}
    </section>`);
    const warns = [...r.warnings, ...validateCatalog(c.catalog)];
    if (warns.length) html.push(`<div class="notice">${warns.map((w) => esc(w.message)).join('<br>')}</div>`);

    /* 지표 표 */
    html.push(`<section><h2>지표별 계산</h2><div class="tbl-wrap"><table class="metrics">
      <thead><tr><th>지표</th><th>단계</th><th>원시 수치</th><th>분모</th><th>기준선</th><th class="num">Δ</th><th>제외 사유 · 비고</th><th>근거 초안</th></tr></thead>
      <tbody>${r.metrics.map((m) => metricRow(m, rep.metricId)).join('')}</tbody></table></div>
      <p class="legend"><span class="tag special">특별</span><span class="tag base">기본</span><span class="tag diag">진단용</span><span class="tag est">추정</span> 단계 기준은 모두 잠정값이며, 칭호 유형끼리 같은 단계가 같은 두드러짐을 뜻하는지는 아직 실데이터로 검증되지 않았어요.</p>
    </section>`);

    /* 타임테이블 */
    html.push(`<section><div class="sec-h"><h2>선택 기록</h2>
      <div class="seg" role="group" aria-label="클릭 동작">
        <button class="${S.mode === 'select' ? 'on' : ''}" data-mode="select">공연 선택</button>
        <button class="${S.mode === 'best' ? 'on' : ''}" data-mode="best">최고 무대 ★</button>
      </div></div>
      <p class="hint">공연을 눌러 선택을 바꾸면 바로 다시 계산해요. 점선은 초반·후반 경계, 아래 줄은 연속 관람 구간·겹침 묶음·관람 사이 경계예요.</p>
      ${c.catalog.festivals.flatMap((f) => f.days.map((d) => dayGrid(c.catalog, f.id, d.date, r))).join('')}
    </section>`);

    /* 반복 관람 */
    if (r.repeatArtists.length) {
      const top = r.repeatArtists.slice(0, 3);
      const rest = r.repeatArtists.slice(3);
      const row = (a: (typeof top)[number]) =>
        `<tr><td>${esc(a.name)}</td><td class="num mono">${a.count}번</td><td class="num mono">${a.festivals}곳</td><td class="num mono">${a.bestStars}</td><td class="mono">${a.occasions.map((o) => `${o.date.slice(5)} ${esc(o.festivalName.replace('가상 페스티벌 ', ''))}`).join(' · ')}</td></tr>`;
      html.push(`<section><h2>2번 이상 본 아티스트 <span class="count">${r.repeatArtists.length}팀</span></h2>
        <div class="tbl-wrap"><table class="plain"><thead><tr><th>아티스트</th><th class="num">횟수</th><th class="num">행사</th><th class="num">★</th><th>관람 (날짜·행사)</th></tr></thead>
        <tbody>${top.map(row).join('')}</tbody></table></div>
        ${rest.length ? `<details><summary>나머지 ${rest.length}팀 펼치기</summary><div class="tbl-wrap"><table class="plain"><tbody>${rest.map(row).join('')}</tbody></table></div></details>` : ''}
        <p class="hint">정렬: 관람 횟수 → 서로 다른 행사 수 → 최고 무대 별표 수 → 최근 관람. 칭호는 3번부터.</p>
      </section>`);
    }

    /* 참가일별 진단 */
    html.push(`<section><h2>참가일별 진단</h2><div class="days">${r.days.map(dayDiag).join('')}</div></section>`);
  }

  /* JSON 도구 */
  html.push(`<section class="tools"><h2>기록 내보내기 · 불러오기</h2>
    <p class="hint">그민페 같은 실제 타임테이블은 아래 형식으로 넣으면 같은 판정 모듈로 계산해요. <span class="mono">catalog</span>는 페스티벌·스테이지·공연·아티스트, <span class="mono">record.selections</span>는 선택한 공연이에요.</p>
    <label for="json-box" class="sr">사례 JSON</label>
    <textarea id="json-box" spellcheck="false">${esc(JSON.stringify({ title: c.title, catalog: c.catalog, record: S.record }, null, 1))}</textarea>
    <div class="tool-row">
      <button class="btn" data-action="copy">JSON 복사</button>
      <button class="btn" data-action="import">이 JSON으로 새 사례 만들기</button>
      <span id="tool-msg" class="tool-msg" role="status"></span>
    </div>
  </section>`);

  /* 기준값 */
  const T = DEFAULT_CONFIG.tiers;
  html.push(`<section><details class="cfg"><summary>잠정 기준값 (${VERSION})</summary>
    <div class="tbl-wrap"><table class="plain">
      <tr><td>반복 관람</td><td class="mono">${T.repeat.join(' / ')}번</td><td>(행사, 날짜) 중복 제거</td></tr>
      <tr><td>활동량</td><td class="mono">${T.festivals.join(' / ')}곳</td><td></td></tr>
      <tr><td>일본 선호</td><td class="mono">Δ +${T.japan.join(' / +')}%p</td><td>고유 ${DEFAULT_CONFIG.nationality.minUniqueArtists}팀·일본 ${DEFAULT_CONFIG.nationality.minCategoryArtists}팀 이상</td></tr>
      <tr><td>해외 선호</td><td class="mono">Δ +${T.foreign.join(' / +')}%p</td><td>일본 포함 해외 전체</td></tr>
      <tr><td>메인 / 서브 선호</td><td class="mono">Δ ±${T.mainPref.join(' / ')}%p</td><td>관람 ${DEFAULT_CONFIG.ratioMinViews}개 이상, 스테이지 2개↑인 날</td></tr>
      <tr><td>초반 / 후반 관람</td><td class="mono">Δ +${T.early.join(' / +')}%p</td><td>하루 일정 3등분, 공연 중간 시각 기준</td></tr>
      <tr><td>관람시간</td><td class="mono">${T.watchTime.join(' / ')}%</td><td>관람 3개↑인 날의 프로그램 대비 평균</td></tr>
      <tr><td>연속 관람</td><td class="mono">${T.streak.map(fmtDuration).join(' / ')}</td><td>공백 ≤ ${DEFAULT_CONFIG.streak.maxGapMin}분, 연결 구간 길이</td></tr>
      <tr><td>헤드라이너 관람</td><td class="mono">${T.headliner.map((t) => `${t.days}일·${t.rate}%`).join(' / ')}</td><td>본 날 수와 비율을 함께 · 메인 마지막 + 확인 후 표시한 서브 마무리 공연, 하나라도 보면 1일</td></tr>
      <tr><td>동률 순서 (특별)</td><td colspan="2">${DEFAULT_CONFIG.order.special.map((id) => METRIC_NAMES[id]).join(' → ')}</td></tr>
      <tr><td>동률 순서 (기본)</td><td colspan="2">${DEFAULT_CONFIG.order.base.map((id) => METRIC_NAMES[id]).join(' → ')}</td></tr>
    </table></div></details></section>`);

  $('#main').innerHTML = html.join('');
}

function metricRow(m: MetricResult, repId: MetricId | null) {
  const cat = m.mode === 'diagnostic' ? 'diag' : m.category;
  const status =
    m.mode === 'disabled'
      ? '<span class="st off">제외</span>'
      : m.mode === 'diagnostic'
        ? '<span class="st diag">진단용</span>'
        : !m.computable
          ? '<span class="st off">계산 불가</span>'
          : `${pips(m.tier, m.category)}<span class="mono t">${m.tier}</span>`;
  const notes = [
    m.excludedReason ? `<span class="why">${esc(m.excludedReason)}</span>` : '',
    m.note ? `<span>${esc(m.note)}</span>` : '',
    m.estimated ? `<span class="est-note"><span class="tag est">추정</span>${esc(m.estimateNote)}</span>` : '',
    `<span class="rule mono">${esc(m.tierRule)}</span>`,
  ]
    .filter(Boolean)
    .join('');
  return `<tr class="${m.id === repId ? 'is-rep ' : ''}${!m.computable || m.mode !== 'active' ? 'dim' : ''}">
    <th scope="row"><span class="tag ${cat}">${m.mode === 'diagnostic' ? '진단' : m.category === 'special' ? '특별' : '기본'}</span>${esc(m.name)}</th>
    <td class="tier">${status}</td>
    <td>${esc(m.valueText)}</td>
    <td>${esc(m.denominatorText)}</td>
    <td>${esc(m.baselineText)}</td>
    <td class="num mono">${m.delta == null ? '—' : `${m.delta >= 0 ? '+' : ''}${(Math.round(m.delta * 10) / 10).toFixed(1)}`}</td>
    <td class="notes"><div class="notes-in">${notes}</div></td>
    <td class="ev">${m.evidence ? esc(m.evidence) : '—'}</td>
  </tr>`;
}

/* ───────────── 타임테이블 그리드 ───────────── */
function dayGrid(catalog: Catalog, festivalId: string, date: string, r: JudgeResult) {
  const f = catalog.festivals.find((x) => x.id === festivalId)!;
  const d = f.days.find((x) => x.date === date)!;
  const toMin = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  const perfs = d.performances.map((p) => {
    const s = toMin(p.start);
    let e = toMin(p.end);
    if (e <= s) e += 1440;
    return { ...p, s, e };
  });
  const t0 = Math.min(...perfs.map((p) => p.s));
  const t1 = Math.max(...perfs.map((p) => p.e));
  const L = t1 - t0;
  const x = (t: number) => `${((t - t0) / L) * 100}%`;
  const w = (a: number, b: number) => `${((b - a) / L) * 100}%`;
  const selKey = (pid: string) => S.record.selections.find((s) => s.festivalId === festivalId && s.date === date && s.performanceId === pid);
  const summary: DaySummary | undefined = r.days.find((x) => x.festivalId === festivalId && x.date === date);
  const headliners = new Set(summary?.headlinerKeys ?? []);

  const hours: number[] = [];
  for (let h = Math.ceil(t0 / 60) * 60; h <= t1; h += 60) hours.push(h);
  const thirds = summary
    ? `<div class="third" style="left:${x(summary.earlyEnd)}"></div><div class="third" style="left:${x(summary.lateStart)}"></div>`
    : '';
  const thirdLabels = summary
    ? `<span class="third-l mono" style="left:${x(summary.earlyEnd)}">초반 ~${fmtTime(summary.earlyEnd)}</span><span class="third-l mono" style="left:${x(summary.lateStart)}">${fmtTime(summary.lateStart)}~ 후반</span>`
    : '';

  const rows = f.stages
    .filter((s) => perfs.some((p) => p.stageId === s.id))
    .map((stage) => {
      const blocks = perfs
        .filter((p) => p.stageId === stage.id)
        .map((p) => {
          const sel = selKey(p.id);
          const key = `${festivalId}|${date}|${p.id}`;
          const a = catalog.artists[p.artistId];
          const cls = ['blk', sel ? 'sel' : '', sel?.best ? 'best' : '', headliners.has(key) ? 'last' : '', a?.country === 'JP' ? 'jp' : a?.country === 'OTHER' ? 'fx' : ''].join(' ');
          return `<button class="${cls}" style="left:${x(p.s)};width:${w(p.s, p.e)}" data-perf="${esc(festivalId)}|${esc(date)}|${esc(p.id)}" title="${esc(a?.name)} ${p.start}~${p.end} (${esc(stage.name)})" aria-pressed="${sel ? 'true' : 'false'}">
            <span class="b-name">${sel?.best ? '★ ' : ''}${esc(a?.shortName ?? a?.name ?? p.artistId)}</span><span class="b-time mono">${p.start}</span></button>`;
        })
        .join('');
      return `<div class="g-row"><div class="g-stage">${esc(stage.name)}${stage.isMain ? '<em>MAIN</em>' : ''}</div><div class="g-track">${thirds}${blocks}</div></div>`;
    })
    .join('');

  let overlays = '';
  if (summary) {
    const segs = summary.segments
      .filter((s) => s.count >= 2)
      .map((s) => {
        const gapPct = s.length ? (s.gap / s.length) * 100 : 0;
        return `<div class="seg-bar" style="left:${x(s.start)};width:${w(s.start, s.end)}" title="연결 ${fmtDuration(s.length)} · 공연 ${fmtDuration(s.inner)} · 공백 ${fmtDuration(s.gap)}"><span class="mono">${fmtDuration(s.length)}${s.gap ? ` · 공백 ${Math.round(gapPct)}%` : ''}</span></div>`;
      })
      .join('');
    const clus = summary.clusters
      .filter((c) => c.perfKeys.length >= 2)
      .map((c) => `<div class="clu-bar" style="left:${x(c.start)};width:${w(c.start, c.end)}" title="겹침 묶음: 공연 ${c.perfKeys.length}개 · 스테이지 ${c.stages.length}개 · 추정 이동 최소 ${c.inferredMin}회 · 순서 불확정"><span class="mono">${c.perfKeys.length}개·이동≥${c.inferredMin}</span></div>`)
      .join('');
    const bnd = summary.boundaries
      .map((b) => {
        const P = summary.clusters[b.fromCluster];
        const Q = summary.clusters[b.toCluster];
        const mid = (P.end + Q.start) / 2;
        const sym = b.type === 'confirmed-move' ? '→' : b.type === 'confirmed-stay' ? '=' : '?';
        const t = b.type === 'confirmed-move' ? '순서 확정 이동' : b.type === 'confirmed-stay' ? '순서 확정 · 같은 스테이지' : '불확정 (이동 여부를 정할 수 없음)';
        return `<span class="bnd ${b.type}" style="left:${x(mid)}" title="${t}">${sym}</span>`;
      })
      .join('');
    overlays = `<div class="g-row ov"><div class="g-stage">연속 구간</div><div class="g-track thin">${segs || '<span class="none">2개 이상 이어진 구간 없음</span>'}</div></div>
      <div class="g-row ov"><div class="g-stage">겹침 묶음</div><div class="g-track thin">${clus || '<span class="none">겹친 선택 없음</span>'}</div></div>
      <div class="g-row ov"><div class="g-stage">관람 사이</div><div class="g-track thin">${bnd || '<span class="none">—</span>'}</div></div>`;
  }

  const n = S.record.selections.filter((s) => s.festivalId === festivalId && s.date === date).length;
  return `<div class="grid">
    <div class="grid-h"><b>${esc(f.name)}</b><span class="mono">${date}</span><span class="cnt">선택 ${n}개</span></div>
    <div class="grid-scroll"><div class="grid-in">
      <div class="g-row axis"><div class="g-stage"></div><div class="g-track">${hours.map((h) => `<span class="tick mono" style="left:${x(h)}">${fmtTime(h).slice(0, 2)}</span>`).join('')}${thirdLabels}</div></div>
      ${rows}${overlays}
    </div></div>
  </div>`;
}

function dayDiag(d: DaySummary) {
  const segs = d.segments.filter((s) => s.count >= 2);
  const multi = d.clusters.filter((c) => c.perfKeys.length >= 2);
  const bc = { m: 0, s: 0, u: 0 };
  d.boundaries.forEach((b) => (b.type === 'confirmed-move' ? bc.m++ : b.type === 'confirmed-stay' ? bc.s++ : bc.u++));
  return `<div class="day">
    <div class="day-h"><b>${esc(d.festivalName)}</b> <span class="mono">${d.date}</span>${d.validForDaily ? '' : '<span class="chip off">관람 3개 미만</span>'}</div>
    <dl>
      <dt>프로그램</dt><dd class="mono">${fmtTime(d.programStart)}~${fmtTime(d.programEnd)} · 초반 ~${fmtTime(d.earlyEnd)} · 후반 ${fmtTime(d.lateStart)}~</dd>
      <dt>선택 공연 합집합</dt><dd>${fmtDuration(d.unionMin)} <span class="muted">(시간표 기준)</span></dd>
      <dt>헤드라이너</dt><dd>${d.headlinerSeen == null ? '특정 불가' : `${d.headlinerKeys.length}개 중 ${d.headlinerSeen ? '선택함' : '선택 안 함'}`}</dd>
      <dt>연결 구간</dt><dd>${segs.length ? segs.map((s) => `${fmtTime(s.start)}~${fmtTime(s.end)} 길이 ${fmtDuration(s.length)} / 공연 ${fmtDuration(s.inner)} / 공백 ${fmtDuration(s.gap)}${s.meals.length ? ` · ${s.meals.join('·')} 겹침` : ''}`).join('<br>') : '—'}</dd>
      <dt>무대 이동</dt><dd>순서 확정 이동 ${bc.m} · 확정 비이동 ${bc.s} · 불확정 경계 ${bc.u}${multi.length ? `<br>겹침 묶음 ${multi.length}개: ${multi.map((c) => `${fmtTime(c.start)}~${fmtTime(c.end)} 공연 ${c.perfKeys.length}·스테이지 ${c.stages.length} → 추정 최소 ${c.inferredMin}회`).join(', ')}` : ''}</dd>
    </dl>
  </div>`;
}

/* ───────────── 동작 ───────────── */
function selectCase(i: number) {
  S.idx = i;
  S.record = clone(allCases()[i].record);
  S.modified = false;
  S.notice = '';
  render();
  window.scrollTo({ top: 0 });
}

function togglePerf(spec: string) {
  const [festivalId, date, performanceId] = spec.split('|');
  const list = S.record.selections;
  const at = list.findIndex((s) => s.festivalId === festivalId && s.date === date && s.performanceId === performanceId);
  if (S.mode === 'best') {
    if (at >= 0) list[at].best = !list[at].best;
    else list.push({ festivalId, date, performanceId, best: true } as Selection);
  } else if (at >= 0) list.splice(at, 1);
  else list.push({ festivalId, date, performanceId });
  S.modified = true;
  S.notice = '';
  render();
}

function importJson() {
  const box = $('#json-box') as HTMLTextAreaElement;
  const msg = $('#tool-msg');
  try {
    const data = JSON.parse(box.value);
    if (!data.catalog?.festivals || !data.record?.selections) throw new Error('catalog.festivals와 record.selections가 필요해요');
    const id = `U${custom.length + 1}`;
    custom.push({ id, group: '직접 입력', title: data.title ? String(data.title) : `직접 입력 ${custom.length + 1}`, focus: '붙여넣은 기록 (기대값 없음)', catalog: data.catalog, record: data.record });
    judge(data.catalog, data.record);
    selectCase(builtIn.length + custom.length - 1);
  } catch (e) {
    msg.textContent = `불러오지 못했어요: ${(e as Error).message}`;
  }
}

function copyJson() {
  const box = $('#json-box') as HTMLTextAreaElement;
  const msg = $('#tool-msg');
  const done = () => (msg.textContent = '복사했어요');
  const fallback = () => {
    box.focus();
    box.select();
    msg.textContent = '자동 복사가 막혀 있어 내용을 선택해 두었어요. 직접 복사해 주세요';
  };
  try {
    navigator.clipboard.writeText(box.value).then(done, fallback);
  } catch {
    fallback();
  }
}

function render() {
  renderSidebar();
  renderMain();
}

document.addEventListener('click', (e) => {
  const t = (e.target as HTMLElement).closest('[data-case],[data-perf],[data-mode],[data-action]') as HTMLElement | null;
  if (!t) return;
  if (t.dataset.case) selectCase(Number(t.dataset.case));
  else if (t.dataset.perf) togglePerf(t.dataset.perf);
  else if (t.dataset.mode) {
    S.mode = t.dataset.mode as 'select' | 'best';
    render();
  } else if (t.dataset.action === 'reset') selectCase(S.idx);
  else if (t.dataset.action === 'copy') copyJson();
  else if (t.dataset.action === 'import') importJson();
});
document.addEventListener('change', (e) => {
  const t = e.target as HTMLElement;
  if (t.id === 'case-select') selectCase(Number((t as HTMLSelectElement).value));
});

render();
