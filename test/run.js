// Desk check: runs each widget script against a stand-in for Scriptable's API and prints
// what it would draw. It catches crashes and layout arithmetic, not how iOS renders things.
// Usage: node test/run.js

const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");

let failures = 0;
let feedCalls = null;
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
  const stacks = s.children.filter(c => c instanceof Stack).length;
  return w + (s.spacing || 0) * Math.max(0, stacks - 1);
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
    else if (c instanceof Stack) h += c.size ? c.size.height : 12;
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
  return kids.join("  ");
}

async function run(file, opts = {}) {
  const now = new Date();
  const at = (dayOffset, h, m = 0) => { const d = new Date(now); d.setDate(d.getDate() + dayOffset); d.setHours(h, m, 0, 0); return d; };
  const events = opts.events || [
    { title: "Late dinner", startDate: at(0, 23, 30), endDate: at(0, 23, 59), isAllDay: false, cal: "Home" },
    { title: "Psychoanalysis | Mayessi Svoronou", startDate: at(1, 14), endDate: at(1, 15), isAllDay: false, cal: "you@gmail.com" },
    { title: "Brunch", startDate: at(3, 11), endDate: at(3, 12), isAllDay: false, cal: "Home" },
  ];
  let widget = null, alerts = 0, keychainSet = null;

  const g = {
    console: { log: () => {} },
    config: { runsInWidget: opts.inApp ? false : true, widgetFamily: opts.family },
    args: { widgetParameter: opts.param || null, queryParameters: opts.query || {} },
    Color: class { constructor(hex, alpha = 1) { this.hex = hex; this.alpha = alpha; } static white() { return new g.Color("#FFFFFF"); } },
    Size: class { constructor(w, h) { this.width = w; this.height = h; } },
    Font: new Proxy({}, { get: (_, name) => size => ({ name, size }) }),
    ListWidget,
    Device: {
      screenSize: () => ({ width: 393, height: 852 }),
      batteryLevel: () => (opts.battery === undefined ? 0.72 : opts.battery),
      isCharging: () => !!opts.charging, isFullyCharged: () => false,
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
      async presentSheet() { alerts++; return -1; } async present() { alerts++; return 0; }
    },
    FileManager: (() => {
      const fm = {
        documentsDirectory: () => "/docs", joinPath: (a, b) => `${a}/${b}`,
        fileExists: p => p in files, readString: p => files[p], writeString: (p, s) => { files[p] = s; },
        downloadFileFromiCloud: async () => {},
      };
      return { iCloud: () => fm, local: () => fm };
    })(),
    Calendar: { forEvents: async () => [{ title: "Home" }, { title: "you@gmail.com" }] },
    CalendarEvent: {
      today: async () => events.filter(e => e.startDate.toDateString() === now.toDateString()),
      between: async (s, e, cals) => {
        if (opts.noCalendar) throw new Error("denied");
        const names = cals.map(c => c.title);
        return events.filter(ev => ev.startDate < e && ev.endDate > s && (!names.length || names.includes(ev.cal)));
      },
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
        for (let i = 0; i < n; i++) { time.push(t0 + i * 3600); temp.push(10 + (i % 24) / 3); rain.push((i * 7) % 100); code.push([0, 2, 3, 61, 80][i % 5]); }
        return { hourly: { time, temperature_2m: temp, precipitation_probability: rain, weather_code: code } };
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
      const m = { small: 117, medium: 117, large: 312 }[opts.family];
      if (m && height(widget) > m + 0.01) issues.push(`content is ${height(widget)} tall, slot allows about ${m}`);
    } else if (!opts.inApp) issues.push("no widget was set");
    console.log(`\n${issues.length ? "FAIL" : "ok  "} ${label}`);
    if (widget) for (const c of widget.children) { const d = describe(c); if (d) console.log("     " + d); }
    if (opts.inApp) console.log(`     (alerts shown: ${alerts})`);
    if (opts.expect) for (const [what, fn] of Object.entries(opts.expect)) {
      if (!fn({ widget, text: widget ? widget.children.map(describe).filter(Boolean).join("\n") : "", keychainSet, files })) issues.push(`expected: ${what}`);
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
  for (const family of ["medium", "large", ...lock]) await run("habit-grid.js", { family });
  await run("habit-grid.js", { inApp: true, note: "menu" });
  await run("habit-grid.js", { inApp: true, query: { habit: "Meditate" }, note: "one-tap" });
  await run("habit-grid.js", { family: "medium", note: "after one-tap" });

  for (const family of [...home, "accessoryRectangular", "accessoryInline"]) await run("calendar-list.js", { family });
  await run("calendar-list.js", { family: "medium", param: "Google: you@gmail.com", note: "Google parameter" });
  await run("calendar-list.js", { family: "medium", param: "Nope", note: "unknown calendar" });
  await run("calendar-list.js", { family: "medium", events: [], note: "empty week" });
  await run("calendar-list.js", { family: "medium", noCalendar: true, note: "no access" });
  await run("calendar-list.js", { inApp: true });

  for (const family of [...home, ...lock]) await run("battery.js", { family });
  await run("battery.js", { family: "medium", battery: 1, charging: true, note: "100%, charging" });
  await run("battery.js", { family: "small", battery: 0.03, note: "3%" });

  for (const family of [...home, ...lock]) await run("weather.js", { family });
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
  for (const family of [...home, ...lock]) await run("orders.js", { ...widgetOpts, family, expect: { "no tracking numbers or email bodies": clean } });
  await run("orders.js", { ...widgetOpts, family: "medium", expect: {
    "no date in the header": ({ text }) => !/\d\d\.\d\d \w{3}/.test(text.split("\n")[0]),
    "one list: titled Now, no Orders or Important sections": ({ text }) => text.includes("Now") && !text.includes("Important") && !text.includes("Orders"),
    "sorted newest first, stars do not jump ahead": ({ text }) => text.indexOf("Zalando") < text.indexOf("Parcel") && text.indexOf("Parcel") < text.indexOf("Landlord") && text.indexOf("Landlord") < text.indexOf("Bank"),
    "starred items are marked": ({ text }) => /★ Parcel/.test(text) && /★ Landlord/.test(text),
    "range eta shows the later day": ({ text }) => text.includes("Out for delivery · 09.10"),
    "private order shows its generic title, not the retailer": ({ text }) => !/^X$/m.test(text) && text.includes("Parcel"),
    "emails show the sender, then the subject on the right": ({ text }) => /★ Landlord\s+Boiler repair today/.test(text),
    "today shows a time": ({ text }) => /\d\d:\d\d\s+Zalando/.test(text),
    "five rows on medium, no +N more line": ({ text }) => !/more/.test(text) && text.split("\n").filter(l => /^\s*(\d\d:\d\d|Yest|\d\d\.\d\d)/.test(l)).length === 5,
  }, note: "one list" });
  await run("orders.js", { ...widgetOpts, family: "large", expect: {
    "ordered sorts after out for delivery": ({ text }) => text.indexOf("Zalando") < text.indexOf("Amazon"),
    "recent delivered is shown": ({ text }) => text.includes("Apple"),
    "delivered older than 48h is hidden": ({ text }) => !text.includes("IKEA"),
    "yesterday shows Yest": ({ text }) => /Yest\s+★ Bank/.test(text),
    "older than yesterday shows the date": ({ text }) => { const d = new Date(Date.now() - 48 * 3600 * 1000); return new RegExp(`${String(d.getDate()).padStart(2, "0")}\\.${String(d.getMonth() + 1).padStart(2, "0")}\\s+Amazon`).test(text); },
    "every important email is starred": ({ text }) => /★ Landlord/.test(text) && /★ Bank/.test(text),
    "nothing is cut off on the large widget": ({ text }) => !/more/.test(text),
  }, note: "hide old delivered" });
  const busy = { orders: { orders: [1, 2, 3, 4, 5, 6].map(n => ({ id: `n${n}`, retailer: `Shop${n}`, private: false, status: "dispatched", status_label: "Dispatched", last_event: iso(n), delivered: false })) },
    important: { important: [{ id: "old", from: "Council", subject: "Old but important", received: iso(72), urgent: false }] } };
  const savedCache = files["/docs/swiss-orders.json"];
  await run("orders.js", { token: "tok", feeds: busy, family: "medium", expect: {
    "an old starred item too old to fit takes the bottom row": ({ text }) => /★ Council/.test(text.split("\n").pop()),
    "the rest are the newest, in order": ({ text }) => /Shop1[\s\S]*Shop2[\s\S]*Shop3[\s\S]*Shop4/.test(text) && !text.includes("Shop5"),
  }, note: "old star kept" });
  files["/docs/swiss-orders.json"] = savedCache;   // the offline tests below read the earlier cache
  await run("orders.js", { ...widgetOpts, family: "medium", offline: true, expect: {
    "stale cache is shown with a stale marker": ({ text }) => text.includes("stale") && text.includes("Zalando"),
  }, note: "offline, cached" });
  delete files["/docs/swiss-orders.json"];
  await run("orders.js", { ...widgetOpts, family: "medium", offline: true, expect: {
    "empty and offline still draws a message": ({ text }) => text.includes("Nothing going on"),
  }, note: "offline, no cache" });
  await run("orders.js", { feeds, family: "medium", expect: {
    "asks to run in the app when there is no token": ({ text }) => text.includes("Run in Scriptable"),
  }, note: "no token" });
  await run("orders.js", { feeds, inApp: true, typedToken: "tok", expect: {
    "token typed in the app goes to the Keychain": ({ keychainSet }) => keychainSet === "tok",
  }, note: "first run, enter token" });
  await run("orders.js", { ...widgetOpts, token: "nope", family: "medium", expect: {
    "wrong token says so": ({ text }) => text.includes("Token rejected"),
  }, note: "wrong token" });
  await run("orders.js", { feeds, token: "nope", inApp: true, typedToken: "tok", expect: {
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
  await run("orders.js", { token: "tok", feeds: nowFeed, family: "medium", expect: {
    "items keep Hermes's order": ({ text }) => text.indexOf("Older first") < text.indexOf("Homes & Villas") && text.indexOf("Homes & Villas") < text.indexOf("Amazon"),
    "title then detail on the right": ({ text }) => /★ Homes & Villas\s+Reply to your complaint/.test(text),
    "a starred item below the fold takes the bottom row": ({ text }) => /★ Council/.test(text.split("\n").pop()),
  }, note: "now feed" });
  await run("orders.js", { token: "tok", feeds: nowFeed, family: "small", expect: {
    "short replaces detail on small": ({ text }) => /Amazon\s+Today/.test(text),
  }, note: "now feed" });
  await run("orders.js", { token: "tok", feeds: nowFeed, family: "medium", offline: true, expect: {
    "offline shows the cached now feed": ({ text }) => text.includes("stale") && text.includes("Homes & Villas"),
  }, note: "now feed, offline" });
  files["/docs/swiss-orders.json"] = savedCache2;

  for (const family of ["large", "medium", "accessoryInline"]) await run("overview.js", { ...widgetOpts, family });
  await run("overview.js", { ...widgetOpts, family: "large", expect: {
    "three sections: day, habits, now": ({ text }) => /^Today/m.test(text) && /^Habits/m.test(text) && /^Now/m.test(text),
    "habit rows are drawn": ({ text }) => /^Anki/m.test(text) && /^Gratitude/m.test(text),
    "calendar rows are drawn": ({ text }) => text.includes("Late dinner"),
    "now rows are drawn": ({ text }) => text.includes("★ Parcel"),
    "calendar takes at most half the shared rows": ({ text }) => !text.includes("Brunch"),
  }, note: "contents" });
  await run("overview.js", { ...widgetOpts, family: "large", events: [], expect: {
    "an empty week still leaves Now its rows": ({ text }) => text.includes("Nothing this week") && text.includes("Zalando") && text.includes("Amazon"),
  }, note: "empty calendar" });
  await run("overview.js", { ...widgetOpts, inApp: true, note: "preview" });
  const before = files["/docs/habit-grid.json"];
  await run("overview.js", { ...widgetOpts, inApp: true, query: { habit: "Meditate" }, expect: {
    "tapping a habit row ticks it": ({ files }) => JSON.parse(files["/docs/habit-grid.json"]).Meditate.includes(new Date().toISOString().slice(0, 10)) !== JSON.parse(before).Meditate?.includes(new Date().toISOString().slice(0, 10)),
  }, note: "one-tap" });

  await run("update.js", { inApp: true });

  console.log(`\n${failures ? failures + " failing" : "all passing"}`);
  process.exit(failures ? 1 : 0);
})();
