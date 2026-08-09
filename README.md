# régi ELVIRA

A nostalgia rebuild of [ELVIRA](https://elvira.mav-start.hu/), the Hungarian State
Railways timetable search that MÁV retired in September 2025 — the original look,
running on today's schedules and live delays.

**This is built purely for nostalgia.** The interface is dated on purpose, ELVIRA looked like
this, it worked like this, and I wanted it back. If you want a modern
journey planner, use [MÁVPlusz](https://mavplusz.hu/) — this is not trying to compete
with it.

> **Trains only.** I use this for trains, and that is all it has been tested for. The
> station list is built from the railway feed, so bus stops are not in it. It is a
> one-person hobby rebuild, so expect rough edges — if something is wrong or missing,
> open an issue or a pull request; both are welcome.

**Unofficial.** Not affiliated with MÁV-START Zrt. For anything binding, use the
official site.

## Where everything comes from

| Part | Source |
|---|---|
| Look and layout | The original site, recovered from the Wayback Machine |
| Schedules and delays | The public MÁVPlusz (EMMA) OpenTripPlanner GraphQL API, via a proxy |

## How it behaves

- One search lists a **whole day**, the way ELVIRA did — not just the next few
  departures. On today's date a single orange rule marks the point the clock has
  passed; everything above it has already left, and the page scrolls there for you.
- Typing `BUDAPEST*` searches from every Budapest terminal at once, as the original did.
- Delayed trains show the scheduled time struck through in red, with the predicted
  time next to it.
- Clicking the **Részletek** button opens the stop-by-stop breakdown of a journey.
- The page is **Hungarian by default, switchable to English** from the flags in the
  header, as the original was. The choice is remembered in `localStorage`.

## Setup
The solution was designed to be hosted on GitHub pages.

### 1. Proxy

GitHub Pages serves static files only — it runs no code — so the timetable request has
to be made by the visitor's browser. A browser will not read a response from another
site unless that site's reply says it may, and the timetable server sends no such
header, so the request is blocked before the page ever sees it. A small proxy fetches
the data server-side and supplies the missing header. Any host that runs server-side
code would not need a separate proxy for this.

See [`proxy/README.md`](proxy/README.md) — free, about five minutes. It is deployed on
Deno Deploy; a Cloudflare Workers version of the same proxy is also included, and either
can be used depending on what the upstream accepts at the time.

Then put your proxy address at the top of [`js/api.js`](js/api.js):

```js
var API_URL = "https://your-project.deno.net";
```

### 2. Trying it locally

Two commands, two terminals:

```sh
node tools/dev-proxy.mjs        # local stand-in for the proxy, port 8787
python -m http.server 8000      # the page itself
```

then <http://localhost:8000>. Served from localhost, the page picks up the local proxy
by itself, so the search works with real schedules and delays **before** anything is
deployed.

### 3. Publishing on GitHub Pages

Repository → **Settings** → **Pages** → *Deploy from a branch* → `main` / `/ (root)`.
No build step; the repository is served as it stands.

## Refreshing the station list

The autocomplete reads `data/stations.json` so that typing needs no network. Regenerate
it when the timetable period changes:

```sh
node tools/build-stations.mjs
```

## What is missing, and why

- **Fares and tickets** — this page shows timetables only. The "Reduction" dropdown is
  period-correct decoration and is disabled.
- **Delays for future dates** — MÁV only publishes realtime data for trains departing
  soon. Search tomorrow and you get scheduled times.
- **Via** — OpenTripPlanner's `plan` query has no intermediate-point argument, so the
  page fetches both halves of the day and joins them itself. One via station.

## Files

```
index.html                 the page
css/g.css                  the original stylesheet
css/p.css                  the original print stylesheet
img/                       the original backgrounds and buttons
fonts/MNR2007.ttf          train category pictograms
js/api.js                  GraphQL queries, filtering, time and delay formatting
js/elvira.js               calendar, station autocomplete, results table
js/i18n.js                 Hungarian and English page text
js/reduction-en.js         English wording for the reduction dropdown
data/stations.json         generated station list
tools/build-stations.mjs   generates the station list
tools/dev-proxy.mjs        local CORS proxy for development
proxy/deno-deploy.ts       CORS proxy for Deno Deploy (the one in use)
proxy/cloudflare-worker.js CORS proxy for Cloudflare Workers (alternative)
```

## Attribution

The design is reproduced from the original site for a non-commercial personal project;
if a rights holder would rather it were not published, open an issue and I will take it
down.
