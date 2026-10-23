# Astronomy methods

This is a low-precision planning aid. It ranks approximate sky geometry; it does not promise a visible object or safe motor movement.

## Inputs and conventions

- RA is decimal hours in [0,24); declination is degrees in [-90,90].
- Longitude is east-positive; west longitudes are negative. Latitude is degrees north.
- Dates are explicit UTC or include a timezone offset. The first release accepts 2020–2050.
- Equatorial coordinates are treated as mean coordinates of the observation date. J2000 catalog coordinates are not precessed and therefore introduce additional error.
- UTC approximates UT1/TT for these low-precision calculations. No leap-second or Earth-orientation data is fetched.
- Azimuth is degrees clockwise from north. Azimuth is undefined at the zenith; a computed angle there should not be used as an instruction.

## Calculation

Julian date comes from the UTC Unix timestamp using JD = timestamp / 86400 + 2440587.5. The Greenwich mean sidereal angle uses the polynomial in [JPL Horizons' GMST description](https://ssd.jpl.nasa.gov/horizons/manual.html#greenwich-mean-sidereal-time). The hour angle is GMST + east longitude − 15 × RA. Standard spherical rotation gives altitude and azimuth.

The approximate solar longitude uses the low-precision mean-longitude and mean-anomaly model documented in [NASA's Sun Model, section 2.6.2](https://ntrs.nasa.gov/api/citations/19930010799/downloads/19930010799.pdf). The model derives the Sun's RA and declination and uses the same horizontal rotation. Estimated astronomical darkness means the calculated Sun altitude is at or below −18 degrees.

These are independently implemented mathematical equations, not copied ephemeris or catalog data. For rigorous coordinate transformations, consult [Astropy's coordinate documentation](https://docs.astropy.org/en/stable/coordinates/index.html). The planner does not claim Astropy-level precision.

## Sampling and ranking

The window is sampled every ten minutes, including its end. An interval counts as usable only when both endpoint samples meet the altitude floor and, optionally, the darkness condition. The interval count is multiplied by ten minutes. A narrow crossing can be missed; crossing times are not interpolated.

Score = 70 × usable-duration fraction + 30 × best eligible altitude / 90. If there are no eligible samples, the score is zero and no eligible peak is shown. Scores are convenience rankings, not probability, image quality or target brightness. Name sorting provides a manual alternative.

## Deliberate limits

No refraction, parallax, precession, nutation, proper motion, terrain, light pollution, clouds, Moon, equipment limits or moving-body ephemerides are modeled. Fixed coordinates for the Sun, Moon, planets, satellites or comets are inappropriate. This app must not be connected to real motors without an independent hardware-control design and validation.

Tests check the analytic north/south pole relation, equivalent time offsets, absent windows and Python/JavaScript agreement. Agreement between ports alone does not establish astronomical accuracy. Actual catalog observations and rigorous reference comparisons remain future validation work.
