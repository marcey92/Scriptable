// lib-now.js: the "Inbox" feed and its drawing (overview.js and hermes.js load it). Not a widget by itself.
const S = importModule("swiss");

// One list of what is going on: parcels and important emails, read from Marcel's misc server
// (pushed there by Hermes, which decides the items, their order, the stars and the wording).
const BASE = "https://misc.mrdrr.uk/widget/api/";
const KEY = "misc-widget-read-token";   // the read token lives in the Keychain, never in this file
const TITLE = "Inbox";
const MAIL_URL = "message://";   // tapping the Inbox opens the Mail app
const HIDE_DELIVERED_AFTER_H = 48;
const STALE_MIN = 90;      // the feed counts as stale when Hermes last ran longer ago than this

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

// the rows to show: { star, name, long, short, when, done }.
// From the now feed: in Hermes's order, as Hermes wrote them. From the older pair: built here, newest first.
function items(data) {
  if (data.items) {
    return data.items.map(i => ({
      star: !!i.star, name: i.title || "", long: i.detail || "", short: i.short || "",
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
      when: new Date(o.last_event).getTime() || 0,
      done: isDelivered(o),
    });
  }
  for (const i of data.important) {
    out.push({
      star: true, name: i.from || "Email", long: i.subject || "", short: "",
      when: new Date(i.received).getTime() || 0, done: false,
    });
  }
  return out.sort((a, b) => b.when - a.when);
}

// the first `n` items, in the feed's order (newest first). Stars mark items; they don't hold a place.
function pick(list, n) {
  return list.slice(0, n);
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

// the Inbox as timetable rows for the overview: day | time | sender | detail. The weekday names an item
// within the last 6 days, shown only when it changes; older items show their date in the time column.
function timetableRows(data, n) {
  const rows = [];
  let prevDay = null;
  for (const it of pick(items(data), n)) {
    const d = new Date(it.when);
    const recent = it.when && d >= S.dayStart(-6);
    const dayKey = recent ? d.toDateString() : null;
    rows.push({
      day: recent && dayKey !== prevDay ? S.WD[d.getDay()].slice(0, 3).toUpperCase() : "",
      time: !it.when ? "" : recent ? S.timeLabel(d) : `${S.p(d.getDate())}.${S.p(d.getMonth() + 1)}`,
      star: it.star,
      who: it.name,
      what: it.long,
    });
    prevDay = dayKey;
  }
  return rows;
}
// `small`: a small widget's two columns, time | who (no room for the day or the detail)
function drawTimetable(w, W, data, n, empty = "Nothing going on", small = false) {
  const note = text => S.gRow(w, W, small ? [{ text }] : [{ text: "", w: S.G.KEY }, { text }]);
  if (data.error || data.rejected) { note(data.error || "Token rejected. Run in Scriptable to re-enter"); return; }
  const rows = timetableRows(data, n);
  if (!rows.length) { note(data.noData ? "No data" : empty); return; }
  for (const r of rows) {
    const who = { text: (r.star ? "★ " : "") + r.who, font: S.F.key };
    S.gRow(w, W, small ? [{ text: r.time, w: S.G.T, font: S.F.mono }, who]
      : [{ text: r.day, w: S.G.D, font: S.F.key }, { text: r.time, w: S.G.T, font: S.F.mono }, { ...who, w: S.G.W1 }, { text: r.what }]);
  }
}

// the read token from the Keychain; inside the app, ask for it when it is missing
async function token() {
  if (Keychain.contains(KEY)) return Keychain.get(KEY);
  return config.runsInWidget ? null : askToken("Paste the read token for the widget feed. It is stored in the iPhone Keychain.");
}

module.exports = { timetableRows, drawTimetable, TITLE, MAIL_URL, KEY, Rejected, fetchFeed, whenText, askToken, token, load, items, pick, headRight, isStale };
