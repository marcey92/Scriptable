const S = importModule("swiss");
const H = importModule("lib-habits");

// One row of boxes per habit; tap a row to tick today. The habits and drawing live in lib-habits.js.

// ---- run ----
const data = await H.load();
const tapped = (args.queryParameters || {}).habit;

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
} else {
  await H.nextEvent();                    // first run in the app triggers the calendar permission prompt
  await H.menu(data);
}
Script.complete();
