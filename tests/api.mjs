/* End-to-end check of assets/js/api.js against the live upstream — no browser, so no
 * CORS and no proxy needed.
 *
 *   node tests/api.mjs
 *
 * This one does hit the network, and asks MÁV for several full days of results.
 * Run it when the data layer changed, not on every save.
 *
 * If tools/dev-proxy.mjs happens to be listening, the GET path is checked
 * through it as well; otherwise that part is skipped.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("..", import.meta.url)).replace(/\\/g, "/");
const UPSTREAM = "https://mavplusz.hu/otp2-backend/otp/routers/default/index/graphql";
const DEV_PROXY = "http://127.0.0.1:8787";

const ctx = { fetch, Intl, Promise, JSON, Math, Date, Object, Error, console, String, Number };
vm.createContext(ctx);
vm.runInContext(readFileSync(`${ROOT}/assets/js/api.js`, "utf8"), ctx);
const API = ctx.ELVIRA_API;
API.apiUrl = UPSTREAM;
console.log("isConfigured:", API.isConfigured());

const stations = JSON.parse(readFileSync(`${ROOT}/data/stations-rail.json`, "utf8"));
const byName = new Map(stations.map((s) => [s.n, s]));
const pick = (n) => {
  const s = byName.get(n);
  if (!s) throw new Error(`station missing from stations-rail.json: ${n}`);
  return s;
};

function describe(title, rows) {
  console.log(`\n=== ${title} — ${rows.length} results`);
  rows.slice(0, 4).forEach((it) => {
    const t = API.transitLegs(it);
    const a = t[0];
    const b = t[t.length - 1];
    const km = Math.round(t.reduce((x, l) => x + (l.distance || 0), 0) / 1000);
    const delay = t.some((l) => l.realTime && l.departureDelay)
      ? `  KÉSÉS ${t.filter((l) => l.realTime && l.departureDelay).map((l) => API.fmtDelay(l.departureDelay)).join(",")}`
      : t.some((l) => l.realTime) ? "  [realtime, pontos]" : "";
    console.log(
      `${API.fmtClock(a.startTime)} ${a.from.name} → ${API.fmtClock(b.endTime)} ${b.to.name}` +
        ` | chg ${t.length - 1} | ${API.fmtDuration((b.endTime - a.startTime) / 1000)} | ${km} km` +
        ` | ${t.map((l) => (l.trip ? l.trip.tripShortName : l.mode)).join(" + ")}${delay}`,
    );
    const inter = t[0].intermediatePlaces || [];
    if (inter.length) console.log(`    intermediate stops (leg 1): ${inter.length} found, e.g. ${inter.slice(0, 3).map((p) => p.name).join(", ")}`);
  });
}

const now = new Date();
const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Budapest" }).format(now);
const base = {
  from: pick("Budapest-Nyugati"),
  to: pick("Sopron"),
  via: null,
  ymd,
  filters: { noChange: false, noBus: false, railOnly: true },
};

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra && !cond ? "  [" + extra + "]" : ""}`);
  if (!cond) failures++;
};

/* The page asks by GET. OTP itself answers 405 to that, which is exactly the
 * case the fallback in api.js exists for: everything below goes straight to
 * upstream, so if these pass, the fallback works. */
const rawGet = await fetch(`${UPSTREAM}?query=${encodeURIComponent("{feeds{feedId}}")}`);
check("upstream really does refuse GET (so the fallback is being exercised)", rawGet.status === 405, String(rawGet.status));

const plain = await API.search(base);
describe("Budapest-Nyugati → Sopron (rail services only)", plain);
check("has results", plain.length > 0);
check("every leg from the railway feed", plain.every((it) => API.transitLegs(it).every((l) => API.isNationalRail(l))));
check("departures in ascending order", plain.every((it, i, a) => i === 0 || a[i - 1].startTime <= it.startTime));
const firstDep = API.fmtClock(Math.min(...plain.map((it) => API.transitLegs(it)[0].startTime)));
const lastDep = API.fmtClock(Math.max(...plain.map((it) => API.transitLegs(it)[0].startTime)));
console.log(`day coverage: ${firstDep}-${lastDep}`);
check("covers the early morning (first departure before 06:00)", firstDep < "06:00", firstDep);
check("covers the evening (last departure after 18:00)", lastDep > "18:00", lastDep);

const direct = await API.search({ ...base, filters: { ...base.filters, noChange: true } });
describe("same, direct connections only", direct);
check("direct-only filter works", direct.every((it) => API.transitLegs(it).length === 1));

const via = await API.search({ ...base, to: pick("Szombathely"), via: pick("Győr") });
describe("Budapest-Nyugati → Szombathely, via Győr", via);
check("via search returns results", via.length > 0);
check("via station appears on the route", via.every((it) => {
  const names = API.transitLegs(it).flatMap((l) => [l.from.name, l.to.name, ...(l.intermediatePlaces || []).map((p) => p.name)]);
  return names.some((n) => n.startsWith("Győr"));
}));

// A busy suburban line, most likely to carry live delay data right now.
const rt = await API.search({ ...base, from: pick("Budapest-Nyugati"), to: pick("Vác") });
describe("Budapest-Nyugati → Vác (live data probe)", rt);
const rtLegs = rt.flatMap((it) => API.transitLegs(it)).filter((l) => l.realTime);
console.log(`legs with live data: ${rtLegs.length}, of which late: ${rtLegs.filter((l) => l.departureDelay).length}`);

const localToo = await API.search({ ...base, to: pick("Sopron"), filters: { ...base.filters, railOnly: false } });
check("results with railOnly off", localToo.length > 0);

/* International. MÁV's routing graph stops at the border: the timetable knows
 * Wien Hbf and lists its railjets, but plan() cannot attach the coordinate to
 * anything and answers LOCATION_NOT_FOUND. The page must be able to say that
 * rather than showing an empty table. */
const wien = byName.get("Wien Hbf");
check("Wien Hbf is offered by the autocomplete", !!wien);
if (wien) {
  const intl = await API.search({ ...base, to: wien });
  check("an international search returns nothing", intl.length === 0, String(intl.length));
  check("and is reported as unreachable, not as an empty day", API.unreachable().to === true,
    JSON.stringify(API.unreachable()));
  check("the near side of the border still plans", (await API.search({ ...base, to: pick("Hegyeshalom") })).length > 0);
  check("and a normal search leaves the flag clear", API.unreachable().to === false,
    JSON.stringify(API.unreachable()));
}

/* Buses, opt-in behind "csak vasúti járat". A village coach stop is only
 * reachable once COACH is in the mode set — the exact case that used to offer a
 * stop it could not then plan to. */
const road = JSON.parse(readFileSync(`${ROOT}/data/stations-road.json`, "utf8"));
const roadByName = new Map(road.map((s) => [s.n, s]));
const coachStop = roadByName.get("Röszke, Kossuth utca");
check("the road list carries village coach stops", !!coachStop);
if (coachStop) {
  const byBus = await API.search({
    ...base,
    from: coachStop,
    to: pick("Szeged"),
    filters: { noChange: false, noBus: false, railOnly: false },
  });
  describe("Röszke, Kossuth utca → Szeged (railOnly off)", byBus);
  check("a coach stop can be planned from", byBus.length > 0);
  check("and the plan really uses road services",
    byBus.some((it) => API.transitLegs(it).some((l) => ["BUS", "COACH", "TROLLEYBUS"].includes(l.mode))));

  /* With railOnly on it still plans — Röszke has a railway station, so OTP walks
   * to it — but it must never put the passenger on a coach. */
  const railOnlyStill = await API.search({ ...base, from: coachStop, to: pick("Szeged") });
  check("with railOnly on, no coach leg is planned (it walks to the station instead)",
    railOnlyStill.every((it) => API.transitLegs(it).every((l) => l.mode !== "COACH")),
    `${railOnlyStill.length} results`);
}

// ELVIRA's wildcard station: plan from every Budapest terminal at once.
const budapest = { n: "BUDAPEST*", members: API.GROUPS[0].members.map(pick) };
const grp = await API.search({ ...base, from: budapest, to: pick("Sopron") });
describe("BUDAPEST* → Sopron (wildcard station)", grp);
check("BUDAPEST* returns results", grp.length > 0);
const bestGroup = Math.min(...grp.map((it) => it.endTime - API.transitLegs(it)[0].startTime));
const bestPlain = Math.min(...plain.map((it) => it.endTime - API.transitLegs(it)[0].startTime));
console.log(`fastest from BUDAPEST*: ${API.fmtDuration(bestGroup / 1000)} vs from Nyugati: ${API.fmtDuration(bestPlain / 1000)}`);
check("BUDAPEST* at least as good as a single terminal", bestGroup <= bestPlain);
const sig = (it) => API.transitLegs(it).map((l) => l.startTime + ":" + (l.trip?.gtfsId ?? l.mode)).join(",");
check("no duplicate results", new Set(grp.map(sig)).size === grp.length);

/* The proxy is what turns the page's GET into the POST upstream wants, and what
 * makes the answer cacheable. Only checked when the local one is running. */
let devUp = false;
try {
  const probe = await fetch(`${DEV_PROXY}?query=${encodeURIComponent("{feeds{feedId}}")}`);
  devUp = probe.ok;
  const body = await probe.json();
  check("dev proxy answers a GET with data", Array.isArray(body?.data?.feeds));
  // Never cached: a stored answer would be a stale delay.
  check("dev proxy forbids caching", (probe.headers.get("cache-control") ?? "").includes("no-store"),
    probe.headers.get("cache-control"));
  const post = await fetch(DEV_PROXY, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "{feeds{feedId}}" }),
  });
  check("dev proxy still accepts POST", post.ok);
  const bad = await fetch(DEV_PROXY);
  check("dev proxy rejects a GET with no query", bad.status === 400, String(bad.status));
} catch {
  console.log("SKIP — tools/dev-proxy.mjs is not running, GET path through a proxy not checked");
}
if (devUp) console.log("(dev proxy checks ran)");

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECKS FAILED"}`);
process.exit(failures ? 1 : 0);
