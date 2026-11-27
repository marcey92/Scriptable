// Desk check: runs each widget script against a stand-in for Scriptable's API and prints
// what it would draw. It catches crashes and layout arithmetic, not how iOS renders things.
// Usage: node test/run.js
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
let failures = 0;
let feedCalls = null;
const savedEvents = [];   // events scripts created with CalendarEvent.save(), kept across runs
let nextId = 1;
const completed = [], opened = [];   // reminders marked done, URLs opened
const files = {};   // fake Scriptable documents folder
class Text {
  constructor(t) { this.text = t; }
}
class Stack {
  constructor() { this.children = []; this.size = null; }
  addStack() { const s = new Stack(); this.children.push(s); return s; }
  addText(t) {
    if (typeof t !== "string") throw new Error(`addText needs a string, got ${typeof t}`);
    const x = new Text(t); this.children.push(x); return x;
  }
  addSpacer(n) { this.children.push({ spacer: n === undefined ? "flex" : n }); }
  setAction(title, options) { this.action = { title, ...options }; }   // Scriptable 1.8 tap actions
  addImage(img) { const x = new Text(img.drawn.join(" ")); x.image = img; this.children.push(x); return x; }
  centerAlignContent() {} bottomAlignContent() {} topAlignContent() {}
  layoutHorizontally() { this.vertical = false; } layoutVertically() { this.vertical = true; }
  setPadding(...p) { this.padding = p; }
}
class ListWidget extends Stack {
  async presentSmall() { this.presented = "small"; }
  async presentMedium() { this.presented = "medium"; }
  async presentLarge() { this.presented = "large"; }
}
// width a row of fixed-size children needs, to check it fits its stack
function fixedWidth(s) {
  if (s.vertical) return Math.max(0, ...s.children.filter(c => c instanceof Stack && c.size).map(c => c.size.width));
  let w = 0;
  for (const c of s.children) {
    if (c.spacer !== undefined) w += c.spacer === "flex" ? 0 : c.spacer;
    else if (c instanceof Stack && c.size) w += c.size.width;
  }
  // iOS puts `spacing` between every pair of children, spacers included
  return w + (s.spacing || 0) * Math.max(0, s.children.length - 1);
}
function check(node, issues) {
  if (!(node instanceof Stack)) return;
  if (node.size && !(node instanceof ListWidget)) {
    const need = fixedWidth(node);
    if (need > node.size.width + 0.01) issues.push(`row needs ${need} but is ${node.size.width} wide`);
    if (!(node.size.width > 0) || !(node.size.height > 0)) issues.push(`bad size ${JSON.stringify(node.size)}`);
  }
  node.children.forEach(c => check(c, issues));
}
function height(w) {
  let h = 0;
  for (const c of w.children) {
    if (c.spacer !== undefined) h += c.spacer === "flex" ? 0 : c.spacer;
    else if (c instanceof Stack) h += c.size ? c.size.height : c.vertical ? height(c) : 12;
    else h += 15;
  }
  return h;
}
function describe(node) {
  if (node instanceof Text) return node.text;
  if (node.spacer !== undefined) return null;
  const kids = node.children.map(describe).filter(x => x !== null);
  if (kids.length && kids.every(k => k === "■" || k === "□")) return kids.join("");
  if (!kids.length) {
    if (node.size && node.size.height === 1) return "─".repeat(12);
    if (node.backgroundColor) return node.backgroundColor.alpha === 1 ? "■" : "□";
    return null;
  }
  return kids.join(node.vertical ? "\n" : "  ");
}
async function run(file, opts = {}) {
  const realSetAction = Stack.prototype.setAction;
  if (opts.noActions) Stack.prototype.setAction = undefined;   // an older Scriptable without tap actions
  const realNow = Date.now;
  if (opts.clock) Date.now = () => opts.clock.getTime();   // pretend it's another time (habit day turnover)
  try { return await runInner(file, opts); } finally { Date.now = realNow; Stack.prototype.setAction = realSetAction; }
}
async function runInner(file, opts) {
  const now = new Date();
  const at = (dayOffset, h, m = 0) => { const d = new Date(now); d.setDate(d.getDate() + dayOffset); d.setHours(h, m, 0, 0); return d; };
  const events = opts.events || [
    { title: "Late dinner", startDate: at(0, 23, 30), endDate: at(0, 23, 59), isAllDay: false, cal: "Home" },
    { title: "Psychoanalysis | Mayessi Svoronou", startDate: at(1, 14), endDate: at(1, 15), isAllDay: false, cal: "you@gmail.com" },
    { title: "Brunch", startDate: at(3, 11), endDate: at(3, 12), isAllDay: false, cal: "Home" },
  ];
  let widget = null, alerts = 0, keychainSet = null;
  const defaultReminders = [
    { identifier: "r1", title: "Renew passport", dueDate: at(-2, 0), dueDateIncludesTime: false, list: "Reminders", creationDate: at(-9, 9) },
    { identifier: "r2", title: "Call landlord", dueDate: new Date(now.getTime() + 2 * 60000), dueDateIncludesTime: true, list: "Reminders", creationDate: at(-1, 9) },
    { identifier: "r3", title: "Buy batteries", dueDate: at(0, 0), dueDateIncludesTime: false, list: "Shopping", creationDate: at(-1, 9) },
    { identifier: "r4", title: "Book dentist", dueDate: at(2, 9), dueDateIncludesTime: true, list: "Reminders", creationDate: at(-3, 9) },
    { identifier: "r5", title: "Fix bike light", dueDate: null, list: "Reminders", creationDate: at(-1, 8) },
    { identifier: "r6", title: "Old idea", dueDate: null, list: "Reminders", creationDate: at(-20, 8) },
  ];
  const g = {
    console: { log: () => {} },
    config: { runsInWidget: opts.inApp ? false : true, widgetFamily: opts.family },
    args: { widgetParameter: opts.param || null, queryParameters: opts.query || {}, widgetAction: opts.action || null },
    Color: class { constructor(hex, alpha = 1) { this.hex = hex; this.alpha = alpha; } static white() { return new g.Color("#FFFFFF"); } },
    Size: class { constructor(w, h) { this.width = w; this.height = h; } },
    Rect: class { constructor(x, y, w, h) { this.x = x; this.y = y; this.width = w; this.height = h; } },
    DrawContext: class {
      constructor() { this.drawn = []; this.font = null; }
      setTextAlignedCenter() {} setTextAlignedRight() {} setTextColor() {} setFont(f) { this.font = f; }
      drawTextInRect(t, r) {
        if (r.x < 0 || r.x + r.width > this.size.width) throw new Error(`text at ${r.x} is outside the ${this.size.width} pt picture`);
        this.drawn.push(t); (this.rects = this.rects || []).push(r);
      }
      getImage() {
        if (!(this.size.width > 0 && this.size.height > 0)) throw new Error(`Invalid canvas size: ${this.size.width} by ${this.size.height}`);
        return { drawn: this.drawn, rects: this.rects, size: this.size };
      }
    },
    Font: new Proxy({}, { get: (_, name) => size => ({ name, size }) }),
    ListWidget,
    Device: {
      screenSize: () => opts.screen || ({ width: 393, height: 852 }),
    },
    Script: { setWidget: w => { widget = w; }, complete: () => {}, name: () => file.replace(".js", "") },
    URLScheme: { forRunningScript: () => "scriptable:///run/x" },
    App: { close: () => {} },
    Timer: { schedule: (ms, repeats, fn) => { const t = setTimeout(fn, ms); t.unref(); return t; } },
    Keychain: {
      contains: k => opts.token !== undefined ? opts.token !== null : false,
      get: k => opts.token, set: (k, v) => { opts.token = v; keychainSet = v; },
    },
    Alert: class {
      addAction() {} addCancelAction() {} addSecureTextField() {} textFieldValue() { return opts.typedToken || ""; }
      async presentSheet() { alerts++; return opts.sheets && opts.sheets.length ? opts.sheets.shift() : -1; } async present() { alerts++; return 0; }   // sheets: scripted taps, then "Done"
    },
    FileManager: (() => {
      const fm = {
        documentsDirectory: () => "/docs", joinPath: (a, b) => `${a}/${b}`,
        fileExists: p => p in files, readString: p => files[p], writeString: (p, s) => { files[p] = s; }, remove: p => { delete files[p]; },
        downloadFileFromiCloud: async () => {},
      };
      return { iCloud: () => fm, local: () => fm };
    })(),
    Calendar: {
      forEvents: async () => [{ title: "Home" }, { title: "you@gmail.com" }],
      defaultForEvents: async () => ({ title: "Home" }),
      forEventsByTitle: async t => ({ title: t }),
      forReminders: async () => [{ title: "Reminders" }, { title: "Shopping" }],
    },
    Reminder: class {
      save() { completed.push(this.title); }
      static async allIncomplete(cals = []) {
        if (opts.noReminders) throw new Error("denied");
        const names = cals.map(c => c.title);
        return (opts.reminders || defaultReminders).filter(r => !names.length || names.includes(r.list))
          .map(r => Object.assign(new g.Reminder(), r));
      }
    },
    Safari: { open: url => { opened.push(url); } },
    CalendarEvent: class {
      save() {
        if (opts.saveFails) throw new Error("not allowed");
        if (!this.identifier) { this.identifier = `ev${nextId++}`; savedEvents.push(this); }
        this.cal = this.calendar && this.calendar.title;
      }
      remove() { const i = savedEvents.indexOf(this); if (i >= 0) savedEvents.splice(i, 1); }
      static async today() { return [...events, ...savedEvents].filter(e => e.startDate.toDateString() === now.toDateString()); }
      static async between(s, e, cals) {
        if (opts.noCalendar) throw new Error("denied");
        const names = cals.map(c => c.title);
        return [...events, ...savedEvents].filter(ev => ev.startDate < e && ev.endDate > s && (!names.length || names.includes(ev.cal)));
      }
    },
    Location: {
      setAccuracyToThreeKilometers: () => {},
      current: async () => { if (opts.noLocation) throw new Error("denied"); return { latitude: 51.5, longitude: -0.12 }; },
      reverseGeocode: async () => [{ locality: "London" }],
    },
    Request: class {
      constructor(url) { this.url = url; this.headers = {}; }
      async loadJSON() {
        if (opts.offline) throw new Error("offline");
        if (this.url.includes("/widget/api/")) {
          const feed = this.url.split("/").pop();
          const good = this.headers.Authorization === `Bearer ${opts.goodToken || "tok"}`;
          const body = opts.feeds && opts.feeds[feed];
          this.response = { statusCode: !good || !body ? 404 : (opts.status || 200) };
          if (feedCalls) feedCalls.push({ feed, auth: this.headers.Authorization });
          return this.response.statusCode === 200 ? body : { error: "not found" };
        }
        const t0 = Math.floor(new Date(now).setHours(0, 0, 0, 0) / 1000);
        const n = 72, time = [], temp = [], rain = [], code = [];
        for (let i = 0; i < n; i++) { time.push(t0 + i * 3600); temp.push(10 + (i % 24) / 3); rain.push(opts.dry ? 5 : (i * 7) % 100); code.push([0, 2, 3, 61, 80][i % 5]); }
        const wind = time.map((_, i) => 5 + (i % 6) * 4), gust = time.map((_, i) => opts.gusty ? 40 : 5 + (i % 6) * 4 + 3), uv = time.map((_, i) => opts.sunny ? 6 : Math.max(0, Math.sin(((i % 24) - 6) / 12 * Math.PI)));
        return { hourly: { time, temperature_2m: temp, precipitation_probability: rain, weather_code: code, wind_speed_10m: wind, wind_gusts_10m: gust, uv_index: uv } };
      }
    },
  };
  g.importModule = name => {
    const m = { exports: {} };
    const src = fs.readFileSync(path.join(root, name + ".js"), "utf8");
    new Function(...Object.keys(g), "module", src)(...Object.values(g), m);
    return m.exports;
  };
  const src = fs.readFileSync(path.join(root, file), "utf8");
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const label = `${file} [${opts.inApp ? "in app" : opts.family}${opts.note ? ", " + opts.note : ""}]`;
  try {
    await new AsyncFunction(...Object.keys(g), src)(...Object.values(g));
    const issues = [];
    if (widget) {
      check(widget, issues);
      const m = { small: 126, medium: 126, large: 322 }[opts.family];   // 393x852 widget heights minus padding
      if (m && height(widget) > m + 0.01) issues.push(`content is ${height(widget)} tall, slot allows about ${m}`);
    } else if (!opts.inApp) issues.push("no widget was set");
    console.log(`\n${issues.length ? "FAIL" : "ok  "} ${label}`);
    if (widget) for (const c of widget.children) { const d = describe(c); if (d) console.log("     " + d); }
    if (opts.inApp) console.log(`     (alerts shown: ${alerts})`);
    if (opts.expect) for (const [what, fn] of Object.entries(opts.expect)) {
      if (!fn({ widget, text: widget ? widget.children.map(describe).filter(Boolean).join("\n") : "", keychainSet, files, alerts })) issues.push(`expected: ${what}`);
    }
    issues.forEach(i => console.log("     ! " + i));
    failures += issues.length ? 1 : 0;
  } catch (e) {
    failures++;
    console.log(`\nFAIL ${label}\n     ! ${e.stack.split("\n").slice(0, 3).join("\n       ")}`);
  }
}
(async () => {
  const home = ["small", "medium", "large"];
  const lock = ["accessoryRectangular", "accessoryCircular", "accessoryInline"];
  files["/docs/habit-grid.json"] = JSON.stringify({ Anki: [new Date().toISOString().slice(0, 10)] });
  {
    const early = new Date(); early.setHours(1, 30, 0, 0);
    const day = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const before = new Date(early); before.setDate(before.getDate() - 1);
    files["/docs/habit-grid.json"] = JSON.stringify({});
    await run("overview.js", { inApp: true, query: { habit: "Gratitude" }, clock: early, expect: {
      "a tick at 01:30 counts for the day before (the habit day turns over at 4am)": ({ files }) => JSON.parse(files["/docs/habit-grid.json"]).Gratitude.includes(day(before)),
    }, note: "tick at 01:30" });
    files["/docs/habit-grid.json"] = JSON.stringify({ Anki: [new Date().toISOString().slice(0, 10)] });
  }
  {
    // menu → "Earlier days…" (after the 4 habits) → the day before yesterday → tick Meditate → back out
    const d = new Date(Date.now() - 4 * 3600 * 1000); d.setDate(d.getDate() - 2);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const saved = files["/docs/habit-grid.json"];
    await run("overview.js", { inApp: true, query: { menu: "1" }, sheets: [4, 1, 2], note: "tick an earlier day", expect: {
      "Meditate is ticked for two days ago, and nothing else changes": ({ files }) => {
        const data = JSON.parse(files["/docs/habit-grid.json"]);
        return JSON.stringify(data.Meditate) === JSON.stringify([...(JSON.parse(saved).Meditate || []), k]) && JSON.stringify(data.Anki) === JSON.stringify(JSON.parse(saved).Anki);
      },
    } });
    files["/docs/habit-grid.json"] = saved;
  }
  {
    // tapping a habit's name → its days, today first → tap the third (two days ago) → Done
    const d = new Date(Date.now() - 4 * 3600 * 1000); d.setDate(d.getDate() - 2);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const saved = files["/docs/habit-grid.json"];
    for (const file of ["overview.js"]) {
      await run(file, { inApp: true, query: { days: "Gratitude" }, sheets: [2], token: "tok", note: "tap a name, fix two days ago", expect: {
        "Gratitude is ticked for two days ago only": ({ files }) => JSON.stringify(JSON.parse(files["/docs/habit-grid.json"]).Gratitude) === JSON.stringify([k]),
      } });
      files["/docs/habit-grid.json"] = saved;
    }
    const urls = n => [n.url, ...(n.children || []).flatMap(urls)].filter(Boolean);
    await run("overview.js", { family: "large", token: "tok", note: "name links", expect: {
      "each habit's name opens its days": ({ widget }) => urls(widget).includes("scriptable:///run/x?days=Cold%20shower"),
    } });
  }
  await run("overview.js", { family: "large", noCalendar: true, note: "no calendar access" });
  for (const family of [...home, ...lock]) await run("weather.js", { family });
  await run("weather.js", { family: "accessoryRectangular", expect: {
    "header, then now, range and rain": ({ text }) => /^Weather/.test(text) && /^\d+°  \w/m.test(text) && /^Low -?\d+° · High -?\d+°$/m.test(text) && /^Rain \d+% at \d\d:\d\d$/m.test(text),
  }, note: "summary" });
  await run("weather.js", { family: "accessoryRectangular", dry: true, expect: {
    "low rain chances read as dry": ({ text }) => /^Dry next 12 hours$/m.test(text),
  }, note: "dry" });
  await run("weather.js", { family: "medium", expect: {
    "a wind column in mph": ({ text }) => /\d+°\s+\S.*\s+\d+ mph\s+\d+%/m.test(text),
    "light gusts are left out": ({ text }) => !text.includes("–"),
    "low UV stays out of the header": ({ text }) => !/UV/.test(text.split("\n")[0]),
  }, note: "wind" });
  await run("weather.js", { family: "medium", gusty: true, expect: {
    "strong gusts show as a range": ({ text }) => /\d+–40 mph/.test(text),
  }, note: "gusty" });
  await run("weather.js", { family: "medium", sunny: true, expect: {
    "UV from 3 shows next to the place": ({ text }) => /^Weather\s+London · UV \d+$/.test(text.split("\n")[0]),
  }, note: "sunny" });
  await run("weather.js", { family: "medium", offline: true, note: "offline, cached" });
  delete files["/docs/swiss-weather.json"];
  await run("weather.js", { family: "medium", offline: true, note: "offline, no cache" });
  await run("weather.js", { family: "medium", noLocation: true, note: "no location" });
  const iso = h => new Date(Date.now() - h * 3600 * 1000).toISOString();
  const feeds = {
    orders: { schema_version: 1, updated: iso(0), orders: [
      { id: "1", retailer: "Amazon", title: "Kettle", private: false, status: "ordered", status_label: "Ordered", eta: "2026-10-12", tracking_number: "TRK-SECRET-1", last_event: iso(48), delivered: false },
      { id: "2", retailer: "Zalando", title: "Shoes", private: false, status: "out_for_delivery", status_label: "Out for delivery", eta: "2026-10-08/2026-10-09", tracking_number: "TRK-SECRET-2", last_event: iso(0), delivered: false },
      { id: "3", retailer: "X", title: "Parcel", private: true, status: "problem", status_label: "Delivery problem", eta: null, tracking_number: null, last_event: iso(3), delivered: false },
      { id: "4", retailer: "IKEA", title: "Shelf", private: false, status: "delivered", status_label: "Delivered", eta: null, tracking_number: null, last_event: iso(60), delivered: true },
      { id: "5", retailer: "Apple", title: "Cable", private: false, status: "delivered", status_label: "Delivered", eta: null, tracking_number: null, last_event: iso(10), delivered: true },
    ] },
    important: { schema_version: 1, updated: iso(0), important: [
      { id: "a", from: "Bank", subject: "Review your statement", summary: "BODY-SECRET-A", received: iso(24), urgent: false, action_needed: true },
      { id: "b", from: "Landlord", subject: "Boiler repair today", summary: "BODY-SECRET-B", received: iso(9), urgent: true, action_needed: true },
    ] },
  };
  const widgetOpts = { token: "tok", feeds };
  const clean = ({ text }) => !/SECRET/.test(text);
  // the Inbox, as the overview draws it: the lines after its section row
  const inbox = text => { const l = text.split("\n"); const k = l.findIndex(x => /^\s*Inbox\s+■/.test(x)); return l.slice(k).join("\n"); };
  const ov = { family: "large" };
  await run("overview.js", { ...widgetOpts, ...ov, expect: {
    "no tracking numbers or email bodies": clean,
    "sorted newest first, stars do not jump ahead": ({ text }) => { const t = inbox(text); return t.indexOf("Zalando") < t.indexOf("Parcel") && t.indexOf("Parcel") < t.indexOf("Landlord") && t.indexOf("Landlord") < t.indexOf("Bank"); },
    "starred items are marked": ({ text }) => /★ Parcel/.test(text) && /★ Landlord/.test(text) && /★ Bank/.test(text),
    "range eta shows the later day": ({ text }) => text.includes("Out for delivery · 09.10"),
    "private order shows its generic title, not the retailer": ({ text }) => !/  X  /.test(inbox(text)) && inbox(text).includes("Parcel"),
    "emails show the sender, then the subject": ({ text }) => /★ Landlord\s+Boiler repair today/.test(text),
    "recent delivered is shown, delivered older than 48h is hidden": ({ text }) => inbox(text).includes("Apple") && !text.includes("IKEA"),
    "at most five items, no +N more line": ({ text }) => !/more/.test(text) && inbox(text).split("\n").length - 1 <= 5,
  }, note: "Inbox" });
  const busy = { orders: { orders: [1, 2, 3, 4, 5, 6].map(n => ({ id: `n${n}`, retailer: `Shop${n}`, private: false, status: "dispatched", status_label: "Dispatched", last_event: iso(n), delivered: false })) },
    important: { important: [{ id: "old", from: "Council", subject: "Old but important", received: iso(72), urgent: false }] } };
  const savedCache = files["/docs/swiss-orders.json"];
  await run("overview.js", { token: "tok", feeds: busy, ...ov, expect: {
    "an old starred item that doesn't fit is left off: no place is held for stars": ({ text }) => !text.includes("Council"),
    "the list is simply the newest, in order": ({ text }) => /Shop1[\s\S]*Shop2[\s\S]*Shop3[\s\S]*Shop4[\s\S]*Shop5/.test(text),
  }, note: "old star not kept" });
  files["/docs/swiss-orders.json"] = savedCache;   // the offline tests below read the earlier cache
  await run("overview.js", { ...widgetOpts, ...ov, offline: true, expect: {
    "offline shows the cached list; recent data is not stale": ({ text }) => !text.includes("Stale") && inbox(text).includes("Zalando"),
  }, note: "offline, cached" });
  delete files["/docs/swiss-orders.json"];
  await run("overview.js", { ...widgetOpts, ...ov, offline: true, expect: {
    "offline with no cache says No data": ({ text }) => inbox(text).includes("No data") && !text.includes("Stale"),
  }, note: "offline, no cache" });
  await run("overview.js", { feeds, ...ov, expect: {
    "asks to run in the app when there is no token": ({ text }) => inbox(text).includes("Run in Scriptable"),
  }, note: "no token" });
  await run("overview.js", { feeds, inApp: true, typedToken: "tok", expect: {
    "token typed in the app goes to the Keychain": ({ keychainSet }) => keychainSet === "tok",
  }, note: "first run, enter token" });
  await run("overview.js", { ...widgetOpts, token: "nope", ...ov, expect: {
    "wrong token says so": ({ text }) => inbox(text).includes("Token rejected"),
  }, note: "wrong token" });
  await run("overview.js", { feeds, token: "nope", inApp: true, typedToken: "tok", expect: {
    "wrong token can be replaced in the app": ({ keychainSet }) => keychainSet === "tok",
  }, note: "wrong token, re-enter" });
  // the single now feed: Hermes's order and wording, drawn as given
  const nowFeed = { now: { schema_version: 2, updated: iso(0), items: [
    { when: iso(30), star: false, title: "Older first", detail: "Hermes put me on top" },
    { when: iso(1), star: true, title: "Homes & Villas", detail: "Reply to your complaint" },
    { when: iso(2), star: false, title: "Amazon", detail: "Out for delivery · 07.10", short: "Today" },
    ...[3, 4, 5].map(n => ({ when: iso(n), star: false, title: `Shop${n}`, detail: "Dispatched" })),
    { when: iso(80), star: true, title: "Council", detail: "Old but important" },
  ] } };
  const savedCache2 = files["/docs/swiss-orders.json"];
  await run("overview.js", { token: "tok", feeds: nowFeed, ...ov, expect: {
    "items keep Hermes's order": ({ text }) => { const t = inbox(text); return t.indexOf("Older first") < t.indexOf("Homes & Villas") && t.indexOf("Homes & Villas") < t.indexOf("Amazon"); },
    "title, then detail": ({ text }) => /★ Homes & Villas\s+Reply to your complaint/.test(text),
    "a starred item below the fold is left off, like any other": ({ text }) => !text.includes("Council"),
  }, note: "now feed" });
  await run("overview.js", { token: "tok", feeds: nowFeed, ...ov, offline: true, expect: {
    "offline shows the cached now feed, judged by its own updated time": ({ text }) => !text.includes("Stale") && text.includes("Homes & Villas"),
  }, note: "now feed, offline" });
  const aged = (h, extra = {}) => ({ now: { ...nowFeed.now, updated: h === null ? undefined : iso(h), ...extra } });
  const inboxHead = text => text.split("\n").find(x => /^\s*Inbox\s+■/.test(x)).trim();
  await run("overview.js", { token: "tok", feeds: aged(0.5), ...ov, expect: {
    "updated 30 minutes ago is fresh": ({ text }) => inboxHead(text) === "Inbox  ■",
  }, note: "fresh" });
  await run("overview.js", { token: "tok", feeds: aged(2), ...ov, expect: {
    "updated 2 hours ago is stale, with the time": ({ text }) => /Stale since \d\d:\d\d·?$/.test(inboxHead(text)),
    "the items are still shown": ({ text }) => text.includes("Homes & Villas"),
  }, note: "stale" });
  await run("overview.js", { token: "tok", feeds: aged(2), ...ov, offline: true, expect: {
    "offline keeps the cached updated time, still stale": ({ text }) => /Stale since/.test(text) && text.includes("Homes & Villas"),
  }, note: "stale, offline" });
  await run("overview.js", { token: "tok", feeds: aged(30), ...ov, expect: {
    "updated yesterday or before shows the dot or the date": ({ text }) => /Stale since (\d\d:\d\d·|\d\d\.\d\d)$/.test(inboxHead(text)),
  }, note: "stale, old" });
  await run("overview.js", { token: "tok", feeds: aged(null), ...ov, expect: {
    "no updated at all counts as stale": ({ text }) => /Stale$/.test(inboxHead(text)),
  }, note: "no timestamp" });
  files["/docs/swiss-orders.json"] = savedCache2;
  // events Hermes pushes to the calendar feed: added once, updated when changed, never duplicated
  const inDays = (d, h) => { const x = new Date(); x.setDate(x.getDate() + d); x.setHours(h, 0, 0, 0); return x.toISOString(); };
  const calFeed = ev => ({ calendar: { schema_version: 1, events: ev } });
  const flight = { id: "tui-tom092", title: "Flight to Cancún (TUI TOM092)", start: inDays(2, 9), end: inDays(2, 20), location: "LGW", notes: "Booking ref" };
  const checkin = { id: "tui-checkin", title: "Check in: TUI TOM092", start: inDays(1, 9) };
  const count = t => savedEvents.filter(e => e.title === t).length;
  await run("overview.js", { token: "tok", feeds: calFeed([flight, checkin]), family: "large", expect: {
    "both pushed events are added": () => count(flight.title) === 1 && count(checkin.title) === 1,
    "a missing end becomes one hour": () => { const c = savedEvents.find(e => e.title === checkin.title); return c.endDate - c.startDate === 3600 * 1000; },
    "they show in the widget": ({ text }) => text.includes("Check in: TUI TOM092"),
  }, note: "calendar feed" });
  await run("overview.js", { token: "tok", feeds: calFeed([flight, checkin]), family: "large", expect: {
    "a second refresh adds nothing": () => count(flight.title) === 1 && count(checkin.title) === 1 && savedEvents.length === 2,
  }, note: "calendar feed again" });
  await run("overview.js", { token: "tok", feeds: calFeed([{ ...flight, notes: "Gate closes 08:20" }, checkin]), family: "large", expect: {
    "a changed event is updated in place, not duplicated": () => savedEvents.length === 2 && savedEvents.find(e => e.title === flight.title).notes === "Gate closes 08:20",
  }, note: "calendar feed changed" });
  await run("overview.js", { token: "tok", feeds: {}, family: "large", expect: {
    "no feed: nothing added, nothing removed": () => savedEvents.length === 2,
  }, note: "no calendar feed" });
  // the Hermes widget: what Hermes did on its own, and calendar failures on this phone
  const activity = h => ({ activity: { schema_version: 1, updated: iso(h), items: [
    { when: iso(0.1), title: "Calendar", detail: "Added Flight to Cancún" },
    { when: iso(0.2), title: "Telegram", detail: "Sent: Boiler repair today" },
    { when: iso(1), title: "Email", detail: "Marked 4 newsletters read" },
  ] } });
  await run("hermes.js", { token: "tok", feeds: activity(0.05), family: "medium", expect: {
    "header shows when Hermes last ran": ({ text }) => /^Hermes\s+\d\d:\d\d$/.test(text.split("\n")[0]),
    "one line per action: time, kind, what": ({ text }) => /\d\d:\d\d·?\s+Calendar\s+Added Flight to Cancún/.test(text) && text.includes("Marked 4 newsletters read"),
    "no failure line when the sync is fine": ({ text }) => !text.includes("★"),
  }, note: "activity" });
  await run("hermes.js", { token: "tok", feeds: activity(3), family: "medium", expect: {
    "an old run shows the stale marker": ({ text }) => /^Hermes\s+Stale since/.test(text.split("\n")[0]),
  }, note: "stale" });
  await run("hermes.js", { token: "tok", feeds: {}, family: "medium", expect: {
    "feed unavailable: the last cached list is shown": ({ text }) => text.includes("Added Flight to Cancún"),
  }, note: "feed unavailable" });
  await run("overview.js", { token: "tok", feeds: calFeed([{ ...checkin, id: "new-one", title: "Dentist" }]), saveFails: true, family: "large", note: "event can't be saved" });
  await run("hermes.js", { token: "tok", feeds: activity(0.05), family: "medium", expect: {
    "a failed calendar add shows as a starred line at the top": ({ text }) => /★ Calendar\s+Couldn't add Dentist/.test(text.split("\n")[2]),
  }, note: "calendar failure" });
  await run("overview.js", { token: "tok", feeds: calFeed([{ ...checkin, id: "new-one", title: "Dentist" }]), family: "large", note: "event saved on retry" });
  await run("hermes.js", { token: "tok", feeds: activity(0.05), family: "medium", expect: {
    "a later successful sync clears it": ({ text }) => !text.includes("Couldn't add"),
  }, note: "failure cleared" });
  await run("overview.js", { token: "tok", feeds: calFeed([checkin]), offline: true, family: "large", note: "offline sync" });
  await run("hermes.js", { token: "tok", feeds: activity(0.05), family: "medium", expect: {
    "being offline is not a failure": ({ text }) => !text.includes("★"),
  }, note: "offline is fine" });
  savedEvents.length = 0;   // the tests below expect only the stand-in calendar
  for (const family of ["large", "medium", "accessoryInline"]) await run("overview.js", { ...widgetOpts, family });
  // ... and the list widgets must not size anything wider than the narrowest widget either
  const widest = (n) => Math.max(n.size ? n.size.width : 0, ...(n.children || []).map(widest));
  for (const file of ["weather.js", "hermes.js", "reminders.js"])
    await run(file, { ...widgetOpts, family: "medium", screen: { width: 1100, height: 800 }, expect: {
      "nothing wider than a narrow widget": ({ widget }) => widest(widget) <= 292,
    }, note: "unknown screen 1100x800" });
  // the iPhone Duo's inner screen (Scriptable reports 466 x 678) is in the tables: its widgets get their real size
  for (const file of ["weather.js", "hermes.js", "reminders.js"])
    await run(file, { ...widgetOpts, family: "medium", screen: { width: 678, height: 466 }, expect: {
      "on the Duo, rows use the widget's width but no more": ({ widget }) => widest(widget) <= 332 - 28 && widest(widget) > 263,
    }, note: "iPhone Duo" });
  await run("overview.js", { ...widgetOpts, family: "large", screen: { width: 678, height: 466 }, expect: {
    "on the Duo the overview gets 13 days and the full width": ({ text, widget }) => /^[A-Z][a-z]{2} \d\d\.\d\d\s+([A-Z] ){12}[A-Z]\s*$/.test(text.split("\n")[0]) && widget.children[0].size.width === 332 - 29,
  }, note: "iPhone Duo" });
  // a screen missing from the size table (the iPhone Duo's inner one) falls back to the narrowest width
  for (const screen of [{ width: 1100, height: 800 }, { width: 800, height: 1100 }, { width: 320, height: 568 }])
    await run("overview.js", { ...widgetOpts, family: "large", screen, expect: {
      "fewer days rather than a negative count column": ({ text }) => /^[A-Z][a-z]{2} \d\d\.\d\d\s+([A-Z] ){4,12}[A-Z]\s*$/.test(text.split("\n")[0]),
    }, note: `unknown screen ${screen.width}x${screen.height}` });
  await run("overview.js", { ...widgetOpts, family: "large", expect: {
    "ruler first: the date, then 13 day initials, each placed over its box": ({ text, widget }) => {
      const img = widget.children[0].children.find(c => c.image);
      return /^[A-Z][a-z]{2} \d\d\.\d\d\s+([A-Z] ){12}[A-Z]\s*$/.test(text.split("\n")[0]) && img.image.rects.every((r, i) => r.x === i * 15 && r.width === 12);
    },
    "the date, Calendar and Inbox are reversed out of white blocks": ({ widget }) => {
      const signs = []; const walk = n => { if (n.children) { if (n.backgroundColor && n.backgroundColor.hex === "#FFFFFF" && n.size && n.size.width === 84) signs.push(n); n.children.forEach(walk); } };
      walk(widget);
      return signs.length === 3 && signs.every(x => x.children[0].textColor.hex === "#0F1F47") && /^[A-Z][a-z]{2} \d\d\.\d\d$/.test(signs[0].children[0].text);
    },
    "then the Calendar and Inbox section rows, in that order": ({ text }) => { const l = text.split("\n"); const c = l.findIndex(x => /^\s*Calendar\s+■/.test(x)), i = l.findIndex(x => /^\s*Inbox\s+■/.test(x)); return c === 5 && c < i; },
    "calendar rows are day | time | what, the day on each day's first row": ({ text }) => /^[A-Z]{3}\s+14:00\s+Psychoanalysis \| Mayessi Svoronou$/m.test(text),
    "no rules between days, only the day name": ({ text }) => { const l = text.split("\n"); const i = l.findIndex(x => /Psychoanalysis/.test(x)); return !/^─/.test(l[i - 1]); },
    "Inbox rows are day | time | sender | detail": ({ text }) => /^[A-Z]{3}\s+\d\d:\d\d\s+Zalando\s+Out for delivery/m.test(text),
    "Inbox shows at most 5 items": ({ text }) => { const l = text.split("\n"); const i = l.findIndex(x => /^\s*Inbox\s+■/.test(x)); return l.length - i - 1 <= 5; },
    "every row fits the grid: no stretchy gaps between sections": ({ widget }) => widget.children.filter(c => c.spacer === "flex").length === 1 && widget.children[widget.children.length - 1].spacer === "flex",
    "habit rows are drawn": ({ text }) => /^Anki/m.test(text) && /^Gratitude/m.test(text),
    "calendar rows are drawn": ({ text }) => text.includes("Late dinner"),
    "now rows are drawn": ({ text }) => text.includes("★ Parcel"),
    "habit rows: name, 13 boxes, count without a leading zero": ({ text }) => /^Anki(\s+[□■]){13}\s+([1-9]\d?|0)$/m.test(text),
  }, note: "contents" });
  await run("overview.js", { ...widgetOpts, family: "large", events: [], expect: {
    "tapping the calendar opens Calendar, tapping the Inbox opens Mail": ({ widget }) => {
      const urls = widget.children.filter(c => c.url).map(c => c.url);
      return urls.includes("calshow://") && urls.includes("message://");
    },
    "an empty week takes one row": ({ text }) => /Nothing in the next month/.test(text) && text.includes("Zalando"),
  }, note: "empty calendar" });
  {
    const at = (d, h) => { const x = new Date(); x.setDate(x.getDate() + d); x.setHours(h, 0, 0, 0); return x; };
    const busy = [];
    for (let d = 1; d <= 6; d++) for (const h of [10, 14]) busy.push({ title: `Event ${d}-${h}`, startDate: at(d, h), endDate: at(d, h + 1), isAllDay: false, cal: "Home" });
    await run("overview.js", { ...widgetOpts, events: busy, family: "large", expect: {
      "one event per row; a day's later events leave the day blank": ({ text }) => /^[A-Z]{3}\s+10:00\s+Event 1-10$/m.test(text) && /^\s+14:00\s+Event 1-14$/m.test(text),
      "the calendar fills the rows Inbox doesn't take, with no count of what's left": ({ text }) => { const l = text.split("\n"); const c = l.findIndex(x => /^\s*Calendar/.test(x)), i = l.findIndex(x => /^\s*Inbox\s+■/.test(x)); return i - c - 1 >= 7 && /^\s*Calendar\s+■$/m.test(text); },
    }, note: "busy calendar" });
    const short = { now: { schema_version: 2, updated: iso(0), items: [
      { when: iso(1), star: false, title: "Amazon", detail: "Dispatched" },
      { when: iso(2), star: false, title: "DHL", detail: "With courier" },
    ] } };
    const far = [
      { title: "Soon", startDate: at(2, 10), endDate: at(2, 11), isAllDay: false, cal: "Home" },
      { title: "Far away", startDate: at(25, 10), endDate: at(25, 11), isAllDay: false, cal: "Home" },
    ];
    const farDate = (() => { const x = at(25, 0); return `${String(x.getDate()).padStart(2, "0")}.${String(x.getMonth() + 1).padStart(2, "0")}`; })();
    await run("overview.js", { ...widgetOpts, events: far, family: "large", expect: {
      "the calendar looks up to a month ahead to fill its rows": ({ text }) => text.includes("Far away"),
      "within a week the day is a weekday": ({ text }) => /^[A-Z]{3}\s+10:00\s+Soon$/m.test(text),
      "beyond a week it is the date": ({ text }) => new RegExp(`^${farDate.replace(".", "\\.")}\\s+10:00\\s+Far away$`, "m").test(text),
    }, note: "a month ahead" });
    await run("overview.js", { token: "tok", feeds: short, events: busy, family: "large", expect: {
      "a short Inbox shows all its items, and the calendar takes the rest": ({ text }) => text.includes("Amazon") && text.includes("DHL") && /Event 5-10/.test(text),
    }, note: "busy calendar, short inbox" });
  }
  {
    const at = (d, h) => { const x = new Date(); x.setDate(x.getDate() + d); x.setHours(h, 0, 0, 0); return x; };
    const withAllDay = [
      { title: "Bank holiday", startDate: at(1, 0), endDate: at(2, 0), isAllDay: true, cal: "Home" },
      { title: "Dentist", startDate: at(1, 9), endDate: at(1, 10), isAllDay: false, cal: "Home" },
      { title: "Packing day", startDate: at(2, 0), endDate: at(3, 0), isAllDay: true, cal: "Home" },
    ];
    const trip = [
      { title: "Parents Canada", startDate: at(0, 0), endDate: at(5, 0), isAllDay: true, cal: "Home" },
      { title: "Psychoanalysis", startDate: at(0, 23), endDate: at(1, 0), isAllDay: false, cal: "Home" },
      { title: "TT", startDate: at(3, 12), endDate: at(3, 13), isAllDay: false, cal: "Home" },
    ];
    await run("overview.js", { ...widgetOpts, events: trip, family: "large", expect: {
      "a multi-day all-day event is one row, timed until its last day": ({ text }) => (text.match(/Parents Canada/g) || []).length === 1 && /^[A-Z]{3}\s+–\d\d\.\d\d\s+Parents Canada$/m.test(text),
      "days with only that event carried over are skipped": ({ text }) => /^[A-Z]{3}\s+12:00\s+TT$/m.test(text),
    }, note: "multi-day all-day" });
    await run("overview.js", { ...widgetOpts, events: withAllDay, family: "large", expect: {
      "a one-day all-day event comes first in its day, timed —": ({ text }) => /^[A-Z]{3}\s+—\s+Bank holiday$/m.test(text) && text.indexOf("Bank holiday") < text.indexOf("Dentist"),
      "a day with only an all-day event still shows": ({ text }) => /^[A-Z]{3}\s+—\s+Packing day$/m.test(text),
    }, note: "all-day events" });
  }
  files["/docs/swiss-overview-hidden-calendars.json"] = JSON.stringify(["you@gmail.com"]);
  await run("overview.js", { ...widgetOpts, family: "large", expect: {
    "a hidden calendar's events are left out": ({ text }) => !text.includes("Psychoanalysis") && text.includes("Late dinner"),
    "a starred sender starts with ★": ({ text }) => /★ Parcel/.test(text),
  }, note: "hidden calendar, stars" });
  delete files["/docs/swiss-overview-hidden-calendars.json"];
  {
    const all = n => [n, ...(n.children || []).flatMap(all)];
    await run("overview.js", { ...widgetOpts, family: "large", expect: {
      "the date row is a refresh action, the only one": ({ widget }) => widget.children[0].action.id === "refresh" && all(widget).filter(n => n.action).length === 1,
      "with an all-but-invisible background (a stack without one ignores taps on the phone)": ({ widget }) => widget.children[0].backgroundColor.alpha === 0.01,
      "the Calendar sign picks calendars": ({ widget }) => all(widget).some(n => n.url && n.url.endsWith("?calendars=1")),
    }, note: "tap step 1" });
    await run("overview.js", { ...widgetOpts, action: { id: "refresh" }, expect: {
      "a tap rerun without a widget size still draws the large layout": ({ text }) => !text.includes("Made for the large") && /^\s*Inbox/m.test(text),
    }, note: "tap rerun, no family" });
    await run("overview.js", { ...widgetOpts, family: "large", noActions: true, expect: {
      "without tap actions the date row opens the habit menu": ({ widget }) => !widget.children[0].action && widget.children[0].url.endsWith("?menu=1"),
    }, note: "older Scriptable" });
  }
  {
    const all = n => [n, ...(n.children || []).flatMap(all)];
    const noNested = widget => all(widget).every(n => !n.url || !all(n).slice(1).some(c => c.url));
    await run("overview.js", { ...widgetOpts, family: "large", expect: {
      "a habit's name and its boxes are separate tap areas, never one inside the other": ({ widget }) => {
        const urls = all(widget).filter(n => n.url).map(n => n.url);
        return urls.some(u => u.endsWith("?days=Anki")) && urls.some(u => u.endsWith("?habit=Anki")) && noNested(widget);
      },
    }, note: "habit tap areas" });
  }
  await run("overview.js", { ...widgetOpts, inApp: true, note: "preview" });
  await run("overview.js", { ...widgetOpts, inApp: true, query: { menu: "1" }, expect: {
    "tapping the Habits header opens the menu": ({ alerts, widget }) => alerts === 1 && !widget,
  }, note: "header tap" });
  const before = files["/docs/habit-grid.json"];
  await run("overview.js", { ...widgetOpts, inApp: true, query: { habit: "Meditate" }, expect: {
    "tapping a habit row ticks it": ({ files }) => JSON.parse(files["/docs/habit-grid.json"]).Meditate.includes(new Date().toISOString().slice(0, 10)) !== JSON.parse(before).Meditate?.includes(new Date().toISOString().slice(0, 10)),
  }, note: "one-tap" });
  for (const family of ["accessoryRectangular", "accessoryInline", "small"]) await run("quotes.js", { family });
  await run("quotes.js", { family: "accessoryRectangular", expect: {
    "a quote for today's weekday, white, up to four lines": ({ widget }) => { const t = widget.children[0]; return typeof t.text === "string" && t.text.length > 10 && t.lineLimit === 4; },
    "redraws just after midnight": ({ widget }) => widget.refreshAfterDate > new Date() && widget.refreshAfterDate.getHours() === 0,
  }, note: "quote" });
  {
    const src = fs.readFileSync(path.join(root, "quotes.js"), "utf8");
    const quotes = [...src.matchAll(/^    "(.+)",$/gm)].map(m => m[1]);
    const long = quotes.filter(q => q.length > 65);
    console.log(`\n${long.length ? "FAIL" : "ok  "} quotes.js [${quotes.length} quotes, all short enough for four Lock Screen lines]`);
    long.forEach(q => console.log("     ! too long: " + q));
    if (quotes.length !== 28) { console.log("     ! expected 4 quotes for each of 7 days"); failures++; }
    failures += long.length ? 1 : 0;
  }
  for (const family of [...home, ...lock]) await run("reminders.js", { family });
  await run("reminders.js", { family: "large", expect: {
    "overdue first, then today (no time first, then by time), later, then undated newest first": ({ text }) => {
      const l = text.split("\n").slice(2).map(x => x.replace(/\s+/g, " ").trim());
      return /^\d\d\.\d\d Renew passport$/.test(l[0]) && l[1] === "— Buy batteries" && /^\d\d:\d\d Call landlord$/.test(l[2])
        && /^\d\d\.\d\d Book dentist$/.test(l[3]) && l[4] === "Fix bike light" && l[5] === "Old idea";
    },
    "header counts the overdue ones": ({ text }) => /Reminders\s+1 overdue/.test(text.split("\n")[0]),
    "each line links to marking it done, the title opens Reminders": ({ widget }) =>
      widget.children.filter(c => c.url && c.url.includes("?done=")).length === 6 && widget.children[0].url === "x-apple-reminderkit://",
  }, note: "order" });
  await run("reminders.js", { family: "medium", param: "Shopping", expect: {
    "the Parameter picks the lists": ({ text }) => text.includes("Buy batteries") && !text.includes("Renew passport"),
  }, note: "one list" });
  await run("reminders.js", { family: "medium", param: "Nope", expect: {
    "an unknown list says so": ({ text }) => text.includes("No list named Nope"),
  }, note: "unknown list" });
  await run("reminders.js", { family: "medium", reminders: [], expect: { "empty": ({ text }) => text.includes("Nothing to do") }, note: "empty" });
  await run("reminders.js", { family: "medium", noReminders: true, expect: { "no access": ({ text }) => text.includes("allow Reminders") }, note: "no access" });
  await run("reminders.js", { family: "accessoryCircular", expect: { "counts overdue and today": ({ text }) => text === "3" }, note: "count" });
  await run("reminders.js", { inApp: true, query: { done: "r4" }, sheets: [0], expect: {
    "tapping a line and choosing Mark as done completes that reminder": () => completed.length === 1 && completed[0] === "Book dentist",
  }, note: "mark done" });
  await run("reminders.js", { inApp: true, query: { done: "r4" }, sheets: [], expect: {
    "cancel changes nothing": () => completed.length === 1,
  }, note: "cancel" });
  await run("update.js", { inApp: true });
  console.log(`\n${failures ? failures + " failing" : "all passing"}`);
  process.exit(failures ? 1 : 0);
})();
