// lib-habits.js: the habit grid (habit-grid.js and overview.js load it). Not a widget by itself.
// Edit HABITS here; both widgets follow.
const S = importModule("swiss");

const HABITS = ["Anki", "Cold shower", "Meditate", "Gratitude"];
const TITLE = "Habits";
const LOCK_TITLE = true;  // title and rule above the Lock Screen grid
const SHOW_EVENT = true;  // next calendar event in the header (falls back to date)
const LOCK_H = 66;         // usable height of the rectangular Lock Screen slot
const NAME_W = 84;        // width of the habit-name column
const COUNT_W = 18;       // width of the count column (ticks in the days shown)

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
  // the row puts `gap` between every child, spacers included: name, boxes, spacer, count. The width
  // estimate leaves room to spare: an overfull row is clipped from the left, cutting into the names.
  const count = Math.max(1, Math.floor((innerW - NAME_W - COUNT_W - 2 * gap) / (cell + gap)));
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

// ---- the overview's habit band, on the 15 pt grid ----
// A ruler row (the date in the key column, then each day's initial over its column, today in semibold;
// tapping it opens the menu), then one row per habit: name | a box per day | count of the days shown.
// Each day is one 15 pt slot: a 12 pt box (or the initial) at its left, then the 3 pt gap.
const GRID_DAYS = 12, GRID_BOX = 12;
function drawGrid(w, W, data, runURL) {
  const days = lastDays(GRID_DAYS);
  const countW = W - S.G.KEY - GRID_DAYS * S.M;
  const ruler = w.addStack(); ruler.size = new Size(W, S.M); ruler.centerAlignContent(); ruler.spacing = 0;
  ruler.url = `${runURL}?menu=1`;
  S.gCell(ruler, { text: S.dateLabel(), w: S.G.KEY, font: S.F.key }, S.M);
  days.forEach((d, i) => {
    const today = i === days.length - 1;
    S.gCell(ruler, { text: S.WD[d.getDay()][0], w: S.M, font: today ? S.F.key : S.F.text }, S.M);
  });
  S.gCell(ruler, { text: "", w: countW }, S.M);

  for (const h of HABITS) {
    const row = w.addStack(); row.size = new Size(W, S.M); row.centerAlignContent(); row.spacing = 0;
    row.url = `${runURL}?habit=${encodeURIComponent(h)}`;
    S.gCell(row, { text: h, w: S.G.KEY }, S.M);
    let done = 0;
    for (const d of days) {
      const on = isDone(data, h, d); if (on) done++;
      S.box(row, GRID_BOX, on);
      row.addSpacer(S.M - GRID_BOX);
    }
    S.gCell(row, { text: S.p(done), w: countW, font: S.F.mono, right: true }, S.M);
  }
}

// ---- Lock Screen widgets ----
// rectangular: one row per habit, no names, one continuous run of days ending with today on the right
function buildLockRect(data) {
  const w = S.lockWidget();
  // shrink the boxes when there are more habits, so every row fits the slot
  const gap = S.BOX_GAP, n = HABITS.length;
  const rowGap = LOCK_TITLE || n > 3 ? 3 : 5;
  const roomH = LOCK_H - (LOCK_TITLE ? 22 : 0) - (n - 1) * rowGap;
  const box = Math.max(5, Math.min(S.LOCK_BOX, Math.floor(roomH / n)));
  const count = Math.max(1, Math.floor((S.LOCK_W + gap) / (box + gap)));
  const days = lastDays(count);

  if (LOCK_TITLE) S.lockHeader(w, count * (box + gap) - gap, TITLE);

  HABITS.forEach((h, i) => {
    if (i > 0) w.addSpacer(rowGap);
    const row = w.addStack(); row.centerAlignContent();
    days.forEach((d, j) => {
      if (j > 0) row.addSpacer(gap);
      S.box(row, box, isDone(data, h, d), true);
    });
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

module.exports = { drawGrid, HABITS, load, toggle, menu, nextEvent, drawRows, buildWidget, buildLockRect, buildLockCircle, buildLockInline };
