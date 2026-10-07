const S = importModule("swiss");

// One list of what is going on: parcels and important emails, read from Marcel's misc server
// (pushed there by Hermes). A star marks urgent emails and problem parcels.
// Home Screen widgets can be read by bystanders, so a parcel shows only its retailer (or the generic
// title of a private order) and status, and an email only its sender and subject. No tracking
// numbers, no email summaries or bodies.
const BASE = "https://misc.mrdrr.uk/widget/api/";
const KEY = "misc-widget-read-token";   // the read token lives in the Keychain, never in this file
const TITLE = "Now";
const HIDE_DELIVERED_AFTER_H = 48;
const CHAR_W = 6.4;         // average width of one character at the row text size, to size the status column
const WHEN_W = 44;          // time column, as wide as the one in the weather and calendar widgets

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

// ---- what to show: one list of everything going on ----
// rank: lower comes first. Urgent emails and problem parcels, then important emails and parcels out for
// delivery (newest first), then the other parcels by how close they are.
const PARCEL_RANK = { out_for_delivery: 1, with_courier: 3, dispatched: 4, ordered: 5, delivered: 7 };
const SHORT = { out_for_delivery: "Today", with_courier: "Courier", dispatched: "Sent", ordered: "Ordered", problem: "Problem", delivered: "Done" };

// eta is a date or a range "YYYY-MM-DD/YYYY-MM-DD"; show the latest day as DD.MM
function etaText(eta) {
  if (!eta) return "";
  const m = String(eta).split("/").pop().match(/^\d{4}-(\d{2})-(\d{2})/);
  return m ? `${m[2]}.${m[1]}` : "";
}
const isDelivered = o => o.delivered || o.status === "delivered";

// "14:02" if it happened today, "Yest" if yesterday, otherwise the date as "06.10"
function whenText(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  if (d.toDateString() === new Date().toDateString()) return S.timeLabel(d);
  if (d.toDateString() === S.dayStart(-1).toDateString()) return "Yest";
  return `${S.p(d.getDate())}.${S.p(d.getMonth() + 1)}`;
}

// parcels and emails as the same kind of item: { star, name, long, short, lock, rank, when }
function items(data) {
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
      rank: o.status === "problem" ? 0 : (PARCEL_RANK[o.status] || 6),
      when: new Date(o.last_event).getTime() || 0,
      done: isDelivered(o),
    });
  }
  for (const i of data.important) {
    out.push({
      star: true, name: i.from || "Email", long: i.subject || "", short: "",
      lock: [i.from, i.subject].filter(Boolean).join(" · "),
      rank: i.urgent ? 0 : 1,
      when: new Date(i.received).getTime() || 0, done: false,
    });
  }
  return out.sort((a, b) => a.rank - b.rank || b.when - a.when);
}

// right-hand header text: nothing, unless the data is old, then the time it was last fetched
function headRight(data) {
  return data.stale && data.fetchedAt ? `stale ${S.timeLabel(new Date(data.fetchedAt))}` : null;
}

// ---- Home Screen widget ----
function buildWidget(data) {
  const w = S.widget();
  const { innerW, availH, small } = S.metrics();

  if (data.error || data.rejected) {
    S.header(w, innerW, TITLE, null);
    S.row(w, innerW, [{ text: data.error || "Token rejected. Run in Scriptable to re-enter" }]);
    return S.finish(w);
  }

  const list = items(data);
  const rows = S.rowsFor(availH, 1);
  const shown = list.slice(0, rows);
  const right = it => (small ? it.short : it.long);
  // the status column is as wide as its longest text; the name gets the rest and shrinks or cuts off
  const rightW = Math.min(Math.floor(innerW * 0.5), Math.ceil(Math.max(0, ...shown.map(it => right(it).length)) * CHAR_W) + 2);

  S.header(w, innerW, TITLE, headRight(data));
  if (!list.length) S.row(w, innerW, [{ text: "Nothing going on" }]);
  // medium and large: time or date, text (starred ones begin with ★), status. small: no time, a short status.
  const lead = small ? 0 : WHEN_W;
  shown.forEach((it, i) => {
    if (i > 0) w.addSpacer(S.ROW_GAP);
    const cells = [];
    if (!small) cells.push({ text: whenText(it.when), w: WHEN_W, mono: true });
    cells.push({ text: (it.star ? "★ " : "") + it.name, w: innerW - lead - rightW }, { text: right(it), w: rightW, right: true });
    S.row(w, innerW, cells);
  });
  return S.finish(w);
}

// ---- Lock Screen ----
function lockLine(it) {
  return `${it.star ? "★ " : ""}${it.lock}`;
}
function lockLines(data, max) {
  if (data.error) return [data.error];
  const lines = items(data).slice(0, max).map(lockLine);
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
