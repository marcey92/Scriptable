# Swiss widgets

Scriptable widgets for iOS in one fixed style: a title, a hairline rule, then rows on a shared grid. White on deep navy, square boxes, no colour.

| Script | What it shows | Sizes |
| --- | --- | --- |
| `habit-grid.js` | One row of boxes per habit; tap a row to tick today | Medium, large, Lock Screen |
| `calendar-list.js` | The next days that have events | Small, medium, large, Lock Screen |
| `battery.js` | Charge as a figure and a bar of boxes | Small, medium, Lock Screen |
| `weather.js` | Hours, temperature, conditions, rain chance | Small, medium, large, Lock Screen |
| `swiss.js` | The shared style. Not a widget; the others load it | |
| `update.js` | Pulls the latest scripts from this repo | Run in the app |

## The style lives in one file

Every widget starts with `importModule("swiss")`. Colours, type sizes, margins, the header and the box all come from `swiss.js`, so a change there reaches every widget. A new widget should build itself from `S.widget`, `S.header`, `S.row`, `S.box` and `S.finish` and add no colours or sizes of its own.

## Install

1. Copy all the `.js` files into Scriptable (they live in iCloud Drive → Scriptable).
2. Run each widget once inside the app so iOS can ask for calendar or location access.
3. Add a Scriptable widget to the Home Screen or Lock Screen and pick the script.
4. For `habit-grid.js`, set the widget's "When Interacting" to "Run Script".

After that, run `update.js` to pull changes from GitHub. For a private repo, put a read-only token in `TOKEN` at the top of `update.js` on your phone (never commit it).

## Google Calendar

`calendar-list.js` reads whatever calendars the iPhone's Calendar app has. To show Google events:

1. Settings → Apps → Calendar → Calendar Accounts → Add Account → Google.
2. Add a second `calendar-list.js` widget and set its Parameter to `Google: you@gmail.com` (the word before the colon becomes the header label; after it, the calendar names, comma-separated).

Run the script in the app to see the exact calendar names in the log.

## Check before pushing

`node test/run.js` runs every widget against a stand-in for Scriptable's API and prints what each would draw. It catches crashes and rows that don't fit; it can't show how iOS renders them.
