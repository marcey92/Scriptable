const S = importModule("swiss");

const TITLE = "Weather";
const PLACE = null;         // fixed place, e.g. { name: "London", lat: 51.5072, lon: -0.1276 }; null = where you are
const STEP = 3;             // hours between rows
const UNITS = "celsius";    // or "fahrenheit"
const TEMP_W = 34;
const RAIN_W = 40;
const TAP_URL = "weather://";   // tapping the widget opens Apple's Weather app

// ---- cache: last known place and forecast, so the widget still draws offline ----
const fm = FileManager.local();
const cachePath = fm.joinPath(fm.documentsDirectory(), "swiss-weather.json");
function readCache() {
  try { return fm.fileExists(cachePath) ? JSON.parse(fm.readString(cachePath)) : {}; }
  catch (e) { return {}; }
}
let lastError = "";   // shown in the widget when something fails, to make problems visible
function writeCache(c) { try { fm.writeString(cachePath, JSON.stringify(c)); } catch (e) {} }

// ---- place ----
// give up on a slow answer so the widget never hangs waiting for it
function within(ms, promise) {
  return Promise.race([promise, new Promise((_, no) => Timer.schedule(ms, false, () => no(new Error("timed out"))))]);
}
async function findPlace(cache) {
  if (PLACE) return PLACE;
  try {
    Location.setAccuracyToThreeKilometers();
    const l = await within(config.runsInWidget ? 6000 : 20000, Location.current());
    let name = "";
    try {
      const g = await within(4000, Location.reverseGeocode(l.latitude, l.longitude));
      name = (g && g[0] && (g[0].locality || g[0].administrativeArea)) || "";
    } catch (e) {}
    if (!name && cache.place) name = cache.place.name || "";
    return { name, lat: l.latitude, lon: l.longitude };
  } catch (e) {
    lastError = `Location: ${e.message || e}`;
    return cache.place || null;
  }
}

// ---- forecast from Open-Meteo (free, no account or key) ----
async function fetchHours(place) {
  const url = "https://api.open-meteo.com/v1/forecast"
    + `?latitude=${place.lat}&longitude=${place.lon}`
    + "&hourly=temperature_2m,precipitation_probability,weather_code"
    + `&temperature_unit=${UNITS}&timeformat=unixtime&timezone=auto&forecast_days=3`;
  const json = await new Request(url).loadJSON();
  const h = json.hourly;
  return h.time.map((t, i) => ({
    t: t * 1000,
    temp: h.temperature_2m[i],
    rain: h.precipitation_probability ? h.precipitation_probability[i] : null,
    code: h.weather_code[i],
  }));
}

// returns { place, hours } or { error }
async function loadWeather() {
  const cache = readCache();
  const place = await findPlace(cache);
  if (!place) return { error: "No location yet. Run in Scriptable once", detail: lastError };
  try {
    const hours = await fetchHours(place);
    writeCache({ place, hours });
    return { place, hours };
  } catch (e) {
    if (cache.hours) return { place: cache.place || place, hours: cache.hours };
    return { error: "No forecast available", detail: `Forecast: ${e.message || e}` };
  }
}

// ---- wording ----
function words(code) {
  if (code === 0) return "Clear";
  if (code === 1) return "Mostly clear";
  if (code === 2) return "Partly cloudy";
  if (code === 3) return "Cloudy";
  if (code === 45 || code === 48) return "Fog";
  if (code >= 51 && code <= 57) return "Drizzle";
  if (code >= 61 && code <= 67) return "Rain";
  if (code >= 71 && code <= 77) return "Snow";
  if (code >= 80 && code <= 82) return "Showers";
  if (code === 85 || code === 86) return "Snow showers";
  if (code >= 95) return "Thunder";
  return "";
}
const deg = v => (v === null || v === undefined ? "–" : `${Math.round(v)}°`);
const pct = v => (v === null || v === undefined ? "" : `${Math.round(v)}%`);

// the current hour, then every STEP hours, up to `max` rows
function pick(hours, max) {
  const now = Date.now();
  let start = hours.findIndex(h => h.t + 3600 * 1000 > now);
  if (start === -1) return [];
  const out = [];
  for (let i = start; i < hours.length && out.length < max; i += STEP) {
    out.push({ ...hours[i], label: out.length === 0 ? "Now" : S.timeLabel(new Date(hours[i].t)) });
  }
  return out;
}

// ---- Home Screen widget: a timetable of hours ----
function buildWidget(data) {
  const w = S.widget();
  const { innerW, availH, small } = S.metrics();

  if (data.error) {
    S.header(w, innerW, TITLE, small ? null : S.dateLabel());
    S.note(w, innerW, data.error);
    if (data.detail) { w.addSpacer(S.ROW_GAP); S.note(w, innerW, data.detail); }
    return S.finish(w);
  }

  S.header(w, innerW, TITLE, data.place.name || (small ? null : S.dateLabel()));
  const rows = pick(data.hours, Math.min(S.rowsFor(availH, 1), Math.ceil(24 / STEP)));   // never past 24 hours
  if (!rows.length) S.note(w, innerW, "No forecast available");
  rows.forEach((r, i) => {
    if (i > 0) w.addSpacer(S.ROW_GAP);
    S.row(w, innerW, [
      { text: r.label, w: S.TIME_W, mono: true },
      { text: deg(r.temp), w: TEMP_W, mono: true },
      { text: small ? "" : words(r.code) },
      { text: pct(r.rain), w: RAIN_W, mono: true, right: true },
    ]);
  });
  return S.finish(w);
}

// ---- Lock Screen ----
// rectangular: styled like the habit grid, a small title and rule, then three short lines of natural
// width (no fixed columns: the Lock Screen draws text larger than the Home Screen, so columns overflow)
const LOCK_HOURS = 12;   // lines 2 and 3 look this far ahead
const RAIN_FROM = 30;    // a rain chance from this % up is worth naming
function lockSummary(hours) {
  const now = Date.now();
  const next = hours.filter(h => h.t + 3600 * 1000 > now).slice(0, LOCK_HOURS);
  if (!next.length) return ["No forecast available"];
  const temps = next.map(h => h.temp);
  const wet = next.reduce((best, h) => ((h.rain || 0) > (best.rain || 0) ? h : best), next[0]);
  return [
    [deg(next[0].temp), words(next[0].code)].filter(Boolean).join("  "),
    `Low ${deg(Math.min(...temps))} · High ${deg(Math.max(...temps))}`,
    (wet.rain || 0) >= RAIN_FROM ? `Rain ${pct(wet.rain)} at ${S.timeLabel(new Date(wet.t))}` : `Dry next ${LOCK_HOURS} hours`,
  ];
}
function buildLockRect(data) {
  const w = S.lockWidget();
  S.lockHeader(w, S.LOCK_W, TITLE);
  (data.error ? [data.error] : lockSummary(data.hours)).forEach((text, i) => {
    if (i > 0) w.addSpacer(2);
    S.lockRow(w, S.LOCK_W, [{ text }]);
  });
  w.addSpacer();
  return w;
}
function nowLine(data) {
  if (data.error) return data.error;
  const r = pick(data.hours, 1)[0];
  return r ? [deg(r.temp), words(r.code), pct(r.rain)].filter(Boolean).join(" ") : "No forecast";
}
function nowTemp(data) {
  const r = data.error ? null : pick(data.hours, 1)[0];
  return r ? deg(r.temp) : "–";
}

// ---- run ----
const data = await loadWeather();   // first run in the app triggers the location permission prompt
const family = config.widgetFamily;
const widget = family === "accessoryRectangular" ? buildLockRect(data)
  : family === "accessoryCircular" ? S.lockCircle(nowTemp(data))
  : family === "accessoryInline" ? S.lockInline(nowLine(data))
  : buildWidget(data);
S.refresh(widget);
if (TAP_URL) widget.url = TAP_URL;

if (config.runsInWidget) Script.setWidget(widget);
else await widget.presentMedium();   // preview when run inside the app
Script.complete();
