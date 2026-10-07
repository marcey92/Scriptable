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
// sizes for the slot the widget sits in
S.metrics = () => {
  const s = Device.screenSize();
  const family = config.widgetFamily || "medium";
  const large = family === "large" || family === "extraLarge";
  const small = family === "small";
  const lock = family.startsWith("accessory");
  const innerW = small ? 130 : Math.max(260, Math.min(s.width, s.height) - 56 - 28);
  const availH = large ? 312 : 117;
  return { family, large, small, lock, innerW, availH };
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
