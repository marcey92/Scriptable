// lib-habits.js: the habit grid (habit-grid.js and overview.js load it). Not a widget by itself.
// Edit HABITS here; both widgets follow.
const S = importModule("swiss");

const HABITS = ["Anki", "Cold shower", "Meditate", "Gratitude"];
const TITLE = "Habits";
const LOCK_TITLE = true;  // title and rule above the Lock Screen grid
const SHOW_EVENT = true;  // next calendar event in the header (falls back to date)
const LOCK_H = 66;         // usable height of the rectangular Lock Screen slot
const NAME_W = 84;        // width of the habit-name column
const COUNT_W = 18;       // width of the count column

// ---- storage: a JSON file in Scriptable's folder ----
let fm, cloud = true;
try { fm = FileManager.iCloud(); fm.documentsDirectory(); }
catch (e) { fm = FileManager.local(); cloud = false; }
const path = fm.joinPath(fm.documentsDirectory(), "habit-grid.json");

async function load() {
  if (!fm.fileExists(path)) return {};
  if (cloud) await fm.downloadFileFromiCloud(path);
  try { return JSON.parse(fm.readString(path)); } catch (e) { return {}; }
}
function save(data) { fm.writeString(path, JSON.stringify(data)); }

// ---- dates ----
function key(d) {
  return `${d.getFullYear()}-${S.p(d.getMonth() + 1)}-${S.p(d.getDate())}`;
}
function lastDays(n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i); out.push(d);
  }
  return out;
}

// ---- ticking ----
function toggle(data, h) {
  const today = key(new Date()), list = data[h] || [];
  data[h] = list.includes(today) ? list.filter(x => x !== today) : [...list, today];
  save(data);
}
function isDone(data, h, d) { return (data[h] || []).includes(key(d)); }

// ---- calendar: title of the next timed event still to come today ----
async function nextEvent() {
  if (!SHOW_EVENT) return null;
  try {
    const now = new Date();
    const evs = await CalendarEvent.today([]);
    const next = evs
      .filter(e => !e.isAllDay && e.startDate > now)
      .sort((a, b) => a.startDate - b.startDate)[0];
    return next ? next.title : null;
  } catch (e) { return null; }
}

// ---- tick-off menu (tap the header, or run the script in the app) ----
async function menu(data) {
  const today = new Date();
  while (true) {
    const a = new Alert();
    a.title = "Today's habits";
    for (const h of HABITS) a.addAction((isDone(data, h, today) ? "✓ " : "") + h);
    a.addCancelAction("Done");
    const i = await a.presentSheet();
    if (i === -1) break;
    toggle(data, HABITS[i]);
  }
}

// ---- Home Screen widget ----
function buildWidget(data, eventTitle) {
  const w = S.widget();
  const runURL = URLScheme.forRunningScript();
  const { innerW, availH } = S.metrics();

  const gridH = availH - S.HEAD_H;
  const cell = Math.max(6, Math.min(S.BOX, Math.floor(gridH / HABITS.length) - S.ROW_GAP));

  // header: tapping it opens the menu
  const head = S.header(w, innerW, TITLE, eventTitle || S.dateLabel());
  head.url = runURL;

  drawRows(w, innerW, cell, data, runURL);
  return S.finish(w);
}

// one row per habit: name, a box per day (today on the right), count. Tapping a row opens
// `runURL?habit=<name>`, and the script behind runURL ticks it (also used by the overview widget).
function drawRows(w, innerW, cell, data, runURL) {
  const gap = S.BOX_GAP;
  const count = Math.max(1, Math.floor((innerW - NAME_W - COUNT_W - gap) / (cell + gap)));
  const days = lastDays(count);
  const textSize = Math.max(9, Math.min(S.TEXT_SIZE, cell - 2));

  HABITS.forEach((h, i) => {
    if (i > 0) w.addSpacer(S.ROW_GAP);
    const row = w.addStack(); row.size = new Size(innerW, cell);
    row.spacing = gap; row.centerAlignContent();
    row.url = `${runURL}?habit=${encodeURIComponent(h)}`;

    const n = row.addStack(); n.size = new Size(NAME_W, cell); n.centerAlignContent();
    const t = n.addText(h); t.lineLimit = 1;
    t.font = Font.mediumSystemFont(textSize); t.textColor = S.FG;
    n.addSpacer();

    let done = 0;
    for (const d of days) {
      const on = isDone(data, h, d); if (on) done++;
      S.box(row, cell, on);
    }

    row.addSpacer();
    const num = row.addText(S.p(done)); num.lineLimit = 1;
    num.font = Font.regularMonospacedSystemFont(textSize); num.textColor = S.FG;
  });
}

// ---- Lock Screen widgets ----
// rectangular: one row per habit, no names, today set apart on the right
function buildLockRect(data) {
  const w = S.lockWidget();
  // shrink the boxes when there are more habits, so every row fits the slot
  const gap = S.BOX_GAP, todayGap = 7, n = HABITS.length;
  const rowGap = LOCK_TITLE || n > 3 ? 3 : 5;
  const roomH = LOCK_H - (LOCK_TITLE ? 22 : 0) - (n - 1) * rowGap;
  const box = Math.max(5, Math.min(S.LOCK_BOX, Math.floor(roomH / n)));
  const past = Math.max(1, Math.floor((S.LOCK_W - box - todayGap + gap) / (box + gap)));
  const days = lastDays(past + 1);
  const today = days.pop();

  if (LOCK_TITLE) S.lockHeader(w, past * (box + gap) - gap + todayGap + box, TITLE);

  HABITS.forEach((h, i) => {
    if (i > 0) w.addSpacer(rowGap);
    const row = w.addStack(); row.centerAlignContent();
    days.forEach((d, j) => {
      if (j > 0) row.addSpacer(gap);
      S.box(row, box, isDone(data, h, d), true);
    });
    row.addSpacer(todayGap);
    S.box(row, box, isDone(data, h, today), true);
    row.addSpacer();
  });
  return w;
}

// circular: today only, one box per habit
function buildLockCircle(data) {
  const w = S.lockWidget();
  const today = new Date();
  const size = Math.max(6, Math.min(12, Math.floor(44 / HABITS.length) - 3));
  w.addSpacer();
  HABITS.forEach((h, i) => {
    if (i > 0) w.addSpacer(3);
    const row = w.addStack();
    row.addSpacer();
    S.box(row, size, isDone(data, h, today), true);
    row.addSpacer();
  });
  w.addSpacer();
  return w;
}

// inline: the text line above the clock
function buildLockInline(data) {
  const today = new Date();
  const done = HABITS.filter(h => isDone(data, h, today)).length;
  return S.lockInline(`${TITLE} ${done}/${HABITS.length}`);
}

module.exports = { HABITS, load, toggle, menu, nextEvent, drawRows, buildWidget, buildLockRect, buildLockCircle, buildLockInline };
