const rad = (n) => (n * Math.PI) / 180;
const deg = (n) => (n * 180) / Math.PI;
const wrap = (n) => ((n % 360) + 360) % 360;
export function time(value) {
  if (!/(Z|[+-]\d\d:\d\d)$/.test(value))
    throw new Error("Include a timezone offset or Z.");
  const result = new Date(value);
  if (
    !Number.isFinite(+result) ||
    result.getUTCFullYear() < 2020 ||
    result.getUTCFullYear() > 2050
  )
    throw new Error("Choose a valid date between 2020 and 2050.");
  return result;
}
export function horizontal(ra, dec, latitude, longitude, when) {
  const d = +new Date(when) / 86400000 + 2440587.5 - 2451545,
    t = d / 36525;
  const gmst =
    (67310.548 +
      (3155760000 + 8640184.812866) * t +
      0.093104 * t ** 2 -
      6.2e-6 * t ** 3) /
    240;
  const h = rad(wrap(gmst + longitude - ra * 15)),
    lat = rad(latitude),
    decl = rad(dec);
  return {
    alt: deg(
      Math.asin(
        Math.max(
          -1,
          Math.min(
            1,
            Math.sin(lat) * Math.sin(decl) +
              Math.cos(lat) * Math.cos(decl) * Math.cos(h),
          ),
        ),
      ),
    ),
    az: wrap(
      deg(
        Math.atan2(
          -Math.cos(decl) * Math.sin(h),
          Math.sin(decl) * Math.cos(lat) -
            Math.cos(decl) * Math.sin(lat) * Math.cos(h),
        ),
      ),
    ),
  };
}
export function sunCoordinates(when) {
  const d = +new Date(when) / 86400000 + 2440587.5 - 2451545;
  const mean = rad(wrap(280.46 + 0.9856474 * d)),
    anomaly = rad(wrap(357.528 + 0.9856003 * d));
  const lng =
      mean + rad(1.915) * Math.sin(anomaly) + rad(0.02) * Math.sin(2 * anomaly),
    obl = rad(23.439 - 0.0000004 * d);
  return [
    wrap(deg(Math.atan2(Math.cos(obl) * Math.sin(lng), Math.cos(lng)))) / 15,
    deg(Math.asin(Math.sin(obl) * Math.sin(lng))),
  ];
}
export function validateTarget(input) {
  const p = {
    name: String(input.name || "").trim(),
    ra: Number(input.ra),
    dec: Number(input.dec),
    notes: String(input.notes || ""),
  };
  if (
    !p.name ||
    p.name.length > 100 ||
    !Number.isFinite(p.ra) ||
    p.ra < 0 ||
    p.ra >= 24 ||
    !Number.isFinite(p.dec) ||
    Math.abs(p.dec) > 90 ||
    p.notes.length > 3000
  )
    throw new Error(
      "Enter a name, RA from 0 to under 24 hours, and declination from −90 to 90 degrees.",
    );
  return p;
}
export function validateSettings(input) {
  const s = {
    ...input,
    start: time(input.start).toISOString(),
    latitude: Number(input.latitude),
    longitude: Number(input.longitude),
    hours: Number(input.hours),
    min_alt: Number(input.min_alt),
    dark_only: Boolean(input.dark_only),
  };
  if (
    !Number.isFinite(s.latitude) ||
    Math.abs(s.latitude) > 90 ||
    !Number.isFinite(s.longitude) ||
    Math.abs(s.longitude) > 180 ||
    !Number.isInteger(s.hours) ||
    s.hours < 1 ||
    s.hours > 12 ||
    !Number.isInteger(s.min_alt) ||
    s.min_alt < 0 ||
    s.min_alt > 85
  )
    throw new Error(
      "Check location, duration (1–12 hours) and altitude floor (0–85°).",
    );
  return s;
}
export function plan(targets, input) {
  const s = validateSettings(input),
    start = +new Date(s.start),
    steps = s.hours * 6;
  if (s.target_ids?.length) {
    if (s.target_ids.some((id) => !targets.some((t) => t.id === id)))
      throw new Error(
        "A selected target no longer exists. Refresh the target list.",
      );
    targets = targets.filter((t) => s.target_ids.includes(t.id));
  }
  const times = Array.from(
    { length: steps + 1 },
    (_, i) => new Date(start + i * 600000),
  );
  const solar = times.map(
    (t) => horizontal(...sunCoordinates(t), s.latitude, s.longitude, t).alt,
  );
  const rows = targets
    .map((target) => {
      const samples = times.map((t, i) => {
        const p = horizontal(target.ra, target.dec, s.latitude, s.longitude, t);
        return {
          time: t.toISOString(),
          ...p,
          sun_alt: solar[i],
          eligible: p.alt >= s.min_alt && (!s.dark_only || solar[i] <= -18),
        };
      });
      const eligible = samples.filter((p) => p.eligible),
        best = eligible.reduce((a, b) => (!a || b.alt > a.alt ? b : a), null);
      const minutes = samples
        .slice(1)
        .reduce(
          (n, p, i) => n + (p.eligible && samples[i].eligible ? 10 : 0),
          0,
        );
      return {
        ...target,
        samples,
        minutes,
        best,
        score: best
          ? Math.round(
              ((minutes / (s.hours * 60)) * 70 + (best.alt / 90) * 30) * 10,
            ) / 10
          : 0,
        reason: `${minutes} sampled minutes above ${s.min_alt} degrees${s.dark_only ? " during estimated astronomical darkness." : "; daylight is allowed in this plan."}`,
      };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
    );
  return {
    settings: s,
    targets: rows,
    method:
      "Approximate mean coordinates; 10-minute samples. No refraction, precession, weather or Moon model.",
  };
}
