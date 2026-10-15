const S = importModule("swiss");
const C = importModule("lib-calendar");
const H = importModule("lib-habits");
const N = importModule("lib-now");

// Overview, set like a timetable on a 15 pt grid (see "the grid" in swiss.js):
//   Thu 15.10   S S M T W T F S S M T W T        <- ruler: the date, then each day's initial
//   Anki        ■ ■ □ ■ ...                 11   <- one row per habit, 13 days, count
//   Calendar    ━━━━━━━━━━━━━━━━━━━━ +2 later    <- section row: label, 2 pt rule, status
//   THU  14:00  Psychoanalysis                   <- day | time | what; a 1 pt rule starts each later day
//   Inbox       ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   WED  11:12  ★ Homes & Villas  €900 claim...  <- day | time | sender | detail, at most INBOX_MAX
// Each part is drawn by the same libraries as its own widget (lib-habits, lib-calendar, lib-now).
// Tapping a habit row ticks it for today, tapping the ruler opens the habit menu, tapping the calendar
// opens Calendar and tapping the Inbox opens Mail.
const CALENDAR_URL = "calshow://";
const INBOX_MAX = 5;   // the Inbox never shows more than this many items; the calendar gets the rest

function build(cal, habits, now) {
  const w = S.widget();
  w.setPadding(...S.G_PAD);
  const g = S.grid(config.runsInWidget ? undefined : "large");   // the in-app preview is large
  if (!g.large) {
    S.gRow(w, g.W, [{ text: "Overview", w: S.G.KEY, font: S.F.key }, { text: "Made for the large widget size" }]);
    return S.finish(w);
  }

  // rows: 5 for the habit band, 1 for each section row, the rest shared by the calendar and Inbox
  const shared = g.rows - (1 + H.HABITS.length) - 2;
  const calRows = C.timetableRows(cal);
  const inN = Math.max(1, Math.min(INBOX_MAX, N.items(now).length));
  const calN = Math.max(1, Math.min(calRows.length || 1, shared - inN));
  const more = calRows.length - calN;

  const runURL = URLScheme.forRunningScript();
  H.drawGrid(w, g.W, habits, runURL);

  const calBox = w.addStack(); calBox.layoutVertically(); calBox.url = CALENDAR_URL;
  S.gSection(calBox, g.W, "Calendar", more > 0 ? `+${more} later` : null);
  C.drawTimetable(calBox, g.W, calRows, calN);

  const inBox = w.addStack(); inBox.layoutVertically(); inBox.url = N.MAIL_URL;
  S.gSection(inBox, g.W, N.TITLE, N.isStale(now) ? N.headRight(now) : null);
  N.drawTimetable(inBox, g.W, now, inN);

  w.addSpacer();   // only when both lists are short, or the slot is taller than the grid
  return S.refresh(w);
}

// ---- run ----
const query = args.queryParameters || {};
const tapped = query.habit;
if (!config.runsInWidget && tapped && H.HABITS.includes(tapped)) {
  H.toggle(await H.load(), tapped);     // one-tap from a habit row
  try { App.close(); } catch (e) {}     // drop back to the Home Screen
} else if (!config.runsInWidget && query.menu) {
  await H.menu(await H.load());         // tapped the Habits header: the tick-off menu
} else {
  // the first run in the app asks for calendar access and, if missing, the feed's read token
  const token = await N.token();
  await C.syncFromFeed(token);         // add any events Hermes pushed before reading the calendar
  const cal = await C.loadDays([], true);   // all-day events too: they go in the day headings
  const habits = await H.load();
  const now = await N.load(token);
  const family = config.widgetFamily;
  const widget = family && family.startsWith("accessory") ? S.lockInline("Overview: use the large size") : build(cal, habits, now);
  S.refresh(widget);
  if (config.runsInWidget) Script.setWidget(widget);
  else await widget.presentLarge();     // preview when run inside the app
}
Script.complete();
