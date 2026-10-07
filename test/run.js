// Desk check: runs each widget script against a stand-in for Scriptable's API and prints
// what it would draw. It catches crashes and layout arithmetic, not how iOS renders things.
// Usage: node test/run.js

const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");

let failures = 0;
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
  layoutHorizontally() {} layoutVertically() {}
  setPadding(...p) { this.padding = p; }
}
class ListWidget extends Stack {
  async presentSmall() { this.presented = "small"; }
  async presentMedium() { this.presented = "medium"; }
  async presentLarge() { this.presented = "large"; }
}

// width a row of fixed-size children needs, to check it fits its stack
function fixedWidth(s) {
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
  let widget = null, alerts = 0;

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
    Alert: class {
      addAction() {} addCancelAction() {}
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
      constructor(url) { this.url = url; }
      async loadJSON() {
        if (opts.offline) throw new Error("offline");
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

  await run("update.js", { inApp: true });

  console.log(`\n${failures ? failures + " failing" : "all passing"}`);
  process.exit(failures ? 1 : 0);
})();
