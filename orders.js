const S = importModule("swiss");

// Parcels and important emails, read from Marcel's misc server (pushed there by Hermes).
// Home Screen widgets can be read by bystanders, so this shows only a retailer (or the generic
// title of a private order) and its status. No tracking numbers, no email bodies.
const BASE = "https://misc.mrdrr.uk/widget/api/";
const KEY = "misc-widget-read-token";   // the read token lives in the Keychain, never in this file
const TITLE = "Orders";
const HIDE_DELIVERED_AFTER_H = 48;
const MAX_IMPORTANT = 3;
const STATUS_W = 140;       // status column on the large widget
const COL_GAP = 12;         // gap between the two columns on the medium widget

const ORDER = ["problem", "out_for_delivery", "with_courier", "dispatched", "ordered", "delivered"];

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

// returns { orders, important, fetchedAt, stale, error? }
async function load(token) {
  const cache = readCache();
  const out = { orders: cache.orders || [], important: cache.important || [], fetchedAt: cache.fetchedAt, stale: true };
  if (!token) return { ...out, error: "Run in Scriptable once to set the token" };
  let ok = 0;
  const next = { ...cache };
  for (const [name, list] of [["orders", "orders"], ["important", "important"]]) {
    try {
      const json = await fetchFeed(name, token);
      next[name] = out[name] = Array.isArray(json[list]) ? json[list] : [];
      ok++;
    } catch (e) {
      if (e instanceof Rejected && ok === 0 && name === "orders") out.rejected = true;
    }
  }
  if (ok) { next.fetchedAt = out.fetchedAt = Date.now(); writeCache(next); }
  out.stale = ok < 2;
  return out;
}

// ---- what to show ----
const rank = o => { const i = ORDER.indexOf(o.status); return i === -1 ? ORDER.length : i; };
function visibleOrders(orders) {
  const cutoff = Date.now() - HIDE_DELIVERED_AFTER_H * 3600 * 1000;
  return orders
    .filter(o => !(o.delivered || o.status === "delivered") || new Date(o.last_event).getTime() >= cutoff)
    .sort((a, b) => rank(a) - rank(b) || new Date(b.last_event) - new Date(a.last_event));
}
function visibleImportant(list) {
  return [...list].sort((a, b) => (b.urgent - a.urgent) || (new Date(b.received) - new Date(a.received)));
}
const nameOf = o => (o.private ? o.title : o.retailer || o.title) || "Parcel";
// eta is a date or a range "YYYY-MM-DD/YYYY-MM-DD"; show the latest day as DD.MM
function etaText(eta) {
  if (!eta) return "";
  const last = String(eta).split("/").pop();
  const m = last.match(/^\d{4}-(\d{2})-(\d{2})/);
  return m ? `${m[2]}.${m[1]}` : "";
}
function statusText(o, withEta) {
  const e = withEta && o.status !== "delivered" ? etaText(o.eta) : "";
  return e ? `${o.status_label} · ${e}` : o.status_label || "";
}
const colourOf = o => (o.status === "problem" ? S.ALERT : S.FG);
const importantColour = i => (i.urgent ? S.ALERT : S.FG);
const importantText = i => `${i.urgent ? "! " : ""}${i.subject || i.from || ""}`;

// right-hand header text: the date, or when the data is old, the time it was last fetched
function headRight(data, small) {
  if (data.stale && data.fetchedAt) return `stale ${S.timeLabel(new Date(data.fetchedAt))}`;
  return small ? null : S.dateLabel();
}

// two lines per order: name, then dimmed status
function orderBlock(parent, width, orders, count) {
  orders.slice(0, count).forEach((o, i) => {
    if (i > 0) parent.addSpacer(S.ROW_GAP);
    S.row(parent, width, [{ text: nameOf(o) }], colourOf(o));
    parent.addSpacer(S.ROW_GAP);
    S.row(parent, width, [{ text: statusText(o, true) }], o.status === "problem" ? S.ALERT : S.DIM);
  });
}

// ---- Home Screen widget ----
function buildWidget(data) {
  const w = S.widget();
  const { innerW, availH, small, large } = S.metrics();
  const orders = visibleOrders(data.orders);
  const important = visibleImportant(data.important);

  if (data.error || data.rejected) {
    S.header(w, innerW, TITLE, null);
    S.note(w, innerW, data.error || "Token rejected. Run in Scriptable to re-enter");
    return S.finish(w);
  }

  if (small) {
    S.header(w, innerW, TITLE, headRight(data, true));
    if (!orders.length) S.note(w, innerW, "No active orders");
    orderBlock(w, innerW, orders, Math.floor(S.rowsFor(availH, 1) / 2));
    return S.finish(w);
  }

  if (large) {
    const rows = S.rowsFor(availH, 2);
    const nImp = Math.min(MAX_IMPORTANT, important.length);
    const nOrd = Math.max(1, rows - Math.max(nImp, 1));   // an empty section still uses one row for its note
    S.header(w, innerW, TITLE, headRight(data, false));
    if (!orders.length) S.note(w, innerW, "No active orders");
    orders.slice(0, nOrd).forEach((o, i) => {
      if (i > 0) w.addSpacer(S.ROW_GAP);
      S.row(w, innerW, [{ text: nameOf(o) }, { text: statusText(o, true), w: STATUS_W, right: true }], colourOf(o));
    });
    w.addSpacer(S.SECTION_GAP);
    S.header(w, innerW, "Important", null);
    if (!important.length) S.note(w, innerW, "Nothing important");
    important.slice(0, nImp).forEach((i, n) => {
      if (n > 0) w.addSpacer(S.ROW_GAP);
      S.row(w, innerW, [{ text: importantText(i) }], importantColour(i));
    });
    return S.finish(w);
  }

  // medium: orders on the left, important on the right
  const colW = Math.floor((innerW - COL_GAP) / 2);
  const rows = S.rowsFor(availH, 1);
  const cols = w.addStack(); cols.size = new Size(innerW, availH); cols.layoutHorizontally();
  const left = cols.addStack(); left.layoutVertically(); left.size = new Size(colW, availH);
  cols.addSpacer(COL_GAP);
  const right = cols.addStack(); right.layoutVertically(); right.size = new Size(colW, availH);

  S.header(left, colW, TITLE, null);
  if (!orders.length) S.note(left, colW, "No active orders");
  orderBlock(left, colW, orders, Math.floor(rows / 2));

  S.header(right, colW, "Important", headRight(data, true));
  if (!important.length) S.note(right, colW, "Nothing important");
  important.slice(0, Math.min(MAX_IMPORTANT, rows)).forEach((i, n) => {
    if (n > 0) right.addSpacer(S.ROW_GAP);
    S.row(right, colW, [{ text: importantText(i) }], importantColour(i));
  });
  return w;
}

// ---- Lock Screen ----
function lockLines(data, max) {
  if (data.error) return [data.error];
  const orders = visibleOrders(data.orders);
  const lines = orders.slice(0, max).map(o => `${nameOf(o)} · ${o.status_label}`);
  return lines.length ? lines : ["No active orders"];
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
  return data.error ? "–" : String(visibleOrders(data.orders).filter(o => o.status !== "delivered" && !o.delivered).length);
}
function inlineLine(data) {
  if (data.error) return data.error;
  const urgent = data.important.filter(i => i.urgent).length;
  return `${activeCount(data)} orders` + (urgent ? ` · ${urgent} urgent` : "");
}

// ---- run ----
let token = Keychain.contains(KEY) ? Keychain.get(KEY) : null;
if (!token && !config.runsInWidget) token = await askToken("Paste the read token for the widget feed. It is stored in the iPhone Keychain.");
let data = await load(token);
if (data.rejected && !config.runsInWidget) {   // wrong token: let the user fix it now
  const t = await askToken("The server rejected the token. Paste the correct read token.");
  if (t) data = await load(t);
}

const family = config.widgetFamily;
const widget = family === "accessoryRectangular" ? buildLockRect(data)
  : family === "accessoryCircular" ? S.lockCircle(activeCount(data))
  : family === "accessoryInline" ? S.lockInline(inlineLine(data))
  : buildWidget(data);
S.refresh(widget);

if (config.runsInWidget) Script.setWidget(widget);
else await widget.presentMedium();   // preview when run inside the app
Script.complete();
