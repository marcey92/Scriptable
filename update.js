// Pulls the latest widget scripts from GitHub into Scriptable. Run it inside the app.

const USER = "marcey92";
const REPO = "Scriptable";
const BRANCH = "main";
const TOKEN = "";   // leave empty for a public repo; a private repo needs a read-only GitHub token here
// Used only if files.json can't be fetched. The real list lives in files.json in the repo, so adding a
// widget never means editing this script. This script does not update itself: overwriting the file
// that is running makes Scriptable create a duplicate. Paste a new copy by hand if this file changes.
const FALLBACK_FILES = ["swiss.js", "lib-calendar.js", "lib-habits.js", "lib-now.js", "habit-grid.js", "calendar-list.js", "battery.js", "weather.js", "orders.js", "overview.js", "hermes.js"];

let fm;
try { fm = FileManager.iCloud(); fm.documentsDirectory(); }
catch (e) { fm = FileManager.local(); }

const report = [];

// Download from the branch's latest commit, not the branch name: GitHub caches files fetched by branch
// name for up to 5 minutes, so an update right after a change could get the old version. A commit's
// files never change, so they are never stale. Falls back to the branch name if GitHub can't be asked.
let ref = BRANCH, sha = "";
try {
  const req = new Request(`https://api.github.com/repos/${USER}/${REPO}/commits/${BRANCH}`);
  req.headers = TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};
  const json = await req.loadJSON();
  if (json && /^[0-9a-f]{40}$/.test(json.sha || "")) { ref = json.sha; sha = json.sha.slice(0, 7); }
} catch (e) {}
const base = `https://raw.githubusercontent.com/${USER}/${REPO}/${ref}/`;

let FILES = FALLBACK_FILES;
try {
  const req = new Request(base + "files.json");
  if (TOKEN) req.headers = { Authorization: `Bearer ${TOKEN}` };
  const json = await req.loadJSON();
  const status = req.response && req.response.statusCode;
  if (status === 200 && Array.isArray(json.files) && json.files.length) FILES = json.files.filter(f => f !== "update.js");
} catch (e) {}

for (const f of FILES) {
  try {
    const req = new Request(base + f);
    if (TOKEN) req.headers = { Authorization: `Bearer ${TOKEN}` };
    const code = await req.loadString();
    const status = req.response && req.response.statusCode;
    if (status !== 200 || !code) { report.push(`Failed  ${f} (${status})`); continue; }

    // keep the icon and colour Scriptable stores in the first lines of an installed script
    const dest = fm.joinPath(fm.documentsDirectory(), f);
    let keep = "";
    if (fm.fileExists(dest)) {
      try { await fm.downloadFileFromiCloud(dest); } catch (e) {}
      const old = fm.readString(dest) || "";
      const m = old.match(/^(\/\/ Variables used by Scriptable\.\n\/\/ These must be.*\n\/\/ icon-color:.*\n)/);
      if (m && !code.startsWith("// Variables used by Scriptable.")) keep = m[1];
    }
    fm.writeString(dest, keep + code);
    report.push(`Updated ${f}`);
  } catch (e) {
    report.push(`Failed  ${f} (${e})`);
  }
}

const a = new Alert();
a.title = sha ? `Swiss widgets · ${sha}` : "Swiss widgets (latest commit unknown)";
a.message = report.join("\n");
a.addAction("OK");
await a.present();
Script.complete();
