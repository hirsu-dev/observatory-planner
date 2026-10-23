import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Window } from "happy-dom";
import { browserRepository } from "../observatory/web/repository.js";
import {
  horizontal,
  time,
  plan,
  validateTarget,
} from "../observatory/web/sky.js";
const settings = {
  start: "2026-10-23T02:00:00Z",
  latitude: 35,
  longitude: -105,
  hours: 6,
  min_alt: 25,
  dark_only: true,
};
function store() {
  let raw = null;
  return {
    getItem() {
      return raw;
    },
    setItem(k, v) {
      raw = v;
    },
  };
}
test("browser records survive reload; snapshots and log names survive deleting a target", async () => {
  const storage = store(),
    repo = browserRepository(storage),
    target = await repo.addTarget({ name: "North", ra: 2, dec: 62 });
  await repo.saveSession("My plan", settings);
  await repo.addObservation({
    target_id: target.id,
    observed_at: settings.start,
    outcome: "observed",
    notes: "A note",
  });
  await repo.deleteTarget(target.id);
  const reopened = browserRepository(storage);
  assert.equal((await reopened.targets()).length, 0);
  assert.equal((await reopened.observations())[0].target_name, "North");
  assert.equal((await reopened.sessions())[0].plan.targets[0].name, "North");
});
test("blocked storage is explicitly reported but remains usable for the session", async () => {
  const notices = [],
    repo = browserRepository(
      {
        getItem() {
          throw Error();
        },
        setItem() {
          throw Error();
        },
      },
      (t) => notices.push(t),
    );
  await repo.addTarget({ name: "x", ra: 1, dec: 0 });
  assert.equal((await repo.targets()).length, 1);
  assert.ok(notices.length >= 2);
});
test("time, polar geometry, selection and empty-window results are explicit", () => {
  assert.throws(() => time("2026-10-23T01:00"));
  assert.throws(() => validateTarget({ name: "", ra: 24, dec: 100 }));
  assert.ok(
    Math.abs(horizontal(12, 90, 35, 0, settings.start).alt - 35) < 1e-8,
  );
  const rows = [
    { id: "a", name: "A", ra: 0, dec: -90 },
    { id: "b", name: "B", ra: 1, dec: 60 },
  ];
  assert.equal(
    plan(rows, { ...settings, target_ids: ["a"] }).targets.length,
    1,
  );
  assert.equal(
    plan(rows, { ...settings, target_ids: ["a"] }).targets[0].score,
    0,
  );
  assert.throws(() => plan(rows, { ...settings, target_ids: ["missing"] }));
});
test("the real app starts, seeds targets, edits and builds a plan through its DOM events", async () => {
  const window = new Window({ url: "https://demo.example/#targets" });
  window.document.write(
    await readFile(
      new URL("../observatory/web/index.html", import.meta.url),
      "utf8",
    ),
  );
  const globals = {
    document: window.document,
    window,
    location: window.location,
    localStorage: window.localStorage,
    FormData: window.FormData,
  };
  const previous = new Map(
    Object.keys(globals).map((k) => [
      k,
      Object.getOwnPropertyDescriptor(globalThis, k),
    ]),
  );
  for (const [k, v] of Object.entries(globals))
    Object.defineProperty(globalThis, k, {
      value: v,
      configurable: true,
      writable: true,
    });
  try {
    await import("../observatory/web/app.js");
    await new Promise((r) => setTimeout(r, 20));
    const seed = window.document.querySelector('[data-action="seed"]');
    assert.ok(seed);
    seed.click();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(window.document.querySelectorAll(".target-card").length, 3);
    window.document.querySelector("[data-edit]").click();
    await new Promise((r) => setTimeout(r, 20));
    assert.match(
      window.document.querySelector("#target-form").textContent,
      /Save changes/,
    );
    window.location.hash = "planner";
    window.dispatchEvent(new window.Event("hashchange"));
    const form = window.document.querySelector("#planner-form");
    form.elements.start.value = "2026-10-23T02:00";
    form.dispatchEvent(
      new window.Event("submit", { bubbles: true, cancelable: true }),
    );
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(window.document.querySelectorAll(".target-result").length, 3);
    assert.ok(window.document.querySelector("#save-session"));
  } finally {
    for (const [k, d] of previous) {
      if (d) Object.defineProperty(globalThis, k, d);
      else delete globalThis[k];
    }
    await window.happyDOM.abort();
  }
});
