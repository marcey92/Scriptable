const S = importModule("swiss");

// Daily motivation, in the spirit of the office poster taken far too seriously: one hustle slogan a
// day for the Lock Screen.
// Each weekday has its own quotes (Mondays sound like Mondays), rotating weekly, so the same
// weekday repeats only after QUOTES[day].length weeks. Edit freely; keep each under ~65 characters
// so it fits the rectangular Lock Screen slot in four lines.
const QUOTES = {
  Monday: [
    "Rise and grind. Sleep is what your competitors do.",
    "Start the week at 110%. Finish it at 140%.",
    "Monday is not a day. It is a deliverable.",
    "Don't count the hours. Bill them.",
  ],
  Tuesday: [
    "Every email answered is a step toward more email.",
    "Work smarter, then harder, then both at lunch.",
    "Your to-do list believes in you. Prove it right.",
    "Success is just a meeting you haven't booked yet.",
  ],
  Wednesday: [
    "Push through the midweek. The KPIs are watching.",
    "Lunch is a tool. Eat it at your desk.",
    "Productivity is a lifestyle. Choose it hourly.",
    "Climb the ladder. Rest on the rungs never.",
  ],
  Thursday: [
    "Deadlines are not limits. They are invitations.",
    "Give 100%. Then give the other 20% too.",
    "Turn every coffee into a deliverable.",
    "Champions answer Slack in the shower.",
  ],
  Friday: [
    "Finish strong. Then start Monday's work early.",
    "Leave nothing on the table except your open laptop.",
    "The weekend is earned. Have you earned it?",
    "Log off when the work is done. The work is never done.",
  ],
  Saturday: [
    "Weekends are just weekdays with better lighting.",
    "Rest fast. The market isn't sleeping.",
    "Saturday is a great day to get ahead of Monday.",
    "Hobbies are side projects you haven't monetised yet.",
  ],
  Sunday: [
    "Sunday is Monday's warm-up. Stretch your inbox.",
    "Plan the week. Then plan the plan.",
    "Recharge at double speed. Results wait for no one.",
    "Dream big. Then put it on the quarterly roadmap.",
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
