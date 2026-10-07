const S = importModule("swiss");
const C = importModule("lib-calendar");

// Add this script as a widget more than once to get separate calendars.
// Each widget can carry its own setting in the widget's "Parameter" field:
//   Work, Family              -> only those calendars
//   Google: you@gmail.com     -> a label in the header, then the calendars to show
// With no parameter, the settings below apply.
const CALENDARS = [];         // e.g. ["Home", "Work"]; empty = all calendars
const LABEL = "";             // optional word in front of the day, e.g. "Google"

// ---- settings from the widget parameter ----
function settings() {
  let label = LABEL, names = CALENDARS;
  const param = (args.widgetParameter || "").trim();
  if (param) {
    const parts = param.split(":");
    if (parts.length > 1) label = parts.shift().trim();
    const list = parts.join(":").split(",").map(x => x.trim()).filter(Boolean);
    if (list.length) names = list;
  }
  return { label, names };
}

// ---- run ----
const { label, names } = settings();
const result = await C.loadDays(names);   // first run in the app triggers the calendar permission prompt
const family = config.widgetFamily;
const widget = family === "accessoryInline" ? S.lockInline(C.lockLines(result, 1)[0])
  : family === "accessoryRectangular" ? C.buildLockRect(result)
  : C.buildWidget(result, label);
S.refresh(widget);

if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  // run inside the app: list the calendar names you can use, then show a preview
  try {
    const all = await Calendar.forEvents();
    console.log("Calendars: " + all.map(c => c.title).join(", "));
  } catch (e) {}
  await widget.presentMedium();
}
Script.complete();
