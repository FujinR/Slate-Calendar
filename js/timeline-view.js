import { formatDate, minutesToLabel } from './schedule-utils.js';

export function startOfWeek(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - d.getDay()); // back up to Sunday
  return d;
}

export function buildWeekDates(weekStart) {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });
}

function isSameDate(a, b) {
  return formatDate(a) === formatDate(b);
}

const HOUR_TICKS = [0, 6, 12, 18, 24];

const BG_VAR_BY_TYPE = { busy: '--busy-bg', free: '--free-bg', mutual: '--mutual-bg' };

// Paints the whole row as one continuous gradient instead of relying on the (transparent)
// segment divs for color. Adjacent divs positioned via independently-rounded left/width
// percentages can leave a sub-pixel gap at their shared edge on some zoom levels, which would
// otherwise show the container's fallback background through as a stray sliver. A single
// gradient has no seams to show through.
function segmentsToGradient(segments) {
  const stops = segments.map(seg => {
    const color = `var(${BG_VAR_BY_TYPE[seg.type] || '--busy-bg'})`;
    const startPct = (seg.start / 1440) * 100;
    const endPct = (seg.end / 1440) * 100;
    return `${color} ${startPct}% ${endPct}%`;
  });
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

export function renderHourTicks() {
  const wrap = document.createElement('div');
  wrap.className = 'hour-ticks';
  wrap.innerHTML = `<div></div><div class="ticks">${HOUR_TICKS.map(h => {
    const pct = (h / 24) * 100;
    const label = h === 0 ? '12AM' : h === 12 ? '12PM' : h === 24 ? '12AM' : h < 12 ? `${h}AM` : `${h - 12}PM`;
    const clampedPct = h === 24 ? 100 : pct;
    return `<span style="left:${clampedPct}%">${label}</span>`;
  }).join('')}</div>`;
  return wrap;
}

/**
 * Renders a week of day rows into `container`.
 * `days` is an array of { date, segments: [{start, end, type, label}] } where type is
 * 'busy' | 'free' | 'mutual'. Segments should already be non-overlapping and cover [0,1440).
 * `onSegmentClick(date, segment)` fires when a clickable (free/mutual) segment is clicked.
 */
export function renderWeekTimelines(container, days, { onSegmentClick, clickableTypes = ['free', 'mutual'] } = {}) {
  container.innerHTML = '';
  const today = new Date();

  for (const day of days) {
    const row = document.createElement('div');
    row.className = 'day-row';

    const label = document.createElement('div');
    label.className = 'day-label' + (isSameDate(day.date, today) ? ' today' : '');
    label.innerHTML = `${day.date.toLocaleDateString(undefined, { weekday: 'short' })}<span class="date">${day.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>`;

    const timeline = document.createElement('div');
    timeline.className = 'timeline';

    // Segments + gradient live in a clipped inner wrapper so the rounded corners still cut
    // them off cleanly; the now-marker below is appended to `timeline` directly (not `fill`)
    // so its flag and tooltip aren't clipped when they extend above the row.
    const fill = document.createElement('div');
    fill.className = 'timeline-fill';
    if (day.segments.length) fill.style.background = segmentsToGradient(day.segments);

    for (const seg of day.segments) {
      const el = document.createElement('div');
      el.className = `seg ${seg.type}`;
      el.style.left = `${(seg.start / 1440) * 100}%`;
      el.style.width = `${((seg.end - seg.start) / 1440) * 100}%`;
      const endLabel = seg.end >= 1440 ? '11:59PM' : minutesToLabel(seg.end);
      const label = `${minutesToLabel(seg.start)} – ${endLabel}${seg.label ? ' · ' + seg.label : ''}`;
      el.title = label;
      if (clickableTypes.includes(seg.type) && onSegmentClick) {
        el.classList.add('clickable');
        el.addEventListener('click', () => onSegmentClick(day.date, seg));
      }
      fill.appendChild(el);
    }
    timeline.appendChild(fill);

    if (isSameDate(day.date, today)) {
      const nowMin = today.getHours() * 60 + today.getMinutes();
      const marker = document.createElement('div');
      marker.className = 'now-marker';
      marker.style.left = `${(nowMin / 1440) * 100}%`;
      timeline.appendChild(marker);
    }

    row.appendChild(label);
    row.appendChild(timeline);
    container.appendChild(row);
  }
}

export function weekRangeLabel(weekStart) {
  const end = new Date(weekStart);
  end.setDate(end.getDate() + 6);
  const opts = { month: 'short', day: 'numeric' };
  return `${weekStart.toLocaleDateString(undefined, opts)} – ${end.toLocaleDateString(undefined, opts)}`;
}
