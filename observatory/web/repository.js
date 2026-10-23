import { plan, validateTarget, time } from "./sky.js";
export const demoTargets = () => [
  {
    id: "sample-north",
    name: "Sample northern target",
    ra: 2.4,
    dec: 62,
    notes: "Fictional target for trying the planner.",
  },
  {
    id: "sample-equator",
    name: "Sample equatorial target",
    ra: 5.6,
    dec: -5,
    notes: "Fictional coordinates, not a catalog identification.",
  },
  {
    id: "sample-south",
    name: "Sample southern target",
    ra: 18.2,
    dec: -35,
    notes: "Fictional target. Replace with your own catalog data.",
  },
];
const fresh = () => ({
  schema: 1,
  targets: [],
  sessions: [],
  observations: [],
});
export function browserRepository(storage, notify = () => {}) {
  let data = fresh();
  try {
    const raw = JSON.parse(storage.getItem("observatory-v1"));
    if (
      raw &&
      raw.schema === 1 &&
      ["targets", "sessions", "observations"].every((k) =>
        Array.isArray(raw[k]),
      )
    )
      data = raw;
  } catch {
    notify(
      "Browser storage is unavailable. Changes last for this page session; export a backup before leaving.",
    );
  }
  const save = (next) => {
    try {
      storage.setItem("observatory-v1", JSON.stringify(next));
    } catch {
      notify(
        "Could not save to browser storage. Your changes are in memory; export them before leaving.",
      );
    }
    data = next;
  };
  const id = () => globalThis.crypto.randomUUID();
  return {
    mode: "browser",
    async targets() {
      return structuredClone(data.targets);
    },
    async addTarget(value) {
      if (data.targets.length >= 200)
        throw new Error("The first release supports 200 targets.");
      const t = { id: id(), ...validateTarget(value) };
      save({ ...data, targets: [...data.targets, t] });
      return t;
    },
    async editTarget(key, value) {
      if (!data.targets.some((t) => t.id === key))
        throw new Error("Target not found.");
      const t = { id: key, ...validateTarget(value) };
      save({
        ...data,
        targets: data.targets.map((p) => (p.id === key ? t : p)),
      });
      return t;
    },
    async deleteTarget(key) {
      save({
        ...data,
        targets: data.targets.filter((t) => t.id !== key),
        observations: data.observations.map((o) =>
          o.target_id === key ? { ...o, target_id: null } : o,
        ),
      });
    },
    async makePlan(settings) {
      return plan(data.targets, settings);
    },
    async sessions() {
      return structuredClone(data.sessions.slice().reverse());
    },
    async saveSession(title, settings) {
      if (!title.trim() || title.length > 120)
        throw new Error("Enter a session title under 120 characters.");
      const s = {
        id: id(),
        title: title.trim(),
        plan: plan(data.targets, settings),
      };
      save({ ...data, sessions: [...data.sessions, s] });
      return s;
    },
    async observations() {
      return structuredClone(
        data.observations
          .slice()
          .sort((a, b) => b.observed_at.localeCompare(a.observed_at)),
      );
    },
    async addObservation(value) {
      const t = data.targets.find((t) => t.id === value.target_id);
      if (!t) throw new Error("Choose an existing target.");
      if (
        !["observed", "attempted", "clouded"].includes(value.outcome) ||
        String(value.notes).length > 5000
      )
        throw new Error("Check the outcome and notes.");
      const row = {
        id: id(),
        target_name: t.name,
        ...value,
        observed_at: time(value.observed_at).toISOString(),
      };
      save({ ...data, observations: [...data.observations, row] });
      return row;
    },
    async deleteObservation(key) {
      save({
        ...data,
        observations: data.observations.filter((o) => o.id !== key),
      });
    },
    async export() {
      return structuredClone(data);
    },
    async seed() {
      for (const t of demoTargets()) {
        const { id, ...value } = t;
        await this.addTarget(value);
      }
    },
  };
}
export function apiRepository(fetcher = fetch) {
  const request = async (path, method = "GET", body) => {
    const res = await fetcher(`/api/${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      let msg;
      try {
        const error = await res.json();
        msg =
          typeof error.detail === "string"
            ? error.detail
            : error.detail
                ?.map((e) => `${e.loc.slice(1).join(".")}: ${e.msg}`)
                .join("; ");
      } catch {}
      throw new Error(msg || `Request failed (${res.status}).`);
    }
    return res.status === 204 ? null : res.json();
  };
  return {
    mode: "sqlite",
    targets: () => request("targets"),
    addTarget: (v) => request("targets", "POST", validateTarget(v)),
    editTarget: (id, v) => request(`targets/${id}`, "PUT", validateTarget(v)),
    deleteTarget: (id) => request(`targets/${id}`, "DELETE"),
    makePlan: (s) => request("plan", "POST", s),
    sessions: () => request("sessions"),
    saveSession: (title, settings) =>
      request("sessions", "POST", { title, settings }),
    observations: () => request("observations"),
    addObservation: (v) => request("observations", "POST", v),
    deleteObservation: (id) => request(`observations/${id}`, "DELETE"),
    export: () => request("export"),
    async seed() {
      for (const t of demoTargets()) {
        const { id, ...value } = t;
        await this.addTarget(value);
      }
    },
  };
}
