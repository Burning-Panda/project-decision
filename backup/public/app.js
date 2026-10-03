'use strict';
const $ = (sel) => document.querySelector(sel);
const main = $('#main');
const userInput = $('#user');
try { userInput.value = localStorage.getItem('dl-user') ?? ''; } catch { /* storage unavailable */ }
userInput.addEventListener('change', () => {
  try { localStorage.setItem('dl-user', userInput.value.trim()); } catch { /* ignore */ }
  route();
});

/** Tiny element builder; text is always set via textContent/Text nodes (no HTML injection). */
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  return el;
}

function showError(msg) {
  const box = $('#error');
  box.hidden = !msg;
  box.textContent = msg ?? '';
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-user': userInput.value.trim() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const type = res.headers.get('content-type') ?? '';
  const data = type.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error(data?.error ? `${data.error.code}: ${data.error.message}` : `HTTP ${res.status}`);
  return data;
}

/** Replaces the page body; goes through h() so arrays, null and false are handled. */
const render = (...kids) => main.replaceChildren(h('div', {}, ...kids));
const badge = (status) => h('span', { class: `badge ${status}` }, status);
const guard = (fn) => async (...a) => { try { showError(null); await fn(...a); } catch (e) { showError(e.message); } };

// ---- views ---------------------------------------------------------------
async function decisionsView() {
  const { items } = await api('GET', '/decisions?limit=100');
  render(
    h('h2', {}, 'Decisions'),
    items.length ? h('div', { class: 'list' }, items.map((d) => h('a', { href: `#/d/${d.id}` }, h('div', { class: 'card' },
      h('div', { class: 'row' }, h('strong', {}, `${d.id}: ${d.title}`), badge(d.status)),
      h('div', { class: 'muted' }, `by ${d.owner} · created ${d.created_at.slice(0, 10)}`),
    )))) : h('p', { class: 'muted' }, 'No decisions yet.'),
  );
}

async function dashboardView() {
  const { dashboard } = await api('GET', '/dashboard');
  const section = (title, list) => h('section', {}, h('h3', {}, `${title} (${list.length})`),
    list.map((d) => h('div', {}, h('a', { href: `#/d/${d.id}` }, `${d.id}: ${d.title}`), ' ', badge(d.status))));
  render(h('h2', {}, 'Dashboard'),
    section('Decisions I own', dashboard.owned), section('Awaiting my approval', dashboard.awaiting_my_approval),
    section("Decisions I've contributed to", dashboard.contributed), section('Decisions in my projects', dashboard.in_my_projects));
}

async function todosView() {
  const { items } = await api('GET', '/todos?user=me&sort=due_date');
  render(h('h2', {}, 'My to-do items'), items.length ? items.map((t) => h('div', { class: 'card' },
    h('div', { class: 'row' }, h('strong', {}, t.title), badge(t.status), h('span', { class: 'muted' }, `${t.priority} · due ${t.due_date ?? '—'}`)),
    h('a', { href: `#/d/${t.decision_id}` }, `${t.decision_id}: ${t.decision_title}`),
    t.status !== 'completed' && h('div', { class: 'row' },
      h('button', { onclick: guard(async () => { await api('PATCH', `/todos/${t.id}`, { status: 'in_progress' }); await todosView(); }) }, 'Start'),
      h('button', { onclick: guard(async () => { await api('PATCH', `/todos/${t.id}`, { status: 'completed' }); await todosView(); }) }, 'Mark complete')),
  )) : h('p', { class: 'muted' }, 'Nothing assigned to you.'));
}

function newView() {
  const form = h('form', { onsubmit: guard(async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const { decision } = await api('POST', '/decisions', { project: f.get('project'), title: f.get('title'), content: f.get('content') || undefined });
    location.hash = `#/d/${decision.id}`;
  }) },
  h('label', {}, 'Project identifier', h('input', { name: 'project', required: true, placeholder: 'PRJ' })),
  h('label', {}, 'Title', h('input', { name: 'title', required: true })),
  h('label', {}, 'Markdown (leave empty for the standard template)', h('textarea', { name: 'content' })),
  h('button', { class: 'primary' }, 'Save draft'));
  render(h('h2', {}, 'New decision'), form);
}

async function detailView(id) {
  const [{ decision: d }, doc] = await Promise.all([api('GET', `/decisions/${id}`), api('GET', `/decisions/${id}/document`)]);
  const refresh = () => detailView(id);
  const act = (action, payload, label, ask) => h('button', { onclick: guard(async () => {
    const body = { ...payload };
    for (const [k, prompt_] of Object.entries(ask ?? {})) { const v = prompt(prompt_); if (v === null) return; body[k] = v; }
    await api('POST', `/decisions/${id}/actions`, { action, payload: body });
    await refresh();
  }) }, label);

  const buttons = {
    draft: [act('propose', {}, 'Propose')],
    proposed: [act('vote', { vote: 'approve' }, 'Vote approve'), act('approve', {}, 'Approve'),
      act('vote', { vote: 'request_revision' }, 'Vote: revise', { comment: 'Reason?' }),
      act('request_revision', {}, 'Request revision', { reason: 'Reason?' }), act('decline', {}, 'Decline', { reason: 'Reason?' })],
    declined: [act('return_to_draft', {}, 'Return to draft')],
    approved: [act('create_superseding_decision', {}, 'Supersede', { title: 'Title of the new decision?' })],
  }[d.status];
  const tally = d.vote_tally;
  const comment = h('input', { placeholder: 'Add a comment (use @name to mention)…' });
  const versionsEl = d.versions.length > 1 ? h('div', {}, h('h3', {}, 'Versions'), d.versions.map((v, i) => h('div', { class: 'row' },
    `v${v.version} — ${v.outcome ?? 'current'}${v.reason ? `: ${v.reason}` : ''}`,
    i > 0 && h('button', { onclick: guard(async () => {
      const { diff } = await api('GET', `/decisions/${id}/diff?from=v${v.version - 1}&to=v${v.version}`);
      alert(diff.changes.map((c) => `${c.section}\n${c.removed.map((l) => `- ${l}`).join('\n')}\n${c.added.map((l) => `+ ${l}`).join('\n')}`).join('\n\n') || 'No changes');
    }) }, 'View diff')))) : null;

  render(
    h('div', { class: 'row' }, h('h2', {}, `${d.id}: ${d.title}`), badge(d.status)),
    h('div', { class: 'row' }, buttons),
    d.status === 'proposed' && h('p', { class: 'muted' }, `Votes — approve ${tally.approve}, revise ${tally.request_revision}, abstain ${tally.abstain}`),
    h('pre', {}, doc),
    versionsEl,
    h('h3', {}, 'Follow-ups'),
    d.followups.map((f) => h('div', {}, `${f.title} → ${f.assigned_to} (${f.status}, due ${f.due_date ?? '—'})`)),
    h('h3', {}, 'Discussion'),
    d.comments.map((c) => h('div', { class: 'card' }, h('div', { class: 'muted' }, `${c.user} · ${c.created_at.slice(0, 16).replace('T', ' ')}`), c.content)),
    h('form', { onsubmit: guard(async (e) => { e.preventDefault(); await api('POST', `/decisions/${id}/comments`, { content: comment.value }); await refresh(); }) },
      comment, h('button', {}, 'Comment')),
  );
}

// ---- routing -------------------------------------------------------------
const views = { '': decisionsView, decisions: decisionsView, dashboard: dashboardView, todos: todosView, new: newView };
const route = guard(async () => {
  if (!userInput.value.trim()) { render(h('p', {}, 'Enter your email above to begin.')); return; }
  const [, kind, id] = location.hash.split('/');
  if (kind === 'd' && id) return detailView(decodeURIComponent(id));
  return (views[kind ?? ''] ?? decisionsView)();
});
document.querySelectorAll('nav button').forEach((b) => b.addEventListener('click', () => {
  const v = b.dataset.view;
  const target = v === 'decisions' ? '#/' : `#/${v}`;
  if (location.hash === target) route(); else location.hash = target;
}));
window.addEventListener('hashchange', route);
route();
