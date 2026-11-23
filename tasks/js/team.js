import { state, live, person, isOwner, subscribe, reassignOpen } from './store.js';
import { isOpen, compareTasks, ymd } from './sort.js';
import { S } from './strings.js';
import { esc, toast, buzz, pushBack, popBack } from './ui.js';
import { rowHtml, listHtml, handleRowClick } from './tasks.js';

export function stats(tasks, personId, today, now = Date.now()) {
  const mine = tasks.filter(t => t.assignee_id === personId && !t.deleted_at);
  const open = mine.filter(isOpen);
  return {
    open: open.length,
    overdue: open.filter(t => t.due_date && t.due_date < today).length,
    done: mine.filter(t => t.status === 'done' && t.done_at && now - new Date(t.done_at) < 7 * 864e5).length,
  };
}

// Owner only: one row per active person except Papa; tap a row for that person's open tasks.
export function mountTeam(el) {
  let current = null;
  const closePerson = () => { current = null; render(); }; // the person page owns one history entry (Android back returns to Team)
  function render() {
    if (el.hidden || !isOwner()) return;
    const today = ymd();
    const p = current && person(current);
    if (p) return renderPerson(p, today);
    const people = state.people.filter(x => x.active && x.role === 'member');
    el.innerHTML = `<div class="large-title"><h1>${S.team}</h1></div><div class="group">${people.map(x => {
      const st = stats(live(), x.id, today);
      return `<button class="row person" data-person="${x.id}"><span class="grow"><b>${esc(x.name)}</b>${x.job ? `<span class="sub">${esc(x.job)}</span>` : ''}
        <span class="sub">${S.teamOpen(st.open)} · <span class="${st.overdue ? 'bad' : ''}">${S.teamOverdue(st.overdue)}</span> · ${S.teamDone(st.done)}</span></span><span class="chev">›</span></button>`;
    }).join('')}</div>${people.length ? '' : `<p class="empty">${S.teamNone}</p>`}`;
  }
  function renderPerson(p, today) {
    const list = live().filter(t => t.assignee_id === p.id && isOpen(t)).sort(compareTasks(today));
    const others = state.people.filter(x => x.active && x.id !== p.id).map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('');
    el.innerHTML = `<div class="large-title"><button class="back" data-back>‹ ${S.backTeam}</button></div><h1>${esc(p.name)}</h1>
      ${p.job ? `<p class="muted foot">${esc(p.job)}</p>` : ''}
      ${list.length ? listHtml(list, today) : `<p class="empty">${S.teamEmpty}</p>`}
      ${list.length ? `<div class="stack moveall"><label>${S.moveAll}<span class="selw"><select name="to">${others}</select></span></label><button class="ghost" data-moveall>${S.moveAllGo}</button></div>` : ''}`;
  }
  el.addEventListener('click', async e => {
    if (handleRowClick(e)) return;
    const r = e.target.closest('[data-person]');
    if (r) { current = r.dataset.person; pushBack(closePerson); scrollTo(0, 0); return render(); }
    if (e.target.closest('[data-back]')) { popBack(closePerson); return closePerson(); }
    if (e.target.closest('[data-moveall]')) {
      const b = e.target.closest('button'); b.disabled = true;
      try { const n = await reassignOpen(current, el.querySelector('[name=to]').value); buzz(); toast(S.moved(n)); } catch { toast(S.changeFailed, 'bad'); }
      b.disabled = false;
    }
  });
  subscribe(render);
  return () => { popBack(closePerson); current = null; render(); };
}
