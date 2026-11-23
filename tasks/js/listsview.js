import { state, list, subscribe, isOwner, addList, addItem, patchItem, patchList, videoTitle } from './store.js';
import { sortLists, archivedLists, openItems, doneItems, countOf, search, parseInput, safeUrl, hostOf, movePos, cleanTitle, sortItems } from './lists.js';
import { S } from './strings.js';
import { ymd } from './sort.js';
import { esc, toast, buzz, sheet, tickBtn, goHash, nav, fmtDay } from './ui.js';

// Lists inside RKB Tasks: Lists screen -> one list. Hash "#lists" is home, "#l/<id>" is one list (app.js shows this tab for both).
// Phone: one pane at a time. Desktop (shell flag data-layout=desktop): the index and the open list sit side by side (CSS .lsplit); the open list is kept in `selected`.
let root, unsub = null, paintIdx = () => {}, paintRows = () => {}, selected = null, detEl, splitEl, ro;
const $ = (el, sel) => el.querySelector(sel);
const route = () => { const m = location.hash.match(/^#l\/([0-9a-f-]{36})$/); return m ? m[1] : null; };
const wide = () => document.documentElement.dataset.layout === 'desktop'; // flag set by the RKB shell (a frame is narrower than the window, so no media query)
const liveList = id => { const l = id && list(id); return l && !l.archived_at ? l : null; };
const curId = () => route() || (wide() ? selected : null);
let show = () => {};
// On phone the hashchange paints (app.js showTab). Painting here too rebuilt the screen a moment later and wiped what the user had typed.
// On desktop the open list changes in place (replaceState, no hashchange) so the search box and scroll of the index stay.
const go = id => {
  if (!wide()) return goHash(id ? `l/${id}` : 'lists');
  selected = id;
  history.replaceState(history.state, '', id ? `#l/${id}` : '#lists');
  drawDetail();
  paintIdx();
};

function drawDetail() {
  ro?.disconnect();
  const id = route() || (wide() ? (liveList(selected)?.id ?? sortLists([...state.lists])[0]?.id) : null);
  if (wide()) selected = id ?? null;
  if (id && list(id)) { splitEl.dataset.mode = 'list'; listView(id, detEl); }
  else { splitEl.dataset.mode = 'index'; detEl.innerHTML = wide() ? `<p class="empty">${S.emptyList}</p>` : ''; paintRows = () => {}; }
}

let watching;
export function mountLists(el) {
  root = el;
  if (!watching) { watching = true; new MutationObserver(() => !root.hidden && show()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-layout'] }); }
  show = function () {
    unsub?.();
    root.innerHTML = '<div class="lsplit"><div class="lpane" data-idx></div><div class="dpane" data-det></div></div>';
    splitEl = root.firstElementChild; detEl = $(root, '[data-det]');
    // Phone builds only the pane in view (a hidden twin would duplicate every control in the DOM).
    if (wide() || !(route() && list(route()))) homeView($(root, '[data-idx]')); else paintIdx = () => {};
    drawDetail();
    unsub = subscribe(() => !root.hidden && (paintIdx(), paintRows()));
    addFab();
  };
  return show;
}

const rowOfList = l => `<button class="row lrow" ${l.id === curId() ? 'aria-current="true" ' : ''}data-open="${l.id}"><span class="t">${esc(l.title)}</span><span class="n">${esc(S.items(countOf(state.items, l.id)))}</span><span class="chev">›</span></button>`;

// ── Lists screen ──
function homeView(el) {
  el.innerHTML = `<div class="large-title"><h1>${S.listsTitle}</h1></div>
    <input class="search" type="search" enterkeyhint="search" placeholder="${esc(S.lSearch)}" aria-label="${esc(S.lSearch)}" autocomplete="off">
    ${isOwner() ? `<form class="add-row" data-newlist><input name="t" maxlength="80" placeholder="${esc(S.newListHint)}" aria-label="${esc(S.newList)}" autocomplete="off" enterkeyhint="done"><button>${S.createList}</button></form>` : ''}
    <div class="group"><a class="row lrow" href="#places"><span class="t">${S.placesRow}</span><span class="chev">›</span></a></div>
    <div id="rows"></div>`;
  const q = $(el, '.search'), rows = $(el, '#rows');
  let showArchived = false;
  paintIdx = () => {
    const term = q.value.trim();
    if (term) {
      const r = search(state.lists, state.items, term);
      rows.innerHTML = !r.lists.length && !r.items.length ? `<p class="empty">${S.searchNone}</p>` : `<div class="sres">
        ${r.lists.length ? `<h3>${S.searchLists}</h3><div class="group">${r.lists.map(rowOfList).join('')}</div>` : ''}
        ${r.items.length ? `<h3>${S.searchItems}</h3><div class="group">${r.items.map(i => `<button class="row" data-open="${i.list_id}" style="display:grid;gap:2px"><b>${esc(i.text)}</b><span class="sub">${esc(S.inList(list(i.list_id).title))}${i.done_at ? ' · ✓' : ''}</span></button>`).join('')}</div>` : ''}</div>`;
      return;
    }
    const ls = sortLists([...state.lists]), arch = isOwner() ? archivedLists(state.lists) : [];
    rows.innerHTML = `${ls.length ? `<div class="group">${ls.map(rowOfList).join('')}</div>` : `<p class="empty">${S.empty}</p>`}
      ${arch.length ? `<button class="dsec" data-arch><span>${esc(S.archivedLists(arch.length))}</span><span>${showArchived ? '⌃' : '⌄'}</span></button>
        ${showArchived ? `<div class="group">${arch.map(l => `<div class="row lrow"><span class="t">${esc(l.title)}</span><button class="ghost" data-restore="${l.id}">${S.restore}</button></div>`).join('')}</div>` : ''}` : ''}`;
  };
  q.oninput = paintIdx;
  $(el, 'a[href="#places"]').onclick = e => { e.preventDefault(); nav.placesFrom = 'lists'; goHash('places'); };
  rows.onclick = e => {
    const o = e.target.closest('[data-open]');
    if (o) return go(o.dataset.open);
    if (e.target.closest('[data-arch]')) { showArchived = !showArchived; return paintIdx(); }
    const r = e.target.closest('[data-restore]');
    if (r) patchList(r.dataset.restore, { archived_at: null }).then(() => toast(S.listRestored)).catch(() => {});
  };
  const nl = $(el, '[data-newlist]');
  if (nl) nl.onsubmit = async e => {
    e.preventDefault();
    const title = cleanTitle(nl.t.value);
    if (!title) return;
    nl.t.value = '';
    buzz();
    try { await addList(title); toast(S.listCreated(title)); } catch {}
  };
  paintIdx();
}

// ── One list ──
function listView(id, el) {
  const l = list(id);
  let reorder = false, showDone = false, extra = false, sortKey = null, sortDir = 1, cols = false; // sortKey: desktop column sort, view only
  // Columns only when the open list itself is wide enough: beside the index at 1024-1180 px windows the pane is 380-540 px.
  // Need = tick 56 + 8 + Item 8rem + dates 11rem + Note 4rem + Link + 96 for Reorder arrows; 16 px more to switch on, so a scrollbar cannot flip it back and forth.
  const fits = () => wide() && el.clientWidth >= 64 + 26 * parseFloat(getComputedStyle(document.documentElement).fontSize) + (reorder ? 96 : 0) + (cols ? 0 : 16);
  el.innerHTML = `<div class="large-title"><button class="back" data-back>‹ ${S.listsBack}</button>${isOwner() ? `<button class="iconbtn" data-menu aria-label="${esc(S.listMenu)}">⋯</button>` : ''}</div>
    <h1 data-title></h1>
    <form class="add-row" data-add><input name="t" maxlength="500" placeholder="${esc(S.addItemHint)}" aria-label="${esc(S.addItem)}" autocomplete="off" enterkeyhint="done"><button>${S.add}</button></form>
    <button class="opts" data-extra>+ ${S.moreOpts}</button>
    <div class="extra" data-extrabox hidden><input name="n" form="x" maxlength="2000" placeholder="${esc(S.note)}" aria-label="${esc(S.note)}"><input name="u" form="x" inputmode="url" autocapitalize="none" autocorrect="off" placeholder="${esc(S.link)} (https://…)" aria-label="${esc(S.link)}"><p class="bad hint" data-err hidden>${S.linkBad}</p></div>
    <p class="hint" data-hint></p>
    <div id="rows"></div>`;
  const form = $(el, '[data-add]'), box = $(el, '[data-extrabox]'), rows = $(el, '#rows'), hint = $(el, '[data-hint]');
  const nIn = box.querySelector('[name=n]'), uIn = box.querySelector('[name=u]'), err = $(el, '[data-err]');
  if (!isOwner()) hint.textContent = S.viewOnly;

  const day = iso => (iso ? esc(fmtDay(ymd(new Date(iso)))) : ''); // local day, not the UTC date
  const head = () => `<div class="ihead" role="row"><span role="columnheader"></span>${[['text', S.itemText], ['note', S.note], ['link', S.link], ['created_at', S.added], ['done_at', S.done]].map(([k, t]) =>
    k === 'note' || k === 'link' ? `<span role="columnheader">${t}</span>` : `<span role="columnheader" aria-sort="${sortKey !== k ? 'none' : sortDir > 0 ? 'ascending' : 'descending'}"><button class="hsort" data-sort="${k}">${t}</button></span>`).join('')}</div>`;
  const itemRow = (i, o, idx, n) => {
    const href = safeUrl(i.url);
    const done = !!i.done_at;
    if (cols) return `<div class="irow ${done ? 'isdone' : ''}" role="row" data-id="${i.id}">
      <span role="cell">${isOwner() ? tickBtn(done, `data-tick="${i.id}"`) : '<span class="dotv"></span>'}</span>
      <span role="cell"><button class="itext" data-edit="${i.id}"><b>${esc(i.text)}</b></button></span>
      <span role="cell" class="sub">${esc(i.note ?? '')}</span>
      <span role="cell">${href ? `<a class="lnk" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(i.link_title || hostOf(href))}</a>` : ''}</span>
      <span role="cell" class="sub">${day(i.created_at)}</span><span role="cell" class="sub">${day(i.done_at)}</span>
      ${reorder && !done ? `<span role="cell" class="mv"><button data-mv="${i.id}" data-d="-1" aria-label="${esc(S.up)}" ${idx === 0 ? 'disabled' : ''}>▲</button><button data-mv="${i.id}" data-d="1" aria-label="${esc(S.down)}" ${idx === n - 1 ? 'disabled' : ''}>▼</button></span>` : ''}</div>`;
    return `<div class="irow ${done ? 'isdone' : ''}" data-id="${i.id}">
      ${isOwner() ? `${tickBtn(done, `data-tick="${i.id}"`)}` : '<span class="dotv"></span>'}
      <div class="imain"><button class="itext" data-edit="${i.id}"><b>${esc(i.text)}</b>${i.note ? `<span class="sub">${esc(i.note)}</span>` : ''}</button>
        ${href ? `<a class="lnk" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(hostOf(href))}</a>` : ''}</div>
      ${reorder && !done ? `<div class="mv"><button data-mv="${i.id}" data-d="-1" aria-label="${esc(S.up)}" ${idx === 0 ? 'disabled' : ''}>▲</button><button data-mv="${i.id}" data-d="1" aria-label="${esc(S.down)}" ${idx === n - 1 ? 'disabled' : ''}>▼</button></div>` : ''}</div>`;
  };
  paintRows = () => {
    const cur = list(id);
    if (!cur || (cur.archived_at && !isOwner())) return go(null);
    $(el, '[data-title]').textContent = cur.title;
    cols = fits();
    if (!cols) sortKey = null;
    const sorted = xs => (sortKey ? sortItems(xs, sortKey, sortDir) : xs);
    const open = sorted(openItems(state.items, id)), done = sorted(doneItems(state.items, id));
    const grp = xs => (cols ? `<div class="group icols" role="table" aria-label="${esc(cur.title)}">${head()}` : '<div class="group">') + xs.map((i, k) => itemRow(i, xs, k, xs.length)).join('') + '</div>';
    rows.innerHTML = `${open.length ? grp(open) : `<p class="empty">${S.emptyList}</p>`}
      ${sortKey ? `<button class="ghost" style="margin-top:var(--sp-3)" data-manual>${S.manualOrder}</button>`
        : open.length > 1 && isOwner() ? `<button class="ghost" style="margin-top:var(--sp-3)" data-reorder>${reorder ? S.reorderDone : S.reorder}</button>` : ''}
      ${done.length ? `<button class="dsec" data-done><span>${esc(S.doneSec(done.length))}</span><span>${showDone ? '⌃' : '⌄'}</span></button>
        ${showDone ? grp(done) : ''}` : ''}`;
  };
  rows.onclick = e => {
    const t = e.target.closest('[data-tick]');
    if (t) {
      const it = state.items.find(x => x.id === t.dataset.tick), nowDone = !it.done_at;
      buzz();
      patchItem(it.id, { done_at: nowDone ? new Date().toISOString() : null }).then(() => {
        if (nowDone) toast(S.ticked, 'ok', { label: S.undo, fn: () => patchItem(it.id, { done_at: null }).catch(() => {}) });
      }).catch(() => {});
      return;
    }
    const m = e.target.closest('[data-mv]');
    if (m) {
      const p = movePos(openItems(state.items, id), m.dataset.mv, Number(m.dataset.d));
      if (p != null) patchItem(m.dataset.mv, { position: p }).catch(() => {});
      return;
    }
    if (e.target.closest('[data-reorder]')) { reorder = !reorder; return paintRows(); }
    const so = e.target.closest('[data-sort]');
    // paintRows replaces the buttons, so focus goes back to the same control (keyboard users stay in place).
    if (so) {
      const k = so.dataset.sort, n = [...rows.querySelectorAll(`[data-sort="${k}"]`)].indexOf(so);
      sortDir = k === sortKey ? -sortDir : k === 'text' ? 1 : -1; sortKey = k; reorder = false; paintRows();
      return rows.querySelectorAll(`[data-sort="${k}"]`)[n]?.focus();
    }
    if (e.target.closest('[data-manual]')) { sortKey = null; paintRows(); return (rows.querySelector('[data-reorder]') ?? rows.querySelector('[data-sort]'))?.focus(); }
    if (e.target.closest('[data-done]')) { showDone = !showDone; return paintRows(); }
    const ed = e.target.closest('[data-edit]');
    if (ed) itemSheet(ed.dataset.edit);
  };
  $(el, '[data-back]').onclick = () => go(null);
  $(el, '[data-menu]')?.addEventListener('click', () => listSheet(id));
  $(el, '[data-extra]').onclick = () => { extra = !extra; box.hidden = !extra; };
  form.onsubmit = async e => {
    e.preventDefault();
    const raw = form.t.value.trim();
    if (!raw) return;
    const p = parseInput(raw);
    const urlTyped = uIn.value.trim();
    let url = p.url, text = p.text, link_title = null;
    if (urlTyped) {
      url = safeUrl(urlTyped);
      err.hidden = !!url;
      if (!url) return;
    }
    err.hidden = true;
    form.querySelector('button').disabled = true;
    if (p.url) { // the box held only a link: show a video title when oEmbed gives one
      hint.textContent = S.lookingUp;
      const t = await videoTitle(p.url);
      if (t) { text = t; link_title = t; }
      hint.textContent = isOwner() ? '' : S.viewOnly;
    }
    form.querySelector('button').disabled = false;
    const note = nIn.value.trim();
    form.t.value = ''; nIn.value = ''; uIn.value = '';
    buzz();
    try { await addItem(id, { text, note, url, link_title }); } catch {}
    form.t.focus();
  };
  paintRows();
  ro = new ResizeObserver(() => !root.hidden && fits() !== cols && paintRows());
  ro.observe(el);
}

function itemSheet(itemId) {
  const it = state.items.find(x => x.id === itemId);
  if (!it) return;
  const href = safeUrl(it.url);
  if (!isOwner()) {
    const d = sheet(S.editItem, `<div class="group"><div class="static"><b>${esc(it.text)}</b>${it.note ? `<p>${esc(it.note)}</p>` : ''}</div></div>
      ${href ? `<a class="lnk" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(href)}</a>` : ''}`);
    return d;
  }
  const lists = sortLists([...state.lists]);
  const d = sheet(S.editItem, `<form class="stack" data-f>
    <label>${S.itemText}<input name="t" maxlength="500" value="${esc(it.text)}" required></label>
    <label>${S.note}<textarea name="n" rows="3" maxlength="2000">${esc(it.note ?? '')}</textarea></label>
    <label>${S.link}<input name="u" inputmode="url" autocapitalize="none" value="${esc(it.url ?? '')}" placeholder="https://…"></label>
    <p class="bad hint" data-err hidden>${S.linkBad}</p>
    ${href ? `<a class="lnk" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${S.openLink}: ${esc(hostOf(href))}</a>` : ''}
    <label>${S.lMoveTo}<select name="l">${lists.map(l => `<option value="${l.id}" ${l.id === it.list_id ? 'selected' : ''}>${esc(l.title)}</option>`).join('')}</select></label>
    <button class="save">${S.save}</button>
    <button type="button" class="ghost" data-arch>${S.archiveItem}</button></form>`);
  const f = $(d, '[data-f]');
  f.onsubmit = e => {
    e.preventDefault();
    const u = f.u.value.trim() ? safeUrl(f.u.value) : null;
    if (f.u.value.trim() && !u) return ($(d, '[data-err]').hidden = false);
    const text = f.t.value.trim();
    if (!text) return;
    const fields = { text, note: f.n.value.trim() || null, url: u };
    if (u !== it.url) fields.link_title = null;
    if (f.l.value !== it.list_id) fields.list_id = f.l.value;
    d.close();
    patchItem(it.id, fields).catch(() => {});
  };
  $(d, '[data-arch]').onclick = () => {
    d.close();
    patchItem(it.id, { archived_at: new Date().toISOString() }).then(() =>
      toast(S.itemArchived, 'ok', { label: S.undo, fn: () => patchItem(it.id, { archived_at: null }).then(() => toast(S.itemRestored)).catch(() => {}) })).catch(() => {});
  };
}

function listSheet(id) {
  const l = list(id);
  const d = sheet(S.listMenu, `<form class="stack" data-f><label>${S.renameList}<input name="t" maxlength="80" value="${esc(l.title)}" required></label>
    <button class="save">${S.save}</button><button type="button" class="ghost" data-arch>${S.archiveList}</button></form>`);
  const f = $(d, '[data-f]');
  f.onsubmit = e => {
    e.preventDefault();
    const t = cleanTitle(f.t.value);
    if (!t) return;
    d.close();
    patchList(id, { title: t }).catch(() => {});
  };
  $(d, '[data-arch]').onclick = () => {
    d.close();
    patchList(id, { archived_at: new Date().toISOString() }).then(() => {
      go(null);
      toast(S.listArchived, 'ok', { label: S.undo, fn: () => patchList(id, { archived_at: null }).catch(() => {}) });
    }).catch(() => {});
  };
}

// ── Quick add: "+" on every screen, asks which list ──
function addFab() {
  let b = document.getElementById('fab');
  if (!b) {
    b = Object.assign(document.createElement('button'), { id: 'fab', className: 'fab', textContent: `+ ${S.lQuickAdd}` }); // icon plus word, never a bare +
    b.onclick = quickAdd;
    document.body.append(b);
  }
  b.hidden = false;
}
function quickAdd() {
  const ls = sortLists([...state.lists]);
  if (!ls.length) return toast(S.noListsYet);
  let pick = liveList(curId()) ? curId() : ls[0].id;
  const d = sheet(S.lQuickAdd, `<form class="stack" data-f><input name="t" maxlength="500" placeholder="${esc(S.addItemHint)}" aria-label="${esc(S.addItem)}" autocomplete="off" enterkeyhint="done" required>
    <div class="lbl">${S.whichList}</div><div class="pick" data-pick></div><button class="save">${S.add}</button></form>`);
  const f = $(d, '[data-f]'), pk = $(d, '[data-pick]');
  const paint = () => (pk.innerHTML = ls.map(l => `<button type="button" data-l="${l.id}" aria-pressed="${l.id === pick}"><span>${esc(l.title)}</span><span class="muted">${esc(S.items(countOf(state.items, l.id)))}</span></button>`).join(''));
  paint();
  pk.onclick = e => { const b = e.target.closest('[data-l]'); if (b) { pick = b.dataset.l; paint(); } };
  f.onsubmit = async e => {
    e.preventDefault();
    const p = parseInput(f.t.value);
    if (!p.text) return;
    let { text } = p, link_title = null;
    if (p.url) { const t = await videoTitle(p.url); if (t) { text = t; link_title = t; } }
    d.close();
    buzz();
    try { await addItem(pick, { text, url: p.url, link_title }); toast(S.lQuickAdded(list(pick).title)); } catch {}
  };
}

