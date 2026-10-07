// Pulls the latest widget scripts from GitHub into Scriptable. Run it inside the app.

const USER = "marcey92";
const REPO = "Scriptable";
const BRANCH = "main";
const TOKEN = "";   // leave empty for a public repo; a private repo needs a read-only GitHub token here
const FILES = ["swiss.js", "habit-grid.js", "calendar-list.js", "battery.js", "weather.js"];

let fm;
try { fm = FileManager.iCloud(); fm.documentsDirectory(); }
catch (e) { fm = FileManager.local(); }

const base = `https://raw.githubusercontent.com/${USER}/${REPO}/${BRANCH}/`;
const report = [];

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
a.title = "Swiss widgets";
a.message = report.join("\n");
a.addAction("OK");
await a.present();
Script.complete();
