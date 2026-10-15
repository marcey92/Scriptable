// swiss.js: the shared style for every widget in this set.
// Change a value here and all widgets follow. Each widget loads it with importModule("swiss").

const S = {};

// ---- colours ----
S.BG = new Color("#0F1F47");            // deep navy, matched to the ocean wallpaper
S.FG = new Color("#FFFFFF");
S.DIM = new Color("#FFFFFF", 0.5);      // secondary text
S.EMPTY = new Color("#FFFFFF", 0.18);   // empty box
S.LOCK_ON = new Color("#FFFFFF");
S.LOCK_OFF = new Color("#FFFFFF", 0.3);

// ---- measurements ----
S.PAD = [20, 14, 12, 14];   // top, left, bottom, right
S.TITLE_SIZE = 13;
S.TEXT_SIZE = 11;
S.ROW = 14;                 // text row height
S.ROW_GAP = 4;
S.TIME_W = 48;              // time column in every list widget, so they line up
S.SECTION_GAP = 8;
S.HEAD_H = 30;              // title + rule + the gaps around them
S.BOX = 14;                 // Home Screen box
S.BOX_GAP = 3;
S.LOCK_BOX = 10;            // Lock Screen box
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
};

// sizes for the slot the widget sits in; `as` overrides the family (the in-app preview has none)
S.metrics = (as) => {
  const s = Device.screenSize();
  const family = as || config.widgetFamily || "medium";
  const large = family === "large" || family === "extraLarge";
  const small = family === "small";
  const lock = family.startsWith("accessory");
  const innerW = small ? 130 : Math.max(260, Math.min(s.width, s.height) - 56 - 28);
  const [h, hLarge] = S.WIDGET_H[`${Math.min(s.width, s.height)}x${Math.max(s.width, s.height)}`] || [149, 344];
  const availH = (large ? hLarge : h) - S.PAD[0] - S.PAD[2];
  return { family, large, small, lock, innerW, availH };
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
};
// the grid for a slot: W = content width, H = content height, rows = whole 15 pt rows that fit
S.grid = (as) => {
  const s = Device.screenSize(), k = `${Math.min(s.width, s.height)}x${Math.max(s.width, s.height)}`;
  const family = as || config.widgetFamily || "medium";
  const large = family === "large" || family === "extraLarge";
  const [h, hLarge] = S.WIDGET_H[k] || [141, 311];
  const W = (S.WIDGET_W[k] || 292) - S.G_PAD[1] - S.G_PAD[3];
  const H = (large ? hLarge : h) - S.G_PAD[0] - S.G_PAD[2];
  return { large, W, H, rows: Math.floor(H / S.M) };
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
S.gSection = (parent, W, label, status) => {
  const row = parent.addStack(); row.size = new Size(W, S.M); row.centerAlignContent(); row.spacing = 0;
  S.gSign(row, label);
  const statusW = status ? 111 : 0;
  const rule = row.addStack(); rule.size = new Size(W - S.G.KEY - statusW, 2); rule.backgroundColor = S.FG;
  if (status) { row.addSpacer(6); S.gCell(row, { text: status, w: 105, font: S.F.key, right: true }, S.M); }
  return row;
};

// how many text rows fit under `sections` headers
S.rowsFor = (availH, sections = 1) =>
  Math.max(sections, Math.floor(
    (availH - sections * S.HEAD_H - (sections - 1) * S.SECTION_GAP + sections * S.ROW_GAP) / (S.ROW + S.ROW_GAP)));

// a Home Screen widget with the panel colour and margins
S.widget = () => {
  const w = new ListWidget();
  w.backgroundColor = S.BG;
  w.setPadding(...S.PAD);
  return w;
};

// header: title left, optional text right, hairline rule underneath. Returns the title row.
S.header = (w, innerW, titleText, rightText) => {
  const head = w.addStack(); head.size = new Size(innerW, 16); head.bottomAlignContent();
  const title = head.addText(titleText);
  title.font = Font.mediumSystemFont(S.TITLE_SIZE); title.textColor = S.FG; title.lineLimit = 1;
  head.addSpacer(12);
  head.addSpacer();
  if (rightText) {
    const right = head.addText(rightText);
    right.font = Font.systemFont(S.TEXT_SIZE); right.textColor = S.FG; right.lineLimit = 1;
  }
  w.addSpacer(5);
  const rule = w.addStack(); rule.size = new Size(innerW, 1); rule.backgroundColor = S.FG;
  w.addSpacer(8);
  return head;
};

// one text row made of cells: { text, w, mono, right, colour }.
// Cells with a width are fixed columns; one cell without a width takes the remaining space.
S.row = (w, innerW, cells, colour = S.FG) => {
  const row = w.addStack(); row.size = new Size(innerW, S.ROW); row.centerAlignContent();
  for (const c of cells) {
    const put = parent => {
      const t = parent.addText(String(c.text)); t.lineLimit = 1;
      t.font = c.mono ? Font.regularMonospacedSystemFont(S.TEXT_SIZE) : Font.mediumSystemFont(S.TEXT_SIZE);
      t.textColor = c.colour || colour;
    };
    if (c.w) {
      const col = row.addStack(); col.size = new Size(c.w, S.ROW); col.centerAlignContent();
      if (c.right) col.addSpacer();
      put(col);
      if (!c.right) col.addSpacer();
    } else {
      put(row);
      row.addSpacer();
    }
  }
  return row;
};

// a dimmed one-line message, for empty and error states
S.note = (w, innerW, text, indent = 0) =>
  S.row(w, innerW, indent ? [{ text: "", w: indent }, { text }] : [{ text }], S.DIM);

// a square box, filled or empty
S.box = (parent, size, on, lock = false) => {
  const c = parent.addStack(); c.size = new Size(size, size); c.cornerRadius = 0;
  c.backgroundColor = lock ? (on ? S.LOCK_ON : S.LOCK_OFF) : (on ? S.FG : S.EMPTY);
  return c;
};

// a run of `count` boxes with the first `filled` switched on
S.bar = (parent, count, size, filled, lock = false) => {
  for (let i = 0; i < count; i++) {
    if (i > 0) parent.addSpacer(S.BOX_GAP);
    S.box(parent, size, i < filled, lock);
  }
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
