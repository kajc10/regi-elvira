#!/usr/bin/env node
// Builds the offline autocomplete lists for the search form:
//
//   data/stations-rail.json  railway stations — always loaded
//   data/stations-road.json  coach and bus stops — loaded only when the user
//                            clears "csak vasúti járat"
//
// They are kept apart on purpose. The road list is by far the larger of the two
// and its stops are named "Település, Utca", so folding it into the default
// would bury Szeged-Rókus under three hundred Szeged bus stops. Anyone who wants
// buses says so, and only they pay for the download.
//
// Run manually when the timetable period changes; the output is committed to the
// repo so the page needs no network call while the user is typing.
//
//   node tools/build-stations.mjs
//
// Talks to the upstream OTP directly (no CORS restrictions outside the browser),
// so this does not need the proxy.

import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const UPSTREAM =
  "https://mavplusz.hu/otp2-backend/otp/routers/default/index/graphql";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "data/stations-rail.json");
const OUT_ROAD = resolve(ROOT, "data/stations-road.json");

const QUERY = `{ stops { gtfsId name lat lon vehicleMode } }`;

// MÁV's own GTFS feed. The endpoint also serves BKK, Volán and local operators;
// ELVIRA only ever knew railway stations, so everything else is dropped.
const MAV_FEED = "1:";
const RAIL_MODES = new Set(["RAIL", "SUBURBAN_RAILWAY", "TRAMTRAIN"]);

// Everything that runs on a road: Volán intercity coaches (feed "hkir"), city
// buses (BKK and the local operators) and trolleybuses.
const ROAD_MODES = new Set(["COACH", "BUS", "TROLLEYBUS"]);

console.log("fetching stops from OTP …");
const res = await fetch(UPSTREAM, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ query: QUERY }),
});

if (!res.ok) {
  console.error(`upstream returned HTTP ${res.status}`);
  process.exit(1);
}

const body = await res.json();
if (body.errors) {
  console.error(JSON.stringify(body.errors, null, 2));
  process.exit(1);
}

const stops = body.data.stops;
console.log(`  ${stops.length} stops total`);

const rail = stops.filter(
  (s) => s.gtfsId.startsWith(MAV_FEED) && RAIL_MODES.has(s.vehicleMode),
);
console.log(`  ${rail.length} railway stops in the MÁV feed`);

const road = stops.filter((s) => ROAD_MODES.has(s.vehicleMode));
console.log(`  ${road.length} coach, bus and trolleybus stops`);

// One entry per name. Several platform-level stops share a station name; any of
// their coordinates plans identically, so the first one wins.
function dedupe(rows, skip) {
  const byName = new Map();
  for (const s of rows) {
    if (!s.name || byName.has(s.name) || (skip && skip.has(s.name))) continue;
    byName.set(s.name, {
      n: s.name,
      lat: Math.round(s.lat * 1e5) / 1e5,
      lon: Math.round(s.lon * 1e5) / 1e5,
    });
  }
  return [...byName.values()];
}

// Hungarian stations first, foreign ones after — matches what ELVIRA users expect
// from the autocomplete, without hiding the international stations it also had.
const HU = { latMin: 45.7, latMax: 48.7, lonMin: 16.0, lonMax: 22.95 };
const isHu = (s) =>
  s.lat >= HU.latMin && s.lat <= HU.latMax && s.lon >= HU.lonMin && s.lon <= HU.lonMax;

const byHuThenName = (a, b) => {
  const d = Number(isHu(b)) - Number(isHu(a));
  return d !== 0 ? d : a.n.localeCompare(b.n, "hu");
};

const list = dedupe(rail).sort(byHuThenName);
// A name already on the railway list stays there and keeps its coordinates, so
// clearing the checkbox never changes where a station search plans from.
const roadList = dedupe(road, new Set(list.map((s) => s.n))).sort(byHuThenName);

/* A partial answer from upstream would otherwise quietly replace a good list with
 * a short one and gut the autocomplete — the sort of thing nobody notices until
 * someone cannot find their station. This runs unattended once a month, so it
 * has to refuse rather than trust what it got.
 *
 * Two checks. The absolute floor catches a catastrophically empty answer even on
 * a first run with nothing to compare against. The relative one is the useful
 * one: measured against the list already committed, it catches the realistic
 * failure, where the feed comes back plausible but incomplete. Growth is never
 * blocked — only an unexplained collapse. */
const FLOOR = { rail: 10000, road: 15000 };
const SHRINK_LIMIT = 0.9; // may not drop below 90% of what is already committed

function previousCount(file) {
  if (!existsSync(file)) return 0;
  try {
    return JSON.parse(readFileSync(file, "utf8")).length;
  } catch {
    return 0;
  }
}

const checks = [
  { what: "railway", got: list.length, floor: FLOOR.rail, was: previousCount(OUT) },
  { what: "road", got: roadList.length, floor: FLOOR.road, was: previousCount(OUT_ROAD) },
];

const refusals = checks.flatMap((c) => {
  const out = [];
  if (c.got < c.floor) {
    out.push(`${c.what}: got ${c.got}, expected at least ${c.floor}`);
  }
  const min = Math.floor(c.was * SHRINK_LIMIT);
  if (c.was && c.got < min) {
    out.push(`${c.what}: got ${c.got}, down from ${c.was} already committed (floor ${min})`);
  }
  return out;
});

if (refusals.length) {
  console.error("refusing to write — the upstream answer looks incomplete:");
  refusals.forEach((r) => console.error(`  ${r}`));
  console.error("nothing was changed on disk.");
  process.exit(1);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(list), "utf8");
writeFileSync(OUT_ROAD, JSON.stringify(roadList), "utf8");

const huCount = list.filter(isHu).length;
console.log(
  `wrote ${OUT}\n  ${list.length} stations (${huCount} Hungarian, ${list.length - huCount} foreign)`,
);
console.log(`wrote ${OUT_ROAD}\n  ${roadList.length} road stops`);
