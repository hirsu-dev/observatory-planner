import { browserRepository, apiRepository } from "./repository.js";
import { validateSettings } from "./sky.js";
const $ = (s) => document.querySelector(s);
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const utc = (v) =>
  new Date(v).toISOString().slice(0, 16).replace("T", " ") + " UTC";
const hour = (v) => new Date(v).toISOString().slice(11, 16);
const defaults = () => ({
  start: new Date().toISOString().slice(0, 13) + ":00Z",
  latitude: 35,
  longitude: -105,
  hours: 6,
  min_alt: 25,
  dark_only: true,
});
let repo,
  targets = [],
  sessions = [],
  observations = [],
  settings = defaults(),
  currentPlan = null,
  editing = null,
  renderId = 0;
function message(text, error = false) {
  $("#message").textContent = text;
  $("#message").classList.toggle("error", error);
}
function warning(text) {
  $("#storage-warning").hidden = false;
  $("#storage-warning").textContent = text;
}
const values = (form) => Object.fromEntries(new FormData(form));
async function action(fn, button) {
  if (button) button.disabled = true;
  try {
    await fn();
  } catch (e) {
    message(e.message || "Something went wrong. Try again.", true);
  } finally {
    if (button?.isConnected) button.disabled = false;
  }
}
async function refresh() {
  [targets, sessions, observations] = await Promise.all([
    repo.targets(),
    repo.sessions(),
    repo.observations(),
  ]);
}
const method = () =>
  `<details class="method panel"><summary>How are the targets ranked?</summary><p>The score combines sampled usable time (70%) and the best eligible altitude (30%). A ten-minute interval counts only when both ends are above the altitude floor and, if enabled, the Sun is below −18°. Narrow windows can be missed. This is a planning aid, not a visibility guarantee.</p><p>Inputs are mean equatorial coordinates of date: RA in decimal hours, declination in degrees, east-positive longitude and UTC time. No epoch conversion, refraction, terrain, Moon, weather or brightness model is included. Catalog J2000 coordinates are treated as approximate. Never use this tool to point at the Sun or control hardware.</p><p>Methods are documented with <a href="https://ssd.jpl.nasa.gov/horizons/manual.html#greenwich-mean-sidereal-time">JPL's sidereal-time model</a> and a low-precision solar model. See the repository's METHODS.md for assumptions and reference checks.</p></details>`;
function chart(t) {
  const n = t.samples.length - 1,
    point = (s, i) =>
      `${40 + (i / n) * 510},${118 - ((s.alt + 90) / 180) * 100}`;
  const floor = 118 - ((currentPlan.settings.min_alt + 90) / 180) * 100;
  return `<svg class="chart" viewBox="0 0 580 140" role="img" aria-label="Approximate altitude curve for ${esc(t.name)}. Best eligible altitude ${t.best ? t.best.alt.toFixed(1) + " degrees" : "not found"}. ${t.minutes} sampled usable minutes."><line x1="40" y1="68" x2="550" y2="68"/><line class="floor" x1="40" y1="${floor}" x2="550" y2="${floor}"/><text x="3" y="23">90°</text><text x="8" y="71">0°</text><text x="2" y="121">−90°</text><polyline points="${t.samples.map(point).join(" ")}"/><polyline class="sun" points="${t.samples.map((s, i) => point({ alt: s.sun_alt }, i)).join(" ")}"/><text x="40" y="136">${hour(t.samples[0].time)} UTC</text><text x="485" y="136">${hour(t.samples.at(-1).time)} UTC</text></svg>`;
}
function resultContent() {
  if (!targets.length)
    return `<div class="empty"><h3>Your sky starts with a target.</h3><p>Add coordinates from a catalog or try three clearly fictional sample targets.</p><a href="#targets">Add a target →</a><div class="actions"><button data-action="seed">Try sample targets</button></div></div>`;
  if (!currentPlan)
    return `<div class="empty"><h3>Make room for a night outside.</h3><p>Set a start time and location, then build a plan.</p></div>`;
  return `<div class="results-head"><div><p class="eyebrow">YOUR NIGHT / ${currentPlan.targets.length} TARGETS</p><h2>A window worth looking for.</h2><p>${utc(currentPlan.settings.start)} · ${currentPlan.settings.hours} hours<br/>Cyan: target altitude / amber: Sun / dashed: your floor</p></div><button data-action="sort">${settings.manual_sort ? "Use ranking" : "Sort by name"}</button></div><div id="target-results">${(settings.manual_sort ? [...currentPlan.targets].sort((a, b) => a.name.localeCompare(b.name)) : currentPlan.targets).map((t) => `<article class="target-result"><div class="result-title"><h3>${esc(t.name)}</h3><span class="score">${t.score}<small> / 100</small></span></div><p>${esc(t.reason)}</p>${chart(t)}<div class="metric-line"><span>BEST ELIGIBLE <b>${t.best ? t.best.alt.toFixed(1) + "° at " + hour(t.best.time) + " UTC" : "No matching sample"}</b></span><span>RA <b>${t.ra} h</b> / DEC <b>${t.dec}°</b></span></div></article>`).join("") || `<div class="empty">No targets in this plan. Add targets and build a new plan.</div>`}</div><form id="save-session"><label>Session title<input name="title" required maxlength="120" placeholder="A clear night, a small plan" /></label><button class="primary" type="submit">Save this plan ↓</button></form>`;
}
function plannerView() {
  return `<div class="grid"><section class="panel"><h2>Plan a night</h2><form id="planner-form"><label>Start in UTC<input name="start" type="datetime-local" required min="2020-01-01T00:00" max="2050-12-31T23:59" value="${settings.start.slice(0, 16)}"/></label><div class="pair"><label>Latitude (°)<input name="latitude" type="number" min="-90" max="90" step="any" required value="${settings.latitude}" /></label><label>Longitude (° east)<input name="longitude" type="number" min="-180" max="180" step="any" required value="${settings.longitude}" /></label></div><p class="help">Example site: 35° N, 105° W. Enter longitude as −105. No location permission is requested.</p><div class="pair"><label>Duration (hours)<input name="hours" type="number" min="1" max="12" step="1" required value="${settings.hours}" /></label><label>Altitude floor (°)<input name="min_alt" type="number" min="0" max="85" step="1" required value="${settings.min_alt}" /></label></div><label><input name="dark_only" type="checkbox" ${settings.dark_only ? "checked" : ""} />Require estimated astronomical darkness</label><details><summary>Choose targets (default: all)</summary>${targets.map((t) => `<label><input type="checkbox" name="target_ids" value="${esc(t.id)}" ${settings.target_ids?.includes(t.id) ? "checked" : ""}/>${esc(t.name)}</label>`).join("")}</details><button class="primary" type="submit" ${targets.length ? "" : "disabled"}>Build my plan ↗</button></form><p class="help">Times are UTC, including when your device uses another timezone. A plan estimates sky geometry; weather and the Moon can still change your night.</p></section><section class="panel" id="results" aria-label="Planning results">${resultContent()}</section></div>${method()}`;
}
function targetView() {
  const t = targets.find((t) => t.id === editing);
  return `<div class="grid"><section class="panel"><h2>${t ? "Edit target" : "Add a target"}</h2><form id="target-form"><label>Name<input name="name" required maxlength="100" value="${esc(t?.name)}" /></label><div class="pair"><label>RA (decimal hours)<input name="ra" type="number" min="0" max="23.999999" step="any" required value="${esc(t?.ra)}" /></label><label>Declination (°)<input name="dec" type="number" min="-90" max="90" step="any" required value="${esc(t?.dec)}" /></label></div><label>Notes<textarea name="notes" maxlength="3000" rows="4">${esc(t?.notes)}</textarea></label><button class="primary" type="submit">${t ? "Save changes" : "Add target"}</button>${t ? `<button type="button" data-action="cancel-edit">Cancel edit</button>` : ""}</form><p class="help">Use fixed sky coordinates from a trusted catalog. Solar-system targets move, so this release does not predict their positions.</p></section><section class="panel"><div class="results-head"><h2>Your targets / ${targets.length}</h2>${!targets.length ? `<button data-action="seed">Try samples</button>` : ""}</div><div class="target-list">${targets.map((t) => `<article class="target-card"><h3>${esc(t.name)}</h3><small>RA ${t.ra} h / DEC ${t.dec}°</small><p>${esc(t.notes) || "No notes yet."}</p><div class="actions"><button data-edit="${esc(t.id)}">Edit</button><button data-delete-target="${esc(t.id)}">Remove</button></div></article>`).join("") || `<div class="empty"><h3>A blank field book.</h3><p>Add your first target, or use fictional samples to explore the interface.</p></div>`}</div></section></div>`;
}
function journalView() {
  return `<div class="grid"><section class="panel"><h2>Record an observation</h2><form id="observation-form"><label>Target<select name="target_id" required><option value="">Choose a target</option>${targets.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join("")}</select></label><label>Observed at (UTC)<input type="datetime-local" name="observed_at" required min="2020-01-01T00:00" max="2050-12-31T23:59" value="${new Date().toISOString().slice(0, 16)}" /></label><label>Outcome<select name="outcome"><option value="observed">Observed</option><option value="attempted">Attempted</option><option value="clouded">Clouded out</option></select></label><label>Field notes<textarea name="notes" rows="5" maxlength="5000" placeholder="What did you notice? What would you try next?"></textarea></label><button class="primary" type="submit" ${targets.length ? "" : "disabled"}>Add to field journal</button></form></section><section class="panel"><h2>Saved nights / ${sessions.length}</h2>${sessions.map((s) => `<article class="saved-session"><div><h3>${esc(s.title)}</h3><p>${utc(s.plan.settings.start)} · ${s.plan.targets.length} target snapshots</p></div><button data-load="${esc(s.id)}">Open plan</button></article>`).join("") || `<p>Build and save a plan to keep its coordinates and results as a snapshot.</p>`}</section><section class="panel wide"><h2>Field journal / ${observations.length}</h2>${observations.length ? `<div class="table-wrap"><table><caption class="help">Recorded outcomes, newest first. All times UTC.</caption><thead><tr><th>Target</th><th>Date</th><th>Outcome</th><th>Notes</th><th>Actions</th></tr></thead><tbody>${observations.map((o) => `<tr><td>${esc(o.target_name)}</td><td>${utc(o.observed_at)}</td><td class="outcome">${esc(o.outcome)}</td><td><p>${esc(o.notes) || "—"}</p></td><td><button data-delete-observation="${esc(o.id)}" aria-label="Remove observation of ${esc(o.target_name)}">Remove</button></td></tr>`).join("")}</tbody></table></div>` : `<div class="empty"><h3>Every attempt teaches you something.</h3><p>Record a sighting, a cloudy night, or a target you want to try again.</p></div>`}</section></div>`;
}
function render() {
  const route = ["planner", "targets", "journal"].includes(
    location.hash.slice(1),
  )
    ? location.hash.slice(1)
    : "planner";
  document.querySelectorAll("nav a").forEach((a) => {
    if (a.hash === `#${route}`) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  $("#view").innerHTML =
    route === "planner"
      ? plannerView()
      : route === "targets"
        ? targetView()
        : journalView();
  document.title = `${route === "planner" ? "Plan a night" : route === "targets" ? "Your targets" : "Field journal"} / Observatory Planner`;
}
async function removeRecord(fn) {
  const dialog = $("#confirm-delete");
  dialog.returnValue = "cancel";
  dialog.showModal();
  const ok = await new Promise((resolve) =>
    dialog.addEventListener(
      "close",
      () => resolve(dialog.returnValue === "delete"),
      { once: true },
    ),
  );
  if (!ok) return;
  await fn();
  await refresh();
  currentPlan = null;
  render();
  message(
    "Record removed. Existing plan snapshots and journal names are preserved.",
  );
}
$("#view").addEventListener("submit", (e) => {
  e.preventDefault();
  action(async () => {
    const v = values(e.target);
    if (e.target.id === "target-form") {
      if (editing) await repo.editTarget(editing, v);
      else await repo.addTarget(v);
      editing = null;
      currentPlan = null;
      await refresh();
      render();
      message("Target saved.");
    } else if (e.target.id === "planner-form") {
      settings = validateSettings({
        ...v,
        start: v.start + "Z",
        dark_only: e.target.elements.dark_only.checked,
        target_ids: new FormData(e.target).getAll("target_ids"),
      });
      const { manual_sort, ...request } = settings;
      currentPlan = await repo.makePlan(request);
      $("#results").innerHTML = resultContent();
      message(`Plan ready. ${currentPlan.targets.length} target estimates.`);
    } else if (e.target.id === "save-session") {
      const { manual_sort, ...request } = settings;
      await repo.saveSession(v.title, request);
      await refresh();
      message("Plan saved as a coordinate and result snapshot.");
    } else if (e.target.id === "observation-form") {
      await repo.addObservation({ ...v, observed_at: v.observed_at + "Z" });
      await refresh();
      render();
      message("Observation added.");
    }
  }, e.submitter);
});
$("#view").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b || (b.type === "submit" && b.form)) return;
  action(async () => {
    if (b.dataset.edit) {
      editing = b.dataset.edit;
      render();
      $("#target-form input").focus();
    } else if (b.dataset.deleteTarget)
      await removeRecord(() => repo.deleteTarget(b.dataset.deleteTarget));
    else if (b.dataset.deleteObservation)
      await removeRecord(() =>
        repo.deleteObservation(b.dataset.deleteObservation),
      );
    else if (b.dataset.load) {
      const s = sessions.find((s) => s.id === b.dataset.load);
      currentPlan = s.plan;
      settings = {
        ...s.plan.settings,
        target_ids: s.plan.targets.map((t) => t.id),
      };
      location.hash = "planner";
      render();
      message(
        "Loaded the saved snapshot. Build a new plan to recalculate with current targets.",
      );
    } else if (b.dataset.action === "seed") {
      await repo.seed();
      currentPlan = null;
      await refresh();
      render();
      message(
        "Fictional sample targets added. Replace them with your own catalog data.",
      );
    } else if (b.dataset.action === "cancel-edit") {
      editing = null;
      render();
    } else if (b.dataset.action === "sort") {
      settings.manual_sort = !settings.manual_sort;
      $("#results").innerHTML = resultContent();
    }
  }, b);
});
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("#export-all").addEventListener("click", () =>
  action(async () =>
    download(
      "observatory-backup.json",
      JSON.stringify(await repo.export(), null, 2),
      "application/json",
    ),
  ),
);
$("#export-csv").addEventListener("click", () =>
  action(async () => {
    const data = await repo.export();
    const cell = (v) =>
      '"' +
      ((/^[=+\-@\t\r]/.test(String(v)) ? "'" : "") + String(v ?? "")).replace(
        /"/g,
        '""',
      ) +
      '"';
    download(
      "observations.csv",
      [
        ["Target", "UTC time", "Outcome", "Notes"],
        ...data.observations.map((o) => [
          o.target_name,
          o.observed_at,
          o.outcome,
          o.notes,
        ]),
      ]
        .map((row) => row.map(cell).join(","))
        .join("\r\n"),
      "text/csv",
    );
  }),
);
window.addEventListener("hashchange", () => {
  editing = null;
  render();
});
async function init() {
  const token = ++renderId;
  const browserMode =
    new URLSearchParams(location.search).get("demo") === "1" ||
    !["localhost", "127.0.0.1"].includes(location.hostname);
  if (browserMode) {
    let storage;
    try {
      storage = localStorage;
    } catch {
      storage = {
        getItem() {
          throw new Error();
        },
        setItem() {
          throw new Error();
        },
      };
    }
    repo = browserRepository(storage, warning);
  } else {
    const config = await fetch("/api/config");
    if (!config.ok)
      throw new Error(
        "The local API is unavailable. Run python -m observatory, or add ?demo=1 for browser storage mode.",
      );
    repo = apiRepository();
  }
  await refresh();
  if (token !== renderId) return;
  $("#mode").textContent =
    repo.mode === "sqlite"
      ? "LOCAL APP / records saved in your SQLite database / no external API calls"
      : "BROWSER EDITION / records stay in this browser / fictional samples are optional / export a backup to keep them";
  render();
}
init().catch((e) => {
  message(e.message, true);
  $("#mode").textContent =
    "Could not connect to storage. Reload after starting the local server, or use ?demo=1.";
});
