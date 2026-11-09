(() => {
'use strict';

const CFG = window.ISH_CONFIG;
const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
});

// ---------- utils ----------
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ymd = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const parseD = s => { const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); };
const today = () => ymd(new Date());
const dayDiff = s => Math.round((parseD(s) - parseD(today())) / 864e5);
const MONTHS = ['yanvar','fevral','mart','aprel','may','iyun','iyul','avgust','sentabr','oktabr','noyabr','dekabr'];
const MON3 = ['yan','fev','mar','apr','may','iyn','iyl','avg','sen','okt','noy','dek'];
const WDAYS = ['Du','Se','Ch','Pa','Ju','Sh','Ya'];
const WDAY_FULL = ['Yakshanba','Dushanba','Seshanba','Chorshanba','Payshanba','Juma','Shanba'];
const COLORS = ['#F06A6A','#EC8D71','#F1BD6C','#5DA283','#4ECBC4','#4573D2','#8D84E8','#E362E3','#6D6E6F'];
const AV_COLORS = ['#F06A6A','#4573D2','#5DA283','#8D84E8','#EC8D71','#4ECBC4','#E362E3'];
const PRIO = { high: 'Yuqori', mid: "O'rta", low: 'Past' };
const STEP = 1000;
const store = {
  get(k){ try { return localStorage.getItem(k); } catch { return null; } },
  set(k,v){ try { localStorage.setItem(k, v); } catch {} },
};
let toastT;
function toast(m){ const el=$('#toast'); el.textContent=m; el.classList.add('show'); clearTimeout(toastT); toastT=setTimeout(()=>el.classList.remove('show'),2800); }
function fail(e, fb='Xatolik yuz berdi'){ console.error(e); toast(e?.message ? `${fb}: ${e.message}` : fb); }
function fmtDue(s){
  if (!s) return '';
  const n = dayDiff(s);
  if (n === 0) return 'Bugun';
  if (n === 1) return 'Ertaga';
  if (n === -1) return 'Kecha';
  const d = parseD(s);
  if (n > 1 && n < 7) return WDAY_FULL[d.getDay()];
  return `${d.getDate()}-${MON3[d.getMonth()]}${d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : ''}`;
}
function dueHTML(t){
  if (!t.due_on) return '';
  const n = dayDiff(t.due_on);
  const cls = t.completed ? '' : n < 0 ? 'over' : n === 0 ? 'today' : n < 7 ? 'soon' : '';
  return `<span class="due ${cls}">${fmtDue(t.due_on)}</span>`;
}
function ago(ts){
  const s = (Date.now() - new Date(ts)) / 1000;
  if (s < 60) return 'hozirgina';
  if (s < 3600) return `${Math.floor(s/60)} daqiqa oldin`;
  if (s < 86400) return `${Math.floor(s/3600)} soat oldin`;
  const d = new Date(ts); return `${d.getDate()}-${MON3[d.getMonth()]}, ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

// ---------- state ----------
const S = {
  user: null,
  projects: [],          // ish_projects
  profiles: {},          // id -> profile
  members: {},           // project_id -> [{user_id, role}]
  sections: [],          // joriy loyiha bo'limlari
  tasks: [],             // joriy kontekstdagi vazifalar (loyiha yoki "mening")
  inbox: [],
  route: { name: null },
  openTask: null,        // ochiq vazifa id
  comments: [],
  showDone: store.get('ish-showdone') === '1',
  calMonth: null,
  collapsed: new Set(JSON.parse(store.get('ish-collapsed') || '[]')),
};
const displayName = p => p?.full_name || p?.email?.split('@')[0] || 'Foydalanuvchi';
const projectOf = id => S.projects.find(p => p.id === id);
const membersOf = pid => S.members[pid] || [];
const isOwner = pid => membersOf(pid).some(m => m.user_id === S.user?.id && m.role === 'owner');
const taskById = id => S.tasks.find(t => t.id === id);
const subsOf = id => S.tasks.filter(t => t.parent_id === id).sort((a,b) => a.position - b.position);

function avatar(id, cls = 'av'){
  const p = id && S.profiles[id];
  if (!p) return `<span class="${cls} none" title="Mas'ul yo'q">👤</span>`;
  const name = displayName(p);
  const url = p.avatar_url && /^https:\/\//.test(p.avatar_url) ? p.avatar_url : '';
  const color = AV_COLORS[[...p.id].reduce((a,c)=>a+c.charCodeAt(0),0) % AV_COLORS.length];
  const ini = name.split(/\s+/).map(w=>w[0]).join('').slice(0,2).toUpperCase();
  return `<span class="${cls}" style="background:${color}" title="${esc(name)}">${url ? `<img src="${esc(url)}" alt="" referrerpolicy="no-referrer" loading="lazy">` : esc(ini)}</span>`;
}

// ---------- auth ----------
function show(v){ $('#viewLoading').hidden = v!=='loading'; $('#viewLogin').hidden = v!=='login'; $('#viewApp').hidden = v!=='app'; }
let rawNonce = null, gsiWait = 0;
async function sha256Hex(str){ const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str)); return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join(''); }
function randomNonce(){ const a = new Uint8Array(32); crypto.getRandomValues(a); return btoa(String.fromCharCode(...a)).replace(/[^a-zA-Z0-9]/g,''); }
async function onGoogleCredential(resp){
  $('#loginErr').textContent = '';
  const { error } = await sb.auth.signInWithIdToken({ provider: 'google', token: resp.credential, nonce: rawNonce });
  if (error) { $('#loginErr').textContent = error.message; renderGsi(); }
}
async function renderGsi(){
  const slot = $('#gsiBtn');
  if (!window.google?.accounts?.id) {
    if (++gsiWait > 30) { slot.hidden = true; $('#googleBtn').hidden = false; return; }
    return setTimeout(renderGsi, 200);
  }
  const nonce = randomNonce(); rawNonce = nonce;
  const hashed = await sha256Hex(nonce);
  if (rawNonce !== nonce) return;
  google.accounts.id.initialize({ client_id: CFG.googleClientId, callback: onGoogleCredential, nonce: hashed, ux_mode: 'popup', use_fedcm_for_prompt: true, itp_support: true });
  slot.innerHTML = '';
  google.accounts.id.renderButton(slot, { type:'standard', theme:'outline', size:'large', text:'signin_with', shape:'pill', width: 300 });
}
$('#googleBtn').addEventListener('click', async () => {
  const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname, queryParams: { prompt: 'select_account' } } });
  if (error) $('#loginErr').textContent = error.message;
});

let booted = false;
sb.auth.onAuthStateChange((_e, session) => setTimeout(() => handleSession(session), 0));
async function handleSession(session){
  const user = session?.user || null;
  if (!user) {
    S.user = null; booted = false; teardown();
    const params = new URLSearchParams(location.search + location.hash.replace(/^#/, '&'));
    const err = params.get('error_description');
    if (err) { $('#loginErr').textContent = err; history.replaceState(null, '', location.pathname); }
    show('login'); renderGsi(); return;
  }
  if (booted && S.user?.id === user.id) { S.user = user; return; }
  S.user = user; booted = true;
  if (location.search.includes('code=')) history.replaceState(null, '', location.pathname + location.hash);
  show('loading');
  const meta = user.user_metadata || {};
  S.profiles[user.id] = { id: user.id, email: user.email, full_name: meta.full_name || meta.name, avatar_url: meta.avatar_url || meta.picture };
  $('#meBtn').innerHTML = avatar(user.id, 'av lg');
  $('#meWho').innerHTML = `${esc(displayName(S.profiles[user.id]))}<small>${esc(user.email)}</small>`;
  await loadProjects();
  await loadInbox();
  subscribe();
  show('app');
  if (innerWidth < 900) $('#viewApp').classList.add('collapsed');
  route();
}
$('#logoutBtn').onclick = async () => { $('#meMenu').hidden = true; teardown(); try { google?.accounts?.id?.disableAutoSelect(); } catch {} await sb.auth.signOut(); };
$('#meBtn').onclick = e => { e.stopPropagation(); $('#meMenu').hidden = !$('#meMenu').hidden; };
document.addEventListener('click', e => {
  if (!e.target.closest('#meMenu')) $('#meMenu').hidden = true;
  if (!e.target.closest('.search')) $('#searchRes').hidden = true;
});

// ---------- data ----------
async function loadProjects(){
  const [{ data: ps, error: e1 }, { data: ms, error: e2 }] = await Promise.all([
    sb.from('ish_projects').select('*').order('created_at'),
    sb.from('ish_members').select('project_id,user_id,role'),
  ]);
  if (e1 || e2) return fail(e1 || e2, "Loyihalarni yuklab bo'lmadi");
  S.projects = ps; S.members = {};
  for (const m of ms) (S.members[m.project_id] ||= []).push(m);
  const ids = [...new Set(ms.map(m => m.user_id))].filter(id => !S.profiles[id] || id === S.user.id);
  if (ids.length) {
    const { data: pr } = await sb.from('profiles').select('id,email,full_name,avatar_url').in('id', ids);
    for (const p of pr || []) S.profiles[p.id] = p;
  }
  renderSide();
}
async function loadProjectData(pid){
  const [{ data: secs, error: e1 }, { data: ts, error: e2 }] = await Promise.all([
    sb.from('ish_sections').select('*').eq('project_id', pid).order('position'),
    sb.from('ish_tasks').select('*').eq('project_id', pid),
  ]);
  if (e1 || e2) return fail(e1 || e2, "Ma'lumotni yuklab bo'lmadi");
  S.sections = secs; S.tasks = ts;
}
async function loadMyTasks(){
  const { data: mine, error } = await sb.from('ish_tasks').select('*').eq('assignee_id', S.user.id).is('parent_id', null);
  if (error) return fail(error, "Vazifalarni yuklab bo'lmadi");
  // kichik vazifalar sonini ko'rsatish uchun ularni ham olamiz
  const ids = mine.map(t => t.id);
  let subs = [];
  if (ids.length) { const r = await sb.from('ish_tasks').select('*').in('parent_id', ids); subs = r.data || []; }
  S.tasks = [...mine, ...subs]; S.sections = [];
}
async function loadInbox(){
  const { data, error } = await sb.from('ish_inbox').select('*').order('created_at', { ascending: false }).limit(100);
  if (error) return fail(error);
  S.inbox = data; renderBadge();
}
function renderBadge(){
  const n = S.inbox.filter(i => !i.read_at).length;
  const b = $('#inboxBadge'); b.hidden = !n; b.textContent = n;
  document.title = (n ? `(${n}) ` : '') + 'Ishlar';
}

// ---------- realtime ----------
let ch = null;
function teardown(){ if (ch) { sb.removeChannel(ch); ch = null; } }
const refresh = debounce(async (what) => {
  const r = S.route;
  if (what === 'members') await loadProjects();
  if (r.name === 'project') await loadProjectData(r.id);
  else if (r.name === 'my' || r.name === 'home') await loadMyTasks();
  if (S.openTask && !taskById(S.openTask)) {
    const { data } = await sb.from('ish_tasks').select('*').eq('id', S.openTask).maybeSingle();
    if (data) { S.tasks.push(data); const { data: subs } = await sb.from('ish_tasks').select('*').eq('parent_id', data.id); S.tasks.push(...(subs || [])); }
  }
  render();
  if (S.openTask) await loadComments(true);
}, 250);
function subscribe(){
  teardown();
  ch = sb.channel('ish-' + S.user.id)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'ish_tasks' }, () => { if (!busy) refresh('tasks'); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'ish_sections' }, () => { if (!busy) refresh('sections'); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'ish_comments' }, p => { if (S.openTask && (p.new?.task_id === S.openTask || p.old?.task_id === S.openTask)) loadComments(true); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'ish_members' }, () => refresh('members'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'ish_projects' }, () => refresh('members'))
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ish_inbox', filter: `user_id=eq.${S.user.id}` }, p => { S.inbox.unshift(p.new); renderBadge(); if (S.route.name === 'inbox') render(); toast(p.new.text); })
    .subscribe();
}
// O'z o'zgarishimizdan keyingi realtime aks-sadoni qisqa vaqt e'tiborsiz qoldiramiz (optimistik UI)
let busy = 0;
async function mutate(fn){ busy++; try { return await fn(); } finally { setTimeout(() => { busy--; }, 600); } }

// ---------- routing ----------
window.addEventListener('hashchange', route);
async function route(){
  const [path, query] = location.hash.replace(/^#\/?/, '').split('?');
  const h = path.split('/');
  const linkTask = new URLSearchParams(query || '').get('t');
  let r;
  if (h[0] === 'p' && h[1]) r = { name: 'project', id: h[1], view: h[2] || store.get('ish-view-' + h[1]) || 'list' };
  else if (h[0] === 'my') r = { name: 'my' };
  else if (h[0] === 'inbox') r = { name: 'inbox' };
  else r = { name: 'home' };
  if (r.name === 'project' && !projectOf(r.id)) { location.hash = '#/home'; return; }
  const changed = S.route.name !== r.name || S.route.id !== r.id;
  S.route = r;
  if (r.name === 'project') store.set('ish-view-' + r.id, r.view);
  if (changed) {
    closePane(false);
    $('#content').innerHTML = '<div class="loading" style="position:static;padding:60px"><div class="spin"></div></div>';
    if (r.name === 'project') await loadProjectData(r.id);
    else if (r.name !== 'inbox') await loadMyTasks();
  }
  if (innerWidth < 900) $('#viewApp').classList.add('collapsed');
  render();
  if (linkTask) { history.replaceState(null, '', '#/' + path); openPane(linkTask); }
}
function go(h){ if (location.hash === h) route(); else location.hash = h; }

// ---------- sidebar ----------
function renderSide(){
  $('#projectNav').innerHTML = S.projects.map(p =>
    `<a href="#/p/${p.id}" data-pid="${p.id}"><i class="sq" style="background:${esc(p.color)}"></i><span>${esc(p.name)}</span></a>`).join('')
    || '<div style="padding:6px 10px;color:var(--side-mut);font-size:13px">Hali loyiha yo\'q</div>';
  markNav();
}
function markNav(){
  document.querySelectorAll('.side a').forEach(a => {
    a.classList.toggle('on', a.dataset.nav === S.route.name || (S.route.name === 'project' && a.dataset.pid === S.route.id));
  });
}
$('#sideToggle').onclick = () => $('#viewApp').classList.add('collapsed');
$('#sideOpen').onclick = () => $('#viewApp').classList.remove('collapsed');
$('#newProjectBtn').onclick = () => projectModal();
$('#createBtn').onclick = () => {
  if (S.route.name === 'project') addTaskPrompt(S.sections[0]?.id || null);
  else if (!S.projects.length) projectModal();
  else quickTaskModal();
};

// ---------- render ----------
function render(){
  markNav();
  const r = S.route;
  if (r.name === 'home') renderHome();
  else if (r.name === 'my') renderMy();
  else if (r.name === 'inbox') renderInbox();
  else if (r.name === 'project') renderProject();
  if (S.openTask) renderPane();
}

function taskVisible(t){ return !t.parent_id && (S.showDone || !t.completed || t.id === S.openTask); }

function myGroups(){
  const ts = S.tasks.filter(t => !t.parent_id && t.assignee_id === S.user.id && (S.showDone || !t.completed));
  const g = { over: [], today: [], week: [], later: [], none: [] };
  for (const t of ts) {
    if (!t.due_on) g.none.push(t);
    else { const n = dayDiff(t.due_on); (n < 0 ? g.over : n === 0 ? g.today : n < 7 ? g.week : g.later).push(t); }
  }
  for (const k in g) g[k].sort((a,b) => (a.due_on||'9').localeCompare(b.due_on||'9') || a.created_at.localeCompare(b.created_at));
  return g;
}

function renderHome(){
  const d = new Date();
  const name = displayName(S.profiles[S.user.id]).split(' ')[0];
  const h = d.getHours();
  const greet = h < 12 ? 'Xayrli tong' : h < 18 ? 'Xayrli kun' : 'Xayrli kech';
  const mine = S.tasks.filter(t => !t.parent_id && t.assignee_id === S.user.id);
  const open = mine.filter(t => !t.completed);
  const doneWeek = mine.filter(t => t.completed && t.completed_at && (Date.now() - new Date(t.completed_at)) < 7*864e5).length;
  const upcoming = open.slice().sort((a,b) => (a.due_on||'9999').localeCompare(b.due_on||'9999')).slice(0, 8);
  $('#content').innerHTML = `<div class="page">
    <div class="hello"><div class="dt">${WDAY_FULL[d.getDay()]}, ${d.getDate()}-${MONTHS[d.getMonth()]}</div><h1>${greet}, ${esc(name)}</h1>
      <div class="stats"><span><b>${doneWeek}</b> ta vazifa shu hafta bajarildi</span><span><b>${S.projects.length}</b> ta loyiha</span></div></div>
    <div class="widgets">
      <section class="wid"><h2>${avatar(S.user.id,'av lg')} Mening vazifalarim</h2>
        ${upcoming.length ? upcoming.map(t => miniRow(t)).join('') : '<div class="empty-st">Sizga biriktirilgan ochiq vazifa yo\'q 🎉</div>'}
        ${open.length > 8 ? `<a href="#/my" style="display:block;margin-top:10px;color:var(--mut)">Barchasini ko'rish (${open.length})</a>` : ''}
      </section>
      <section class="wid"><h2>Loyihalar</h2><div class="projgrid">
        <a class="ptile add" href="javascript:void 0" data-act="newproj"><span class="pic">+</span>Loyiha yaratish</a>
        ${S.projects.map(p => `<a class="ptile" href="#/p/${p.id}"><span class="pic" style="background:${esc(p.color)}">${esc(p.name[0]?.toUpperCase()||'?')}</span><span>${esc(p.name)}</span></a>`).join('')}
      </div></section>
    </div></div>`;
  $('#content').querySelector('[data-act=newproj]').onclick = () => projectModal();
  bindMini();
}
function miniRow(t){
  const p = projectOf(t.project_id);
  return `<div class="mini" data-open="${t.id}"><button class="cbx ${t.completed?'on':''}" data-done="${t.id}" aria-label="Bajarildi">✓</button><span class="tt">${esc(t.title)}</span>
    ${p ? `<span class="ptag"><i style="background:${esc(p.color)}"></i>${esc(p.name)}</span>` : ''}${dueHTML(t)}</div>`;
}
function bindMini(){
  $('#content').querySelectorAll('[data-open]').forEach(el => el.onclick = e => { if (!e.target.closest('[data-done]')) openPane(el.dataset.open); });
  $('#content').querySelectorAll('[data-done]').forEach(el => el.onclick = e => { e.stopPropagation(); toggleDone(el.dataset.done); });
}

function renderMy(){
  const g = myGroups();
  const labels = [['over','Muddati o\'tgan'],['today','Bugun'],['week','Shu hafta'],['later','Keyinroq'],['none','Muddatsiz']];
  const total = Object.values(g).reduce((a,x)=>a+x.length,0);
  $('#content').innerHTML = `<div class="ph"><div class="ph-row">${avatar(S.user.id,'av lg')}<h1>Mening vazifalarim</h1></div><div class="vtabs"><a class="on">Ro'yxat</a></div></div>
    <div class="toolbar"><button class="btn primary" id="addMy">+ Vazifa qo'shish</button><span class="sp"></span>${doneToggle()}</div>
    <div class="list"><div class="lhead"><div>Vazifa nomi</div><div>Loyiha</div><div>Muddat</div><div>Muhimlik</div></div>
    ${total ? labels.filter(([k]) => g[k].length).map(([k,l]) => `<div class="sec-h"><span>${l}</span><span class="cnt">${g[k].length}</span></div>${g[k].map(t => rowHTML(t, true)).join('')}`).join('')
      : '<div class="empty-st">Sizga biriktirilgan vazifa yo\'q. Loyihada vazifa yaratib, o\'zingizni mas\'ul qilib tayinlang.</div>'}
    </div>`;
  bindDoneToggle();
  $('#addMy').onclick = () => S.projects.length ? quickTaskModal() : projectModal();
  bindRows(false);
}
function doneToggle(){ return `<label class="chk"><input type="checkbox" id="showDone" ${S.showDone?'checked':''}> Bajarilganlarni ko'rsatish</label>`; }
function bindDoneToggle(){ $('#showDone').onchange = e => { S.showDone = e.target.checked; store.set('ish-showdone', S.showDone ? '1' : '0'); render(); }; }

function renderInbox(){
  const unread = S.inbox.filter(i => !i.read_at).length;
  $('#content').innerHTML = `<div class="ph"><div class="ph-row"><h1>Kiruvchi</h1><div class="right">${unread ? '<button class="btn" id="readAll">Hammasini o\'qilgan qilish</button>' : ''}</div></div><div class="vtabs"><a class="on">Faoliyat</a></div></div>
    <div class="page" style="padding-top:8px">${S.inbox.length ? S.inbox.map(i => `<div class="inbox-i ${i.read_at?'':'unread'}" data-id="${i.id}">${avatar(i.actor_id,'av lg')}<div class="b">${esc(i.text)}<small>${projectOf(i.project_id) ? esc(projectOf(i.project_id).name) + ' · ' : ''}${ago(i.created_at)}</small></div></div>`).join('')
      : '<div class="empty-st">Hozircha xabar yo\'q. Sizga vazifa berilsa yoki izoh yozilsa, shu yerda ko\'rinadi.</div>'}</div>`;
  const ra = $('#readAll');
  if (ra) ra.onclick = async () => {
    const ids = S.inbox.filter(i => !i.read_at).map(i => i.id);
    const now = new Date().toISOString();
    S.inbox.forEach(i => { if (!i.read_at) i.read_at = now; }); renderBadge(); render();
    const { error } = await sb.from('ish_inbox').update({ read_at: now }).in('id', ids);
    if (error) fail(error);
  };
  $('#content').querySelectorAll('.inbox-i').forEach(el => el.onclick = async () => {
    const it = S.inbox.find(i => i.id === el.dataset.id);
    if (!it.read_at) { it.read_at = new Date().toISOString(); renderBadge(); sb.from('ish_inbox').update({ read_at: it.read_at }).eq('id', it.id).then(({error}) => error && fail(error)); }
    if (it.project_id && projectOf(it.project_id)) {
      location.hash = `#/p/${it.project_id}`;
      if (it.task_id) { await waitRoute(); openPane(it.task_id); }
    } else render();
  });
}
function waitRoute(){ return new Promise(res => { const t = setInterval(() => { if (S.route.name === 'project' && !$('#content .spin')) { clearInterval(t); res(); } }, 50); setTimeout(() => { clearInterval(t); res(); }, 4000); }); }

// ---------- project ----------
function renderProject(){
  const p = projectOf(S.route.id); if (!p) return;
  const v = S.route.view;
  const mem = membersOf(p.id);
  $('#content').innerHTML = `<div class="ph"><div class="ph-row">
      <span class="pic" style="background:${esc(p.color)}">${esc(p.name[0]?.toUpperCase()||'?')}</span>
      <h1 id="pname" ${isOwner(p.id)?'contenteditable="true" spellcheck="false"':''}>${esc(p.name)}</h1>
      ${isOwner(p.id) ? '<button class="icon-btn" id="pEdit" title="Loyiha sozlamalari">⚙</button>' : ''}
      <div class="right"><span class="avs">${mem.slice(0,5).map(m => avatar(m.user_id)).join('')}</span><button class="btn primary" id="share">Ulashish</button></div></div>
    <nav class="vtabs">${[['list',"Ro'yxat"],['board','Doska'],['calendar','Kalendar']].map(([k,l]) => `<a href="#/p/${p.id}/${k}" class="${v===k?'on':''}">${l}</a>`).join('')}</nav></div>
    <div class="toolbar"><button class="btn primary" id="addTask">+ Vazifa qo'shish</button><span class="sp"></span>${v!=='calendar'?doneToggle():''}</div>
    <div id="pv" style="${v==='board'?'height:calc(100% - 150px)':''}"></div>`;
  $('#share').onclick = () => membersModal(p.id);
  $('#addTask').onclick = () => addTaskPrompt(S.sections[0]?.id || null);
  if (v !== 'calendar') bindDoneToggle();
  const pe = $('#pEdit'); if (pe) pe.onclick = () => projectModal(p);
  const pn = $('#pname');
  if (isOwner(p.id)) {
    pn.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); pn.blur(); } if (e.key === 'Escape') { pn.textContent = p.name; pn.blur(); } };
    pn.onblur = async () => {
      const name = pn.textContent.trim();
      if (!name || name === p.name) { pn.textContent = p.name; return; }
      p.name = name; renderSide();
      const { error } = await sb.from('ish_projects').update({ name }).eq('id', p.id);
      if (error) fail(error);
    };
  }
  if (v === 'board') renderBoard(); else if (v === 'calendar') renderCalendar(); else renderList();
}

function rowHTML(t, withProject){
  const subs = subsOf(t.id);
  const p = projectOf(t.project_id);
  return `<div class="row ${t.completed?'done':''} ${S.openTask===t.id?'sel':''}" data-id="${t.id}" draggable="${!withProject}">
    <div>${withProject?'':'<span class="grip">⋮⋮</span>'}<button class="cbx ${t.completed?'on':''}" data-done="${t.id}" aria-label="Bajarildi">✓</button><span class="tt">${esc(t.title)}</span>
      ${subs.length ? `<span class="meta">${subs.filter(s=>s.completed).length}/${subs.length} ⑃</span>` : ''}</div>
    <div>${withProject ? (p ? `<span class="ptag"><i style="background:${esc(p.color)}"></i>${esc(p.name)}</span>` : '') : avatar(t.assignee_id) + `<span class="ptag">${t.assignee_id ? esc(displayName(S.profiles[t.assignee_id])) : ''}</span>`}</div>
    <div>${dueHTML(t)}</div>
    <div>${t.priority ? `<span class="tag ${t.priority}">${PRIO[t.priority]}</span>` : ''}</div></div>`;
}

function renderList(){
  const secs = S.sections;
  const noSec = S.tasks.filter(t => taskVisible(t) && (!t.section_id || !secs.some(s => s.id === t.section_id))).sort((a,b)=>a.position-b.position);
  const block = (sec) => {
    const ts = sec ? S.tasks.filter(t => taskVisible(t) && t.section_id === sec.id).sort((a,b)=>a.position-b.position) : noSec;
    const key = sec ? sec.id : 'none';
    const closed = S.collapsed.has(key);
    return `<div class="sec" data-sec="${sec ? sec.id : ''}">
      <div class="sec-h ${closed?'closed':''}"><button class="tw" data-tw="${key}" aria-label="Yig'ish">▾</button>
        ${sec ? `<input value="${esc(sec.name)}" data-secname="${sec.id}" size="${Math.max(6, sec.name.length)}">` : '<span>Bo\'limsiz</span>'}
        <span class="cnt">${ts.length}</span>${sec ? `<button class="icon-btn x" data-secdel="${sec.id}" title="Bo'limni o'chirish">🗑</button>` : ''}</div>
      ${closed ? '' : `<div class="rows" data-drop="${sec ? sec.id : ''}">${ts.map(t => rowHTML(t, false)).join('')}</div>
      <button class="addrow" data-add="${sec ? sec.id : ''}">+ Vazifa qo'shish…</button>`}</div>`;
  };
  $('#pv').innerHTML = `<div class="list"><div class="lhead"><div>Vazifa nomi</div><div>Mas'ul</div><div>Muddat</div><div>Muhimlik</div></div>
    ${noSec.length ? block(null) : ''}${secs.map(block).join('')}
    <button class="btn addsec" id="addSec">+ Bo'lim qo'shish</button></div>`;
  bindRows(true);
  bindSections();
}

function bindRows(dnd){
  const root = $('#content');
  root.querySelectorAll('.row').forEach(el => el.onclick = e => { if (!e.target.closest('[data-done]')) openPane(el.dataset.id); });
  root.querySelectorAll('[data-done]').forEach(el => el.onclick = e => { e.stopPropagation(); toggleDone(el.dataset.done); });
  root.querySelectorAll('[data-add]').forEach(el => el.onclick = () => inlineAdd(el, el.dataset.add || null));
  if (!dnd) return;
  let dragId = null;
  root.querySelectorAll('.row[draggable=true]').forEach(el => {
    el.ondragstart = e => { dragId = el.dataset.id; el.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId); };
    el.ondragend = () => { el.classList.remove('dragging'); root.querySelectorAll('.drop-line').forEach(x => x.classList.remove('drop-line')); };
    el.ondragover = e => { if (!dragId) return; e.preventDefault(); root.querySelectorAll('.drop-line').forEach(x => x.classList.remove('drop-line')); el.classList.add('drop-line'); };
    el.ondrop = e => { e.preventDefault(); if (!dragId || dragId === el.dataset.id) return; const target = taskById(el.dataset.id); moveTask(dragId, target.section_id, el.dataset.id); dragId = null; };
  });
  root.querySelectorAll('.rows').forEach(z => {
    z.ondragover = e => { if (dragId && e.target === z) e.preventDefault(); };
    z.ondrop = e => { if (e.target !== z || !dragId) return; e.preventDefault(); moveTask(dragId, z.dataset.drop || null, null); dragId = null; };
  });
  root.querySelectorAll('.sec-h').forEach(h => {
    h.ondragover = e => { if (dragId) e.preventDefault(); };
    h.ondrop = e => { if (!dragId) return; e.preventDefault(); const sid = h.parentElement.dataset.sec || null; const first = S.tasks.filter(t => !t.parent_id && t.section_id === sid).sort((a,b)=>a.position-b.position)[0]; moveTask(dragId, sid, first?.id || null); dragId = null; };
  });
}

function bindSections(){
  const root = $('#content');
  root.querySelectorAll('[data-tw]').forEach(b => b.onclick = () => {
    const k = b.dataset.tw; S.collapsed.has(k) ? S.collapsed.delete(k) : S.collapsed.add(k);
    store.set('ish-collapsed', JSON.stringify([...S.collapsed])); render();
  });
  root.querySelectorAll('[data-secname]').forEach(inp => {
    inp.onkeydown = e => { if (e.key === 'Enter') inp.blur(); };
    inp.onblur = async () => {
      const sec = S.sections.find(s => s.id === inp.dataset.secname); const name = inp.value.trim();
      if (!name) { inp.value = sec.name; return; }
      if (name === sec.name) return;
      sec.name = name;
      await mutate(async () => { const { error } = await sb.from('ish_sections').update({ name }).eq('id', sec.id); if (error) fail(error); });
    };
  });
  root.querySelectorAll('[data-secdel]').forEach(b => b.onclick = async () => {
    const sec = S.sections.find(s => s.id === b.dataset.secdel);
    const n = S.tasks.filter(t => t.section_id === sec.id && !t.parent_id).length;
    if (!confirm(`«${sec.name}» bo'limi o'chirilsinmi?` + (n ? ` Undagi ${n} ta vazifa «Bo'limsiz» ga o'tadi.` : ''))) return;
    S.sections = S.sections.filter(s => s.id !== sec.id);
    S.tasks.forEach(t => { if (t.section_id === sec.id) t.section_id = null; });
    render();
    await mutate(async () => { const { error } = await sb.from('ish_sections').delete().eq('id', sec.id); if (error) { fail(error); refresh(); } });
  });
  const as = $('#addSec'); if (as) as.onclick = () => addSection();
}

async function addSection(name){
  name = name || prompt("Bo'lim nomi:", "Yangi bo'lim");
  if (!name?.trim()) return;
  const pos = (S.sections.at(-1)?.position || 0) + STEP;
  await mutate(async () => {
    const { data, error } = await sb.from('ish_sections').insert({ project_id: S.route.id, name: name.trim(), position: pos }).select().single();
    if (error) return fail(error);
    S.sections.push(data); render();
  });
}

function inlineAdd(btn, sectionId){
  const wrap = document.createElement('div');
  wrap.className = 'newrow'; wrap.style.padding = '6px 0 6px 30px';
  wrap.innerHTML = '<input placeholder="Vazifa nomini yozing va Enter bosing" maxlength="500">';
  btn.replaceWith(wrap);
  const inp = wrap.querySelector('input'); inp.focus();
  let done = false;
  const finish = async (keep) => {
    if (done) return;
    const title = inp.value.trim();
    if (!title) { done = true; render(); return; }
    inp.value = '';
    await createTask({ title, section_id: sectionId });
    if (keep) { const again = [...$('#content').querySelectorAll('[data-add]')].find(b => (b.dataset.add || null) === sectionId); if (again) inlineAdd(again, sectionId); }
  };
  inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); done = false; finish(true); } if (e.key === 'Escape') { done = true; render(); } };
  inp.onblur = () => setTimeout(() => { if (document.activeElement !== inp) finish(false); }, 100);
}

function addTaskPrompt(sectionId){
  if (S.route.view === 'list' || S.route.view === 'board') {
    const btn = [...$('#content').querySelectorAll('[data-add]')].find(b => (b.dataset.add || null) === sectionId) || $('#content').querySelector('[data-add]');
    if (btn) return inlineAdd(btn, btn.dataset.add || null);
  }
  const title = prompt('Vazifa nomi:'); if (title?.trim()) createTask({ title: title.trim(), section_id: sectionId }).then(t => t && openPane(t.id));
}

async function createTask(f, projectId = S.route.id){
  const siblings = S.tasks.filter(t => !t.parent_id && t.section_id === (f.section_id ?? null) && t.project_id === projectId);
  const pos = f.parent_id ? (subsOf(f.parent_id).at(-1)?.position || 0) + STEP : (siblings.reduce((m,t)=>Math.max(m,t.position),0) + STEP);
  return mutate(async () => {
    const { data, error } = await sb.from('ish_tasks').insert({ project_id: projectId, position: pos, ...f }).select().single();
    if (error) { fail(error, "Vazifa yaratilmadi"); return null; }
    if (S.route.name === 'project' && S.route.id === projectId || f.parent_id || data.assignee_id === S.user.id) S.tasks.push(data);
    render();
    return data;
  });
}

async function moveTask(id, sectionId, beforeId){
  const t = taskById(id); if (!t) return;
  const list = S.tasks.filter(x => !x.parent_id && x.id !== id && x.section_id === sectionId).sort((a,b)=>a.position-b.position);
  let pos;
  const i = beforeId ? list.findIndex(x => x.id === beforeId) : -1;
  if (i === -1) pos = (list.at(-1)?.position || 0) + STEP;
  else { const prev = list[i-1]?.position ?? (list[i].position - 2*STEP); pos = (prev + list[i].position) / 2; }
  const needRenumber = i > 0 && Math.abs(pos - list[i-1].position) < 1e-6;
  t.section_id = sectionId; t.position = pos; render();
  await mutate(async () => {
    const { error } = await sb.from('ish_tasks').update({ section_id: sectionId, position: pos }).eq('id', id);
    if (error) { fail(error); return refresh(); }
    if (needRenumber) {
      const all = S.tasks.filter(x => !x.parent_id && x.section_id === sectionId).sort((a,b)=>a.position-b.position);
      await Promise.all(all.map((x, k) => { x.position = (k+1)*STEP; return sb.from('ish_tasks').update({ position: x.position }).eq('id', x.id); }));
    }
  });
}

async function updateTask(id, patch){
  const t = taskById(id); if (!t) return;
  const old = { ...t };
  Object.assign(t, patch);
  if ('completed' in patch) t.completed_at = patch.completed ? new Date().toISOString() : null;
  render();
  return mutate(async () => {
    const { error } = await sb.from('ish_tasks').update(patch).eq('id', id);
    if (error) { Object.assign(t, old); render(); fail(error, "Saqlanmadi"); return false; }
    if (S.openTask === id) loadComments(true);
    return true;
  });
}
function toggleDone(id){ const t = taskById(id); if (t) updateTask(id, { completed: !t.completed }); }

// ---------- board ----------
function renderBoard(){
  const secs = S.sections;
  const noSec = S.tasks.filter(t => taskVisible(t) && (!t.section_id || !secs.some(s => s.id === t.section_id)));
  const col = (sec) => {
    const ts = (sec ? S.tasks.filter(t => taskVisible(t) && t.section_id === sec.id) : noSec).sort((a,b)=>a.position-b.position);
    return `<div class="bcol" data-sec="${sec ? sec.id : ''}"><div class="bcol-h">${sec ? `<input value="${esc(sec.name)}" data-secname="${sec.id}" style="border:0;background:none;font-weight:600;font:inherit;font-weight:600;flex:1;min-width:0">` : "<span style='flex:1'>Bo'limsiz</span>"}<span class="cnt">${ts.length}</span>${sec ? `<button class="icon-btn" data-secdel="${sec.id}" title="O'chirish">🗑</button>` : ''}</div>
      <div class="bcards" data-drop="${sec ? sec.id : ''}">${ts.map(t => cardHTML(t)).join('')}</div>
      <button class="addrow" data-add="${sec ? sec.id : ''}">+ Vazifa qo'shish</button></div>`;
  };
  $('#pv').innerHTML = `<div class="board">${noSec.length ? col(null) : ''}${secs.map(col).join('')}<button class="btn newcol" id="addSec">+ Bo'lim qo'shish</button></div>`;
  const root = $('#pv');
  root.querySelectorAll('.card').forEach(el => el.onclick = e => { if (!e.target.closest('[data-done]')) openPane(el.dataset.id); });
  root.querySelectorAll('[data-done]').forEach(el => el.onclick = e => { e.stopPropagation(); toggleDone(el.dataset.done); });
  root.querySelectorAll('[data-add]').forEach(el => el.onclick = () => inlineAdd(el, el.dataset.add || null));
  bindSections();
  let dragId = null;
  root.querySelectorAll('.card').forEach(el => {
    el.ondragstart = e => { dragId = el.dataset.id; el.classList.add('dragging'); e.dataTransfer.setData('text/plain', dragId); };
    el.ondragend = () => { el.classList.remove('dragging'); root.querySelectorAll('.over,.drop-line').forEach(x => x.classList.remove('over','drop-line')); };
  });
  root.querySelectorAll('.bcards').forEach(z => {
    z.ondragover = e => {
      if (!dragId) return; e.preventDefault();
      root.querySelectorAll('.over,.drop-line').forEach(x => x.classList.remove('over','drop-line'));
      const card = e.target.closest('.card'); if (card && card.dataset.id !== dragId) card.classList.add('drop-line'); else z.classList.add('over');
    };
    z.ondrop = e => {
      if (!dragId) return; e.preventDefault();
      const card = e.target.closest('.card');
      moveTask(dragId, z.dataset.drop || null, card && card.dataset.id !== dragId ? card.dataset.id : null); dragId = null;
    };
  });
}
function cardHTML(t){
  const subs = subsOf(t.id);
  return `<div class="card ${t.completed?'done':''} ${S.openTask===t.id?'sel':''}" data-id="${t.id}" draggable="true">
    <div class="top"><button class="cbx ${t.completed?'on':''}" data-done="${t.id}" aria-label="Bajarildi">✓</button><span class="tt">${esc(t.title)}</span></div>
    ${t.priority ? `<div><span class="tag ${t.priority}">${PRIO[t.priority]}</span></div>` : ''}
    <div class="bot">${avatar(t.assignee_id)}${dueHTML(t)}<span class="sp"></span>${subs.length ? `<span class="meta" style="color:var(--mut);font-size:12px">${subs.filter(s=>s.completed).length}/${subs.length} ⑃</span>` : ''}</div></div>`;
}

// ---------- calendar ----------
function renderCalendar(){
  if (!S.calMonth) { const d = new Date(); S.calMonth = new Date(d.getFullYear(), d.getMonth(), 1); }
  const m = S.calMonth;
  const start = new Date(m); start.setDate(1 - ((m.getDay() + 6) % 7));
  const p = projectOf(S.route.id);
  const byDay = {};
  S.tasks.filter(t => !t.parent_id && t.due_on).forEach(t => (byDay[t.due_on] ||= []).push(t));
  let cells = '';
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const k = ymd(d);
    const ts = byDay[k] || [];
    cells += `<div class="d ${d.getMonth()!==m.getMonth()?'out':''} ${k===today()?'today':''}" data-day="${k}"><span class="n">${d.getDate()}</span>
      ${ts.slice(0,4).map(t => `<button class="cal-t ${t.completed?'done':''}" data-id="${t.id}" draggable="true" style="background:${esc(p.color)}">${esc(t.title)}</button>`).join('')}
      ${ts.length > 4 ? `<span style="font-size:11px;color:var(--mut);padding:0 4px">+${ts.length-4} ta</span>` : ''}</div>`;
    if (i === 34 && new Date(start.getTime() + 35*864e5).getMonth() !== m.getMonth()) break;
  }
  $('#pv').innerHTML = `<div class="cal"><div class="cal-h"><button class="btn" id="calToday">Bugun</button><button class="icon-btn" id="calPrev">‹</button><button class="icon-btn" id="calNext">›</button><b>${MONTHS[m.getMonth()][0].toUpperCase()+MONTHS[m.getMonth()].slice(1)} ${m.getFullYear()}</b>
    <span style="color:var(--mut);font-size:13px">Kunga ikki marta bosing — yangi vazifa; vazifani boshqa kunga sudrang</span></div>
    <div class="cal-grid">${WDAYS.map(w => `<div class="dn">${w}</div>`).join('')}${cells}</div></div>`;
  $('#calPrev').onclick = () => { S.calMonth = new Date(m.getFullYear(), m.getMonth()-1, 1); render(); };
  $('#calNext').onclick = () => { S.calMonth = new Date(m.getFullYear(), m.getMonth()+1, 1); render(); };
  $('#calToday').onclick = () => { S.calMonth = null; render(); };
  const root = $('#pv');
  let dragId = null;
  root.querySelectorAll('.cal-t').forEach(b => {
    b.onclick = () => openPane(b.dataset.id);
    b.ondragstart = e => { dragId = b.dataset.id; e.dataTransfer.setData('text/plain', dragId); };
  });
  root.querySelectorAll('.d').forEach(c => {
    c.ondblclick = async e => { if (e.target.closest('.cal-t')) return; const title = prompt(`Vazifa nomi (${fmtDue(c.dataset.day)}):`); if (title?.trim()) createTask({ title: title.trim(), due_on: c.dataset.day, section_id: S.sections[0]?.id || null }); };
    c.ondragover = e => { if (dragId) { e.preventDefault(); c.classList.add('over'); } };
    c.ondragleave = () => c.classList.remove('over');
    c.ondrop = e => { e.preventDefault(); c.classList.remove('over'); if (dragId) updateTask(dragId, { due_on: c.dataset.day }); dragId = null; };
  });
}

// ---------- task pane ----------
async function openPane(id){
  if (!taskById(id)) {
    const { data } = await sb.from('ish_tasks').select('*').eq('id', id).maybeSingle();
    if (!data) return toast("Vazifa topilmadi yoki o'chirilgan");
    S.tasks.push(data);
    const { data: subs } = await sb.from('ish_tasks').select('*').eq('parent_id', id); S.tasks.push(...(subs||[]));
  }
  S.openTask = id; S.comments = [];
  $('#pane').hidden = false;
  render();
  loadComments(true);
}
function closePane(rerender = true){ S.openTask = null; $('#pane').hidden = true; $('#pane').innerHTML = ''; if (rerender) render(); }
let commentSeq = 0;
async function loadComments(rerender){
  const id = S.openTask; if (!id) return;
  const seq = ++commentSeq;
  const { data, error } = await sb.from('ish_comments').select('*').eq('task_id', id).order('created_at');
  if (seq !== commentSeq || S.openTask !== id) return;
  if (error) return fail(error);
  S.comments = data;
  const missing = [...new Set(data.map(c => c.author_id))].filter(u => u && !S.profiles[u]);
  if (missing.length) { const { data: pr } = await sb.from('profiles').select('id,email,full_name,avatar_url').in('id', missing); (pr||[]).forEach(p => S.profiles[p.id] = p); }
  if (rerender) renderFeed();
}

function renderPane(){
  const t = taskById(S.openTask); if (!t) return closePane();
  const pane = $('#pane');
  const p = projectOf(t.project_id);
  const parent = t.parent_id ? taskById(t.parent_id) : null;
  const mem = membersOf(t.project_id);
  const focused = document.activeElement && pane.contains(document.activeElement) ? document.activeElement.id : null;
  if (focused && ['ptitle','pdesc','cmtBox','subNew'].includes(focused)) { // yozilayotgan matnni buzmaslik uchun faqat qisman yangilaymiz
    updatePaneStatic(t); return;
  }
  const secs = S.route.name === 'project' ? S.sections : [];
  pane.innerHTML = `<div class="pane-top"><button class="donebtn ${t.completed?'on':''}" id="pDone">✓ ${t.completed ? 'Bajarildi' : 'Bajarildi deb belgilash'}</button><span class="sp"></span>
      <button class="icon-btn" id="pLink" title="Havolani nusxalash">🔗</button><button class="icon-btn" id="pDel" title="O'chirish">🗑</button><button class="icon-btn" id="pClose" title="Yopish">✕</button></div>
    <div class="pane-body">
      ${t.completed ? '<div class="done-banner">✓ Bu vazifa bajarilgan</div>' : ''}
      ${parent ? `<a href="javascript:void 0" id="pParent" style="color:var(--mut);font-size:13px">← ${esc(parent.title)}</a>` : ''}
      <textarea class="ptitle" id="ptitle" rows="1" maxlength="500">${esc(t.title)}</textarea>
      <div class="fields">
        <label>Mas'ul</label><div class="fld-who">${avatar(t.assignee_id)}<select id="pWho"><option value="">Mas'ul yo'q</option>${mem.map(m => `<option value="${m.user_id}" ${m.user_id===t.assignee_id?'selected':''}>${esc(displayName(S.profiles[m.user_id]))}${m.user_id===S.user.id?' (siz)':''}</option>`).join('')}</select></div>
        <label>Muddat</label><div class="fld-who"><input type="date" id="pDue" value="${t.due_on||''}">${t.due_on ? dueHTML(t) : ''}</div>
        <label>Loyiha</label><div><span class="ptag" style="font-size:13px"><i style="background:${esc(p?.color||'#999')}"></i>${esc(p?.name||'')}</span>
          ${!t.parent_id && secs.length ? `<select id="pSec"><option value="">Bo'limsiz</option>${secs.map(s => `<option value="${s.id}" ${s.id===t.section_id?'selected':''}>${esc(s.name)}</option>`).join('')}</select>` : ''}</div>
        <label>Muhimlik</label><div><select id="pPrio"><option value="">—</option>${Object.entries(PRIO).map(([k,l]) => `<option value="${k}" ${t.priority===k?'selected':''}>${l}</option>`).join('')}</select></div>
      </div>
      <div class="psec">Tavsif</div>
      <textarea class="desc" id="pdesc" placeholder="Bu vazifa nima haqida? Tafsilotlarni yozing…">${esc(t.description)}</textarea>
      ${t.parent_id ? '' : `<div class="psec">Kichik vazifalar</div><div class="subs" id="subs"></div>
      <div style="padding:6px 4px"><input id="subNew" placeholder="+ Kichik vazifa qo'shish (Enter)" maxlength="500" style="border:0;background:none;width:100%;padding:4px 0;outline:none"></div>`}
      <div class="feed" id="feed"></div>
    </div>
    <div class="cmt">${avatar(S.user.id)}<textarea id="cmtBox" placeholder="Izoh qo'shing… (Ctrl+Enter — yuborish)" maxlength="5000"></textarea><button class="btn primary" id="cmtSend">Yuborish</button></div>`;
  const ta = $('#ptitle'); const fit = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }; fit();
  ta.oninput = fit;
  ta.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); ta.blur(); } };
  ta.onblur = () => { const v = ta.value.trim(); if (!v) { ta.value = t.title; return; } if (v !== t.title) updateTask(t.id, { title: v }); };
  $('#pdesc').onblur = e => { if (e.target.value !== t.description) updateTask(t.id, { description: e.target.value }); };
  $('#pDone').onclick = () => toggleDone(t.id);
  $('#pClose').onclick = () => closePane();
  $('#pLink').onclick = () => { navigator.clipboard?.writeText(`${location.origin}${location.pathname}#/p/${t.project_id}?t=${t.id}`).then(() => toast('Havola nusxalandi'), () => toast('Nusxalab bo\'lmadi')); };
  $('#pDel').onclick = async () => {
    if (!confirm(`«${t.title}» o'chirilsinmi? Kichik vazifalar va izohlar ham o'chadi.`)) return;
    const ids = [t.id, ...subsOf(t.id).map(s => s.id)];
    S.tasks = S.tasks.filter(x => !ids.includes(x.id)); closePane();
    await mutate(async () => { const { error } = await sb.from('ish_tasks').delete().eq('id', t.id); if (error) { fail(error); refresh(); } else toast("Vazifa o'chirildi"); });
  };
  $('#pWho').onchange = e => updateTask(t.id, { assignee_id: e.target.value || null });
  $('#pDue').onchange = e => updateTask(t.id, { due_on: e.target.value || null });
  $('#pPrio').onchange = e => updateTask(t.id, { priority: e.target.value || null });
  const ps = $('#pSec'); if (ps) ps.onchange = e => moveTask(t.id, e.target.value || null, null);
  const pp = $('#pParent'); if (pp) pp.onclick = () => openPane(parent.id);
  const sn = $('#subNew');
  if (sn) sn.onkeydown = async e => {
    if (e.key !== 'Enter' || !sn.value.trim()) return;
    const title = sn.value.trim(); sn.value = '';
    await createTask({ title, parent_id: t.id, section_id: null }, t.project_id);
    $('#subNew')?.focus();
  };
  const send = async () => {
    const box = $('#cmtBox'); const body = box.value.trim(); if (!body) return;
    box.value = ''; $('#cmtSend').disabled = true;
    const { error } = await sb.from('ish_comments').insert({ task_id: t.id, project_id: t.project_id, body });
    $('#cmtSend').disabled = false;
    if (error) { box.value = body; return fail(error, 'Izoh yuborilmadi'); }
    loadComments(true);
  };
  $('#cmtSend').onclick = send;
  $('#cmtBox').onkeydown = e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } };
  renderSubs(t); renderFeed();
}
function updatePaneStatic(t){
  const b = $('#pDone'); if (b) { b.classList.toggle('on', t.completed); b.textContent = '✓ ' + (t.completed ? 'Bajarildi' : 'Bajarildi deb belgilash'); }
  renderSubs(t); renderFeed();
}
function renderSubs(t){
  const box = $('#subs'); if (!box) return;
  box.innerHTML = subsOf(t.id).map(s => `<div class="sub ${s.completed?'done':''}"><button class="cbx ${s.completed?'on':''}" data-sd="${s.id}">✓</button><span class="tt" data-so="${s.id}">${esc(s.title)}</span>${avatar(s.assignee_id)}${dueHTML(s)}</div>`).join('');
  box.querySelectorAll('[data-sd]').forEach(b => b.onclick = () => toggleDone(b.dataset.sd));
  box.querySelectorAll('[data-so]').forEach(b => b.onclick = () => openPane(b.dataset.so));
}
function renderFeed(){
  const f = $('#feed'); if (!f) return;
  const t = taskById(S.openTask);
  f.innerHTML = S.comments.map(c => c.kind === 'activity'
    ? `<div class="ev act"><span style="width:24px;text-align:center">•</span><div class="b"><b>${esc(displayName(S.profiles[c.author_id]))}</b> ${esc(c.body)} <time>${ago(c.created_at)}</time></div></div>`
    : `<div class="ev">${avatar(c.author_id)}<div class="b"><b>${esc(displayName(S.profiles[c.author_id]))}</b><time>${ago(c.created_at)}</time>${c.author_id===S.user.id?`<button class="del" data-cdel="${c.id}">o'chirish</button>`:''}<p>${esc(c.body)}</p></div></div>`).join('')
    || `<div style="color:var(--mut);font-size:13px">${t ? 'Faoliyat yuklanmoqda…' : ''}</div>`;
  f.querySelectorAll('[data-cdel]').forEach(b => b.onclick = async () => {
    S.comments = S.comments.filter(c => c.id !== b.dataset.cdel); renderFeed();
    const { error } = await sb.from('ish_comments').delete().eq('id', b.dataset.cdel); if (error) { fail(error); loadComments(true); }
  });
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && S.openTask && !e.target.closest('input,textarea,[contenteditable]') && $('#modal').hidden) closePane();
});

// ---------- search ----------
const doSearch = debounce(async q => {
  const box = $('#searchRes');
  if (q.length < 2) { box.hidden = true; return; }
  const { data, error } = await sb.from('ish_tasks').select('id,title,project_id,completed').ilike('title', `%${q.replace(/[%_\\]/g, m => '\\' + m)}%`).limit(12);
  if (error) return fail(error);
  const ps = S.projects.filter(p => p.name.toLowerCase().includes(q.toLowerCase()));
  box.innerHTML = [...ps.map(p => `<button data-p="${p.id}"><i class="sq" style="width:12px;height:12px;border-radius:3px;background:${esc(p.color)}"></i>${esc(p.name)}</button>`),
    ...data.map(t => `<button data-t="${t.id}" data-tp="${t.project_id}"><span class="cbx ${t.completed?'on':''}">✓</span>${esc(t.title)}<span class="ptag" style="margin-left:auto">${esc(projectOf(t.project_id)?.name||'')}</span></button>`)].join('')
    || '<div class="empty">Hech narsa topilmadi</div>';
  box.hidden = false;
  box.querySelectorAll('[data-p]').forEach(b => b.onclick = () => { box.hidden = true; $('#searchInput').value = ''; go('#/p/' + b.dataset.p); });
  box.querySelectorAll('[data-t]').forEach(b => b.onclick = async () => {
    box.hidden = true; $('#searchInput').value = '';
    if (!(S.route.name === 'project' && S.route.id === b.dataset.tp)) { location.hash = '#/p/' + b.dataset.tp; await waitRoute(); }
    openPane(b.dataset.t);
  });
}, 250);
$('#searchInput').oninput = e => doSearch(e.target.value.trim());
$('#searchInput').onfocus = e => { if (e.target.value.trim().length >= 2) $('#searchRes').hidden = false; };

// ---------- modals ----------
function modal(html, bind){
  $('#modalBody').innerHTML = html; $('#modal').hidden = false;
  const close = () => { $('#modal').hidden = true; $('#modalBody').innerHTML = ''; };
  $('#modal').onclick = e => { if (e.target.id === 'modal') close(); };
  $('#modalBody').onkeydown = e => { if (e.key === 'Escape') close(); };
  $('#modalBody').querySelectorAll('[data-close]').forEach(b => b.onclick = close);
  bind(close);
  $('#modalBody').querySelector('input,select,button')?.focus();
}
function projectModal(p){
  let color = p?.color || COLORS[S.projects.length % COLORS.length];
  modal(`<h2>${p ? 'Loyiha sozlamalari' : 'Yangi loyiha'}</h2>
    <div class="f"><label for="mpName">Loyiha nomi</label><input type="text" id="mpName" maxlength="120" value="${esc(p?.name||'')}" placeholder="Masalan: Marketing rejasi"></div>
    <div class="f"><label>Rang</label><div class="colors">${COLORS.map(c => `<button type="button" data-c="${c}" style="background:${c}" class="${c===color?'on':''}" aria-label="${c}"></button>`).join('')}</div></div>
    <div class="acts">${p ? '<button class="btn danger" id="mpDel" style="margin-right:auto">Loyihani o\'chirish</button>' : ''}<button class="btn" data-close>Bekor qilish</button><button class="btn primary" id="mpOk">${p ? 'Saqlash' : 'Yaratish'}</button></div>`, close => {
    $('#modalBody').querySelectorAll('[data-c]').forEach(b => b.onclick = () => { color = b.dataset.c; $('#modalBody').querySelectorAll('[data-c]').forEach(x => x.classList.toggle('on', x === b)); });
    const ok = async () => {
      const name = $('#mpName').value.trim(); if (!name) return $('#mpName').focus();
      $('#mpOk').disabled = true;
      if (p) {
        const { error } = await sb.from('ish_projects').update({ name, color }).eq('id', p.id);
        if (error) { $('#mpOk').disabled = false; return fail(error); }
        Object.assign(p, { name, color }); close(); renderSide(); render();
      } else {
        const { data: id, error } = await sb.rpc('ish_create_project', { p_name: name, p_color: color });
        if (error) { $('#mpOk').disabled = false; return fail(error, 'Loyiha yaratilmadi'); }
        close(); await loadProjects(); go('#/p/' + id + '/list');
      }
    };
    $('#mpOk').onclick = ok;
    $('#mpName').onkeydown = e => { if (e.key === 'Enter') ok(); };
    const del = $('#mpDel');
    if (del) del.onclick = async () => {
      if (prompt(`Loyiha va undagi BARCHA vazifalar butunlay o'chadi. Tasdiqlash uchun loyiha nomini yozing: ${p.name}`) !== p.name) return toast('Nom mos kelmadi — o\'chirilmadi');
      const { error } = await sb.from('ish_projects').delete().eq('id', p.id);
      if (error) return fail(error);
      close(); await loadProjects(); go('#/home');
    };
  });
}
function membersModal(pid){
  const own = isOwner(pid);
  const draw = () => modal(`<h2>«${esc(projectOf(pid).name)}» a'zolari</h2>
    ${own ? `<div class="f"><label for="mmEmail">Email orqali taklif qilish</label><div style="display:flex;gap:8px"><input type="email" id="mmEmail" placeholder="ism@gmail.com" style="flex:1"><button class="btn primary" id="mmAdd">Qo'shish</button></div>
      <small style="color:var(--mut)">Odam avval saytga Google orqali bir marta kirgan bo'lishi kerak.</small></div>` : ''}
    <div>${membersOf(pid).map(m => { const pr = S.profiles[m.user_id]; return `<div class="mrow">${avatar(m.user_id,'av lg')}<div class="b">${esc(displayName(pr))}${m.user_id===S.user.id?' (siz)':''}<small>${esc(pr?.email||'')}</small></div>
      <span style="color:var(--mut);font-size:13px">${m.role==='owner'?'Egasi':"A'zo"}</span>
      ${m.role!=='owner' && (own || m.user_id===S.user.id) ? `<button class="icon-btn" data-rm="${m.user_id}" title="${m.user_id===S.user.id?'Loyihadan chiqish':'Chiqarish'}">✕</button>` : ''}</div>`; }).join('')}</div>
    <div class="acts"><button class="btn" data-close>Yopish</button></div>`, close => {
    const add = $('#mmAdd');
    if (add) {
      const go2 = async () => {
        const email = $('#mmEmail').value.trim(); if (!email) return;
        add.disabled = true;
        const { error } = await sb.rpc('ish_add_member', { p_project: pid, p_email: email });
        add.disabled = false;
        if (error) return fail(error, "Qo'shilmadi");
        toast("A'zo qo'shildi"); await loadProjects(); draw();
      };
      add.onclick = go2; $('#mmEmail').onkeydown = e => { if (e.key === 'Enter') go2(); };
    }
    $('#modalBody').querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => {
      const self = b.dataset.rm === S.user.id;
      if (!confirm(self ? 'Loyihadan chiqasizmi?' : "Bu a'zoni loyihadan chiqarasizmi? Unga biriktirilgan vazifalar mas'ulsiz qoladi.")) return;
      const { error } = await sb.from('ish_members').delete().eq('project_id', pid).eq('user_id', b.dataset.rm);
      if (error) return fail(error);
      await loadProjects();
      if (self) { close(); go('#/home'); } else { if (S.route.id === pid) await loadProjectData(pid); render(); draw(); }
    });
  });
  draw();
}
function quickTaskModal(){
  const cur = S.route.name === 'project' ? S.route.id : (store.get('ish-lastproj') || S.projects[0].id);
  modal(`<h2>Yangi vazifa</h2>
    <div class="f"><label for="qtTitle">Vazifa nomi</label><input type="text" id="qtTitle" maxlength="500"></div>
    <div class="f"><label for="qtProj">Loyiha</label><select id="qtProj">${S.projects.map(p => `<option value="${p.id}" ${p.id===cur?'selected':''}>${esc(p.name)}</option>`).join('')}</select></div>
    <div class="f"><label for="qtDue">Muddat</label><input type="date" id="qtDue" style="border:1px solid var(--line2);border-radius:6px;padding:7px 10px;background:var(--bg)"></div>
    <label class="chk" style="margin-bottom:10px"><input type="checkbox" id="qtMe" checked> Menga biriktirish</label>
    <div class="acts"><button class="btn" data-close>Bekor qilish</button><button class="btn primary" id="qtOk">Yaratish</button></div>`, close => {
    $('#qtTitle').focus();
    const ok = async () => {
      const title = $('#qtTitle').value.trim(); if (!title) return $('#qtTitle').focus();
      const pid = $('#qtProj').value; store.set('ish-lastproj', pid);
      $('#qtOk').disabled = true;
      const { data: secs } = await sb.from('ish_sections').select('id,position').eq('project_id', pid).order('position').limit(1);
      const t = await createTask({ title, section_id: secs?.[0]?.id || null, due_on: $('#qtDue').value || null, assignee_id: $('#qtMe').checked ? S.user.id : null }, pid);
      close();
      if (t) { toast('Vazifa yaratildi'); if (S.route.name !== 'project') { await loadMyTasks(); render(); } }
    };
    $('#qtOk').onclick = ok; $('#qtTitle').onkeydown = e => { if (e.key === 'Enter') ok(); };
  });
}
})();
