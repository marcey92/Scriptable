const S = importModule("swiss");

// Daily motivation, in the spirit of the office poster: one quote a day for the Lock Screen.
// Each weekday has its own quotes (Mondays sound like Mondays), rotating weekly, so the same
// weekday repeats only after QUOTES[day].length weeks. Edit freely; keep each under ~65 characters
// so it fits the rectangular Lock Screen slot in four lines.
const QUOTES = {
  Monday: [
    "Let's circle back to the weekend you didn't have.",
    "A fresh week. A fresh chance to align on alignment.",
    "Your inbox missed you. It told everyone.",
    "Hit the ground running. The ground is a meeting.",
  ],
  Tuesday: [
    "Every task is a quick one until you open it.",
    "Be the synergy you want to see in the deck.",
    "If it isn't in a spreadsheet, did you even feel it?",
    "Think outside the box. Then put it back in the box.",
  ],
  Wednesday: [
    "Halfway there. Please update the tracker.",
    "This meeting could have been an email. So could you.",
    "Let's take this offline, then never speak of it again.",
    "Bandwidth is a state of mind. Yours is full.",
  ],
  Thursday: [
    "Per my last email, which you have bravely ignored.",
    "Low-hanging fruit is still fruit. Climb.",
    "Stretch goals: now with extra stretch.",
    "Quick sync? Clear your afternoon.",
  ],
  Friday: [
    "Friday: the deadline for everything due Monday.",
    "Wins of the week: you attended.",
    "Let's park this until it dies of natural causes.",
    "Logging off is a mindset. Not yours, yet.",
  ],
  Saturday: [
    "Rest is just pre-work for Monday.",
    "Weekends are optional. Like lunch.",
    "No one is emailing you. Yet.",
    "Touch grass. Report back by EOD.",
  ],
  Sunday: [
    "The Sunday scaries are just engagement.",
    "Tomorrow is a great day to be on mute.",
    "Reflect on your growth areas. All of them.",
    "Your out-of-office expires in twelve hours.",
  ],
};

// today's quote: the weekday's list, stepped on once a week
function todaysQuote(d = new Date()) {
  const list = QUOTES[S.WD[d.getDay()]];
  const week = Math.floor((S.dayStart(0) - new Date(2024, 0, 1)) / (7 * 86400 * 1000));
  return list[((week % list.length) + list.length) % list.length];
}

// redraw just after midnight, when the quote changes
function untilTomorrow(w) {
  w.refreshAfterDate = new Date(S.dayStart(1).getTime() + 60 * 1000);
  return w;
}

// Lock Screen, rectangular: the quote in white, up to four lines (cut off, never shrunk)
function buildLockRect(q) {
  const w = S.lockWidget();
  const t = w.addText(q);
  t.font = Font.mediumSystemFont(12); t.textColor = S.LOCK_ON; t.lineLimit = 4;
  w.addSpacer();
  return w;
}

// Home Screen: the same quote under a header, in the shared style
function buildWidget(q) {
  const w = S.widget();
  const { innerW } = S.metrics();
  S.header(w, innerW, "Motivation", null);
  const t = w.addText(q);
  t.font = Font.mediumSystemFont(S.TITLE_SIZE); t.textColor = S.FG; t.lineLimit = 5;
  w.addSpacer();
  return w;
}

// ---- run ----
const quote = todaysQuote();
const family = config.widgetFamily;
const widget = family === "accessoryRectangular" ? buildLockRect(quote)
  : family === "accessoryInline" ? S.lockInline(quote)
  : family === "accessoryCircular" ? S.lockCircle("☕")
  : buildWidget(quote);
untilTomorrow(widget);
if (config.runsInWidget) Script.setWidget(widget);
else await widget.presentSmall();   // preview when run inside the app
Script.complete();
