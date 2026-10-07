// lib-calendar.js: calendar loading and drawing (calendar-list.js and overview.js load it). Not a widget by itself.
const S = importModule("swiss");

const SHOW_ALL_DAY = false;   // include all-day events (shown with a dash instead of a time)
const LOOK_AHEAD = 7;         // how many days ahead to search for events

function dayTitle(offset, d, label) {
  const day = offset === 0 ? "Today" : offset === 1 ? "Tomorrow" : S.WD[d.getDay()];
  return label ? `${label} · ${day}` : day;
}

// ---- calendar ----
// returns { days: [{ offset, date, events }] }, or { error } when something is missing
async function loadDays(names) {
  try {
    let cals = [];
    if (names.length) {
      const all = await Calendar.forEvents();
      const wanted = names.map(n => n.toLowerCase());
      cals = all.filter(c => wanted.includes(c.title.toLowerCase()));
      if (!cals.length) return { error: `No calendar named ${names.join(", ")}` };
    }
    const now = new Date();
    const evs = await CalendarEvent.between(S.dayStart(0), S.dayStart(LOOK_AHEAD), cals);
    const order = (a, b) => (b.isAllDay - a.isAllDay) || (a.startDate - b.startDate);
    const days = [];
    for (let i = 0; i < LOOK_AHEAD; i++) {
      const s = S.dayStart(i), e = S.dayStart(i + 1);
      const list = evs.filter(ev => {
        if (ev.isAllDay) return SHOW_ALL_DAY && ev.startDate < e && ev.endDate > s;   // every day it covers
        if (i === 0 && ev.endDate <= now) return false;                               // already finished
        if (ev.startDate >= s && ev.startDate < e) return true;                       // starts this day
        return i === 0 && ev.startDate < s && ev.endDate > now;                       // still running from earlier
      }).sort(order);
      if (list.length) days.push({ offset: i, date: s, events: list });
    }
    return { days };
  } catch (e) { return { error: "Open Scriptable to allow calendar access" }; }
}

// ---- Home Screen widget ----
function buildWidget(result, label) {
  const w = S.widget();
  w.url = "calshow://";   // tapping opens the Calendar app
  const { innerW, availH, large } = S.metrics();
  const maxDays = large ? 4 : 2;

  const line = (left, text, colour) =>
    S.row(w, innerW, [{ text: left, w: S.TIME_W, mono: true }, { text }], colour);

  // up to `rows` lines of events, with a "+N more" line when they don't all fit
  const list = (events, rows) => {
    const more = events.length > rows;
    const shown = more ? events.slice(0, Math.max(1, rows - 1)) : events;
    shown.forEach((e, i) => {
      if (i > 0) w.addSpacer(S.ROW_GAP);
      line(e.isAllDay ? "—" : S.timeLabel(e.startDate), e.title, S.FG);
    });
    if (more && rows > 1) {
      w.addSpacer(S.ROW_GAP);
      line("", `+${events.length - shown.length} more`, S.DIM);
    }
  };

  const days = result.days || [];
  if (result.error || days.length === 0) {
    S.header(w, innerW, dayTitle(0, S.dayStart(0), label), S.dayMonth());
    S.note(w, innerW, result.error || "Nothing this week", S.TIME_W);
  } else {
    const show = days.slice(0, maxDays);
    const k = show.length;
    let left = S.rowsFor(availH, k);   // rows that fit once the headers are paid for
    show.forEach((d, i) => {
      if (i > 0) w.addSpacer(S.SECTION_GAP);
      const after = k - i - 1;         // sections still to come
      const rows = i === k - 1 ? left : Math.min(d.events.length, left - after);
      S.header(w, innerW, dayTitle(d.offset, d.date, label), S.dayMonth(d.date));   // the title already names the day
      list(d.events, rows);
      left -= Math.min(rows, d.events.length);
    });
  }

  return S.finish(w);
}

// upcoming events as lines: events of the first day, then for each later day a label line and its events
function upcomingLines(result) {
  const out = [];
  (result.days || []).forEach((d, i) => {
    if (i > 0) out.push({ day: d });
    for (const e of d.events) out.push({ event: e });
  });
  return out;
}

// right-hand text of a day heading in the overview: "Wed 07.10" when the title is Today or Tomorrow,
// just "13.10" when the title already names the weekday
function dayRight(offset, d) {
  return offset <= 1 ? S.dateLabel(d) : S.dayMonth(d);
}

// height of each kind of line: an event row, and a later day's heading (a section gap, then a header)
const EVENT_H = S.ROW, DAY_H = S.SECTION_GAP + S.HEAD_H;

// the lines that fit in `maxH` points, never ending on a day heading with no event under it.
// Returns { lines, height }.
function fitLines(result, maxH) {
  const lines = [];
  let h = 0;
  for (const l of upcomingLines(result)) {
    const prev = lines[lines.length - 1];
    const cost = l.day ? DAY_H : EVENT_H + (prev && !prev.day ? S.ROW_GAP : 0);
    if (h + cost > maxH) break;
    lines.push(l); h += cost;
  }
  while (lines.length && lines[lines.length - 1].day) { lines.pop(); h -= DAY_H; }
  return { lines, height: Math.max(h, EVENT_H) };
}

// upcoming events in `maxH` points under a header that already names the first day; each later day
// gets its own heading (used by the overview widget)
function drawUpcoming(w, innerW, maxH, result, label) {
  if (result.error || !(result.days || []).length) {
    S.row(w, innerW, [{ text: result.error || "Nothing this week" }]);
    return;
  }
  fitLines(result, maxH).lines.forEach((l, i, all) => {
    if (l.day) {
      w.addSpacer(S.SECTION_GAP);
      S.header(w, innerW, dayTitle(l.day.offset, l.day.date, label), dayRight(l.day.offset, l.day.date));
      return;
    }
    if (i > 0 && !all[i - 1].day) w.addSpacer(S.ROW_GAP);
    S.row(w, innerW, [{ text: l.event.isAllDay ? "—" : S.timeLabel(l.event.startDate), w: S.TIME_W, mono: true }, { text: l.event.title }]);
  });
}

// ---- Lock Screen widgets ----
// upcoming events as short text lines, e.g. "14:00 Dentist", "Tmrw 09:00 Standup", "Sat 11:00 Brunch"
function lockLines(result, max) {
  if (result.error) return [result.error];
  const out = [];
  for (const d of result.days) {
    const prefix = d.offset === 0 ? "" : d.offset === 1 ? "Tmrw " : S.WD[d.date.getDay()].slice(0, 3) + " ";
    for (const e of d.events) {
      out.push(`${prefix}${e.isAllDay ? "—" : S.timeLabel(e.startDate)} ${e.title}`);
      if (out.length === max) return out;
    }
  }
  return out.length ? out : ["Nothing this week"];
}

// rectangular: the next three events
function buildLockRect(result) {
  const w = S.lockWidget();
  lockLines(result, 3).forEach((text, i) => {
    if (i > 0) w.addSpacer(3);
    S.lockText(w, text);
  });
  w.addSpacer();
  return w;
}

module.exports = { loadDays, dayTitle, dayRight, fitLines, drawUpcoming, buildWidget, buildLockRect, lockLines };
