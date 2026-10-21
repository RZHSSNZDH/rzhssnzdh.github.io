/*
 * Worldle game engine.
 * JavaScript port of worldle.py (country guessing, GPL-3.0-or-later).
 *
 * Offline: distances use the haversine formula, directions the initial bearing.
 * A guess that borders the answer reports direction only — same rule as the
 * terminal game.
 */
// @ts-nocheck

export const MAX_ATTEMPTS = 10;
export const EARTH_RADIUS_KM = 6371;

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const COMPASS_WORD = {
  N: "north",
  NE: "northeast",
  E: "east",
  SE: "southeast",
  S: "south",
  SW: "southwest",
  W: "west",
  NW: "northwest",
};

/** Neighbor strings in the dataset that don't match a country key. */
const NEIGHBOR_ALIAS = {
  "Democratic Republic of the Congo": "Congo (Democratic Republic of the)",
  "Republic of the Congo": "Congo (Republic of the)",
  "São Tomé and Príncipe": "Sao Tome and Principe",
  "Cape Verde": "Cabo Verde",
  "East Timor": "Timor-Leste",
  "The Gambia": "Gambia",
  "Federated States of Micronesia": "Micronesia",
};

/** Extra spellings a player might type. Values must be real country names. */
const INPUT_ALIASES = {
  usa: "United States",
  us: "United States",
  "united states of america": "United States",
  uk: "United Kingdom",
  britain: "United Kingdom",
  "great britain": "United Kingdom",
  uae: "United Arab Emirates",
  emirates: "United Arab Emirates",
  czechia: "Czech Republic",
  czech: "Czech Republic",
  "ivory coast": "Côte d'Ivoire",
  "cape verde": "Cabo Verde",
  "east timor": "Timor-Leste",
  burma: "Myanmar",
  swaziland: "Eswatini",
  holland: "Netherlands",
  "the netherlands": "Netherlands",
  vatican: "Vatican City",
  "holy see": "Vatican City",
  drc: "Congo (Democratic Republic of the)",
  "dr congo": "Congo (Democratic Republic of the)",
  "democratic republic of the congo": "Congo (Democratic Republic of the)",
  "congo kinshasa": "Congo (Democratic Republic of the)",
  "republic of the congo": "Congo (Republic of the)",
  "congo brazzaville": "Congo (Republic of the)",
  "republic of korea": "South Korea",
  rok: "South Korea",
  dprk: "North Korea",
  "the gambia": "Gambia",
  "federated states of micronesia": "Micronesia",
  "sao tome": "Sao Tome and Principe",
  "russian federation": "Russia",
  "viet nam": "Vietnam",
  "islamic republic of iran": "Iran",
  "republic of moldova": "Moldova",
  "state of palestine": "Palestine",
  "the bahamas": "Bahamas",
  "united republic of tanzania": "Tanzania",
  "lao peoples democratic republic": "Laos",
  lao: "Laos",
};

export function normalizeCountryName(name) {
  return String(name ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/&/g, " and ")
    .replace(/[.’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function haversine(lat1, lon1, lat2, lon2) {
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const dphi = ((lat2 - lat1) * Math.PI) / 180;
  const dlambda = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dphi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlambda / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function initialBearing(lat1, lon1, lat2, lon2) {
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const dlambda = ((lon2 - lon1) * Math.PI) / 180;
  const x = Math.sin(dlambda) * Math.cos(phi2);
  const y =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dlambda);
  const bearing = (Math.atan2(x, y) * 180) / Math.PI;
  return (bearing + 360) % 360;
}

export function bearingToCompass(bearing) {
  const ix = Math.floor((bearing + 22.5) / 45) % 8;
  return COMPASS[ix];
}

export function compassWord(code) {
  return COMPASS_WORD[code] || code;
}

export function formatKm(km) {
  return `${Math.round(km).toLocaleString("en-US")} km`;
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[b.length];
}

function similarity(a, b) {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (!maxLen) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

export function buildDatabase(data) {
  const countries = {};
  for (const [name, value] of Object.entries(data || {})) {
    const coords = value?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const lat = Number(coords[0]);
    const lon = Number(coords[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const neighbors = (value.neighbors || []).map((n) => NEIGHBOR_ALIAS[n] || n);
    countries[name] = { lat, lon, neighbors };
  }

  const byNorm = new Map();
  const searchKeys = [];
  const pushKey = (norm, display) => {
    if (!norm || byNorm.has(norm)) return;
    byNorm.set(norm, display);
    searchKeys.push({ norm, display });
  };

  for (const name of Object.keys(countries)) pushKey(normalizeCountryName(name), name);
  for (const [alias, display] of Object.entries(INPUT_ALIASES)) {
    if (!countries[display]) continue;
    pushKey(normalizeCountryName(alias), display);
  }

  return { countries, byNorm, searchKeys };
}

let pendingDb;
export function loadDatabase() {
  if (!pendingDb) {
    const url = new URL("../countries.json", import.meta.url);
    pendingDb = fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`Country list HTTP ${res.status}`);
        return res.json();
      })
      .then(buildDatabase);
  }
  return pendingDb;
}

export function chooseTarget(db, rng = Math.random) {
  const names = Object.keys(db.countries);
  return names[Math.floor(rng() * names.length)];
}

export function guidingCountry(db, targetDisplay, rng = Math.random) {
  const target = db.countries[targetDisplay];
  const banned = new Set([targetDisplay, ...target.neighbors]);
  let pool = Object.keys(db.countries).filter((n) => !banned.has(n));
  if (!pool.length) pool = Object.keys(db.countries).filter((n) => n !== targetDisplay);
  const name = pool[Math.floor(rng() * pool.length)];
  const guess = db.countries[name];
  const distance = haversine(guess.lat, guess.lon, target.lat, target.lon);
  const bearing = initialBearing(guess.lat, guess.lon, target.lat, target.lon) % 360;
  const compass = bearingToCompass(bearing);
  return { name, distance, bearing, compass };
}

export function resolveCountry(input, db) {
  const norm = normalizeCountryName(input);
  if (!norm) return null;
  return db.byNorm.get(norm) || null;
}

export function suggestNames(input, db, max = 6) {
  const norm = normalizeCountryName(input);
  if (!norm) return [];
  const seen = new Set();
  const out = [];
  const push = (display) => {
    if (!display || seen.has(display)) return;
    seen.add(display);
    out.push(display);
  };

  const prefix = db.searchKeys.filter((item) => item.norm.startsWith(norm));
  prefix.sort((a, b) => a.display.localeCompare(b.display));
  for (const item of prefix) {
    push(item.display);
    if (out.length >= max) return out;
  }

  const includes = db.searchKeys.filter((item) => item.norm.includes(norm));
  includes.sort((a, b) => a.display.localeCompare(b.display));
  for (const item of includes) {
    push(item.display);
    if (out.length >= max) return out;
  }

  const scored = [];
  for (const item of db.searchKeys) {
    const score = similarity(norm, item.norm);
    if (score >= 0.72) scored.push([score, item.display]);
  }
  scored.sort((a, b) => b[0] - a[0] || a[1].localeCompare(b[1]));
  for (const [, display] of scored) {
    push(display);
    if (out.length >= max) break;
  }
  return out;
}

export function evaluateGuess(db, targetDisplay, guessDisplay) {
  const target = db.countries[targetDisplay];
  const guess = db.countries[guessDisplay];
  const correct = guessDisplay === targetDisplay;
  const isNeighbor = !correct && target.neighbors.includes(guessDisplay);
  const distance = haversine(guess.lat, guess.lon, target.lat, target.lon);
  let bearing = initialBearing(guess.lat, guess.lon, target.lat, target.lon) % 360;
  if (correct) bearing = 0;
  const compass = correct ? "—" : bearingToCompass(bearing);
  return {
    country: guessDisplay,
    distance: correct ? 0 : distance,
    bearing,
    compass,
    isNeighbor,
    correct,
  };
}

/** East/north kilometres of a guess relative to the target (for the end plot). */
export function relativePosition(db, targetDisplay, guessDisplay) {
  const t = db.countries[targetDisplay];
  const g = db.countries[guessDisplay];
  let ns = haversine(t.lat, t.lon, g.lat, t.lon);
  if (g.lat < t.lat) ns = -ns;
  let ew = haversine(t.lat, t.lon, t.lat, g.lon);
  if (g.lon < t.lon) ew = -ew;
  return { ew, ns };
}

export function emptyResults() {
  return { games_played: 0, results: [] };
}

export function addResult(results, attempts, target, success) {
  const list = (results?.results || []).concat([
    {
      attempts,
      target,
      success: !!success,
      max_attempts: MAX_ATTEMPTS,
      when: Date.now(),
    },
  ]);
  return { games_played: (results?.games_played || 0) + 1, results: list };
}

export function summarize(results) {
  const list = results?.results || [];
  const won = list.filter((r) => r.success);
  const avg = won.length ? won.reduce((sum, r) => sum + r.attempts, 0) / won.length : null;
  const best = won.reduce((pick, r) => (!pick || r.attempts < pick.attempts ? r : pick), null);
  const rate = list.length ? (won.length / list.length) * 100 : 0;
  const dist = Array.from({ length: MAX_ATTEMPTS }, (_, i) =>
    won.filter((r) => r.attempts === i + 1).length,
  );
  return {
    played: list.length,
    won: won.length,
    lost: list.length - won.length,
    avg,
    best,
    rate,
    dist,
  };
}

export function summarizeCountry(results, targetName) {
  const list = (results?.results || []).filter((r) => r.target === targetName);
  const won = list.filter((r) => r.success);
  const avg = won.length ? won.reduce((sum, r) => sum + r.attempts, 0) / won.length : null;
  const rate = list.length ? (won.length / list.length) * 100 : 0;
  return {
    target: targetName,
    played: list.length,
    won: won.length,
    lost: list.length - won.length,
    avg,
    rate,
  };
}
