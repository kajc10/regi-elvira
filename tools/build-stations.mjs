#!/usr/bin/env node
// Builds data/stations.json — the offline autocomplete list for the search form.
//
// Run manually when the timetable period changes; the output is committed to the repo
// so the page needs no network call while the user is typing.
//
//   node tools/build-stations.mjs
//
// Talks to the upstream OTP directly (no CORS restrictions outside the browser),
// so this does not need the Worker proxy.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const UPSTREAM =
  "https://mavplusz.hu/otp2-backend/otp/routers/default/index/graphql";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "data/stations.json");

const QUERY = `{ stops { gtfsId name lat lon vehicleMode } }`;

// MÁV's own GTFS feed. The endpoint also serves BKK, Volán and local operators;
// ELVIRA only ever knew railway stations, so everything else is dropped.
const MAV_FEED = "1:";
const RAIL_MODES = new Set(["RAIL", "SUBURBAN_RAILWAY", "TRAMTRAIN"]);

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

// One entry per name. Several platform-level stops share a station name; any of
// their coordinates plans identically, so the first one wins.
const byName = new Map();
for (const s of rail) {
  if (!s.name || byName.has(s.name)) continue;
  byName.set(s.name, {
    n: s.name,
    lat: Math.round(s.lat * 1e5) / 1e5,
    lon: Math.round(s.lon * 1e5) / 1e5,
  });
}

// Hungarian stations first, foreign ones after — matches what ELVIRA users expect
// from the autocomplete, without hiding the international stations it also had.
const HU = { latMin: 45.7, latMax: 48.7, lonMin: 16.0, lonMax: 22.95 };
const isHu = (s) =>
  s.lat >= HU.latMin && s.lat <= HU.latMax && s.lon >= HU.lonMin && s.lon <= HU.lonMax;

const list = [...byName.values()].sort((a, b) => {
  const d = Number(isHu(b)) - Number(isHu(a));
  return d !== 0 ? d : a.n.localeCompare(b.n, "hu");
});

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(list), "utf8");

const huCount = list.filter(isHu).length;
console.log(
  `wrote ${OUT}\n  ${list.length} stations (${huCount} Hungarian, ${list.length - huCount} foreign)`,
);
