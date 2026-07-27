import { DEMO_MODE, getFirebase } from './firebase-config.js';
import { OWNER_UID } from './site-config.js';
import { DEMO_OWNER, DEMO_PARTNER, DEMO_REQUESTS } from './demo-data.js';
import { DAY_KEYS, DAY_LABELS, getBusyIntervalsForDate, getFreeIntervalsForDate, getMutualFreeForDate, applyTravelBuffer } from './schedule-utils.js';
import { startOfWeek, buildWeekDates, renderWeekTimelines, renderHourTicks, weekRangeLabel } from './timeline-view.js';

let currentUid = null;
let myDoc = null;
let partnerDoc = null;
let cvWeekStart = startOfWeek(new Date());
let demoRequests = DEMO_REQUESTS.map(r => ({ ...r }));

function defaultScheduleDoc(displayName) {
  return {
    displayName: displayName || '',
    role: 'owner',
    public: false,
    partnerUid: '',
    travelBufferMinutes: 60,
    weekly: { sun: [], mon: [], tue: [], wed: [], thu: [], fri: [], sat: [] },
    overrides: [],
  };
}

function showToast(msg) {
  const root = document.getElementById('toastRoot');
  root.innerHTML = `<div class="toast">${msg}</div>`;
  setTimeout(() => { root.innerHTML = ''; }, 3200);
}

async function saveMyDoc() {
  if (DEMO_MODE) { showToast("Demo mode — changes aren't saved."); return; }
  const { db, dbMod } = await getFirebase();
  await dbMod.setDoc(dbMod.doc(db, 'schedules', currentUid), myDoc);
}

function daySegments(schedule, date) {
  const busy = getBusyIntervalsForDate(schedule, date).map(b => ({ ...b, type: 'busy' }));
  const free = getFreeIntervalsForDate(schedule, date).map(f => ({ ...f, type: 'free' }));
  return [...busy, ...free].sort((a, b) => a.start - b.start);
}

function buildMutualSegments(usable) {
  const segs = [];
  let cursor = 0;
  for (const iv of [...usable].sort((a, b) => a.start - b.start)) {
    if (iv.start > cursor) segs.push({ start: cursor, end: iv.start, type: 'busy' });
    segs.push({ start: iv.start, end: iv.end, type: 'mutual' });
    cursor = iv.end;
  }
  if (cursor < 1440) segs.push({ start: cursor, end: 1440, type: 'busy' });
  return segs;
}

// ---------- Tabs ----------
document.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', () => {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.tab-panel').forEach(p => (p.style.display = 'none'));
  document.getElementById('panel-' + btn.dataset.tab).style.display = 'block';
}));

// ---------- Weekly editor ----------
function renderWeeklyEditor() {
  const container = document.getElementById('weeklyEditor');
  container.innerHTML = '';
  for (const day of DAY_KEYS) {
    const blocks = myDoc.weekly[day] || (myDoc.weekly[day] = []);
    const dayWrap = document.createElement('div');
    dayWrap.style.marginBottom = '14px';
    const rows = blocks.map((b, i) => `
      <div class="block-row" data-day="${day}" data-idx="${i}">
        <input type="time" class="b-start" value="${b.start}" style="width:110px" />
        <span>to</span>
        <input type="time" class="b-end" value="${b.end}" style="width:110px" />
        <label style="display:flex;align-items:center;gap:4px"><input type="checkbox" class="b-next" ${b.endNextDay ? 'checked' : ''}/> ends next day</label>
        <input class="b-label grow" placeholder="label" value="${b.label || ''}" maxlength="30" />
        <button class="btn danger small b-del" type="button">Remove</button>
      </div>`).join('');
    dayWrap.innerHTML = `
      <div style="font-weight:600;margin-bottom:4px">${DAY_LABELS[day]}</div>
      ${rows || '<div class="empty-state" style="padding:6px 0">No shifts — assumed free all day</div>'}
      <button class="btn secondary small b-add" type="button" data-day="${day}" style="margin-top:6px">+ Add shift</button>
    `;
    container.appendChild(dayWrap);
  }

  container.querySelectorAll('.b-add').forEach(btn => btn.addEventListener('click', () => {
    myDoc.weekly[btn.dataset.day].push({ start: '09:00', end: '17:00', label: '' });
    renderWeeklyEditor();
    saveMyDoc();
    renderCombinedView();
  }));

  container.querySelectorAll('.b-del').forEach(btn => btn.addEventListener('click', () => {
    const row = btn.closest('.block-row');
    myDoc.weekly[row.dataset.day].splice(Number(row.dataset.idx), 1);
    renderWeeklyEditor();
    saveMyDoc();
    renderCombinedView();
  }));

  container.querySelectorAll('.block-row').forEach(row => {
    const block = myDoc.weekly[row.dataset.day][row.dataset.idx];
    row.querySelector('.b-start').addEventListener('change', e => { block.start = e.target.value; saveMyDoc(); renderCombinedView(); });
    row.querySelector('.b-end').addEventListener('change', e => { block.end = e.target.value; saveMyDoc(); renderCombinedView(); });
    row.querySelector('.b-next').addEventListener('change', e => { block.endNextDay = e.target.checked; saveMyDoc(); renderCombinedView(); });
    row.querySelector('.b-label').addEventListener('change', e => { block.label = e.target.value; saveMyDoc(); });
  });
}

// ---------- Overrides ----------
function renderOverridesList() {
  const container = document.getElementById('overridesList');
  const overrides = [...(myDoc.overrides || [])].sort((a, b) => a.date.localeCompare(b.date));
  if (!overrides.length) {
    container.innerHTML = '<div class="empty-state">No exceptions added</div>';
    return;
  }
  container.innerHTML = overrides.map((o, i) => `
    <div class="block-row">
      <span class="grow">${o.date} · ${o.type === 'busy' ? 'Busy' : 'Available'} ${o.start}–${o.end}${o.label ? ' · ' + o.label : ''}</span>
      <button class="btn danger small" type="button" data-real-idx="${myDoc.overrides.indexOf(o)}">Remove</button>
    </div>`).join('');
  container.querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => {
    myDoc.overrides.splice(Number(btn.dataset.realIdx), 1);
    renderOverridesList();
    saveMyDoc();
    renderCombinedView();
  }));
}

document.getElementById('overrideForm').addEventListener('submit', e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const start = fd.get('start'), end = fd.get('end');
  if (start >= end) { showToast('End time must be after start time.'); return; }
  myDoc.overrides.push({
    date: fd.get('date'), type: fd.get('type'), start, end, label: (fd.get('label') || '').trim(),
  });
  e.target.reset();
  e.target.start.value = '09:00';
  e.target.end.value = '17:00';
  renderOverridesList();
  saveMyDoc();
  renderCombinedView();
});

// ---------- Settings ----------
function renderSettingsForm() {
  const form = document.getElementById('settingsForm');
  form.displayName.value = myDoc.displayName || '';
  form.public.checked = !!myDoc.public;
  form.partnerUid.value = myDoc.partnerUid || '';
  form.travelBufferMinutes.value = myDoc.travelBufferMinutes ?? 60;
}

document.getElementById('settingsForm').addEventListener('submit', async e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const prevPartnerUid = myDoc.partnerUid;
  myDoc.displayName = fd.get('displayName').trim();
  myDoc.public = fd.get('public') === 'on';
  myDoc.partnerUid = fd.get('partnerUid').trim();
  myDoc.travelBufferMinutes = Number(fd.get('travelBufferMinutes')) || 0;
  await saveMyDoc();
  document.getElementById('whoami').textContent = `Logged in as ${myDoc.displayName || currentUid}`;
  if (myDoc.partnerUid !== prevPartnerUid) await loadPartnerDoc();
  renderCombinedView();
  const saved = document.getElementById('settingsSaved');
  saved.style.display = 'inline';
  setTimeout(() => (saved.style.display = 'none'), 2000);
});

// ---------- Combined view ----------
function renderCombinedView() {
  document.getElementById('cvWeekLabel').textContent = weekRangeLabel(cvWeekStart);
  const noPartner = document.getElementById('noPartnerNotice');
  const wrap = document.getElementById('combinedWrap');
  if (!partnerDoc) {
    noPartner.style.display = 'block';
    wrap.style.display = 'none';
    return;
  }
  noPartner.style.display = 'none';
  wrap.style.display = 'block';

  for (const id of ['hourTicksYou', 'hourTicksPartner', 'hourTicksMutual']) {
    const el = document.getElementById(id);
    el.innerHTML = '';
    el.appendChild(renderHourTicks());
  }

  const dates = buildWeekDates(cvWeekStart);
  const buffer = myDoc.travelBufferMinutes ?? 60;

  renderWeekTimelines(document.getElementById('timelineYou'), dates.map(date => ({ date, segments: daySegments(myDoc, date) })));
  renderWeekTimelines(document.getElementById('timelinePartner'), dates.map(date => ({ date, segments: daySegments(partnerDoc, date) })));
  renderWeekTimelines(document.getElementById('timelineMutual'), dates.map(date => {
    const raw = getMutualFreeForDate(myDoc, partnerDoc, date);
    const usable = applyTravelBuffer(raw, buffer);
    return { date, segments: buildMutualSegments(usable) };
  }));
}

document.getElementById('cvPrevWeek').addEventListener('click', () => { cvWeekStart.setDate(cvWeekStart.getDate() - 7); renderCombinedView(); });
document.getElementById('cvNextWeek').addEventListener('click', () => { cvWeekStart.setDate(cvWeekStart.getDate() + 7); renderCombinedView(); });
document.getElementById('cvThisWeek').addEventListener('click', () => { cvWeekStart = startOfWeek(new Date()); renderCombinedView(); });

// ---------- Requests ----------
async function renderRequests() {
  const container = document.getElementById('requestsList');
  let requests;
  if (DEMO_MODE) {
    requests = demoRequests;
  } else {
    const { db, dbMod } = await getFirebase();
    const snap = await dbMod.getDocs(dbMod.collection(db, 'requests'));
    requests = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }
  requests.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));

  if (!requests.length) {
    container.innerHTML = '<div class="empty-state">No requests yet</div>';
    return;
  }

  container.innerHTML = requests.map(r => `
    <div class="block-row" data-id="${r.id}">
      <span class="grow">
        <strong>${escapeHtml(r.name)}</strong> (${escapeHtml(r.contact)}) — ${r.date} ${r.start}-${r.end}
        ${r.note ? '· ' + escapeHtml(r.note) : ''}
        <span class="pill ${r.status}">${r.status}</span>
      </span>
      ${r.status === 'pending' ? `
        <button class="btn small approve-btn" type="button">Approve</button>
        <button class="btn secondary small decline-btn" type="button">Decline</button>
      ` : ''}
    </div>`).join('');

  container.querySelectorAll('.approve-btn').forEach(btn => btn.addEventListener('click', () => updateRequest(btn.closest('.block-row').dataset.id, 'approved')));
  container.querySelectorAll('.decline-btn').forEach(btn => btn.addEventListener('click', () => updateRequest(btn.closest('.block-row').dataset.id, 'declined')));
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function updateRequest(id, status) {
  if (DEMO_MODE) {
    const r = demoRequests.find(x => x.id === id);
    if (r) r.status = status;
    if (status === 'approved' && r) {
      myDoc.overrides.push({ date: r.date, type: 'busy', start: r.start, end: r.end, label: 'Request: ' + r.name });
      renderOverridesList();
      renderCombinedView();
    }
    renderRequests();
    return;
  }
  const { db, dbMod } = await getFirebase();
  const reqSnap = await dbMod.getDoc(dbMod.doc(db, 'requests', id));
  const r = reqSnap.data();
  await dbMod.updateDoc(dbMod.doc(db, 'requests', id), { status });
  if (status === 'approved' && r) {
    const entry = { date: r.date, type: 'busy', start: r.start, end: r.end, label: 'Request: ' + r.name };
    await dbMod.updateDoc(dbMod.doc(db, 'schedules', OWNER_UID), { overrides: dbMod.arrayUnion(entry) });
    if (currentUid === OWNER_UID) {
      myDoc.overrides.push(entry);
      renderOverridesList();
      renderCombinedView();
    }
  }
  renderRequests();
}

// ---------- Logout ----------
document.getElementById('logoutBtn').addEventListener('click', async () => {
  if (DEMO_MODE) { window.location.href = 'index.html'; return; }
  const { auth, authMod } = await getFirebase();
  await authMod.signOut(auth);
  window.location.href = 'login.html';
});

// ---------- Init ----------
function initAll() {
  renderWeeklyEditor();
  renderOverridesList();
  renderSettingsForm();
  renderCombinedView();
  renderRequests();
}

async function loadPartnerDoc() {
  if (!myDoc.partnerUid) { partnerDoc = null; return; }
  if (DEMO_MODE) { partnerDoc = DEMO_PARTNER; return; }
  const { db, dbMod } = await getFirebase();
  const snap = await dbMod.getDoc(dbMod.doc(db, 'schedules', myDoc.partnerUid));
  partnerDoc = snap.exists() ? snap.data() : null;
}

async function boot() {
  if (DEMO_MODE) {
    document.getElementById('demoBanner').style.display = 'block';
    currentUid = 'demo-owner';
    myDoc = JSON.parse(JSON.stringify(DEMO_OWNER));
    document.getElementById('whoami').textContent = `Logged in as ${myDoc.displayName} (demo)`;
    await loadPartnerDoc();
    initAll();
    return;
  }

  const { auth, authMod, db, dbMod } = await getFirebase();
  authMod.onAuthStateChanged(auth, async user => {
    if (!user) { window.location.href = 'login.html'; return; }
    currentUid = user.uid;
    const ref = dbMod.doc(db, 'schedules', currentUid);
    const snap = await dbMod.getDoc(ref);
    if (snap.exists()) {
      myDoc = snap.data();
    } else {
      myDoc = defaultScheduleDoc(user.email);
      await dbMod.setDoc(ref, myDoc);
    }
    document.getElementById('whoami').textContent = `Logged in as ${myDoc.displayName || user.email}`;
    await loadPartnerDoc();
    initAll();
  });
}

boot();
