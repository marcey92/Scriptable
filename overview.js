const S = importModule("swiss");
const C = importModule("lib-calendar");
const H = importModule("lib-habits");
const N = importModule("lib-now");

// Overview: habits, calendar and "Inbox" in one large widget, stacked under their own headers.
// Each part is drawn by the same code as its own widget (lib-calendar, lib-habits, lib-now).
// As in the habit widget, tapping a habit row ticks it for today and tapping the Habits header opens the menu;
// tapping the calendar opens the Calendar app, and tapping the Inbox opens Mail.
const CALENDAR_URL = "calshow://";   // opens the Calendar app
const NOW_MIN_ROWS = 3;   // the calendar never leaves Inbox fewer rows than this (or than its items)

function build(cal, habits, now) {
  const w = S.widget();
  const m = S.metrics(config.runsInWidget ? undefined : "large");   // the in-app preview is large
  const { innerW, availH, large } = m;
  if (!large) {
    S.header(w, innerW, "Overview", null);
    S.row(w, innerW, [{ text: "Made for the large widget size" }]);
    return S.finish(w);
  }

  // height left once the three headers, the gaps between sections and the habit rows are paid for,
  // shared by the calendar and Inbox: the calendar takes what it needs up to half, plus whatever Inbox
  // has no items for; Inbox keeps at least NOW_MIN_ROWS (or as many as it has items)
  const rowsH = k => k * S.ROW + Math.max(0, k - 1) * S.ROW_GAP;
  const rest = availH - 3 * S.HEAD_H - 2 * S.SECTION_GAP - rowsH(H.HABITS.length);
  const nowNeed = Math.max(1, N.items(now).length);
  const cap = Math.min(Math.max(Math.ceil(rest / 2), rest - rowsH(nowNeed)), rest - rowsH(Math.min(NOW_MIN_ROWS, nowNeed)));
  const calH = C.fitLines(cal, Math.max(S.ROW, cap)).height;
  const nowRows = Math.max(1, Math.floor((rest - calH + S.ROW_GAP) / (S.ROW + S.ROW_GAP)));

  // habits first; tap the header for the menu
  const runURL = URLScheme.forRunningScript();
  const head = S.header(w, innerW, "Habits", S.dateLabel());   // the date: the next event is in the Calendar below
  head.url = `${runURL}?menu=1`;
  H.drawRows(w, innerW, S.ROW, habits, runURL);

  // calendar: tapping anywhere in it opens the Calendar app
  w.addSpacer(S.SECTION_GAP);
  const calBox = w.addStack(); calBox.layoutVertically(); calBox.url = CALENDAR_URL;
  const head1 = C.firstHeading(cal);
  S.header(calBox, innerW, head1.title, head1.right);
  C.drawUpcoming(calBox, innerW, calH, cal);

  // Inbox sits on the bottom edge: any height left over (a short Inbox list, or a slot taller than
  // planned) becomes space above it, never a gap at the bottom
  // and tapping the Inbox opens Mail
  w.addSpacer(S.SECTION_GAP);
  w.addSpacer();
  const inBox = w.addStack(); inBox.layoutVertically(); inBox.url = N.MAIL_URL;
  S.header(inBox, innerW, N.TITLE, N.headRight(now));
  N.drawRows(inBox, innerW, nowRows, now);

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
