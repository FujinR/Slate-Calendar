// Pure schedule math — no Firebase, no DOM. Kept separate so it can be unit-tested with plain node.

export const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
export const DAY_LABELS = { sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday' };

export function timeToMin(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export function minToTime(m) {
  m = ((Math.round(m) % 1440) + 1440) % 1440;
  const h = String(Math.floor(m / 60)).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return `${h}:${mm}`;
}

export function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function mergeSameType(intervals) {
  if (!intervals.length) return [];
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const out = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1];
    const cur = sorted[i];
    if (cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end);
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

// Subtract `holes` ranges from `ranges` ranges. Both are arrays of {start,end,...} in minutes;
// extra fields (label, category) on `ranges` are preserved through the split.
function subtractRanges(ranges, holes) {
  let result = ranges.map(r => ({ ...r }));
  for (const hole of holes) {
    const next = [];
    for (const r of result) {
      if (hole.end <= r.start || hole.start >= r.end) {
        next.push(r); // no overlap
        continue;
      }
      if (hole.start > r.start) next.push({ ...r, start: r.start, end: Math.min(hole.start, r.end) });
      if (hole.end < r.end) next.push({ ...r, start: Math.max(hole.end, r.start), end: r.end });
    }
    result = next.filter(r => r.end > r.start);
  }
  return result;
}

function clip(ranges, min, max) {
  return ranges
    .map(r => ({ ...r, start: Math.max(r.start, min), end: Math.min(r.end, max) }))
    .filter(r => r.end > r.start);
}

// Complement of `ranges` (assumed merged/sorted) within [0, span).
function complement(ranges, span = 1440) {
  const sorted = mergeSameType(ranges);
  const out = [];
  let cursor = 0;
  for (const r of sorted) {
    if (r.start > cursor) out.push({ start: cursor, end: r.start });
    cursor = Math.max(cursor, r.end);
  }
  if (cursor < span) out.push({ start: cursor, end: span });
  return out;
}

/**
 * Returns merged busy intervals (minutes 0-1440) for a schedule doc on a given date,
 * accounting for the weekly recurring pattern, overnight (endNextDay) shifts spilling
 * over from the previous day, and date-specific overrides.
 */
export function getBusyIntervalsForDate(schedule, dateObj) {
  const weekly = schedule.weekly || {};
  const dayIdx = dateObj.getDay();
  const todayKey = DAY_KEYS[dayIdx];
  const prevKey = DAY_KEYS[(dayIdx + 6) % 7];

  let busy = [];

  for (const block of weekly[todayKey] || []) {
    const start = timeToMin(block.start);
    const end = block.endNextDay ? 1440 : timeToMin(block.end);
    if (end > start) busy.push({ start, end, label: block.label || '', category: block.category });
  }

  for (const block of weekly[prevKey] || []) {
    if (block.endNextDay) {
      const end = timeToMin(block.end);
      if (end > 0) busy.push({ start: 0, end, label: block.label || '', category: block.category });
    }
  }

  busy = mergeSameType(busy);

  const dateStr = formatDate(dateObj);
  const prevDateObj = new Date(dateObj);
  prevDateObj.setDate(prevDateObj.getDate() - 1);
  const prevDateStr = formatDate(prevDateObj);
  const allOverrides = schedule.overrides || [];
  const todayOverrides = allOverrides.filter(o => o.date === dateStr);
  const prevDayOverrides = allOverrides.filter(o => o.date === prevDateStr);

  const extraBusy = todayOverrides
    .filter(o => o.type === 'busy')
    .map(o => {
      const start = timeToMin(o.start);
      const end = o.endNextDay ? 1440 : timeToMin(o.end);
      return { start, end, label: o.label || '', category: o.category };
    })
    .filter(iv => iv.end > iv.start);

  for (const o of prevDayOverrides) {
    if (o.type === 'busy' && o.endNextDay) {
      const end = timeToMin(o.end);
      if (end > 0) extraBusy.push({ start: 0, end, label: o.label || '', category: o.category });
    }
  }

  const holes = todayOverrides
    .filter(o => o.type === 'available')
    .map(o => ({ start: timeToMin(o.start), end: timeToMin(o.end) }));

  busy = mergeSameType([...busy, ...extraBusy]);
  busy = subtractRanges(busy, holes);
  busy = clip(mergeSameType(busy), 0, 1440);

  return busy;
}

export function getFreeIntervalsForDate(schedule, dateObj) {
  return complement(getBusyIntervalsForDate(schedule, dateObj), 1440);
}

export function intersectRanges(a, b) {
  const out = [];
  let i = 0, j = 0;
  const A = mergeSameType(a), B = mergeSameType(b);
  while (i < A.length && j < B.length) {
    const start = Math.max(A[i].start, B[j].start);
    const end = Math.min(A[i].end, B[j].end);
    if (end > start) out.push({ start, end });
    if (A[i].end < B[j].end) i++; else j++;
  }
  return out;
}

export function getMutualFreeForDate(scheduleA, scheduleB, dateObj) {
  return intersectRanges(getFreeIntervalsForDate(scheduleA, dateObj), getFreeIntervalsForDate(scheduleB, dateObj));
}

// Shrinks each mutual-free window by `bufferMinutes` to account for travel time needed
// before the two of you can actually be in the same place. Windows too short to be worth
// the trip are dropped.
export function applyTravelBuffer(intervals, bufferMinutes) {
  if (!bufferMinutes) return intervals;
  return intervals
    .map(iv => ({ ...iv, start: iv.start + bufferMinutes }))
    .filter(iv => iv.end > iv.start);
}

export function minutesToLabel(mins) {
  mins = ((mins % 1440) + 1440) % 1440;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const period = h < 12 ? 'AM' : 'PM';
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return m === 0 ? `${h12}${period}` : `${h12}:${String(m).padStart(2, '0')}${period}`;
}
