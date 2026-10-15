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
// `hidden`: calendar titles to leave out (the overview's own choice, see chooseCalendars)
async function loadDays(names, allDay = SHOW_ALL_DAY, lookAhead = LOOK_AHEAD, hidden = []) {
  try {
    let cals = [];
    if (names.length) {
      const all = await Calendar.forEvents();
      const wanted = names.map(n => n.toLowerCase());
      cals = all.filter(c => wanted.includes(c.title.toLowerCase()));
      if (!cals.length) return { error: `No calendar named ${names.join(", ")}` };
    } else if (hidden.length) {
      const all = await Calendar.forEvents();
      cals = all.filter(c => !hidden.includes(c.title));
      if (!cals.length) return { error: "All calendars are hidden" };
    }
    const now = new Date();
    const evs = await CalendarEvent.between(S.dayStart(0), S.dayStart(lookAhead), cals);
    const order = (a, b) => (b.isAllDay - a.isAllDay) || (a.startDate - b.startDate);
    const days = [];
    for (let i = 0; i < lookAhead; i++) {
      const s = S.dayStart(i), e = S.dayStart(i + 1);
      const list = evs.filter(ev => {
        if (ev.isAllDay) return allDay && ev.startDate < e && ev.endDate > s;         // every day it covers
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

// ---- the overview's calendar, set as a timetable: day | time | what ----
// Each day's first row names the day (THU); its other rows leave the day column blank. All-day
// events come first in their day, timed "—", or "–22.10" when they run past that day; an all-day event
// spanning several days is listed once, on the first day shown.
function timetableRows(result) {
  const rows = [], seen = new Set();
  for (const d of result.days || []) {
    const next = S.dayStart(d.offset + 1);
    const list = [];
    for (const e of d.events) {
      if (e.isAllDay) {
        const key = `${e.title}|${e.startDate.getTime()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const last = new Date(e.endDate.getTime() - 1);
        list.push({ time: e.endDate > next ? `–${S.dayMonth(last)}` : "—", title: e.title });
      } else list.push({ time: S.timeLabel(e.startDate), title: e.title });
    }
    if (!list.length) continue;
    // within a week the weekday is unambiguous ("THU"); further out the day is named by its date ("22.10")
    const name = d.offset < 7 ? S.WD[d.date.getDay()].slice(0, 3).toUpperCase() : S.dayMonth(d.date);
    list.forEach((r, i) => rows.push({ ...r, day: i === 0 ? name : "" }));
  }
  return rows;
}

// the first `n` timetable rows into a stack W wide
function drawTimetable(w, W, rows, n) {
  if (!rows.length) { S.gRow(w, W, [{ text: "", w: S.G.KEY }, { text: "Nothing in the next two weeks" }]); return; }
  for (const r of rows.slice(0, n)) {
    S.gRow(w, W, [{ text: r.day, w: S.G.D, font: S.F.key }, { text: r.time, w: S.G.T, font: S.F.mono }, { text: r.title }]);
  }
}

// ---- which calendars the overview shows ----
// Scriptable sees every calendar on the phone, including ones hidden in the Calendar app (holiday
// calendars, subscriptions), so the overview keeps its own list of calendars to leave out.
const hiddenFm = FileManager.local();
const hiddenPath = hiddenFm.joinPath(hiddenFm.documentsDirectory(), "swiss-overview-hidden-calendars.json");
function hiddenCalendars() {
  try { return hiddenFm.fileExists(hiddenPath) ? JSON.parse(hiddenFm.readString(hiddenPath)) : []; } catch (e) { return []; }
}
// a menu of every calendar, ✓ for shown; tap to hide or show, Done to finish
async function chooseCalendars() {
  let all = [];
  try { all = await Calendar.forEvents(); } catch (e) { return; }
  const hidden = new Set(hiddenCalendars());
  while (true) {
    const a = new Alert();
    a.title = "Calendars in the overview";
    for (const c of all) a.addAction((hidden.has(c.title) ? "   " : "✓ ") + c.title);
    a.addCancelAction("Done");
    const i = await a.presentSheet();
    if (i === -1) break;
    const t = all[i].title;
    if (hidden.has(t)) hidden.delete(t); else hidden.add(t);
    try { hiddenFm.writeString(hiddenPath, JSON.stringify([...hidden])); } catch (e) {}
  }
}

// ---- events Hermes pushes to /widget/api/calendar ----
// Each refresh adds them to the calendar, updates any Hermes changed, and skips ones already added
// unchanged. It never deletes: an event dropped from the feed, or deleted by hand, is left alone.
const SYNC_FEED = "https://misc.mrdrr.uk/widget/api/calendar";
const SYNC_CALENDAR = "";   // calendar to add them to; "" = the default calendar
const syncFm = FileManager.local();
const syncPath = syncFm.joinPath(syncFm.documentsDirectory(), "swiss-calendar-sync.json");   // feed id -> event added
function readSync() {
  try { return syncFm.fileExists(syncPath) ? JSON.parse(syncFm.readString(syncPath)) : {}; } catch (e) { return {}; }
}
function writeSync(state) { try { syncFm.writeString(syncPath, JSON.stringify(state)); } catch (e) {} }
const fingerprint = e => JSON.stringify([e.title, e.start, e.end || "", !!e.all_day, e.location || "", e.notes || ""]);

// the last real failure of the sync, shown by the Hermes widget: { at, message } or null. Being offline
// isn't one (it passes), and neither is a 404 (no calendar.json pushed yet).
const failPath = syncFm.joinPath(syncFm.documentsDirectory(), "swiss-calendar-sync-failure.json");
function lastSyncFailure() {
  try { return syncFm.fileExists(failPath) ? JSON.parse(syncFm.readString(failPath)) : null; } catch (e) { return null; }
}
function setSyncFailure(message) {
  try {
    if (message) syncFm.writeString(failPath, JSON.stringify({ at: Date.now(), message }));
    else if (syncFm.fileExists(failPath)) syncFm.remove(failPath);
  } catch (e) {}
}

// returns { added, updated, failed } or { error }
async function syncFromFeed(token) {
  if (!token) return { error: "no token" };
  let json;
  try {
    const req = new Request(SYNC_FEED);
    req.headers = { Authorization: `Bearer ${token}` };
    req.timeoutInterval = 10;
    json = await req.loadJSON();
    const status = req.response && req.response.statusCode;
    if (status === 404) return { error: "no calendar feed" };
    if (status !== 200) { setSyncFailure(`Calendar feed: HTTP ${status}`); return { error: `HTTP ${status}` }; }
  } catch (e) { return { error: String(e.message || e) }; }   // offline: try again next refresh

  const state = readSync();
  let added = 0, updated = 0, calendar = null;
  const failed = [];
  for (const e of Array.isArray(json.events) ? json.events : []) {
    const start = new Date(e.start);
    if (!e.id || !e.title || isNaN(start)) continue;
    const end = e.end && !isNaN(new Date(e.end)) ? new Date(e.end) : new Date(start.getTime() + 3600 * 1000);
    const print = fingerprint(e);
    const prev = state[e.id];
    if (prev && prev.print === print) continue;   // added before and unchanged

    let ev = null;
    if (prev) {   // changed: find the event added before, by its identifier, around where it was
      const near = await CalendarEvent.between(new Date(prev.start - 86400000), new Date(prev.end + 86400000), []);
      ev = near.find(x => x.identifier === prev.identifier) || null;
    }
    if (!ev) {
      ev = new CalendarEvent();
      calendar = calendar || (SYNC_CALENDAR ? await Calendar.forEventsByTitle(SYNC_CALENDAR) : await Calendar.defaultForEvents());
      ev.calendar = calendar;
    }
    try {
      ev.title = e.title;
      ev.startDate = start;
      ev.endDate = end;
      ev.isAllDay = !!e.all_day;
      ev.location = e.location || "";
      ev.notes = e.notes || "";
      ev.save();
    } catch (err) { failed.push(e.title); continue; }
    state[e.id] = { identifier: ev.identifier, start: start.getTime(), end: end.getTime(), print };
    if (prev) updated++; else added++;
  }
  writeSync(state);
  setSyncFailure(failed.length ? `Couldn't add ${failed.join(", ")}` : null);
  return { added, updated, failed };
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

module.exports = { hiddenCalendars, chooseCalendars, syncFromFeed, lastSyncFailure, loadDays, dayTitle, timetableRows, drawTimetable, buildWidget, buildLockRect, lockLines };
