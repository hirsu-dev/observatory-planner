"""Low precision mean-coordinate planning. See METHODS.md for limits and sources."""

from datetime import datetime, timedelta, timezone
from math import asin, atan2, cos, degrees, radians, sin

def instant(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("Include a timezone offset or Z on the start time.")
    parsed = parsed.astimezone(timezone.utc)
    if not 2020 <= parsed.year <= 2050:
        raise ValueError("Use a date between 2020 and 2050.")
    return parsed

def horizontal(
    ra: float, dec: float, latitude: float, longitude: float, when: datetime
) -> dict:
    days = when.timestamp() / 86400 + 2440587.5 - 2451545.0
    centuries = days / 36525
    gmst = (
        67310.548
        + (3155760000 + 8640184.812866) * centuries
        + 0.093104 * centuries**2
        - 6.2e-6 * centuries**3
    ) / 240
    hour = radians((gmst + longitude - ra * 15) % 360)
    lat, decl = radians(latitude), radians(dec)
    altitude = degrees(
        asin(max(-1, min(1, sin(lat) * sin(decl) + cos(lat) * cos(decl) * cos(hour))))
    )
    east = -cos(decl) * sin(hour)
    north = sin(decl) * cos(lat) - cos(decl) * sin(lat) * cos(hour)
    azimuth = degrees(atan2(east, north)) % 360
    return {"alt": round(altitude, 6), "az": round(azimuth, 6)}

def sun_coordinates(when: datetime) -> tuple[float, float]:
    days = when.timestamp() / 86400 + 2440587.5 - 2451545.0
    mean = radians((280.46 + 0.9856474 * days) % 360)
    anomaly = radians((357.528 + 0.9856003 * days) % 360)
    longitude = mean + radians(1.915) * sin(anomaly) + radians(0.020) * sin(2 * anomaly)
    obliquity = radians(23.439 - 0.0000004 * days)
    return (
        (degrees(atan2(cos(obliquity) * sin(longitude), cos(longitude))) % 360) / 15,
        degrees(asin(sin(obliquity) * sin(longitude))),
    )

def plan(targets: list[dict], settings: dict) -> dict:
    start = instant(settings["start"])
    steps = int(settings["hours"] * 6)
    times = [start + timedelta(minutes=10 * i) for i in range(steps + 1)]
    sun = [
        horizontal(*sun_coordinates(t), settings["latitude"], settings["longitude"], t)[
            "alt"
        ]
        for t in times
    ]
    output = []
    for target in targets:
        samples = []
        for i, when in enumerate(times):
            position = horizontal(
                target["ra"],
                target["dec"],
                settings["latitude"],
                settings["longitude"],
                when,
            )
            samples.append(
                {
                    "time": when.isoformat().replace("+00:00", "Z"),
                    **position,
                    "sun_alt": sun[i],
                    "eligible": position["alt"] >= settings["min_alt"]
                    and (not settings["dark_only"] or sun[i] <= -18),
                }
            )
        eligible = [s for s in samples if s["eligible"]]
        minutes = sum(
            10 for a, b in zip(samples, samples[1:]) if a["eligible"] and b["eligible"]
        )
        best = max(eligible, key=lambda s: s["alt"]) if eligible else None
        score = (
            round(
                (minutes / (settings["hours"] * 60)) * 70 + (best["alt"] / 90) * 30, 1
            )
            if best
            else 0
        )
        output.append(
            {
                "id": target["id"],
                "name": target["name"],
                "ra": target["ra"],
                "dec": target["dec"],
                "samples": samples,
                "minutes": minutes,
                "best": best,
                "score": score,
                "reason": f"{minutes} sampled minutes above {settings['min_alt']} degrees"
                + (
                    " during estimated astronomical darkness."
                    if settings["dark_only"]
                    else "; daylight is allowed in this plan."
                ),
            }
        )
    output.sort(key=lambda t: (-t["score"], t["name"].lower()))
    return {
        "settings": settings,
        "targets": output,
        "method": "Approximate mean coordinates; 10-minute samples. No refraction, precession, weather or Moon model.",
    }
