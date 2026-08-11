/* Renders index.html in jsdom with a canned OTP response and checks the page.
 *
 *   node tests/dom.mjs
 *
 * No network: the station list is read from disk and the timetable request is
 * answered with the fixture below, so this is safe to run before every push.
 * Needs jsdom — if it is not next to the repo, set JSDOM_FROM to a directory
 * whose node_modules has it.
 */
import { readFileSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = fileURLToPath(new URL("..", import.meta.url)).replace(/\\/g, "/");

function loadJsdom() {
  const roots = [import.meta.url, process.env.JSDOM_FROM, "C:/Users/Kajc/"].filter(Boolean);
  for (const r of roots) {
    try {
      return createRequire(r)("jsdom");
    } catch {
      /* try the next one */
    }
  }
  throw new Error("jsdom not found — npm i jsdom, or set JSDOM_FROM");
}
const { JSDOM, VirtualConsole } = loadJsdom();

const stations = JSON.parse(readFileSync(`${ROOT}/data/stations-rail.json`, "utf8"));
const roadStations = JSON.parse(readFileSync(`${ROOT}/data/stations-road.json`, "utf8"));

const at = (h, m) => Date.UTC(2026, 7, 8, h - 2, m); // Budapest time -> epoch ms

/* Leg 1 leaves three minutes late and loses more on the way, arriving nine down —
 * the shape of a real train (2548 out of Nyugati), and the case that catches a
 * band summarising the leg by its departure. Leg 2 is on schedule. */
const PLAN = {
  data: {
    plan: {
      itineraries: [
        {
          startTime: at(9, 18),
          endTime: at(12, 40),
          duration: 12120,
          walkDistance: 0,
          legs: [
            {
              mode: "RAIL", realTime: true, distance: 120000,
              startTime: at(9, 18), endTime: at(10, 40),
              departureDelay: 180, arrivalDelay: 540,
              from: { name: "Budapest-Keleti", departureTime: at(9, 18) },
              to: { name: "Győr", arrivalTime: at(10, 40) },
              trip: { gtfsId: "1:111", tripShortName: "992 SCARBANTIA InterCity InterCity", tripHeadsign: "Sopron" },
              route: { shortName: '<span class="MNR2007">&#474;</span>', longName: "IC SCARBANTIA", mode: "RAIL" },
              agency: { name: "MÁV Személyszállítási Zrt." },
              /* Tatabánya is running three minutes late, Komárom has made the
               * time up — a train's delay is not constant along its run. */
              intermediatePlaces: [
                {
                  name: "Tatabánya", arrivalTime: at(9, 59), departureTime: at(10, 0),
                  arrival: { estimated: { delay: "PT3M" } },
                  departure: { estimated: { delay: "PT3M" } },
                },
                {
                  name: "Komárom", arrivalTime: at(10, 18), departureTime: at(10, 19),
                  arrival: { estimated: { delay: "PT0S" } },
                  departure: { estimated: { delay: "PT0S" } },
                },
              ],
            },
            {
              mode: "RAIL", realTime: false, distance: 85000,
              startTime: at(11, 0), endTime: at(12, 40),
              departureDelay: 0, arrivalDelay: 0,
              from: { name: "Győr", departureTime: at(11, 0) },
              to: { name: "Sopron", arrivalTime: at(12, 40) },
              trip: { gtfsId: "1:222", tripShortName: "9928 személyvonat passenger train", tripHeadsign: "Sopron" },
              route: { shortName: '<span class="MNR2007">&#363;</span>', longName: "S30", mode: "RAIL" },
              agency: { name: "GYSEV Zrt." },
              // Leg 2 has no live data at all: no estimated block, no markup.
              intermediatePlaces: [{ name: "Csorna", arrivalTime: at(11, 40), departureTime: at(11, 41) }],
            },
          ],
        },
      ],
    },
  },
};

const vc = new VirtualConsole();
vc.on("jsdomError", (e) => console.error("JSDOM ERROR:", e.message));

let planCalls = 0;
let roadFetches = 0;
const sent = [];

const dom = new JSDOM(readFileSync(`${ROOT}/index.html`, "utf8"), {
  url: pathToFileURL(`${ROOT}/index.html`).href,
  runScripts: "dangerously",
  resources: "usable",
  virtualConsole: vc,
  beforeParse(window) {
    window.fetch = async (url, opts) => {
      if (String(url).includes("stations-road.json")) {
        roadFetches++;
        return { ok: true, status: 200, json: async () => roadStations };
      }
      if (String(url).includes("stations-rail.json")) {
        return { ok: true, status: 200, json: async () => stations };
      }
      planCalls++;
      sent.push({ url: String(url), method: (opts && opts.method) || "GET" });
      return { ok: true, status: 200, json: async () => PLAN };
    };
  },
});

const { window } = dom;
await new Promise((r) => window.addEventListener("load", r));
await new Promise((r) => setTimeout(r, 300)); // let stations-rail.json settle

const doc = window.document;
const $ = (id) => doc.getElementById(id);

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra && !cond ? "  [" + extra + "]" : ""}`);
  if (!cond) failures++;
};

// ---- static shell
/* Only bookable days are links — calMin is today — so the count shrinks as the
 * month runs out. Asserting a fixed number quietly turns into a calendar bug
 * report on the 12th; assert the rule instead. */
const calLinks = [...$("cal").querySelectorAll("td a")];
const dayOfMonth = Number(
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Budapest" }).format(new Date()).slice(8, 10),
);
check("calendar drawn", calLinks.length > 0, `${calLinks.length} selectable days`);
check("today is selectable", calLinks.some((a) => Number(a.textContent) === dayOfMonth),
  calLinks.map((a) => a.textContent).join(","));
check("days already past are not", dayOfMonth === 1 ||
  [...$("cal").querySelectorAll("td.off span")].some((s) => Number(s.textContent) === dayOfMonth - 1),
  `looking for ${dayOfMonth - 1}`);
check("calendar header is month + year", /^\d{4}\. \w+$/.test($("cal").querySelector("th.y").textContent), $("cal").querySelector("th.y").textContent);
check("reduction dropdown period-correct and disabled", $("u").disabled && $("u").options.length > 40);
check("three station fields present", ["i", "e", "v"].every((k) => $(k)));

// ---- autocomplete
function ac(term) {
  $("i").value = term;
  $("i").dispatchEvent(new window.Event("input"));
  return [...$("ac-i").querySelectorAll("li")].map((li) => li.textContent);
}

const acItems = ac("Budap");
check("autocomplete offers matches", acItems.length > 0, acItems.slice(0, 3).join(" / "));
check("BUDAPEST* offered first", acItems[0] === "BUDAPEST*", acItems[0]);
check("exact spelling still ranks first", ac("Budapest-Keleti")[0] === "Budapest-Keleti", ac("Budapest-Keleti")[0]);

/* The separator bug from r/programmingHungary: names are spelled with hyphens
 * and spaces that nobody types, and matching the query as one unbroken run of
 * characters found nothing at all. Every one of these used to return zero. */
[
  ["Budapest Keleti", "Budapest-Keleti"],
  ["Kobanya Kispest", "Kőbánya-Kispest"],
  ["Szeged Rokus", "Szeged-Rókus"],
  ["Gyor Gyarvaros", "Győr-Gyárváros"],
  ["Rakospalota Ujpest", "Rákospalota-Újpest"],
  ["Zalaegerszeg Ola", "Zalaegerszeg-Ola"],
  ["Balatonszeplak also", "Balatonszéplak alsó"], // accents alone already worked
  ["keleti budapest", "Budapest-Keleti"], // words in any order
  ["pest kel", "Budapest-Keleti"], // partial words, mid-word start
].forEach(([term, want]) => {
  const got = ac(term);
  check(`"${term}" finds ${want}`, got.includes(want), got.slice(0, 3).join(" / ") || "(nothing)");
});

check("a one-letter query still offers nothing", ac("B").length === 0);
check("nonsense finds nothing", ac("qqqqzzz").length === 0, ac("qqqqzzz").slice(0, 2).join(" / "));

ac("Budapest Keleti");
const hit = [...$("ac-i").querySelectorAll("li")].find((li) => li.textContent === "Budapest-Keleti");
check("both typed words are highlighted", hit && hit.querySelectorAll("span.m").length === 2,
  hit ? [...hit.querySelectorAll("span.m")].map((s) => s.textContent).join("+") : "no row");

/* ---- buses are opt-in, behind the "csak vasúti járat" checkbox.
 * They must not be downloaded, offered, or planned for until it is cleared. */
check("rail-only is the default", $("csv").checked);
check("bus stop list not downloaded while rail-only is on", roadFetches === 0, String(roadFetches));
check("bus stops are not offered while rail-only is on", ac("Röszke Kossuth").length === 0,
  ac("Röszke Kossuth").slice(0, 2).join(" / "));
check("railway stops named like villages still work", ac("Röszke").includes("Röszke"),
  ac("Röszke").slice(0, 3).join(" / "));

$("csv").checked = false;
$("csv").dispatchEvent(new window.Event("change", { bubbles: true }));
await new Promise((r) => setTimeout(r, 300));

check("clearing the box fetches the bus stops, once", roadFetches === 1, String(roadFetches));
check("bus stops now offered", ac("Röszke Kossuth").includes("Röszke, Kossuth utca"),
  ac("Röszke Kossuth").slice(0, 3).join(" / "));
check("a railway station still outranks bus stops", ac("Szeged")[0].startsWith("Szeged"),
  ac("Szeged").slice(0, 3).join(" / "));

// A bus stop typed while the box was clear must stop resolving once it is ticked
// again, not just disappear from the dropdown.
$("i").value = "Röszke, Kossuth utca";
$("e").value = "Szeged";
$("uff").dispatchEvent(new window.Event("submit", { cancelable: true, bubbles: true }));
await new Promise((r) => setTimeout(r, 400)); // let the search settle before the next one
check("an exact bus stop name submits while the box is clear",
  !/Nincs ilyen/.test($("results").textContent), $("results").textContent.slice(0, 60));

$("csv").checked = true;
$("csv").dispatchEvent(new window.Event("change", { bubbles: true }));
check("ticking it again hides the bus stops", ac("Röszke Kossuth").length === 0,
  ac("Röszke Kossuth").slice(0, 2).join(" / "));
check("and does not re-download them", roadFetches === 1, String(roadFetches));

$("i").value = "Röszke, Kossuth utca";
$("e").value = "Szeged";
$("uff").dispatchEvent(new window.Event("submit", { cancelable: true, bubbles: true }));
await new Promise((r) => setTimeout(r, 400));
check("that same bus stop no longer resolves once the box is ticked",
  /Nincs ilyen induló állomás/.test($("results").textContent), $("results").textContent.slice(0, 80));
$("i").value = "";
$("e").value = "";

// ---- search
$("i").value = "Budapest-Keleti";
$("e").value = "Sopron";
$("uff").dispatchEvent(new window.Event("submit", { cancelable: true, bubbles: true }));
await new Promise((r) => setTimeout(r, 400));

const results = $("results");
check("query fired", planCalls > 0, `planCalls=${planCalls}`);

// GET to skip the CORS preflight. Not to make the answer storable — the proxy
// sends no-store, because a cached delay is a wrong delay.
check("timetable asked for by GET", sent.length > 0 && sent[0].method === "GET", sent[0] && sent[0].method);
check("query travels in the URL", sent.length > 0 && /[?&]query=/.test(sent[0].url) && /[&]variables=/.test(sent[0].url),
  sent[0] && sent[0].url.slice(0, 80));

check("route header rendered", /Budapest-Keleti - Sopron/.test(results.querySelector(".lrtftop")?.textContent ?? ""));
const todayHu = new Intl.DateTimeFormat("hu-HU", { timeZone: "Europe/Budapest", year: "numeric", month: "2-digit", day: "2-digit" })
  .format(new Date()).replace(/\s/g, "").replace(/\.$/, "");
check("date and weekday printed", results.querySelector(".rrtftop")?.textContent.startsWith(todayHu),
  `${results.querySelector(".rrtftop")?.textContent} vs ${todayHu}`);

const table = results.querySelector("div.timetable table");
check("results table built", !!table);
const headers = [...(table?.querySelectorAll("thead th") ?? [])].map((th) => th.textContent.replace(/\s+/g, ""));
check("column headers as in the original", headers.join("|") === "Rész-le-tek|Indulás|Érkezés|Át-szál-lás|Idő-tartam|Összeskm", headers.join("|"));

const row = table?.querySelector("tbody tr");
const cells = [...(row?.children ?? [])].map((td) => td.textContent.trim());
console.log("  row:", JSON.stringify(cells));
check("one change", cells[3] === "1", cells[3]);
check("duration 3:22", cells[4] === "3:22", cells[4]);
check("distance 205 km", cells[5] === "205 km", cells[5]);

// ---- delay markup
const struck = row?.querySelector(".lateold");
const predicted = row?.querySelector(".latenew");
check("scheduled time struck through", struck?.textContent === "09:15", struck?.textContent);
check("predicted time beside it", predicted?.textContent === "09:18", predicted?.textContent);
check("arrival shown without delay (leg 2 on time)", cells[2].startsWith("12:40"), cells[2]);

// ---- expandable detail
const more = doc.getElementById("more0");
check("details panel starts hidden", !more.style.display || more.style.display === "none");
row.querySelector("td.info a").dispatchEvent(new window.Event("click", { cancelable: true, bubbles: true }));
check("opens on click", more.style.display === "block", more.style.display);

const detailText = more.textContent.replace(/\s+/g, " ");
check("details name the train", detailText.includes("992 SCARBANTIA InterCity"));

/* MÁV writes the category twice, once per language, so the raw name reads
 * "992 SCARBANTIA InterCity InterCity" and "9928 személyvonat passenger train".
 * One category, in the page's language. */
check("the doubled category is stripped", !/InterCity InterCity/.test(detailText),
  detailText.slice(0, 120));
check("the Hungarian category is kept, not the English one",
  /9928 személyvonat/.test(detailText) && !/passenger train/.test(detailText),
  detailText.slice(0, 200));
check("details list intermediate stops", detailText.includes("Tatabánya") && detailText.includes("Komárom") && detailText.includes("Csorna"));
check("details show transfer time", /átszállási idő: 20 perc/.test(detailText), detailText.slice(0, 200));
check("details flag the delay", /\+9 perc késés/.test(detailText), detailText.slice(0, 120));
check("pictogram decoded to a character", more.querySelector(".MNR2007")?.textContent.length === 1);

/* The columns used to be unlabelled, told apart only by an "érk."/"ind." prefix
 * on every row while the table outside spent those same words on something else.
 * Reported on r/programmingHungary. */
const colHead = more.querySelector("tr.cols");
check("detail columns are named", !!colHead);
check("detail header reads Állomás | Érkezés | Indulás",
  colHead && [...colHead.children].map((th) => th.textContent).join("|") === "Állomás|Érkezés|Indulás",
  colHead && [...colHead.children].map((th) => th.textContent).join("|"));
check("one column header per leg", more.querySelectorAll("tr.cols").length === 2,
  String(more.querySelectorAll("tr.cols").length));

/* The blue band must carry the train name and open its block. With the band
 * below the name it read as a separator, so the name looked like it belonged to
 * the leg above. */
const bands = [...more.querySelectorAll("th.t")];
check("one blue band per leg", bands.length === 2, String(bands.length));
check("the band names the train", /992 SCARBANTIA InterCity/.test(bands[0]?.textContent ?? ""),
  bands[0]?.textContent.trim().slice(0, 50));
check("the band spans the table", bands[0]?.colSpan === 3, String(bands[0]?.colSpan));
const detailRows = [...more.querySelectorAll("tr")];
check("the band comes first, column names under it",
  detailRows.indexOf(bands[0].parentNode) === 0 && detailRows.indexOf(colHead) === 1,
  `band ${detailRows.indexOf(bands[0].parentNode)}, cols ${detailRows.indexOf(colHead)}`);
/* The band reports the delay on ARRIVAL. A train can leave on time and lose
 * minutes on the way, so a note taken from the departure would contradict the
 * stop rows under it. Fixture: leaves +3, arrives +9. */
check("the band reports the delay on arrival, not on departure",
  /\+9 perc késés/.test(bands[0]?.textContent ?? ""), bands[0]?.textContent.trim());
check("…so it does not quote the departure delay", !/\+3 perc/.test(bands[0]?.textContent ?? ""),
  bands[0]?.textContent.trim());
check("a punctual leg still reads 'pontos'", /pontos/.test(bands[1]?.textContent ?? "") || !bands[1]?.textContent.includes("késés"),
  bands[1]?.textContent.trim());

/* A late stop inside the panel is marked the way the table outside marks one:
 * scheduled struck through, expected beside it. Printed bare, the live time was
 * indistinguishable from the timetable. */
const stopRow = (name) =>
  [...more.querySelectorAll("tr")].find((tr) => tr.children[0]?.textContent === name);

const tata = stopRow("Tatabánya");
check("a late stop shows the scheduled time struck through",
  tata?.querySelector(".lateold")?.textContent === "09:56", tata?.querySelector(".lateold")?.textContent);
check("…and the expected time beside it",
  tata?.querySelector(".latenew")?.textContent === "09:59", tata?.querySelector(".latenew")?.textContent);
check("both arrival and departure are marked", tata?.querySelectorAll(".lateold").length === 2,
  String(tata?.querySelectorAll(".lateold").length));

const komarom = stopRow("Komárom");
check("a stop that made up the time is not marked", !komarom?.querySelector(".lateold"),
  komarom?.textContent);
check("…and still shows its time", /10:18/.test(komarom?.textContent ?? ""), komarom?.textContent);

const csorna = stopRow("Csorna");
check("a leg with no live data is left unmarked", !csorna?.querySelector(".lateold"), csorna?.textContent);

const firstStop = stopRow("Budapest-Keleti");
check("the first stop uses the leg's own departure delay",
  firstStop?.querySelector(".lateold")?.textContent === "09:15", firstStop?.querySelector(".lateold")?.textContent);
check("times no longer repeat the érk./ind. prefix", !/érk\.|ind\./.test(detailText), detailText.slice(0, 120));
check("stop times still shown", /09:59/.test(detailText) && /10:00/.test(detailText));

row.querySelector("td.info a").dispatchEvent(new window.Event("click", { cancelable: true, bubbles: true }));
check("closes on second click", more.style.display === "none");

// ---- the single now-line separating past from upcoming
const nowline = doc.querySelectorAll("tr.nowline");
check("exactly one now-line", nowline.length === 1, `found ${nowline.length}`);
check("now-line spans the table", nowline[0]?.querySelector("td")?.colSpan === 6);
check("now-line is labelled", /^most \d{2}:\d{2}$/.test(nowline[0]?.querySelector(".nowbar span")?.textContent ?? ""),
  nowline[0]?.querySelector(".nowbar span")?.textContent);
const bodyRows = [...table.querySelector("tbody").children];
const lineAt = bodyRows.indexOf(nowline[0]);
const firstDataRow = bodyRows.findIndex((r) => !r.classList.contains("nowline"));
check("canned 09:18 journey sorts above the now-line (it has departed)", lineAt > firstDataRow, `line at ${lineAt}`);

// ---- day paging replaced the old hour paging
const pagerButtons = [...results.querySelectorAll(".pager input")].map((b) => b.value);
check("pager moves by whole days", pagerButtons.join(" | ") === "<<< előző nap | következő nap >>>", pagerButtons.join(" | "));

// ---- the time field is gone
check("no time input left in the form", !$("t"));

// ---- swap button
$("goback").dispatchEvent(new window.Event("click", { cancelable: true, bubbles: true }));
check("Return trip swaps the stations", $("i").value === "Sopron" && $("e").value === "Budapest-Keleti");

// ---- language: Hungarian by default, English on demand
check("page starts in Hungarian", doc.documentElement.lang === "hu", doc.documentElement.lang);
check("Hungarian form labels", doc.querySelector('label[for="i"]').textContent === "Honnan:");
check("Hungarian reduction options", $("u").options[0].textContent === "Teljesárú menetdíj", $("u").options[0].textContent);

$("lang-en").dispatchEvent(new window.Event("click", { cancelable: true, bubbles: true }));
await new Promise((r) => setTimeout(r, 200));

check("switches to English", doc.documentElement.lang === "en", doc.documentElement.lang);
check("English form labels", doc.querySelector('label[for="i"]').textContent === "From:", doc.querySelector('label[for="i"]').textContent);
check("English placeholder", $("i").placeholder === "From?", $("i").placeholder);
check("English submit button", $("go").value === "Timetable", $("go").value);
check("English document title", doc.title === "Régi ELVIRA – Hungarian train timetable and journey planner", doc.title);
check("title matches the one in index.html", readFileSync(`${ROOT}/index.html`, "utf8").includes("<title>Régi ELVIRA – vasúti menetrend és útvonaltervező</title>"));
check("English reduction options (MÁV's own wording)", $("u").options[0].textContent === "Full fare", $("u").options[0].textContent);
check("English optgroup labels", $("u").querySelector("optgroup").label === "33% discount fare", $("u").querySelector("optgroup").label);
check("English calendar month", /^[A-Z][a-z]+ \d{4}$/.test($("cal").querySelector("th.y").textContent), $("cal").querySelector("th.y").textContent);
check("English disclaimer states it is unofficial", /Unofficial site.*not affiliated/s.test($("discl").textContent), $("discl").textContent.slice(0, 80));

const enHeaders = [...doc.querySelectorAll("div.timetable thead th")].map((th) => th.textContent.replace(/\s+/g, ""));
check("results redrawn in English", enHeaders.join("|") === "De-tails|Departure|Arrival|Chan-ges|Dura-tion|Totalkm", enHeaders.join("|"));
const enPager = [...doc.querySelectorAll(".pager input")].map((b) => b.value);
check("English pager", enPager.join(" | ") === "<<< previous day | next day >>>", enPager.join(" | "));
check("English now-line", /^now \d{2}:\d{2}$/.test(doc.querySelector(".nowbar span")?.textContent ?? ""), doc.querySelector(".nowbar span")?.textContent);
check("English details panel", /transfer time: 20 min/.test(doc.getElementById("more0").textContent.replace(/\s+/g, " ")));
const enDetail = doc.getElementById("more0").textContent.replace(/\s+/g, " ");
check("category switches language with the page",
  /9928 passenger train/.test(enDetail) && !/személyvonat/.test(enDetail), enDetail.slice(0, 200));
check("…and is still not doubled", !/passenger train passenger train/.test(enDetail));
const enCols = doc.getElementById("more0").querySelector("tr.cols");
check("English detail header", enCols && [...enCols.children].map((th) => th.textContent).join("|") === "Station|Arrival|Departure",
  enCols && [...enCols.children].map((th) => th.textContent).join("|"));

$("lang-hu").dispatchEvent(new window.Event("click", { cancelable: true, bubbles: true }));
await new Promise((r) => setTimeout(r, 200));
check("switches back to Hungarian", doc.documentElement.lang === "hu" && doc.querySelector('label[for="i"]').textContent === "Honnan:");
check("reduction options restored", $("u").options[0].textContent === "Teljesárú menetdíj", $("u").options[0].textContent);
const huHeaders2 = [...doc.querySelectorAll("div.timetable thead th")].map((th) => th.textContent.replace(/\s+/g, ""));
check("results back in Hungarian", huHeaders2.join("|") === "Rész-le-tek|Indulás|Érkezés|Át-szál-lás|Idő-tartam|Összeskm", huHeaders2.join("|"));

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECKS FAILED"}`);
process.exit(failures ? 1 : 0);
