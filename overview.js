const S = importModule("swiss");
const C = importModule("lib-calendar");
const H = importModule("lib-habits");
const N = importModule("lib-now");

// Overview: calendar, habits and "Now" in one large widget, stacked under their own headers.
// Each part is drawn by the same code as its own widget (lib-calendar, lib-habits, lib-now).
// Tapping a habit row ticks it for today, as in the habit widget.
const NOW_MIN_ROWS = 3;   // the calendar never leaves Now fewer rows than this

function build(cal, habits, now) {
  const w = S.widget();
  const m = S.metrics();
  const large = m.large || !config.runsInWidget;    // the in-app preview is large
  const { innerW } = m, availH = large ? 312 : m.availH;
  if (!large) {
    S.header(w, innerW, "Overview", null);
    S.row(w, innerW, [{ text: "Made for the large widget size" }]);
    return S.finish(w);
  }

  // rows left once the three headers and the habit rows are paid for, shared by calendar and Now:
  // the calendar takes what it needs up to half, Now gets the rest
  const rest = Math.max(2, S.rowsFor(availH, 3) - H.HABITS.length);
  const cap = Math.max(1, Math.min(rest - NOW_MIN_ROWS, Math.ceil(rest / 2)));
  const calRows = Math.max(1, C.fitLines(cal, cap).length);
  const nowRows = Math.max(1, rest - calRows);

  const first = (cal.days || [])[0];
  S.header(w, innerW, first ? C.dayTitle(first.offset, first.date, "") : "Today", S.dayMonth(first ? first.date : new Date()));
  C.drawUpcoming(w, innerW, calRows, cal, "");

  w.addSpacer(S.SECTION_GAP);
  S.header(w, innerW, "Habits", H.todayCount(habits));
  H.drawRows(w, innerW, S.ROW, habits, URLScheme.forRunningScript());

  w.addSpacer(S.SECTION_GAP);
  S.header(w, innerW, N.TITLE, N.headRight(now));
  N.drawRows(w, innerW, nowRows, now);

  return S.finish(w);
}

// ---- run ----
const tapped = (args.queryParameters || {}).habit;
if (!config.runsInWidget && tapped && H.HABITS.includes(tapped)) {
  H.toggle(await H.load(), tapped);     // one-tap from a habit row
  try { App.close(); } catch (e) {}     // drop back to the Home Screen
} else {
  // the first run in the app asks for calendar access and, if missing, the feed's read token
  const cal = await C.loadDays([]);
  const habits = await H.load();
  const now = await N.load(await N.token());
  const family = config.widgetFamily;
  const widget = family && family.startsWith("accessory") ? S.lockInline("Overview: use the large size") : build(cal, habits, now);
  S.refresh(widget);
  if (config.runsInWidget) Script.setWidget(widget);
  else await widget.presentLarge();     // preview when run inside the app
}
Script.complete();
