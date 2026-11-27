// lib-habits.js: the habits for overview.js: storage, ticking, menus and the habit band. Not a widget by itself.
// Edit HABITS here.
const S = importModule("swiss");

const HABITS = ["Anki", "Cold shower", "Meditate", "Gratitude"];

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

// one habit's last days, today first: tap a day to tick or untick it (tapping a habit's name on a widget)
async function habitDays(data, h) {
  const days = lastDays(EARLIER_DAYS + 1).reverse();
  while (true) {
    const a = new Alert();
    a.title = h;
    a.message = "Tap a day to tick or untick it";
    days.forEach((d, i) => {
      const label = i === 0 ? "Today" : i === 1 ? `Yesterday ${S.dayMonth(d)}` : S.dateLabel(d);
      a.addAction((isDone(data, h, d) ? "✓ " : "") + label);
    });
    a.addCancelAction("Done");
    const i = await a.presentSheet();
    if (i === -1) break;
    toggle(data, h, days[i]);
  }
}

// ---- the overview's habit band, on the 15 pt grid ----
// A ruler row (the date as a sign, then each day's initial over its column, today in semibold; tapping it
// redraws the widget), then one row per habit: name | a box per day | count of the days shown.
// Each day is one 15 pt slot: a 12 pt box (or the initial) at its left, then the 3 pt gap.
// On a screen missing from S.WIDGET_W the width falls back to the narrowest, where 13 days don't fit
// (an iPhone Duo's inner screen drew "Invalid canvas size: -22 by 15"): show fewer days, keep the count.
const GRID_DAYS = 13, GRID_BOX = 12, COUNT_MIN = S.M;   // a mini (300 pt) leaves exactly 15 pt: still 13 days
function drawGrid(w, W, data, runURL) {
  const nDays = Math.max(1, Math.min(GRID_DAYS, Math.floor((W - S.G.KEY - COUNT_MIN) / S.M)));
  const days = lastDays(nDays);
  const countW = W - S.G.KEY - nDays * S.M;
  const ruler = w.addStack(); ruler.size = new Size(W, S.M); ruler.centerAlignContent(); ruler.spacing = 0;
  // tapping the date row redraws the widget (where tap actions are missing, it opens the habit menu). A tap
  // action only takes on a stack with a background (see swiss.js). The widget's own navy showed as a band
  // (iOS styles the widget background, not a stack's), so the row gets white at 1%: invisible, but there.
  if (S.canAct(ruler)) { ruler.backgroundColor = S.TAP_BG; ruler.setAction("Refresh", { id: "refresh" }); }
  else ruler.url = `${runURL}?menu=1`;
  S.gSign(ruler, S.dateLabel());   // the date as the habit band's sign, like Calendar and Inbox below
  // the initials are drawn into a picture, each centred over its box at exactly 15 pt spacing: laid out
  // as text they either clipped (narrow cells) or drifted (the font's real width differs on the phone)
  const ctx = new DrawContext();
  ctx.size = new Size(nDays * S.M, S.M);
  ctx.opaque = false;
  ctx.respectScreenScale = true;
  ctx.setTextAlignedCenter();
  ctx.setTextColor(S.FG);
  days.forEach((d, i) => {
    ctx.setFont(i === days.length - 1 ? S.F.key : S.F.text);
    ctx.drawTextInRect(S.WD[d.getDay()][0], new Rect(i * S.M, 1, GRID_BOX, S.M - 1));
  });
  const img = ruler.addImage(ctx.getImage());
  img.imageSize = new Size(nDays * S.M, S.M);
  S.gCell(ruler, { text: "", w: countW }, S.M);

  for (const h of HABITS) {
    const row = w.addStack(); row.size = new Size(W, S.M); row.centerAlignContent(); row.spacing = 0;
    // two tap areas side by side, never nested (on the phone a link on the row beat the one on the name):
    // the name lists the habit's days to fix earlier ones; the boxes and count tick today
    S.gCell(row, { text: h, w: S.G.KEY }, S.M).url = `${runURL}?days=${encodeURIComponent(h)}`;
    const ticks = row.addStack(); ticks.size = new Size(W - S.G.KEY, S.M); ticks.centerAlignContent(); ticks.spacing = 0;
    ticks.url = `${runURL}?habit=${encodeURIComponent(h)}`;
    let done = 0;
    for (const d of days) {
      const on = isDone(data, h, d); if (on) done++;
      S.box(ticks, GRID_BOX, on);
      ticks.addSpacer(S.M - GRID_BOX);
    }
    // the count is drawn, right-aligned, like the initials: on a mini its slot is only 15 pt wide,
    // and text in a cell that narrow gets clipped
    const ctx = new DrawContext();
    ctx.size = new Size(countW, S.M); ctx.opaque = false; ctx.respectScreenScale = true;
    ctx.setTextAlignedRight(); ctx.setTextColor(S.FG); ctx.setFont(S.F.mono);
    ctx.drawTextInRect(String(done), new Rect(0, 1, countW, S.M - 1));
    const num = ticks.addImage(ctx.getImage()); num.imageSize = new Size(countW, S.M);
  }
}

module.exports = { drawGrid, HABITS, load, toggle, menu, habitDays };
