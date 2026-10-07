// lib-now.js: the "Inbox" list (orders.js and overview.js load it). Not a widget by itself.
const S = importModule("swiss");

// One list of what is going on: parcels and important emails, read from Marcel's misc server
// (pushed there by Hermes). A star marks important emails and problem parcels.
// Home Screen widgets can be read by bystanders, so a parcel shows only its retailer (or the generic
// title of a private order) and status, and an email only its sender and subject. No tracking
// numbers, no email summaries or bodies.
const BASE = "https://misc.mrdrr.uk/widget/api/";
const KEY = "misc-widget-read-token";   // the read token lives in the Keychain, never in this file
const TITLE = "Inbox";
const HIDE_DELIVERED_AFTER_H = 48;
const STALE_MIN = 90;      // the feed counts as stale when Hermes last ran longer ago than this
const CHAR_W = 6.4;         // average width of one character at the row text size, to size the title column
const TITLE_MAX = 0.45;     // the title column never takes more than this share of the row after the time
const COL_GAP = 10;         // space between the title and detail columns

// ---- cache: the last good copy of both feeds, so the widget still draws when the server can't be reached ----
const fm = FileManager.local();
const cachePath = fm.joinPath(fm.documentsDirectory(), "swiss-orders.json");
function readCache() {
  try { return fm.fileExists(cachePath) ? JSON.parse(fm.readString(cachePath)) : {}; }
  catch (e) { return {}; }
}
function writeCache(c) { try { fm.writeString(cachePath, JSON.stringify(c)); } catch (e) {} }

// ---- token ----
async function askToken(message) {
  const a = new Alert();
  a.title = "Widget read token";
  a.message = message;
  a.addSecureTextField("token");
  a.addAction("Save");
  a.addCancelAction("Cancel");
  if ((await a.present()) === -1) return null;
  const t = a.textFieldValue(0).trim();
  if (!t) return null;
  Keychain.set(KEY, t);
  return t;
}

// ---- feeds ----
class Rejected extends Error {}
async function fetchFeed(name, token) {
  const req = new Request(BASE + name);
  req.headers = { Authorization: `Bearer ${token}` };
  req.timeoutInterval = 10;
  const json = await req.loadJSON();
  const status = req.response && req.response.statusCode;
  if (status === 404) throw new Rejected("wrong token or no data yet");
  if (status !== 200) throw new Error(`HTTP ${status}`);
  return json;
}

// returns { items } (the now feed, as Hermes ordered it) or { orders, important } (the older pair),
// plus { updated, rejected?, error?, noData? }. `updated` is when Hermes last ran (the feed's own
// timestamp, ms), which is what staleness is judged on: the phone's fetch time says nothing about
// Hermes, since the server can be reachable while Hermes is down. Every good fetch is cached; a
// failed one shows the cache with its cached `updated`.
const ms = iso => { const t = Date.parse(iso || ""); return isNaN(t) ? null : t; };
async function load(token) {
  const cache = readCache();
  const has = cache.items || cache.orders || cache.important;
  const out = cache.items
    ? { items: cache.items, updated: cache.updated || null }
    : { orders: cache.orders || [], important: cache.important || [], updated: cache.updated || null };
  if (!has) out.noData = true;
  if (!token) return { ...out, error: "Run in Scriptable once to set the token" };
  try {
    const json = await fetchFeed("now", token);
    const items = Array.isArray(json.items) ? json.items : [];
    const updated = ms(json.updated);
    writeCache({ items, updated });
    return { items, updated };
  } catch (e) {
    if (!(e instanceof Rejected)) return out;   // offline or server error: the last good copy
  }
  // no now feed yet (or a wrong token): the older pair; its age is that of the older of the two
  const legacy = { orders: cache.orders || [], important: cache.important || [], updated: cache.items ? null : out.updated, noData: out.noData };
  let ok = 0;
  const next = { orders: legacy.orders, important: legacy.important };
  const stamps = [];
  for (const name of ["orders", "important"]) {
    try {
      const json = await fetchFeed(name, token);
      next[name] = legacy[name] = Array.isArray(json[name]) ? json[name] : [];
      stamps.push(ms(json.updated));
      ok++;
    } catch (e) {
      if (e instanceof Rejected && ok === 0 && name === "orders") legacy.rejected = true;
    }
  }
  if (ok) {
    next.updated = legacy.updated = stamps.includes(null) || ok < 2 ? null : Math.min(...stamps);
    delete legacy.noData;
    writeCache(next);
  }
  return legacy;
}

// ---- what to show: one list of everything going on ----
const SHORT = { out_for_delivery: "Today", with_courier: "Courier", dispatched: "Sent", ordered: "Ordered", problem: "Problem", delivered: "Done" };

// eta is a date or a range "YYYY-MM-DD/YYYY-MM-DD"; show the latest day as DD.MM
function etaText(eta) {
  if (!eta) return "";
  const m = String(eta).split("/").pop().match(/^\d{4}-(\d{2})-(\d{2})/);
  return m ? `${m[2]}.${m[1]}` : "";
}
const isDelivered = o => o.delivered || o.status === "delivered";

// "14:02" if it happened today, "14:02·" if yesterday, otherwise the date as "06.10"
function whenText(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  if (d.toDateString() === new Date().toDateString()) return S.timeLabel(d);
  if (d.toDateString() === S.dayStart(-1).toDateString()) return S.timeLabel(d) + "·";   // yesterday: the time, then a dot
  return `${S.p(d.getDate())}.${S.p(d.getMonth() + 1)}`;
}

// the rows to show: { star, name, long, short, lock, when, done }.
// From the now feed: in Hermes's order, as Hermes wrote them. From the older pair: built here, newest first.
function items(data) {
  if (data.items) {
    return data.items.map(i => ({
      star: !!i.star, name: i.title || "", long: i.detail || "", short: i.short || "",
      lock: [i.title, i.short || i.detail].filter(Boolean).join(" · "),
      when: new Date(i.when).getTime() || 0, done: false,
    }));
  }
  const cutoff = Date.now() - HIDE_DELIVERED_AFTER_H * 3600 * 1000;
  const out = [];
  for (const o of data.orders) {
    if (isDelivered(o) && new Date(o.last_event).getTime() < cutoff) continue;
    const eta = isDelivered(o) ? "" : etaText(o.eta);
    const label = o.status_label || "";
    const name = (o.private ? o.title : o.retailer || o.title) || "Parcel";
    out.push({
      star: o.status === "problem",
      name,
      long: eta ? `${label} · ${eta}` : label,
      short: SHORT[o.status] || label,
      lock: `${name} · ${SHORT[o.status] || label}`,
      when: new Date(o.last_event).getTime() || 0,
      done: isDelivered(o),
    });
  }
  for (const i of data.important) {
    out.push({
      star: true, name: i.from || "Email", long: i.subject || "", short: "",
      lock: [i.from, i.subject].filter(Boolean).join(" · "),
      when: new Date(i.received).getTime() || 0, done: false,
    });
  }
  return out.sort((a, b) => b.when - a.when);
}

// the first `n` items, except that a starred item never drops off: any that are too far down to fit
// replace the last unstarred ones at the bottom (so the order is kept)
function pick(list, n) {
  const top = list.slice(0, n);
  const missing = list.slice(n).filter(it => it.star);
  if (!missing.length) return top;
  const keep = Math.max(0, n - missing.length);
  const plain = top.filter(it => !it.star);
  const drop = new Set(plain.slice(Math.max(0, plain.length - (n - keep))));
  return [...top.filter(it => !drop.has(it)), ...missing].slice(0, n);
}

// right-hand header text: nothing, unless Hermes hasn't updated the feed for a while
function headRight(data) {
  if (!isStale(data)) return null;
  return data.updated ? `Stale since ${whenText(data.updated)}` : "Stale";
}

// Hermes refreshes every 30 minutes and sets `updated` every run, so more than STALE_MIN old means
// three missed runs: the Mac is asleep or offline, or Hermes stopped
function isStale(data) {
  if (data.noData) return false;   // nothing to be stale about; the list says "No data"
  return !data.updated || Date.now() - data.updated > STALE_MIN * 60 * 1000;
}

// ---- Home Screen widget ----
function buildWidget(data) {
  const w = S.widget();
  const { innerW, availH, small } = S.metrics();

  if (data.error || data.rejected) {
    S.header(w, innerW, TITLE, null);
    drawRows(w, innerW, 1, data);
    return S.finish(w);
  }

  S.header(w, innerW, TITLE, headRight(data));
  drawRows(w, innerW, S.rowsFor(availH, 1), data, small);
  return S.finish(w);
}

// `rows` lines of items under a header that is already drawn (also used by the overview widget).
// medium and large: time or date, text (starred ones begin with ★), status. small: no time, a short status.
function drawRows(w, innerW, rows, data, small = false) {
  if (data.error || data.rejected) {
    S.row(w, innerW, [{ text: data.error || "Token rejected. Run in Scriptable to re-enter" }]);
    return;
  }
  const list = items(data);
  const shown = pick(list, rows);
  const detail = it => (small ? it.short : it.long);
  const title = it => (it.star ? "★ " : "") + it.name;
  // three columns: time, title, detail. The title column is as wide as the longest title shown (up to
  // TITLE_MAX of the space after the time), so every detail starts at the same place; text is cut off with "…"
  const lead = small ? 0 : S.TIME_W;
  const titleW = Math.min(Math.floor((innerW - lead) * TITLE_MAX), Math.ceil(Math.max(0, ...shown.map(it => title(it).length)) * CHAR_W) + COL_GAP);
  if (!list.length) S.row(w, innerW, [{ text: data.noData ? "No data" : "Nothing going on" }]);
  shown.forEach((it, i) => {
    if (i > 0) w.addSpacer(S.ROW_GAP);
    const cells = [];
    if (!small) cells.push({ text: whenText(it.when), w: S.TIME_W, mono: true });
    cells.push({ text: title(it), w: titleW }, { text: detail(it), w: innerW - lead - titleW });
    S.row(w, innerW, cells);
  });
}

// the read token from the Keychain; inside the app, ask for it when it is missing
async function token() {
  if (Keychain.contains(KEY)) return Keychain.get(KEY);
  return config.runsInWidget ? null : askToken("Paste the read token for the widget feed. It is stored in the iPhone Keychain.");
}

// ---- Lock Screen ----
function lockLine(it) {
  return `${it.star ? "★ " : ""}${it.lock}`;
}
function lockLines(data, max) {
  if (data.error) return [data.error];
  const lines = pick(items(data), max).map(lockLine);
  return lines.length ? lines : ["Nothing going on"];
}
function buildLockRect(data) {
  const w = S.lockWidget();
  lockLines(data, 3).forEach((text, i) => {
    if (i > 0) w.addSpacer(3);
    S.lockText(w, text);
  });
  w.addSpacer();
  return w;
}
function activeCount(data) {
  return data.error ? "–" : String(items(data).filter(i => !i.done).length);
}
function inlineLine(data) {
  if (data.error) return data.error;
  const stars = items(data).filter(i => i.star).length;
  return `${activeCount(data)} going on` + (stars ? ` · ${stars} ★` : "");
}

module.exports = { TITLE, KEY, askToken, token, load, items, pick, headRight, isStale, drawRows, buildWidget, buildLockRect, activeCount, inlineLine };
