const S = importModule("swiss");
const N = importModule("lib-now");
const C = importModule("lib-calendar");

// "Hermes": what Hermes did on its own, one line each, newest first (it pushes activity.json).
// The header shows when Hermes last ran, or "Stale since ..." when that was over 90 minutes ago.
// If adding Hermes's calendar events failed on this phone, that shows as a starred line at the top.
const TITLE = "Hermes";

// ---- the activity feed, cached like the Inbox so it still draws offline ----
const fm = FileManager.local();
const cachePath = fm.joinPath(fm.documentsDirectory(), "swiss-activity.json");
function readCache() {
  try { return fm.fileExists(cachePath) ? JSON.parse(fm.readString(cachePath)) : null; } catch (e) { return null; }
}
async function load(token) {
  const cache = readCache();
  const fallback = cache ? { items: cache.items || [], updated: cache.updated || null } : { items: [], updated: null, noData: true };
  if (!token) return { ...fallback, error: "Run the Inbox widget in Scriptable once to set the token" };
  try {
    const json = await N.fetchFeed("activity", token);
    const t = Date.parse(json.updated || "");
    const data = { items: Array.isArray(json.items) ? json.items : [], updated: isNaN(t) ? null : t };
    try { fm.writeString(cachePath, JSON.stringify(data)); } catch (e) {}
    return data;
  } catch (e) {
    return fallback;   // offline, or nothing pushed yet
  }
}

// a failed calendar sync on this phone, as a line in the same shape as Hermes's own
function withFailure(data) {
  const fail = C.lastSyncFailure();
  if (!fail) return data;
  const line = { when: new Date(fail.at).toISOString(), star: true, title: "Calendar", detail: fail.message };
  return { ...data, items: [line, ...data.items], noData: false };
}

// header: when Hermes last ran, or the stale marker
function headRight(data) {
  if (N.isStale(data)) return N.headRight(data);
  return data.updated ? N.whenText(data.updated) : null;
}

function buildWidget(data) {
  const w = S.widget();
  const { innerW, availH, small } = S.metrics();
  S.header(w, innerW, TITLE, headRight(data));
  N.drawRows(w, innerW, S.rowsFor(availH, 1), data, small, "Nothing yet");
  return S.finish(w);
}

// ---- run ----
const data = withFailure(await load(await N.token()));
const family = config.widgetFamily;
const widget = family && family.startsWith("accessory")
  ? S.lockInline(data.updated ? `${TITLE} ${N.whenText(data.updated)}` : TITLE)
  : buildWidget(data);
S.refresh(widget);
if (config.runsInWidget) Script.setWidget(widget);
else await widget.presentMedium();   // preview when run inside the app
Script.complete();
