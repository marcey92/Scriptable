const S = importModule("swiss");
const C = importModule("lib-calendar");
const H = importModule("lib-habits");
const N = importModule("lib-now");

// Overview: calendar, habits and "Inbox" in one large widget, stacked under their own headers.
// Each part is drawn by the same code as its own widget (lib-calendar, lib-habits, lib-now).
// Tapping a habit row ticks it for today, as in the habit widget.
const NOW_MIN_ROWS = 3;   // the calendar never leaves Inbox fewer rows than this

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

  // height left once the three headers, the gaps between sections and the habit rows are paid for,
  // shared by calendar and Inbox: the calendar takes what it needs up to half, Inbox gets the rest
  const rowsH = k => k * S.ROW + Math.max(0, k - 1) * S.ROW_GAP;
  const rest = availH - 3 * S.HEAD_H - 2 * S.SECTION_GAP - rowsH(H.HABITS.length);
  const cap = Math.max(S.ROW, Math.min(rest - rowsH(NOW_MIN_ROWS), Math.ceil(rest / 2)));
  const calH = C.fitLines(cal, cap).height;
  const nowRows = Math.max(1, Math.floor((rest - calH + S.ROW_GAP) / (S.ROW + S.ROW_GAP)));

  const first = (cal.days || [])[0];
  S.header(w, innerW, first ? C.dayTitle(first.offset, first.date, "") : "Today", S.dayMonth(first ? first.date : new Date()));
  C.drawUpcoming(w, innerW, calH, cal, "");

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
