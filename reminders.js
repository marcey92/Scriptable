const S = importModule("swiss");

// "Reminders": what's left to do today from Apple Reminders, set like the overview's timetable.
// A reminder with a date only shows up on its day (and stays, as LATE, until it's done):
//   [Reminders]  ━━━━━━━━━━━━━━━━━━━━  1 overdue
//   LATE   24.11  Renew passport     Hom    <- overdue: LATE, then its date (or time, if due earlier today)
//   FRI    —      Buy batteries      Sho    <- today: the weekday, "—" when it has no time
//          14:00  Call landlord      Hom
//                 Fix bike light     Hom    <- no due date (newest first, after the dated ones)
// The list's first three letters are on the right, like a platform number, when the reminders shown come
// from more than one list.
// Tapping the widget opens Reminders.
// The widget's Parameter field can name lists to show, e.g. "Shopping, Home"; empty = every list.
const TITLE = "Reminders";
const REMINDERS_URL = "x-apple-reminderkit://";
const LIST_W = 36;      // the list column at the right edge, left-aligned so every code starts at the same place: its first three letters
const UNDATED = true;   // also show reminders without a due date, after the dated ones

const lists = () => (args.widgetParameter || "").split(",").map(x => x.trim()).filter(Boolean);

// ---- loading ----
// returns { items: [{ id, title, list, due, timed, overdue, today }] } or { error }
async function load(names = lists()) {
  try {
    let cals = [];
    if (names.length) {
      const all = await Calendar.forReminders();
      const wanted = names.map(n => n.toLowerCase());
      cals = all.filter(c => wanted.includes(c.title.toLowerCase()));
      if (!cals.length) return { error: `No list named ${names.join(", ")}` };
    }
    const rs = await Reminder.allIncomplete(cals);
    const now = new Date(), end = S.dayStart(1);
    const items = rs.map(r => {
      const due = r.dueDate || null, timed = !!(due && r.dueDateIncludesTime);
      // a reminder due today without a time isn't overdue until the day is over
      const overdue = !!due && (timed ? due < now : due < S.dayStart(0));
      return { id: r.identifier, title: r.title || "", list: (r.calendar && r.calendar.title) || "", due, timed, overdue, today: !!due && due < end && !overdue,
               created: r.creationDate ? r.creationDate.getTime() : 0 };
    }).filter(it => it.due ? it.overdue || it.today : UNDATED);   // nothing from days still to come
    items.sort((a, b) => (!a.due - !b.due) || (a.due && b.due ? a.due - b.due : b.created - a.created));
    return { items };
  } catch (e) { return { error: "Open Scriptable to allow Reminders access" }; }
}

// the time column: its date when overdue or later, the time today, "—" today without a time
function whenText(it) {
  if (!it.due) return "";
  if (it.today) return it.timed ? S.timeLabel(it.due) : "—";
  if (it.overdue && it.timed && it.due >= S.dayStart(0)) return S.timeLabel(it.due);   // earlier today
  return S.dayMonth(it.due);
}

function headRight(data) {
  if (data.error) return null;
  const late = data.items.filter(it => it.overdue).length;
  const today = data.items.filter(it => it.today).length;
  return late ? `${late} overdue` : today ? `${today} today` : null;
}

// ---- Home Screen widget ----
// the day column: LATE for overdue, the weekday within a week, the date beyond; blank without a date
function dayText(it) {
  if (!it.due) return "";
  if (it.overdue) return "LATE";
  const d = new Date(it.due); d.setHours(0, 0, 0, 0);
  const days = Math.round((d - S.dayStart(0)) / 86400000);
  return days < 7 ? S.WD[it.due.getDay()].slice(0, 3).toUpperCase() : S.dayMonth(it.due);
}
// the time column: the date when overdue from an earlier day, else the time, "—" without one
function timeText(it) {
  if (!it.due) return "";
  if (it.overdue && it.due < S.dayStart(0)) return S.dayMonth(it.due);
  return it.timed ? S.timeLabel(it.due) : "—";
}

function buildWidget(data) {
  const { w, g, rows } = S.board(TITLE, headRight(data), null, REMINDERS_URL);
  const note = text => S.gRow(w, g.W, g.small ? [{ text }] : [{ text: "", w: S.G.KEY }, { text }]);
  if (data.error) { note(data.error); return S.finish(w); }
  if (!data.items.length) { note("Nothing to do"); return S.finish(w); }
  const shown = data.items.slice(0, rows);
  const withList = !g.small && new Set(shown.map(it => it.list)).size > 1;
  let prev = null;
  for (const it of shown) {
    const day = dayText(it);
    const what = { text: it.title };
    const cells = g.small ? [{ text: whenText(it), w: S.G.T, font: S.F.mono }, what]
      : [{ text: day === prev ? "" : day, w: S.G.D, font: S.F.key }, { text: timeText(it), w: S.G.T, font: S.F.mono }, what,
         ...(withList ? [{ text: it.list.slice(0, 3), w: LIST_W }] : [])];
    S.gRow(w, g.W, cells);
    prev = day;
  }
  return S.finish(w);
}

// ---- Lock Screen ----
function lockLines(data, max) {
  if (data.error) return [data.error];
  const out = data.items.filter(it => it.due).slice(0, max).map(it => `${whenText(it)} ${it.title}`);
  return out.length ? out : ["Nothing due"];
}
function buildLockRect(data) {
  const w = S.lockWidget();
  lockLines(data, 3).forEach((text, i) => { if (i > 0) w.addSpacer(3); S.lockText(w, text); });
  w.addSpacer();
  return w;
}
const dueCount = data => data.error ? 0 : data.items.filter(it => it.overdue || it.today).length;

// ---- run ----
const data = await load();   // the first run in the app asks for Reminders access
const family = config.widgetFamily;
const widget = family === "accessoryRectangular" ? buildLockRect(data)
  : family === "accessoryCircular" ? S.lockCircle(String(dueCount(data)))
  : family === "accessoryInline" ? S.lockInline(lockLines(data, 1)[0])
  : buildWidget(data);
// tapping anywhere opens Reminders: on the Home Screen the link is on the content (S.board), which opens it
// without Scriptable first; the Lock Screen only takes a link on the whole widget
if (family && family.startsWith("accessory")) widget.url = REMINDERS_URL;
S.refresh(widget);
if (config.runsInWidget) Script.setWidget(widget);
else await widget.presentMedium();   // preview when run inside the app
Script.complete();
