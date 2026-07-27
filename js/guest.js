import { DEMO_MODE, getFirebase } from './firebase-config.js';
import { OWNER_UID, SITE_NAME } from './site-config.js';
import { DEMO_OWNER } from './demo-data.js';
import { getBusyIntervalsForDate, getFreeIntervalsForDate, formatDate, minutesToLabel } from './schedule-utils.js';
import { startOfWeek, buildWeekDates, renderWeekTimelines, renderHourTicks, weekRangeLabel } from './timeline-view.js';

document.getElementById('siteTitle').textContent = SITE_NAME;

let weekStart = startOfWeek(new Date());
let ownerSchedule = null;
let dbRefs = null;

function showToast(msg) {
  const root = document.getElementById('toastRoot');
  root.innerHTML = `<div class="toast">${msg}</div>`;
  setTimeout(() => { root.innerHTML = ''; }, 3200);
}

function daySegments(date) {
  const busy = getBusyIntervalsForDate(ownerSchedule, date).map(b => ({ ...b, type: 'busy' }));
  const free = getFreeIntervalsForDate(ownerSchedule, date).map(f => ({ ...f, type: 'free' }));
  return [...busy, ...free].sort((a, b) => a.start - b.start);
}

function render() {
  document.getElementById('weekLabel').textContent = weekRangeLabel(weekStart);
  const ticks = document.getElementById('hourTicks');
  ticks.innerHTML = '';
  ticks.appendChild(renderHourTicks());

  const days = buildWeekDates(weekStart).map(date => ({ date, segments: daySegments(date) }));
  renderWeekTimelines(document.getElementById('timelineContainer'), days, {
    onSegmentClick: (date, seg) => openRequestModal(date, seg),
  });
}

function openRequestModal(date, seg) {
  const defaultStart = seg.start;
  const defaultEnd = Math.min(seg.end, seg.start + 60);
  // <input type=time> can't represent 24:00 (end-of-day), so clamp to 23:59 for input attrs.
  const toTimeInput = m => {
    const clamped = Math.min(m, 1439);
    return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
  };

  const root = document.getElementById('modalRoot');
  root.innerHTML = `
    <div class="modal-backdrop" id="backdrop">
      <div class="modal">
        <h3>Request time</h3>
        <div class="helper-text">${date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} · free ${minutesToLabel(seg.start)}–${seg.end >= 1440 ? '11:59PM' : minutesToLabel(seg.end)}</div>
        <br/>
        <form id="reqForm">
          <div class="field">
            <label>Your name</label>
            <input required name="name" maxlength="60" />
          </div>
          <div class="field">
            <label>Email or phone (so they can confirm)</label>
            <input required name="contact" maxlength="120" />
          </div>
          <div class="field row">
            <div class="field" style="flex:1">
              <label>Start</label>
              <input required type="time" name="start" value="${toTimeInput(defaultStart)}" min="${toTimeInput(seg.start)}" max="${toTimeInput(seg.end)}" />
            </div>
            <div class="field" style="flex:1">
              <label>End</label>
              <input required type="time" name="end" value="${toTimeInput(defaultEnd)}" min="${toTimeInput(seg.start)}" max="${toTimeInput(seg.end)}" />
            </div>
          </div>
          <div class="field">
            <label>Note (optional)</label>
            <textarea name="note" rows="2" maxlength="300"></textarea>
          </div>
          <div class="field row" style="justify-content:flex-end">
            <button type="button" class="btn secondary" id="cancelBtn">Cancel</button>
            <button type="submit" class="btn">Send request</button>
          </div>
        </form>
      </div>
    </div>
  `;

  document.getElementById('cancelBtn').addEventListener('click', () => { root.innerHTML = ''; });
  document.getElementById('backdrop').addEventListener('click', e => { if (e.target.id === 'backdrop') root.innerHTML = ''; });

  document.getElementById('reqForm').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const start = fd.get('start');
    const end = fd.get('end');
    if (start >= end) { showToast("End time must be after start time."); return; }

    const payload = {
      name: fd.get('name').trim(),
      contact: fd.get('contact').trim(),
      note: (fd.get('note') || '').trim(),
      date: formatDate(date),
      start, end,
      ownerUid: OWNER_UID,
      status: 'pending',
    };

    if (DEMO_MODE) {
      showToast('Demo mode — requests aren\'t saved. Set up Firebase to go live.');
      root.innerHTML = '';
      return;
    }

    try {
      const { db, dbMod } = await getFirebase();
      await dbMod.addDoc(dbMod.collection(db, 'requests'), { ...payload, createdAt: dbMod.serverTimestamp() });
      showToast('Request sent!');
      root.innerHTML = '';
    } catch (err) {
      showToast('Could not send request: ' + err.message);
    }
  });
}

async function loadOwnerSchedule() {
  if (DEMO_MODE) {
    document.getElementById('demoBanner').style.display = 'block';
    ownerSchedule = DEMO_OWNER;
    return true;
  }
  const { db, dbMod } = await getFirebase();
  try {
    const snap = await dbMod.getDoc(dbMod.doc(db, 'schedules', OWNER_UID));
    if (!snap.exists() || snap.data().public !== true) {
      document.getElementById('unavailableBanner').style.display = 'block';
      return false;
    }
    ownerSchedule = snap.data();
    return true;
  } catch (err) {
    document.getElementById('unavailableBanner').style.display = 'block';
    return false;
  }
}

document.getElementById('prevWeek').addEventListener('click', () => { weekStart.setDate(weekStart.getDate() - 7); render(); });
document.getElementById('nextWeek').addEventListener('click', () => { weekStart.setDate(weekStart.getDate() + 7); render(); });
document.getElementById('thisWeek').addEventListener('click', () => { weekStart = startOfWeek(new Date()); render(); });

(async () => {
  const ok = await loadOwnerSchedule();
  if (ok) render();
  else {
    document.getElementById('weekLabel').textContent = '';
  }
})();
