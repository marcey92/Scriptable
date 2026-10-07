const S = importModule("swiss");
const N = importModule("lib-now");

// "Now": parcels and important emails in one list, newest first. The logic lives in lib-now.js.

// ---- run ----
let data = await N.load(await N.token());
if (data.rejected && !config.runsInWidget) {   // wrong token: let the user fix it now
  const t = await N.askToken("The server rejected the token. Paste the correct read token.");
  if (t) data = await N.load(t);
}

const family = config.widgetFamily;
const widget = family === "accessoryRectangular" ? N.buildLockRect(data)
  : family === "accessoryCircular" ? S.lockCircle(N.activeCount(data))
  : family === "accessoryInline" ? S.lockInline(N.inlineLine(data))
  : N.buildWidget(data);
S.refresh(widget);

if (config.runsInWidget) Script.setWidget(widget);
else await widget.presentMedium();   // preview when run inside the app
Script.complete();
