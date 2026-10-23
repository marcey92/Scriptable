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
// the habit day turns over at DAY_STARTS, not midnight: ticking at 1am counts for the evening before
const DAY_STARTS = 4;   // hour
function habitNow() { return new Date(Date.now() - DAY_STARTS * 3600 * 1000); }

function lastDays(n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = habitNow(); d.setDate(d.getDate() - i); out.push(d);
  }
  return out;
}

// ---- ticking ----
// `d` defaults to today; the menu's "Earlier days…" passes a past day
function toggle(data, h, d = habitNow()) {
  const k = key(d), list = data[h] || [];
  data[h] = list.includes(k) ? list.filter(x => x !== k) : [...list, k];
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
// `extras`: further lines under the habits, [{ label, run }] (the overview adds "Calendars…")
const EARLIER_DAYS = 13;   // how far back "Earlier days…" reaches (the overview's grid shows 13 days)
async function menu(data, extras = []) {
  await dayMenu(data, habitNow(), "Today's habits",
    [{ label: "Earlier days…", run: () => earlierMenu(data) }, ...extras], "Done");
}

// one day's habits: tap a habit to tick or untick it on that day
async function dayMenu(data, d, title, extras = [], cancel = "Back") {
  while (true) {
    const a = new Alert();
    a.title = title;
    for (const h of HABITS) a.addAction((isDone(data, h, d) ? "✓ " : "") + h);
    for (const x of extras) a.addAction(x.label);
    a.addCancelAction(cancel);
    const i = await a.presentSheet();
    if (i === -1) break;
    if (i >= HABITS.length) { await extras[i - HABITS.length].run(); continue; }
    toggle(data, HABITS[i], d);
  }
}

// pick a past day (yesterday first), then tick its habits; for days missed on the widget
async function earlierMenu(data) {
  const days = lastDays(EARLIER_DAYS + 1).slice(0, -1).reverse();
  while (true) {
    const a = new Alert();
    a.title = "Earlier days";
    const labels = days.map((d, i) => i === 0 ? `Yesterday ${S.dayMonth(d)}` : S.dateLabel(d));
    days.forEach((d, i) => {
      const done = HABITS.filter(h => isDone(data, h, d)).length;
      a.addAction(`${labels[i]}  ${done}/${HABITS.length}`);
    });
    a.addCancelAction("Back");
    const i = await a.presentSheet();
    if (i === -1) break;
    await dayMenu(data, days[i], `Habits on ${labels[i]}`);
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
    const num = row.addText(String(done)); num.lineLimit = 1;
    num.font = Font.regularMonospacedSystemFont(textSize); num.textColor = S.FG;
  });
}

// ---- the overview's habit band, on the 15 pt grid ----
// A ruler row (the date in the key column, then each day's initial over its column, today in semibold;
// tapping it opens the menu), then one row per habit: name | a box per day | count of the days shown.
// Each day is one 15 pt slot: a 12 pt box (or the initial) at its left, then the 3 pt gap.
const GRID_DAYS = 13, GRID_BOX = 12;
function drawGrid(w, W, data, runURL) {
  const days = lastDays(GRID_DAYS);
  const countW = W - S.G.KEY - GRID_DAYS * S.M;
  const ruler = w.addStack(); ruler.size = new Size(W, S.M); ruler.centerAlignContent(); ruler.spacing = 0;
  ruler.url = `${runURL}?menu=1`;
  S.gSign(ruler, S.dateLabel());   // the date as the habit band's sign, like Calendar and Inbox below
  // the initials are drawn into a picture, each centred over its box at exactly 15 pt spacing: laid out
  // as text they either clipped (narrow cells) or drifted (the font's real width differs on the phone)
  const ctx = new DrawContext();
  ctx.size = new Size(GRID_DAYS * S.M, S.M);
  ctx.opaque = false;
  ctx.respectScreenScale = true;
  ctx.setTextAlignedCenter();
  ctx.setTextColor(S.FG);
  days.forEach((d, i) => {
    ctx.setFont(i === days.length - 1 ? S.F.key : S.F.text);
    ctx.drawTextInRect(S.WD[d.getDay()][0], new Rect(i * S.M, 1, GRID_BOX, S.M - 1));
  });
  const img = ruler.addImage(ctx.getImage());
  img.imageSize = new Size(GRID_DAYS * S.M, S.M);
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
    // the count is drawn, right-aligned, like the initials: on a mini its slot is only 15 pt wide,
    // and text in a cell that narrow gets clipped
    const ctx = new DrawContext();
    ctx.size = new Size(countW, S.M); ctx.opaque = false; ctx.respectScreenScale = true;
    ctx.setTextAlignedRight(); ctx.setTextColor(S.FG); ctx.setFont(S.F.mono);
    ctx.drawTextInRect(String(done), new Rect(0, 1, countW, S.M - 1));
    const num = row.addImage(ctx.getImage()); num.imageSize = new Size(countW, S.M);
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
  const today = habitNow();
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
  const today = habitNow();
  const done = HABITS.filter(h => isDone(data, h, today)).length;
  return S.lockInline(`${TITLE} ${done}/${HABITS.length}`);
}

module.exports = { drawGrid, HABITS, load, toggle, menu, nextEvent, drawRows, buildWidget, buildLockRect, buildLockCircle, buildLockInline };
