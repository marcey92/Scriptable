const S = importModule("swiss");

// "Reminders": what's left to do from Apple Reminders, one line each.
//   Reminders                     2 overdue
//   ───────────────────────────────────────
//   24.11  Renew passport          <- overdue: its date
//   09:00  Call landlord           <- due today at a time
//   —      Buy batteries           <- due today, no time
//   28.11  Book dentist            <- due later
//          Fix bike light          <- no due date (newest first, after the dated ones)
// Tap a line to mark it done (Scriptable opens, asks, and closes); tap the title to open Reminders.
// The widget's Parameter field can name lists to show, e.g. "Shopping, Home"; empty = every list.
const TITLE = "Reminders";
const REMINDERS_URL = "x-apple-reminderkit://";
const UNDATED = true;   // also show reminders without a due date, after the dated ones

const lists = () => (args.widgetParameter || "").split(",").map(x => x.trim()).filter(Boolean);

// ---- loading ----
// returns { items: [{ id, title, due, timed, overdue, today }] } or { error }
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
      return { id: r.identifier, title: r.title || "", due, timed, overdue, today: !!due && due < end && !overdue,
               created: r.creationDate ? r.creationDate.getTime() : 0 };
    }).filter(it => UNDATED || it.due);
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
function buildWidget(data) {
  const w = S.widget();
  const { innerW, availH, small } = S.metrics();
  const head = S.header(w, innerW, TITLE, small ? null : headRight(data));
  head.url = REMINDERS_URL;
  if (data.error) { S.note(w, innerW, data.error); return S.finish(w); }
  if (!data.items.length) { S.note(w, innerW, "Nothing to do", small ? 0 : S.TIME_W); return S.finish(w); }
  const run = URLScheme.forRunningScript();
  data.items.slice(0, S.rowsFor(availH, 1)).forEach((it, i) => {
    if (i > 0) w.addSpacer(S.ROW_GAP);
    const cells = small ? [{ text: it.title }] : [{ text: whenText(it), w: S.TIME_W, mono: true }, { text: it.title }];
    S.row(w, innerW, cells).url = `${run}?done=${encodeURIComponent(it.id)}`;
  });
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
  w.url = REMINDERS_URL;
  lockLines(data, 3).forEach((text, i) => { if (i > 0) w.addSpacer(3); S.lockText(w, text); });
  w.addSpacer();
  return w;
}
const dueCount = data => data.error ? 0 : data.items.filter(it => it.overdue || it.today).length;

// ---- tapped a line: mark it done ----
async function complete(id) {
  let r = null;
  try { r = (await Reminder.allIncomplete()).find(x => x.identifier === id) || null; } catch (e) {}
  if (!r) return;   // done already, or deleted
  const a = new Alert();
  a.title = r.title;
  a.addAction("Mark as done");
  a.addAction("Open Reminders");
  a.addCancelAction("Cancel");
  const i = await a.presentSheet();
  if (i === 0) { r.isCompleted = true; r.save(); }
  else if (i === 1) Safari.open(REMINDERS_URL);
}

// ---- run ----
const query = args.queryParameters || {};
if (!config.runsInWidget && query.done) {
  await complete(query.done);
  try { App.close(); } catch (e) {}
} else {
  const data = await load();   // the first run in the app asks for Reminders access
  const family = config.widgetFamily;
  const widget = family === "accessoryRectangular" ? buildLockRect(data)
    : family === "accessoryCircular" ? S.lockCircle(String(dueCount(data)))
    : family === "accessoryInline" ? S.lockInline(lockLines(data, 1)[0])
    : buildWidget(data);
  S.refresh(widget);
  if (config.runsInWidget) Script.setWidget(widget);
  else await widget.presentMedium();   // preview when run inside the app
}
Script.complete();
