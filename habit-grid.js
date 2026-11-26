const S = importModule("swiss");
const H = importModule("lib-habits");

// One row of boxes per habit; tap a row to tick today, tap a habit's name to change earlier days. The habits and drawing live in lib-habits.js.

// ---- run ----
const data = await H.load();
const query = args.queryParameters || {};
const tapped = query.habit;

if (config.runsInWidget) {
  const f = config.widgetFamily;
  let w;
  if (f === "accessoryRectangular") w = H.buildLockRect(data);
  else if (f === "accessoryCircular") w = H.buildLockCircle(data);
  else if (f === "accessoryInline") w = H.buildLockInline(data);
  else w = H.buildWidget(data, await H.nextEvent());
  Script.setWidget(S.refresh(w));
} else if (tapped && H.HABITS.includes(tapped)) {
  H.toggle(data, tapped);                 // one-tap from a widget row
  try { App.close(); } catch (e) {}     // drop back to the Home Screen
} else if (query.days && H.HABITS.includes(query.days)) {
  await H.habitDays(data, query.days);    // tapped a habit's name: fix earlier days
  try { App.close(); } catch (e) {}
} else {
  await H.nextEvent();                    // first run in the app triggers the calendar permission prompt
  await H.menu(data);
}
Script.complete();
