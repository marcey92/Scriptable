const S = importModule("swiss");

const TITLE = "Battery";
const NUMBER_SIZE = 34;   // the big figure

// ---- battery ----
function level() {
  return Math.max(0, Math.min(100, Math.round(Device.batteryLevel() * 100)));
}
// boxes to fill out of `count`; any charge at all shows at least one
function filled(count) {
  const pct = level();
  return pct === 0 ? 0 : Math.max(1, Math.round(pct / 100 * count));
}
function state() {
  if (Device.isFullyCharged()) return "Full";
  if (Device.isCharging()) return "Charging";
  return null;
}

// ---- Home Screen widget: big figure, then a bar of boxes ----
function buildWidget() {
  const w = S.widget();
  const { innerW, small } = S.metrics();
  const pct = level();

  S.header(w, innerW, TITLE, state() || (small ? null : S.dateLabel()));

  // figure with a small percent sign on the same baseline
  const fig = w.addStack(); fig.size = new Size(innerW, NUMBER_SIZE + 4); fig.bottomAlignContent();
  const num = fig.addText(String(pct)); num.lineLimit = 1;
  num.font = Font.mediumSystemFont(NUMBER_SIZE); num.textColor = S.FG;
  fig.addSpacer(2);
  const unit = fig.addText("%"); unit.lineLimit = 1;
  unit.font = Font.mediumSystemFont(S.TITLE_SIZE); unit.textColor = S.FG;
  fig.addSpacer();

  // bar: 10 boxes of 10% in the small size, 20 boxes of 5% otherwise
  w.addSpacer(8);
  const count = small ? 10 : 20;
  const size = Math.max(4, Math.min(S.BOX, Math.floor((innerW - (count - 1) * S.BOX_GAP) / count)));
  const bar = w.addStack(); bar.size = new Size(innerW, size); bar.centerAlignContent();
  S.bar(bar, count, size, filled(count));
  bar.addSpacer();

  return S.finish(w);
}

// ---- Lock Screen: title, rule, bar of ten boxes ----
function buildLockRect() {
  const w = S.lockWidget();
  const count = 10, size = S.LOCK_BOX;
  S.lockHeader(w, count * (size + S.BOX_GAP) - S.BOX_GAP, TITLE);
  const bar = w.addStack(); bar.centerAlignContent();
  S.bar(bar, count, size, filled(count), true);
  bar.addSpacer();
  w.addSpacer();
  return w;
}

// ---- run ----
const family = config.widgetFamily;
const widget = family === "accessoryRectangular" ? buildLockRect()
  : family === "accessoryCircular" ? S.lockCircle(String(level()))
  : family === "accessoryInline" ? S.lockInline(`${TITLE} ${level()}%`)
  : buildWidget();
S.refresh(widget);

if (config.runsInWidget) Script.setWidget(widget);
else await widget.presentSmall();   // preview when run inside the app
Script.complete();
