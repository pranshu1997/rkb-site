// History: range stats as one card per metric (value, status line, chart), then a calendar of days.
// A tapped day opens on Today. The same screen on both phones.
import { sb, cachedRows } from './db.js';
import { localDate } from './slots.js';
import { lastDays, parseDay, indexData, dayStatus, weeklyAdherence } from './stats.js';
import { glp1Due } from './slots.js';
import { STEPS_TARGET, REQUIRED_METRICS, STOOL_MAX, INSULIN_DEFAULT } from './config.js';
import { target, loadTargets } from './targets.js';
import { dailySums } from './nutrition.js';
import { toast } from './ui.js';
import { bpLevel, sugarLevel } from './ranges.js';
import { ICONS } from './icons.js';
import { t, LOCALE, TIME } from './i18n.js';
const tr = t; // chartSpec names its colour `t`

// Chart.js (about 200 KB) loads in the background; everything except the charts paints without it.
const chartLib = import('https://cdn.jsdelivr.net/npm/chart.js@4.4.4/auto/+esm');
let Chart;

// Chart colours come from the CSS theme tokens, so charts follow light/dark mode.
let C = {};
const readColors = () => {
  const v = n => getComputedStyle(document.documentElement).getPropertyValue(`--${n}`).trim();
  C = { blue: v('blue'), green: v('green'), muted: v('muted'), line: v('line') };
};
const STATUS_LABEL = { done: t('All done'), partial: t('Partial'), skipped: t('Skipped'), none: t('No data') };

// Metric tints match Today (.vic-* in app.css). Icons come from icons.js, shared with Today.
// Sugar is token blue, not orange: orange (--warn) means a raised / low reading. Charts resolve var() via C.
const TINT = { bp: '#ff2d55', sugar: 'var(--blue)', weight: '#5856d6', steps: '#34c759', meds: '#007aff', insulin: '#af52de', glp1: '#30b0c7', stool: '#a2845e', kcal: '#ff3b30', carbs: '#c98a00', fsugar: 'var(--blue)', urine_night: '#5ac8fa' };

let root, range = 30, data, idx, charts = [], channel, poll, loads = 0, metrics = [];

const shell = `
  <header class="large-title"><h1>${t('History')}</h1>
    <div class="seg small" data-out="range" role="radiogroup" aria-label="${t('Days shown')}">${[7, 30, 90].map(n => `<label><input type="radio" name="range" value="${n}">${t('{n} days', { n })}</label>`).join('')}</div></header>
  <div class="alerts" data-out="alerts"></div>
  <div data-out="metrics"></div>
  <h2 class="sec">${t('Days')}</h2>
  <section class="card cal">
    <div class="heat-head">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<span>${t(d)}</span>`).join('')}</div>
    <div class="heat" data-out="heat"></div>
    <div class="legend">${Object.entries(STATUS_LABEL).map(([k, t]) => `<span><i class="${k}"></i>${t}</span>`).join('')}</div>
    <p class="muted hint">${t('Tap a day to open it on Today.')}</p>
  </section>`;

export async function mountDashboard(el, profile) {
  root = el;
  document.body.classList.add('viewer'); // wide-screen layout class (name kept from before the two phones shared one screen)
  root.classList.add('sum');
  root.innerHTML = shell;
  root.querySelector(`[name=range][value="${range}"]`).checked = true;
  root.querySelector('[data-out=range]').onchange = e => ((range = Number(e.target.value)), root.setAttribute('aria-busy', 'true'), load());
  const open = e => {
    const day = e.target.closest('[data-day]')?.dataset.day;
    if (day) openDay(day);
  };
  root.querySelector('[data-out=alerts]').onclick = open;
  root.querySelector('[data-out=heat]').onclick = open;
  await load(true); // paint from the phone's copy first
  load();

  // Theme or text size changed (Pulse settings, or the RKB shell setting the frame's flags): repaint in the new colours and size.
  // One repaint per frame: the shell flips data-theme and data-size together. pulse:theme covers the system light/dark
  // flip, where data-theme stays 'system' and only a same-value mutation record would reach the observer.
  let queued = false;
  const repaint = () => queued || ((queued = true), requestAnimationFrame(() => ((queued = false), data && Chart && paintCharts())));
  new MutationObserver(repaint).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-size'] });
  addEventListener('pulse:theme', repaint);
  addEventListener('pulse:refresh', () => load());
  addEventListener('pulse:targets', () => data && (paintMetrics(), Chart && paintCharts()));
  loadTargets(true).then(() => loadTargets());
  channel?.unsubscribe();
  channel = sb.channel('dashboard');
  for (const table of ['readings', 'daily_check', 'food_log'])
    channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => load());
  channel.subscribe(st => st === 'SUBSCRIBED' && load());
  // Realtime is best effort: reload when the channel (re)joins, and poll while the screen is open.
  clearInterval(poll);
  poll = setInterval(() => document.visibilityState === 'visible' && !root.hidden && navigator.onLine && load(), 15_000);
}

async function load(first = false) {
  const mine = ++loads; // a slow 30-day load must not paint over a newer 7-day one
  try {
    const days = lastDays(range);
    const from = days[0];
    const get = (key, q) => cachedRows(`dash:${key}:${range}`, q, first);
    const [readings, firstR, firstM, checks, insulinLast, glp1Last, food] = await Promise.all([
      get('readings', sb.from('readings').select('*').gte('slot_date', from).is('deleted_at', null).order('taken_at')),
      get('firstR', sb.from('readings').select('slot_date').order('slot_date').limit(1)),
      get('firstM', sb.from('daily_check').select('day').like('kind', 'meds%').is('deleted_at', null).order('day').limit(1)),
      get('checks', sb.from('daily_check').select('day,kind,done').gte('day', from).is('deleted_at', null)),
      get('insulinLast', sb.from('readings').select('value').eq('metric', 'insulin').is('deleted_at', null).order('slot_date', { ascending: false }).order('taken_at', { ascending: false }).limit(1)),
      get('glp1Last', sb.from('readings').select('slot_date,value').eq('metric', 'glp1').is('deleted_at', null).order('slot_date', { ascending: false }).limit(1)),
      // Before the food_log migration is applied this errors; the other cards must still paint.
      get('food', sb.from('food_log').select('slot_date,kcal,carbs,sugar').gte('slot_date', from).is('deleted_at', null)).catch(e => { if (e.message === 'nocache') throw e; return []; }),
    ]);
    if (mine !== loads) return;
    const firstMed = firstM[0]?.day;
    const firstDay = [firstR[0]?.slot_date, firstMed].filter(Boolean).sort()[0];
    data = { days, readings, firstDay, today: localDate(new Date()), checks, insulinLast: insulinLast[0]?.value, glp1Last: glp1Last[0], food };
    idx = indexData({ ...data, firstMed });
    paintMetrics();
    paintAlerts();
    paintHeat();
    try { Chart ??= (await chartLib).Chart; } catch { return toast(t('Charts need the internet once.'), 'bad'); }
    if (mine === loads) paintCharts();
  } catch (e) {
    // Today's calm "Could not load" card already says it; no red toast on top of it.
    if (!(first && e.message === 'nocache') && !document.querySelector('.load-fail:not([hidden])')) toast(t('Could not load: {error}', { error: e.message }), 'bad');
  } finally {
    if (mine === loads) root.removeAttribute('aria-busy'); // set when the range changes: dims the old numbers until the new ones arrive
  }
}

const opts = () => ({ firstDay: data.firstDay, today: data.today, required: REQUIRED_METRICS });
const avg = (xs, d = 0) => (xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(d) : null);
const of = m => data.readings.filter(r => r.metric === m);
// Plain-words range line under the headline value: lowest and highest in the period.
const spread = (xs, key = 'Lowest {lo}, highest {hi}') => (xs.length > 1 ? t(key, { lo: Math.min(...xs).toLocaleString(LOCALE), hi: Math.max(...xs).toLocaleString(LOCALE) }) : '');
const signed = n => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}`;

// One entry per metric: the big value, one status line (lvl colours it), n = rows behind it (0 hides the chart).
function buildMetrics() {
  const span = t('{n} days', { n: range });
  const bp = of('bp'), fasting = of('sugar').filter(r => r.sugar_context === 'fasting'), w = of('weight'), st = of('steps');
  const stool = of('stool'), urine = of('urine_night'), doses = of('insulin'), shots = of('glp1');
  const gd = data.glp1Last && glp1Due(data.glp1Last.slot_date, data.today);
  const gDay = ymd => parseDay(ymd).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' });
  const none = key => t(key, { span });
  const [sys, dia] = [avg(bp.map(r => r.systolic)), avg(bp.map(r => r.diastolic))];
  const bpHigh = bp.filter(r => bpLevel(r.systolic, r.diastolic) === 'high').length;
  const sugarAvg = avg(fasting.map(r => +r.value));
  const sugarHigh = fasting.filter(r => sugarLevel(r.value, 'fasting') === 'high').length;
  const change = w.length > 1 ? Math.round((w.at(-1).value - w[0].value) * 10) / 10 : null;
  const goal = st.filter(r => +r.value >= STEPS_TARGET).length;
  const stoolOver = stool.filter(r => +r.value > STOOL_MAX).length;
  const adh = weeklyAdherence(idx, data.days, data.today);
  const wk = adh.reduce((a, x) => ({ taken: a.taken + x.taken, due: a.due + x.due }), { taken: 0, due: 0 });
  const pct = wk.due ? Math.round((100 * wk.taken) / wk.due) : null;
  // Food: one bar per day that has entries; the status line counts days over target.
  const foodCard = (key, name, col, unit, target) => {
    const days = dailySums(data.food, col), a = avg(days.map(d => d.value));
    const over = days.filter(d => d.value > target).length;
    return { key, name, val: a == null ? '–' : Number(a).toLocaleString(LOCALE), unit: t('{unit} a day', { unit }), n: days.length, days, target,
      status: days.length ? t(days.length === 1 ? 'Over {target} {unit} on {over} of {n} day' : 'Over {target} {unit} on {over} of {n} days', { target: Number(target).toLocaleString(LOCALE), unit, over, n: days.length }) : none('No food in {span}'),
      lvl: days.length && a > target ? 'raised' : null };
  };
  return [
    { key: 'bp', name: t('Blood pressure'), val: sys ? `${sys}/${dia}` : '–', unit: t('mmHg average'), rng: spread(bp.map(r => r.systolic), 'Top number lowest {lo}, highest {hi}'), n: bp.length,
      status: bp.length ? t('{n} of {total} high', { n: bpHigh, total: bp.length }) : none('No readings in {span}'), lvl: sys && bpLevel(sys, dia) },
    { key: 'sugar', name: t('Fasting sugar'), val: sugarAvg ?? '–', unit: t('mg/dL average'), rng: spread(fasting.map(r => +r.value)), n: of('sugar').length,
      status: fasting.length ? t('{n} of {total} high', { n: sugarHigh, total: fasting.length }) : none('No fasting readings in {span}'), lvl: sugarAvg && sugarLevel(sugarAvg, 'fasting') },
    { key: 'weight', name: t('Weight'), val: w.length ? Number(w.at(-1).value) : '–', unit: 'kg', rng: spread(w.map(r => +r.value)), n: w.length,
      status: change != null ? t('{change} kg in {span}', { change: signed(change), span }) : w.length ? t('One reading') : none('No weights in {span}') },
    { key: 'steps', name: t('Steps'), val: st.length ? Number(avg(st.map(r => +r.value))).toLocaleString(LOCALE) : '–', unit: t('a day'), rng: spread(st.map(r => +r.value)), n: st.length,
      status: st.length ? t('10k on {n} of {total} days', { n: goal, total: st.length }) : none('No steps in {span}'), lvl: st.length && goal === 0 ? 'raised' : null },
    foodCard('kcal', t('Calories'), 'kcal', 'kcal', target('kcal')),
    foodCard('carbs', t('Carbs'), 'carbs', 'g', target('carbs')),
    foodCard('fsugar', t('Sugar eaten'), 'sugar', 'g', target('sugar')),
    { key: 'meds', name: t('Medicines'), val: pct != null ? `${pct}%` : '–', unit: t('taken'), n: adh.length, adh,
      status: wk.due ? t('{n} of {total} doses taken', { n: wk.taken, total: wk.due }) : none('No doses in {span}'), lvl: pct != null && pct < 70 ? 'raised' : null },
    { key: 'insulin', name: t('Insulin'), val: Number(data.insulinLast ?? INSULIN_DEFAULT), unit: t('units'), n: 1,
      status: doses.length ? t(doses.length === 1 ? '{n} change in {span}' : '{n} changes in {span}', { n: doses.length, span }) : t('No changes in {span}', { span }) },
    { key: 'glp1', name: t('GLP-1 injection'), val: data.glp1Last ? Number(data.glp1Last.value) : '–', unit: 'mg', n: shots.length,
      status: !gd ? none('No injections in {span}') : gd.state === 'overdue' ? t(gd.days === -1 ? 'Overdue by {n} day, was due {day}' : 'Overdue by {n} days, was due {day}', { n: -gd.days, day: gDay(gd.due) })
        : gd.state === 'due' ? t('Due today') : t('Next due {day}', { day: gDay(gd.due) }), lvl: gd && { overdue: 'high', due: 'raised' }[gd.state] },
    { key: 'stool', name: t('Stool'), val: stool.length ? avg(stool.map(r => +r.value), 1) : '–', unit: t('a day'), n: stool.length,
      status: stool.length ? t('Above {max} on {n} of {total} days', { max: STOOL_MAX, n: stoolOver, total: stool.length }) : none('No counts in {span}'), lvl: stoolOver ? 'high' : null },
    { key: 'urine_night', name: t('Night urine'), val: urine.length ? avg(urine.map(r => +r.value), 1) : '–', unit: t('a night'), n: urine.length,
      status: urine.length ? t(urine.length === 1 ? '{n} night counted' : '{n} nights counted', { n: urine.length }) : none('No counts in {span}') },
  ];
}

const REQUIRED = new Set(['bp', 'sugar', 'weight', 'steps', 'meds']);
const card = m => `<section class="card metric" data-card="${m.key}" style="--t:${TINT[m.key]}">
  <div class="m-head"><span class="m-name">${ICONS[m.key] ?? ICONS.sugar}${m.name}</span><span class="m-range">${t('{n} days', { n: range })}</span></div>
  <div class="m-val"><span class="num">${m.val}</span><span class="m-unit">${m.val === '–' ? '' : m.unit}</span></div>
  <p class="m-stat lvl-${m.lvl || 'none'}">${m.status}</p>${m.rng ? `<p class="m-rng">${m.rng}</p>` : ''}
  ${m.n ? `<div class="chart"><canvas data-chart="${m.key}"></canvas></div>` : ''}</section>`;

function paintMetrics() {
  metrics = buildMetrics();
  root.querySelector('[data-out=metrics]').innerHTML = metrics.filter(m => m.n || REQUIRED.has(m.key)).map(card).join(''); // optional metrics with nothing logged stay hidden
}

// Stool above the daily maximum; it opens its latest day on Today.
function paintAlerts() {
  const stoolDays = [...new Set(data.readings.filter(r => r.metric === 'stool' && +r.value > STOOL_MAX).map(r => r.slot_date))];
  const alert = (text, day) => `<button type="button" class="alert" data-day="${day}">${text}</button>`;
  const el = root.querySelector('[data-out=alerts]');
  el.innerHTML = stoolDays.length ? alert(t(stoolDays.length === 1 ? 'Stool above {max} on {n} day' : 'Stool above {max} on {n} days', { max: STOOL_MAX, n: stoolDays.length }), stoolDays.at(-1)) : '';
  el.hidden = !stoolDays.length; // BP, sugar and missed medicines live in the metric cards and the calendar colours
}

function openDay(day) {
  dispatchEvent(new CustomEvent('pulse:open-day', { detail: day }));
}

function paintHeat() {
  const lead = (parseDay(data.days[0]).getDay() + 6) % 7; // blanks before the first Monday-based column
  root.querySelector('[data-out=heat]').innerHTML = '<span></span>'.repeat(lead) + data.days.map(ymd => {
    const st = dayStatus(idx, ymd, opts());
    const cls = [st, ymd === data.today && 'today'].filter(Boolean).join(' ');
    return `<button class="cell" data-day="${ymd}" aria-label="${parseDay(ymd).toLocaleDateString(LOCALE, { day: 'numeric', month: 'long' })}: ${STATUS_LABEL[st]}"><span class="d ${cls}">${parseDay(ymd).getDate()}</span></button>`;
  }).join('');
}

// ── Charts: linear time axis in ms, so no date adapter is needed. ─────────
// Axis and legend text is 0.875rem in px (canvas cannot read rem), so it grows with RKB's text size like the page (H1).
const fs = () => 0.875 * parseFloat(getComputedStyle(document.documentElement).fontSize);
const tick = () => ({ color: C.muted, font: { size: fs() }, maxTicksLimit: 5 });
function xAxis() {
  const min = parseDay(data.days[0]).getTime();
  const max = parseDay(data.today).getTime() + 86_400_000;
  return { type: 'linear', min, max, offset: false, grid: { display: false }, border: { color: C.line },
    ticks: { ...tick(), maxRotation: 0, callback: v => new Date(v).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' }) } };
}

// Normal range as a light band behind the data.
const bandPlugin = { id: 'band', beforeDatasetsDraw(c, _, bands) {
  if (!bands?.length) return;
  const { ctx, chartArea: a, scales: { y } } = c;
  ctx.save();
  ctx.fillStyle = C.green;
  ctx.globalAlpha = 0.16;
  for (const [lo, hi] of bands) {
    const top = y.getPixelForValue(Math.min(hi, y.max)), bottom = y.getPixelForValue(Math.max(lo, y.min));
    if (bottom > top) ctx.fillRect(a.left, top, a.width, bottom - top);
  }
  ctx.restore();
} };
// Weekly bars carry their value on top, so nobody has to tap to read them.
const valuePlugin = { id: 'barValue', afterDatasetsDraw(c, _, texts) {
  if (!texts) return;
  const { ctx } = c;
  ctx.save();
  ctx.fillStyle = C.muted;
  ctx.font = `600 ${fs()}px -apple-system, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  c.getDatasetMeta(0).data.forEach((bar, i) => ctx.fillText(texts[i], bar.x, bar.y - 4));
  ctx.restore();
} };

const pts = (list, y) => list.map(r => ({ x: new Date(r.taken_at).getTime(), y: y(r) }));
const noon = ymd => parseDay(ymd).getTime() + 43_200_000;
const thick = () => (range > 30 ? 3 : range > 7 ? 7 : 18);
const line = (label, color, points, extra = {}) =>
  ({ type: 'line', label, data: points, borderColor: color, backgroundColor: color, pointRadius: range > 30 ? 1.5 : 2.5, borderWidth: 1.5, tension: 0.25, ...extra });
const ref = (label, y, color) => line(`_${label}`, color, [{ x: xAxis().min, y }, { x: xAxis().max, y }], { pointRadius: 0, borderDash: [5, 4], borderWidth: 1, tension: 0 });
const bars = (rows, color, over) => ({ type: 'bar', data: rows.map(r => ({ x: noon(r.slot_date), y: +r.value })), barThickness: thick(),
  backgroundColor: rows.map(r => (over?.(+r.value) ? '#ff453a' : color)) });

// Y range around the data (plus any normal band), never tighter than minSpan, rounded out to whole steps:
// a 0.6 kg weight wobble must not fill the chart. Pure maths; the min/max go to Chart.js as-is.
const fit = (vals, minSpan, step) => {
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = Math.max(0, minSpan - (hi - lo)) / 2;
  lo -= pad; hi += pad;
  return { min: Math.floor(lo / step) * step, max: Math.ceil(hi / step) * step };
};

// [datasets, y-axis extras, bands, extra top-level options] per metric.
function chartSpec(key) {
  const t = TINT[key].startsWith('var(') ? C.blue : TINT[key]; // canvas cannot read CSS variables
  const sugar = c => of('sugar').filter(r => r.sugar_context === c);
  if (key === 'bp') return { sets: [line(tr('Upper'), t, pts(of('bp'), r => r.systolic)), line(tr('Lower'), C.blue, pts(of('bp'), r => r.diastolic))],
    y: fit([...of('bp').flatMap(r => [r.systolic, r.diastolic]), 60, 130], 90, 10), bands: [[90, 130], [60, 85]] };
  if (key === 'sugar') return { sets: [line(tr('Fasting'), C.blue, pts(sugar('fasting'), r => +r.value)), line(tr('After meal'), TINT.weight, pts(sugar('post_meal'), r => +r.value)),
    line(tr('Random'), C.muted, pts(sugar('random'), r => +r.value))], y: fit([...of('sugar').map(r => +r.value), 70, 100], 60, 10), bands: [[70, 100]] };
  if (key === 'weight') return { sets: [line(tr('Weight'), t, pts(of('weight'), r => +r.value))], y: fit(of('weight').map(r => +r.value), 4, 1) };
  if (key === 'steps') return { sets: [bars(of('steps'), t), ref('10k', STEPS_TARGET, C.muted)], y: { beginAtZero: true } };
  if (['kcal', 'carbs', 'fsugar'].includes(key)) {
    const m = metrics.find(x => x.key === key);
    return { sets: [bars(m.days, t, v => v > m.target), ref('target', m.target, C.muted)], y: { beginAtZero: true, suggestedMax: Math.ceil(1.15 * m.target) } };
  }
  if (key === 'stool') return { sets: [bars(of('stool'), t, v => v > STOOL_MAX), ref('max', STOOL_MAX, '#ff453a')], y: { beginAtZero: true, suggestedMax: STOOL_MAX + 2, ticks: { precision: 0 } } };
  if (key === 'urine_night') return { sets: [bars(of('urine_night'), t)], y: { beginAtZero: true, suggestedMax: 4, ticks: { precision: 0 } } };
  if (key === 'glp1') return { sets: [line('GLP-1', t, pts(of('glp1'), r => +r.value), { tension: 0, pointRadius: 4 })], y: { min: 0, suggestedMax: Math.ceil(1.25 * Math.max(1, ...of('glp1').map(r => +r.value))) } };
  if (key === 'insulin') {
    const p = pts(of('insulin'), r => +r.value), last = Number(data.insulinLast ?? INSULIN_DEFAULT);
    const flat = [{ x: xAxis().min, y: last }, { x: xAxis().max, y: last }];
    return { sets: [line(tr('Insulin'), t, p.length ? [...p, { x: xAxis().max, y: p.at(-1).y }] : flat, { stepped: 'after', tension: 0, pointRadius: 3 })], y: { min: 0, suggestedMax: Math.ceil(1.25 * Math.max(last, ...p.map(q => q.y))) } };
  }
  // Medicines: one bar per week, percent of doses taken.
  const adh = metrics.find(m => m.key === 'meds').adh;
  return { weekly: adh, sets: [{ type: 'bar', data: adh.map(w => w.pct ?? 0), backgroundColor: t, maxBarThickness: 36 }], y: { min: 0, max: 100, ticks: { stepSize: 50, callback: v => `${v}%` } } };
}

function paintCharts() {
  readColors();
  charts.forEach(c => c.destroy());
  const base = { maintainAspectRatio: false, animation: false, layout: { padding: { top: 16 } }, interaction: { mode: 'nearest', intersect: false } };
  charts = metrics.filter(m => m.n).map(m => {
    const el = root.querySelector(`[data-chart=${m.key}]`);
    if (!el) return null;
    const { sets, y, bands, weekly } = chartSpec(m.key);
    const yAxis = { grid: { color: C.line }, border: { display: false }, ...y, ticks: { ...tick(), ...y.ticks } };
    const multi = sets.filter(s => !s.label?.startsWith('_') && s.label).length > 1;
    const plugins = { band: bands, barValue: weekly?.length <= 8 ? weekly.map(w => (w.pct == null ? '' : `${w.pct}%`)) : undefined, legend: { display: multi, position: 'top', align: 'start',
      labels: { color: C.muted, usePointStyle: true, boxWidth: 8, boxHeight: 8, font: { size: fs() }, filter: i => !i.text?.startsWith('_') } } };
    if (weekly) return new Chart(el, { type: 'bar', plugins: [valuePlugin],
      data: { labels: weekly.map(w => parseDay(w.week).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' })), datasets: sets },
      options: { ...base, scales: { x: { grid: { display: false }, border: { color: C.line }, ticks: { ...tick(), maxRotation: 0 } }, y: yAxis }, plugins: { ...plugins, legend: { display: false }, tooltip: { callbacks: { label: c => tr('{n} of {total} doses', { n: weekly[c.dataIndex].taken, total: weekly[c.dataIndex].due }) } } } } });
    return new Chart(el, { type: 'line', plugins: [bandPlugin],
      data: { datasets: sets },
      options: { ...base, scales: { x: xAxis(), y: yAxis }, plugins: { ...plugins,
        tooltip: { filter: i => !i.dataset.label?.startsWith('_'), callbacks: { title: items => new Date(items[0].parsed.x).toLocaleString(TIME[0], { day: 'numeric', month: 'short', ...TIME[1] }) } } } } });
  }).filter(Boolean);
}
