# Observatory Planner

Plan a night of observing and keep the notes afterwards. Built by [hirsu](https://hrushikbarani-hub.github.io/) as a practical companion to the Robo Telescope project.

**Browser edition:** [try the planner](https://hrushikbarani-hub.github.io/observatory-planner/). It stores your records in this browser. No account, API key or paid host is needed.

The local Python app uses SQLite instead. Both editions let you:

- Add, edit and remove targets using RA in decimal hours and declination in degrees.
- Plan 1–12 hours from a UTC start time and a manually entered location.
- Compare altitude curves, estimated astronomical darkness and explainable target rankings.
- Save plan snapshots and record observed, attempted or clouded-out outcomes.
- Export a JSON backup or a spreadsheet-safe observation CSV.

The sample targets are fictional coordinates for exploring the app. Add your own catalog data for a real session. Calculations are approximate; read [the methods and limitations](METHODS.md). This app does not control a telescope.

## Run locally

You need Python 3.12 or newer. From the repository folder:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".[dev]"
.\.venv\Scripts\python.exe -m observatory
```

On macOS/Linux, use `.venv/bin/python` in place of `.\.venv\Scripts\python.exe`.

Open [localhost:8140](http://127.0.0.1:8140). The server listens only on loopback. Records are saved in `data/observatory.sqlite`, which is ignored by Git. Change the file with `--database PATH` or `OBSERVATORY_DB`. Export before removing records. Back up the database while the app is stopped if you need a complete restore copy.

There is no account system. Keep the server local; remote use requires a separate access-control design. The app makes no external API calls and does not request location permission. Coordinates you type are sent only to your local Python server. The hosted browser edition keeps them in browser storage. Clearing site data removes browser records, so export a backup.

## Browser-only development

```powershell
python -m http.server 8141 --bind 127.0.0.1 --directory observatory/web
```

Open `http://127.0.0.1:8141/?demo=1`. This explicitly selects browser storage instead of the local API. No Python API is deployed by GitHub Pages. Private browsing, disabled storage or quotas can make records temporary; the app displays a warning and keeps an in-memory session.

## Checks

Node.js 22+ is used for browser-module checks and comparison of Python and JavaScript calculations.

```powershell
npm ci
npm run check
python -m unittest discover -s tests -p "test_*.py" -v
```

The checks exercise API validation, database persistence, preserved snapshots, deleted-target log history, CSV output, timezones, polar geometry, cross-origin rejection, browser storage failure, and the real app's DOM events. Python and JavaScript altitude samples are compared. Visual browser QA was unavailable during this release; review the responsive layout in a browser before relying on its appearance on every device.

## Files and design

- `observatory/astro.py` — approximate sky calculations and scoring
- `observatory/server.py` — validated API, SQLite records and static app
- `observatory/web/sky.js` — equivalent browser calculations
- `observatory/web/repository.js` — browser storage and API adapters
- `observatory/web/app.js` — planning, targets, journal and exports
- `METHODS.md` — coordinate conventions, equations and limits

The database has targets, saved sessions, and observations. Sessions retain target-coordinate snapshots. Deleting a target keeps its historical observation name. The UI shows the latest 200 plans and 500 observations in the local edition; JSON/CSV exports include all stored records.

The GitHub Actions workflow checks the app and deploys the browser edition. It publishes only `observatory/web`, never the database. This release intentionally has no cloud sync, forecast feed, imported star catalog or physical motor connection.

## Next useful work

Add a validated backup importer, a production astronomy library with epoch transformations, horizon masks, and accessibility feedback from actual observers. Keep these changes separate from the first release so the current workflow stays understandable.
