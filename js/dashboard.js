import { DEMO_MODE, getFirebase } from './firebase-config.js';
import { OWNER_UID } from './site-config.js';
import { DEMO_OWNER, DEMO_PARTNER, DEMO_REQUESTS } from './demo-data.js';
import { DAY_KEYS, DAY_LABELS, getBusyIntervalsForDate, getFreeIntervalsForDate, getMutualFreeForDate, applyTravelBuffer, formatDate, minutesToLabel, timeToMin } from './schedule-utils.js';
import { startOfWeek, buildWeekDates, renderWeekTimelines, renderHourTicks, weekRangeLabel } from './timeline-view.js';

let currentUid = null;
let myDoc = null;
let partnerDoc = null;
let cvWeekStart = startOfWeek(new Date());
let msWeekStart = startOfWeek(new Date());
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
        <label style="display:flex;align-items:center;gap:4px"><input type="checkbox" class="b-work" ${b.category === 'work' ? 'checked' : ''}/> work shift</label>
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
    renderMyScheduleTimeline();
  }));

  container.querySelectorAll('.b-del').forEach(btn => btn.addEventListener('click', () => {
    const row = btn.closest('.block-row');
    myDoc.weekly[row.dataset.day].splice(Number(row.dataset.idx), 1);
    renderWeeklyEditor();
    saveMyDoc();
    renderCombinedView();
    renderMyScheduleTimeline();
  }));

  container.querySelectorAll('.block-row').forEach(row => {
    const block = myDoc.weekly[row.dataset.day][row.dataset.idx];
    row.querySelector('.b-start').addEventListener('change', e => { block.start = e.target.value; saveMyDoc(); renderCombinedView(); renderMyScheduleTimeline(); });
    row.querySelector('.b-end').addEventListener('change', e => { block.end = e.target.value; saveMyDoc(); renderCombinedView(); renderMyScheduleTimeline(); });
    row.querySelector('.b-next').addEventListener('change', e => { block.endNextDay = e.target.checked; saveMyDoc(); renderCombinedView(); renderMyScheduleTimeline(); });
    row.querySelector('.b-work').addEventListener('change', e => {
      if (e.target.checked) block.category = 'work'; else delete block.category;
      saveMyDoc(); renderCombinedView(); renderMyScheduleTimeline();
    });
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
  container.innerHTML = overrides.map((o, i) => {
    const dot = o.type === 'busy' ? `<span class="swatch ${o.category === 'work' ? 'work' : 'busy'}" style="margin-right:2px"></span>` : '';
    const typeLabel = o.type === 'busy' ? (o.category === 'work' ? 'Work' : 'Busy') : 'Available';
    const nextDay = o.endNextDay ? ' (ends next day)' : '';
    return `
    <div class="block-row">
      <span class="grow">${dot}${o.date} · ${typeLabel} ${o.start}–${o.end}${nextDay}${o.label ? ' · ' + o.label : ''}</span>
      <button class="btn danger small" type="button" data-real-idx="${myDoc.overrides.indexOf(o)}">Remove</button>
    </div>`;
  }).join('');
  container.querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => {
    myDoc.overrides.splice(Number(btn.dataset.realIdx), 1);
    renderOverridesList();
    saveMyDoc();
    renderCombinedView();
    renderMyScheduleTimeline();
  }));
}

// "Ends next day" and "Work shift" only make sense for busy entries — hide them otherwise.
document.querySelector('#overrideForm select[name=type]').addEventListener('change', e => {
  const isBusy = e.target.value === 'busy';
  document.getElementById('ovEndNextDay').closest('label').style.display = isBusy ? 'flex' : 'none';
  document.getElementById('ovWorkLabel').style.display = isBusy ? 'flex' : 'none';
});

document.getElementById('overrideForm').addEventListener('submit', e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const type = fd.get('type');
  const start = fd.get('start'), end = fd.get('end');
  const endNextDay = type === 'busy' && fd.get('endNextDay') === 'on';
  if (!endNextDay && start >= end) { showToast('End time must be after start time.'); return; }
  const entry = { date: fd.get('date'), type, start, end, label: (fd.get('label') || '').trim() };
  if (type === 'busy') {
    entry.endNextDay = endNextDay;
    if (fd.get('work') === 'on') entry.category = 'work';
  }
  myDoc.overrides.push(entry);
  e.target.reset();
  e.target.start.value = '09:00';
  document.getElementById('ovEnd').value = '17:00';
  renderOverridesList();
  saveMyDoc();
  renderCombinedView();
  renderMyScheduleTimeline();
});

// ---------- My Schedule timeline (click-to-edit, for rotating shifts) ----------
function renderMyScheduleTimeline() {
  document.getElementById('msWeekLabel').textContent = weekRangeLabel(msWeekStart);
  const ticks = document.getElementById('msHourTicks');
  ticks.innerHTML = '';
  ticks.appendChild(renderHourTicks());

  const days = buildWeekDates(msWeekStart).map(date => ({ date, segments: daySegments(myDoc, date) }));
  renderWeekTimelines(document.getElementById('msTimelineContainer'), days, {
    onSegmentClick: (date, seg) => openShiftModal(date, seg),
    clickableTypes: ['free', 'busy'],
  });
}

function openShiftModal(date, seg) {
  // Clamped to 23:59 for <input type=time>, which can't represent 24:00.
  const toTimeInput = m => {
    const clamped = Math.min(m, 1439);
    return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
  };
  // Unclamped — for writing the exact segment bounds into an override (no <input> involved).
  const rawTimeStr = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const endLabel = seg.end >= 1440 ? '11:59PM' : minutesToLabel(seg.end);
  const dateStr = formatDate(date);
  const root = document.getElementById('modalRoot');

  const prevDateObj = new Date(date);
  prevDateObj.setDate(prevDateObj.getDate() - 1);
  const prevDateStr = formatDate(prevDateObj);

  // Overrides of the given type overlapping [rangeStart, rangeEnd) on this date — including a
  // previous-day override that spills into this date via "ends next day". Used so adding a
  // shift removes any conflicting "available" hole (instead of the hole silently cancelling
  // the new busy time back out), and so freeing a shift removes the override that caused it
  // (instead of stacking a second, competing override on top).
  const overlappingOverrides = (type, rangeStart, rangeEnd) => myDoc.overrides.filter(o => {
    if (o.type !== type) return false;
    if (o.date === dateStr) {
      const effEnd = o.endNextDay ? 1440 : timeToMin(o.end);
      return timeToMin(o.start) < rangeEnd && effEnd > rangeStart;
    }
    if (o.date === prevDateStr && o.endNextDay) {
      return timeToMin(o.end) > rangeStart; // spillover always occupies [0, o.end) on `date`
    }
    return false;
  });
  const removeOverrides = toRemove => { myDoc.overrides = myDoc.overrides.filter(o => !toRemove.includes(o)); };

  if (seg.type === 'free') {
    root.innerHTML = `
      <div class="modal-backdrop" id="backdrop">
        <div class="modal">
          <h3>Add a shift</h3>
          <div class="helper-text">${date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} · currently free ${minutesToLabel(seg.start)}–${endLabel}</div>
          <br/>
          <form id="shiftForm">
            <div class="field row">
              <div class="field" style="flex:1"><label>Start</label><input required type="time" name="start" value="${toTimeInput(seg.start)}" min="${toTimeInput(seg.start)}" max="${toTimeInput(seg.end)}" /></div>
              <div class="field" style="flex:1"><label>End</label><input required type="time" name="end" id="shiftEnd" value="${toTimeInput(Math.min(seg.end, seg.start + 480))}" min="${toTimeInput(seg.start)}" max="${toTimeInput(seg.end)}" /></div>
            </div>
            <div class="field row" style="flex-wrap:wrap">
              <label style="display:flex;align-items:center;gap:4px"><input type="checkbox" id="shiftEndNextDay" /> Ends next day</label>
              <label style="display:flex;align-items:center;gap:4px"><input type="checkbox" name="work" /> Work shift</label>
            </div>
            <div class="field"><label>Label</label><input name="label" maxlength="40" placeholder="e.g. Shift" /></div>
            <div class="field row" style="justify-content:flex-end">
              <button type="button" class="btn secondary" id="cancelBtn">Cancel</button>
              <button type="submit" class="btn">Add shift</button>
            </div>
          </form>
        </div>
      </div>`;
    document.getElementById('cancelBtn').addEventListener('click', () => (root.innerHTML = ''));
    document.getElementById('backdrop').addEventListener('click', e => { if (e.target.id === 'backdrop') root.innerHTML = ''; });
    const endInput = document.getElementById('shiftEnd');
    // Once "ends next day" is checked, End is a time on the *next* date, so today's segment
    // bounds no longer apply — drop the max (and reset it if unchecked again).
    document.getElementById('shiftEndNextDay').addEventListener('change', e => {
      if (e.target.checked) endInput.removeAttribute('max');
      else endInput.max = toTimeInput(seg.end);
    });
    document.getElementById('shiftForm').addEventListener('submit', e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const start = fd.get('start'), end = fd.get('end');
      const endNextDay = document.getElementById('shiftEndNextDay').checked;
      if (!endNextDay && start >= end) { showToast('End time must be after start time.'); return; }
      // Clear any "available" overrides covering this range first, so a previous "mark as
      // free" here doesn't immediately cancel the shift being added right back out.
      const effEnd = endNextDay ? 1440 : timeToMin(end);
      removeOverrides(overlappingOverrides('available', timeToMin(start), effEnd));
      const entry = { date: dateStr, type: 'busy', start, end, endNextDay, label: (fd.get('label') || '').trim() };
      if (fd.get('work') === 'on') entry.category = 'work';
      myDoc.overrides.push(entry);
      root.innerHTML = '';
      renderMyScheduleTimeline();
      renderOverridesList();
      saveMyDoc();
      renderCombinedView();
    });
  } else {
    root.innerHTML = `
      <div class="modal-backdrop" id="backdrop">
        <div class="modal">
          <h3>Free up this time?</h3>
          <div class="helper-text">${date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} · currently busy ${minutesToLabel(seg.start)}–${endLabel}${seg.label ? ' · ' + seg.label : ''}</div>
          <br/>
          <div class="field row" style="justify-content:flex-end">
            <button type="button" class="btn secondary" id="cancelBtn">Cancel</button>
            <button type="button" class="btn" id="freeBtn">Mark as free</button>
          </div>
        </div>
      </div>`;
    document.getElementById('cancelBtn').addEventListener('click', () => (root.innerHTML = ''));
    document.getElementById('backdrop').addEventListener('click', e => { if (e.target.id === 'backdrop') root.innerHTML = ''; });
    document.getElementById('freeBtn').addEventListener('click', () => {
      // If this busy time came from one or more "busy" overrides (e.g. a shift added via
      // "Add a shift"), just remove them — same as the Remove button in the entries list.
      // Otherwise it's coming from the recurring weekly pattern, which can only be cancelled
      // for this one date with an "available" override.
      const causingBusyOverrides = overlappingOverrides('busy', seg.start, seg.end);
      if (causingBusyOverrides.length) {
        removeOverrides(causingBusyOverrides);
      } else {
        myDoc.overrides.push({ date: dateStr, type: 'available', start: rawTimeStr(seg.start), end: rawTimeStr(seg.end), label: '' });
      }
      root.innerHTML = '';
      renderMyScheduleTimeline();
      renderOverridesList();
      saveMyDoc();
      renderCombinedView();
    });
  }
}

document.getElementById('msPrevWeek').addEventListener('click', () => { msWeekStart.setDate(msWeekStart.getDate() - 7); renderMyScheduleTimeline(); });
document.getElementById('msNextWeek').addEventListener('click', () => { msWeekStart.setDate(msWeekStart.getDate() + 7); renderMyScheduleTimeline(); });
document.getElementById('msThisWeek').addEventListener('click', () => { msWeekStart = startOfWeek(new Date()); renderMyScheduleTimeline(); });

document.getElementById('msCopyWeek').addEventListener('click', () => {
  const weekDates = buildWeekDates(msWeekStart).map(d => formatDate(d));
  const thisWeeksOverrides = myDoc.overrides.filter(o => weekDates.includes(o.date));
  if (!thisWeeksOverrides.length) { showToast('No entries this week to copy.'); return; }
  let added = 0;
  for (const o of thisWeeksOverrides) {
    const nextDate = new Date(o.date + 'T00:00:00');
    nextDate.setDate(nextDate.getDate() + 7);
    const nextDateStr = formatDate(nextDate);
    const exists = myDoc.overrides.some(x => x.date === nextDateStr && x.start === o.start && x.end === o.end && x.type === o.type);
    if (!exists) { myDoc.overrides.push({ ...o, date: nextDateStr }); added++; }
  }
  renderMyScheduleTimeline();
  renderOverridesList();
  saveMyDoc();
  renderCombinedView();
  showToast(`Copied ${added} entr${added === 1 ? 'y' : 'ies'} to next week.`);
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
      renderMyScheduleTimeline();
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
      renderMyScheduleTimeline();
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
  renderMyScheduleTimeline();
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
