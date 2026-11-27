// swiss.js: the shared style for every widget in this set.
// Change a value here and all widgets follow. Each widget loads it with importModule("swiss").

const S = {};

// ---- colours ----
S.BG = new Color("#0F1F47");            // deep navy, matched to the ocean wallpaper
S.FG = new Color("#FFFFFF");
S.EMPTY = new Color("#FFFFFF", 0.18);   // empty box
S.LOCK_ON = new Color("#FFFFFF");
S.LOCK_OFF = new Color("#FFFFFF", 0.3);

// ---- measurements ----
S.TITLE_SIZE = 13;
S.LOCK_W = 150;             // usable width of the rectangular Lock Screen slot
S.REFRESH_MIN = 15;

// ---- dates ----
S.p = n => String(n).padStart(2, "0");
S.WD = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
S.dayStart = offset => {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + offset); return d;
};
S.dayMonth = (d = new Date()) => `${S.p(d.getDate())}.${S.p(d.getMonth() + 1)}`;   // "07.10"
S.dateLabel = (d = new Date()) => `${S.WD[d.getDay()].slice(0, 3)} ${S.dayMonth(d)}`;   // "Tue 07.10"
S.timeLabel = d => `${S.p(d.getHours())}:${S.p(d.getMinutes())}`;

// ---- layout ----
// Home Screen widget heights per iPhone screen size (points, from Apple's widget sizes): small/medium, large.
// Unknown screens fall back to the smallest common heights, so nothing overflows.
S.WIDGET_H = {
  "430x932": [170, 382], "428x926": [170, 382], "414x896": [169, 379], "414x736": [159, 357],
  "402x874": [158, 354], "393x852": [158, 354], "390x844": [158, 354],
  "375x812": [155, 345], "360x780": [155, 345], "375x667": [148, 324], "320x568": [141, 311],
  "466x678": [155, 352],   // iPhone Duo, inner screen (Scriptable reports 466 x 678): measured from screenshots
};

// ---- the grid: the overview's timetable layout ----
// One 15 pt module across and down: text rows and habit boxes (12 pt + 3 pt gap) sit on the same lattice.
// Columns hang from fixed edges: D (day key) 0, T (time) 40, W (what) 90; Inbox splits W at 186.
// (Measured on the phone: "22.10" in semibold needs more than 36 pt and "–22.10" more than 45 pt.)
// One text size (11); hierarchy comes from weight and rules, never from grey.
S.M = 15;
S.G_PAD = [16, 14, 14, 15];   // top, left, bottom, right: a mini's large widget leaves 300 x 315 pt
S.G = { D: 40, T: 50, KEY: 90, W1: 96 };   // KEY = D + T: habit names and section labels hang in it
S.F = {
  text: Font.systemFont(11),
  key: Font.semiboldSystemFont(11),
  mono: Font.regularMonospacedSystemFont(11),
  monoKey: Font.boldMonospacedSystemFont(11),
};
// Home Screen widget widths (medium and large) per screen size; unknown screens get the narrowest
S.WIDGET_W = {
  "430x932": 364, "428x926": 364, "414x896": 360, "414x736": 348, "402x874": 338, "393x852": 338,
  "390x844": 338, "375x812": 329, "360x780": 329, "375x667": 321, "320x568": 292,
  "466x678": 332,   // iPhone Duo, inner screen
};
// the grid for a slot: W = content width, H = content height, rows = whole 15 pt rows that fit
S.grid = (as) => {
  const s = Device.screenSize(), k = `${Math.min(s.width, s.height)}x${Math.max(s.width, s.height)}`;
  const family = as || config.widgetFamily || "medium";
  const large = family === "large" || family === "extraLarge", small = family === "small";
  const [h, hLarge] = S.WIDGET_H[k] || [141, 311];
  const W = (small ? h : S.WIDGET_W[k] || 292) - S.G_PAD[1] - S.G_PAD[3];   // a small widget is square
  const H = (large ? hLarge : h) - S.G_PAD[0] - S.G_PAD[2];
  return { large, small, W, H, rows: Math.floor(H / S.M) };
};
// a widget set on the grid, opened by its name as a station sign (the overview's look):
//   [Weather]  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  London · UV 5
// returns { w, g, rows }: rows = grid rows left under the sign. The status is left off on a small widget.
S.board = (label, status, signUrl) => {
  const w = S.widget();
  const g = S.grid();
  S.gSection(w, g.W, label, g.small ? null : status, signUrl);
  return { w, g, rows: g.rows - 1 };
};
// a fixed-size cell: { text, w, font, right }; text is cut with "…", never shrunk
S.gCell = (row, c, h) => {
  const col = row.addStack(); col.size = new Size(c.w, h); col.centerAlignContent();
  if (c.right) col.addSpacer();
  const t = col.addText(String(c.text || "")); t.lineLimit = 1;
  t.font = c.font || S.F.text; t.textColor = S.FG;
  if (!c.right) col.addSpacer();
  return col;
};
// a row of cells, W wide and one module (or `h`) tall; the last cell may leave out w to take the rest
S.gRow = (parent, W, cells, h = S.M) => {
  const row = parent.addStack(); row.size = new Size(W, h); row.centerAlignContent(); row.spacing = 0;
  const fixed = cells.reduce((n, c) => n + (c.w || 0), 0);
  for (const c of cells) S.gCell(row, c.w ? c : { ...c, w: W - fixed }, h);
  return row;
};
// ---- tap actions (Scriptable 1.8, iOS 17+): a tap reruns the script inside the widget, which redraws ----
// Tested on the phone: a stack's action only takes when the stack has a background, and the script never
// learns what was tapped (args.widgetAction is null for stacks, buttons and toggles), so actions can only
// refresh. Where they're missing, callers fall back to URLs that open the app.
S.canAct = stack => typeof stack.setAction === "function";
S.TAP_BG = new Color("#FFFFFF", 0.01);   // a background you can't see, for stacks that carry a tap action

// a section row, like a station sign: the label reversed out of a white block in the key column (navy
// text on white), then a 2 pt rule to the right edge, with an optional status at its end
// ("Stale since 14:02")
const SIGN_GAP = 6;   // between the white block and the rule
// the sign itself: a white block in the key column, navy text, then the gap (KEY wide in all)
S.gSign = (row, label) => {
  const sign = row.addStack(); sign.size = new Size(S.G.KEY - SIGN_GAP, S.M - 1); sign.centerAlignContent();
  sign.backgroundColor = S.FG; sign.setPadding(0, 4, 0, 0);
  const t = sign.addText(label); t.lineLimit = 1; t.font = S.F.key; t.textColor = S.BG;
  sign.addSpacer();
  row.addSpacer(SIGN_GAP);
  return sign;
};
S.gSection = (parent, W, label, status, signUrl) => {
  const row = parent.addStack(); row.size = new Size(W, S.M); row.centerAlignContent(); row.spacing = 0;
  const sign = S.gSign(row, label);
  if (signUrl) sign.url = signUrl;   // the sign can do something of its own (the Calendar sign picks calendars)
  // the status is sized to its text, so the rule runs right up to it ("London" leaves a long rule).
  // 6.4 pt a character covers semibold 11 pt with room to spare: a short guess would cut the text.
  const textW = status ? Math.min(W - S.G.KEY - 30, Math.ceil(String(status).length * 6.4) + 4) : 0;
  const rule = row.addStack(); rule.size = new Size(W - S.G.KEY - (status ? textW + 6 : 0), 2); rule.backgroundColor = S.FG;
  if (status) { row.addSpacer(6); S.gCell(row, { text: status, w: textW, font: S.F.key, right: true }, S.M); }
  return row;
};

// a Home Screen widget with the panel colour and margins
S.widget = () => {
  const w = new ListWidget();
  w.backgroundColor = S.BG;
  w.setPadding(...S.G_PAD);
  return w;
};

// a square box, filled or empty
S.box = (parent, size, on, lock = false) => {
  const c = parent.addStack(); c.size = new Size(size, size); c.cornerRadius = 0;
  c.backgroundColor = lock ? (on ? S.LOCK_ON : S.LOCK_OFF) : (on ? S.FG : S.EMPTY);
  return c;
};

// push content to the top edge and set the refresh interval
S.finish = w => {
  w.addSpacer();
  return S.refresh(w);
};
S.refresh = w => {
  w.refreshAfterDate = new Date(Date.now() + S.REFRESH_MIN * 60 * 1000);
  return w;
};

// ---- Lock Screen ----
S.lockWidget = () => {
  const w = new ListWidget();
  w.setPadding(0, 0, 0, 0);
  return w;
};

// small title with a rule, `width` wide, flush left
S.lockHeader = (w, width, titleText) => {
  const outer = w.addStack();
  const head = outer.addStack(); head.size = new Size(width, 13); head.bottomAlignContent();
  const title = head.addText(titleText);
  title.font = Font.mediumSystemFont(11); title.textColor = S.LOCK_ON; title.lineLimit = 1;
  head.addSpacer();
  outer.addSpacer();
  w.addSpacer(3);
  const ruleRow = w.addStack();
  const rule = ruleRow.addStack(); rule.size = new Size(width, 1); rule.backgroundColor = S.LOCK_ON;
  ruleRow.addSpacer();
  w.addSpacer(5);
};

// one row of columns under a lockHeader, `width` wide: cells are { text, w, mono, right }; one cell
// without a width takes the rest. Same size as the header title, so it reads as one block.
S.LOCK_ROW = 12;
S.lockRow = (w, width, cells) => {
  const outer = w.addStack();
  const row = outer.addStack(); row.size = new Size(width, S.LOCK_ROW); row.centerAlignContent();
  for (const c of cells) {
    const put = parent => {
      const t = parent.addText(String(c.text)); t.lineLimit = 1;
      t.font = c.mono ? Font.regularMonospacedSystemFont(11) : Font.mediumSystemFont(11);
      t.textColor = S.LOCK_ON;
    };
    if (c.w) {
      const col = row.addStack(); col.size = new Size(c.w, S.LOCK_ROW); col.centerAlignContent();
      if (c.right) col.addSpacer();
      put(col);
      if (!c.right) col.addSpacer();
    } else {
      put(row);
      row.addSpacer();
    }
  }
  outer.addSpacer();
  return row;
};

// plain text line for the rectangular slot
S.lockText = (w, text) => {
  const t = w.addText(text); t.lineLimit = 1;
  t.font = Font.mediumSystemFont(12); t.textColor = S.LOCK_ON;
  return t;
};

// one centred figure for the circular slot
S.lockCircle = text => {
  const w = S.lockWidget();
  w.addSpacer();
  const row = w.addStack();
  row.addSpacer();
  const t = row.addText(text); t.lineLimit = 1; t.minimumScaleFactor = 0.6;
  t.font = Font.mediumSystemFont(16); t.textColor = S.LOCK_ON;
  row.addSpacer();
  w.addSpacer();
  return w;
};

// the text line above the clock (iOS sets its font)
S.lockInline = text => {
  const w = new ListWidget();
  w.addText(text);
  return w;
};

module.exports = S;
