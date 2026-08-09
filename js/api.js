/* ELVIRA nosztalgia — data layer.
 *
 * Talks to MÁV's public OpenTripPlanner (the engine behind MÁVPlusz / EMMA).
 * That server sends no Access-Control-Allow-Origin header, so a browser cannot
 * call it directly — every request goes through the small proxy in proxy/, which
 * forwards it and adds the CORS headers.
 *
 * Set API_URL to your own deployed proxy (see proxy/README.md).
 */

var ELVIRA_API = (function () {
  "use strict";

  /* Deno Deploy rather than Cloudflare Workers: MÁV rate limits by source network
   * and refuses Cloudflare's with "host limit achived". See proxy/README.md. */
  var API_URL = "https://regi-elvira.kajc10.deno.net";

  // Served from localhost? Then tools/dev-proxy.mjs stands in for the proxy,
  // so the page can be tried out before anything is deployed.
  var DEV_PROXY = "http://127.0.0.1:8787";
  var isLocal =
    typeof location !== "undefined" &&
    /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  if (isLocal) API_URL = DEV_PROXY;

  var TZ = "Europe/Budapest";
  var MAV_FEED = "1:";

  /* ELVIRA's wildcard stations. Typing "BUDAPEST*" searched from every terminal
   * at once, which is the only way to be offered the Keleti InterCity when you
   * happen to start at Nyugati. */
  var GROUPS = [
    {
      n: "BUDAPEST*",
      members: [
        "Budapest-Keleti",
        "Budapest-Nyugati",
        "Budapest-Déli",
        "Budapest-Kelenföld",
      ],
    },
  ];

  // ---------------------------------------------------------------- transport

  function gql(query, variables) {
    return fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: query, variables: variables || {} }),
    })
      .then(function (r) {
        if (!r.ok) throw new Error("A menetrendi szolgáltatás hibát adott (HTTP " + r.status + ").");
        return r.json();
      })
      .then(function (body) {
        if (body.errors && body.errors.length) throw new Error(body.errors[0].message);
        return body.data;
      });
  }

  /* The original listed a whole day at a time, so every search asks for the day
   * from midnight with a 24 hour search window. 200 is a ceiling, not a target:
   * OTP stops at the end of the window, which for a busy line lands around 120
   * results and roughly 130 KB. */
  var PLAN_QUERY = [
    "query Plan($fromLat:Float!,$fromLon:Float!,$toLat:Float!,$toLon:Float!,",
    "           $date:String!,$modes:[TransportMode]){",
    "  plan(from:{lat:$fromLat,lon:$fromLon}, to:{lat:$toLat,lon:$toLon},",
    "       date:$date, time:\"00:00:00\", arriveBy:false,",
    "       numItineraries:200, searchWindow:86400,",
    "       transportModes:$modes, walkReluctance:6){",
    "    itineraries{",
    "      startTime endTime duration walkDistance",
    "      legs{",
    "        mode realTime distance startTime endTime departureDelay arrivalDelay",
    "        from{ name departureTime }",
    "        to{ name arrivalTime }",
    "        trip{ gtfsId tripShortName tripHeadsign }",
    "        route{ shortName longName mode }",
    "        agency{ name }",
    "        intermediatePlaces{ name arrivalTime departureTime }",
    "      }",
    "    }",
    "  }",
    "}",
  ].join("\n");

  /** One OTP plan call for a whole day. `opts` is {from,to,date,modes}. */
  function planOnce(opts) {
    return gql(PLAN_QUERY, {
      fromLat: opts.from.lat,
      fromLon: opts.from.lon,
      toLat: opts.to.lat,
      toLon: opts.to.lon,
      date: opts.date,
      modes: opts.modes,
    }).then(function (data) {
      return (data.plan && data.plan.itineraries) || [];
    });
  }

  // ------------------------------------------------------------------ filters

  function transitLegs(it) {
    return it.legs.filter(function (l) {
      return l.mode !== "WALK";
    });
  }

  /* Feed "1" is the national railway feed — it carries both MÁV and GYSEV
   * trains, which ELVIRA always listed side by side. BKK, Volánbusz and the
   * local operators sit in their own feeds. */
  function isNationalRail(leg) {
    return !!(leg.trip && leg.trip.gtfsId && leg.trip.gtfsId.indexOf(MAV_FEED) === 0);
  }

  /** Rail replacement coaches ride in the railway feed under a railway agency. */
  function isReplacementBus(leg) {
    var agency = (leg.agency && leg.agency.name) || "";
    return leg.mode === "BUS" && isNationalRail(leg) && !/volán/i.test(agency);
  }

  function applyFilters(itineraries, f) {
    return itineraries.filter(function (it) {
      var t = transitLegs(it);
      if (!t.length) return false;
      if (f.noBus && t.some(function (l) { return l.mode === "BUS"; })) return false;
      if (f.noChange && t.length > 1) return false;
      if (
        f.railOnly &&
        t.some(function (l) {
          return !(l.mode === "RAIL" ? isNationalRail(l) : isReplacementBus(l));
        })
      ) {
        return false;
      }
      return true;
    });
  }

  /* Keyed on the times only, not on trip ids: MÁV publishes some trains under
   * several numbers (462 / 40462 KÁLMÁN IMRE), which would otherwise show up as
   * duplicate rows with identical departure and arrival. */
  function dedupe(itineraries) {
    var seen = {};
    return itineraries.filter(function (it) {
      var t = transitLegs(it);
      var key =
        t[0].startTime +
        "|" +
        t[t.length - 1].endTime +
        "|" +
        t.map(function (l) { return l.startTime; }).join(",");
      if (seen[key]) return false;
      seen[key] = 1;
      return true;
    });
  }

  /* A single train can arrive as two legs: stitching two searches at a via point
   * cuts one in half, and trains handed over between MÁV and GYSEV are split at
   * the boundary station. Both cases are glued back into one leg, otherwise the
   * table would claim a change of train where the passenger just stays seated. */
  function mergeSameTrip(legs) {
    var out = [];
    // OTP inserts a zero-length walk where two searches were stitched together
    // and at platform changes; it would otherwise keep the halves apart.
    legs
      .filter(function (l) {
        return l.mode !== "WALK" || (l.distance || 0) >= 50;
      })
      .forEach(function (leg) {
      var prev = out[out.length - 1];
      var continuous =
        prev &&
        prev.trip &&
        leg.trip &&
        prev.to.name === leg.from.name &&
        prev.endTime <= leg.startTime &&
        leg.startTime - prev.endTime < 20 * 60000;
      var sameTrip =
        continuous &&
        (prev.trip.gtfsId === leg.trip.gtfsId ||
          (!!prev.trip.tripShortName &&
            prev.trip.tripShortName === leg.trip.tripShortName));
      if (!sameTrip) {
        out.push(leg);
        return;
      }
      var junction = {
        name: prev.to.name,
        arrivalTime: prev.endTime,
        departureTime: leg.startTime,
      };
      out[out.length - 1] = Object.assign({}, prev, {
        endTime: leg.endTime,
        to: leg.to,
        arrivalDelay: leg.arrivalDelay,
        distance: (prev.distance || 0) + (leg.distance || 0),
        intermediatePlaces: (prev.intermediatePlaces || [])
          .concat([junction])
          .concat(leg.intermediatePlaces || []),
      });
    });
    return out;
  }

  // --------------------------------------------------------------- via search

  /* OTP's `plan` has no via/intermediate-place argument (checked against the
   * live schema), so "Érintve" fetches both halves of the day and joins them
   * here: each first half is matched with the earliest second half that can
   * still be caught. Two requests, whatever the number of results. */
  var MIN_TRANSFER_MS = 3 * 60000;

  function planVia(opts) {
    return Promise.all([
      planOnce({ from: opts.from, to: opts.via, date: opts.date, modes: opts.modes }),
      planOnce({ from: opts.via, to: opts.to, date: opts.date, modes: opts.modes }),
    ]).then(function (halves) {
      var heads = applyFilters(halves[0], opts.filters);
      var tails = applyFilters(halves[1], opts.filters).sort(function (a, b) {
        return a.startTime - b.startTime;
      });
      if (!heads.length || !tails.length) return [];

      return heads
        .map(function (h) {
          var t = tails.find(function (c) {
            return c.startTime >= h.endTime + MIN_TRANSFER_MS;
          });
          if (!t) return null;
          return {
            startTime: h.startTime,
            endTime: t.endTime,
            duration: Math.round((t.endTime - h.startTime) / 1000),
            walkDistance: (h.walkDistance || 0) + (t.walkDistance || 0),
            legs: mergeSameTrip(h.legs.concat(t.legs)),
          };
        })
        .filter(Boolean);
    });
  }

  /**
   * Full search used by the form.
   * `q` = {from, to, via|null, ymd:"YYYY-MM-DD", filters:{railOnly,noBus,noChange}}
   */
  /* Which mode sets to ask OTP for.
   *
   * Asking for BUS and then throwing bus itineraries away does not work: OTP
   * answers with its ten *best* options, and around Budapest those are all
   * metro/tram combinations, so the filter would leave nothing. When the search
   * is restricted to trains we therefore ask for trains only, and — unless the
   * user excluded replacement coaches — run a second pass that also allows
   * buses, so rail replacement sections still show up. */
  function modeSets(f) {
    if (!f.railOnly) {
      var all = [{ mode: "WALK" }, { mode: "RAIL" }, { mode: "TRAM" }, { mode: "SUBWAY" }, { mode: "FERRY" }];
      if (!f.noBus) all.push({ mode: "BUS" });
      return [all];
    }
    var railOnly = [{ mode: "WALK" }, { mode: "RAIL" }];
    if (f.noBus) return [railOnly];
    return [railOnly, [{ mode: "WALK" }, { mode: "RAIL" }, { mode: "BUS" }]];
  }

  /* A station may be a group (ELVIRA's "BUDAPEST*"), in which case every member
   * is planned separately and the results are merged — that is how the original
   * managed to offer the Keleti InterCity when you typed Budapest. */
  function pointsOf(station) {
    return station.members && station.members.length ? station.members : [station];
  }

  var MAX_PLAN_CALLS = 8;

  function search(q) {
    var common = {
      via: q.via,
      date: q.ymd,
      filters: q.filters,
    };

    var pairs = [];
    pointsOf(q.from).forEach(function (from) {
      pointsOf(q.to).forEach(function (to) {
        pairs.push({ from: from, to: to });
      });
    });

    var sets = modeSets(q.filters);
    // Groups multiply the request count; drop the extra replacement-bus pass
    // rather than firing a dozen calls for one search.
    if (pairs.length * sets.length > MAX_PLAN_CALLS) sets = [sets[0]];

    var runs = [];
    pairs.forEach(function (pair) {
      sets.forEach(function (modes) {
        var opts = Object.assign({}, common, pair, { modes: modes });
        runs.push(
          q.via
            ? planVia(opts)
            : planOnce(opts).then(function (r) {
                return applyFilters(r, q.filters);
              }),
        );
      });
    });

    return Promise.all(runs).then(function (results) {
      var merged = [].concat.apply([], results).map(function (it) {
        return Object.assign({}, it, { legs: mergeSameTrip(it.legs) });
      });
      var rows = dedupe(merged);
      rows.sort(function (a, b) {
        return a.startTime - b.startTime || a.endTime - b.endTime;
      });
      return rows;
    });
  }

  // ------------------------------------------------------------- date helpers

  var dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  var timeParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  /** YYYY-MM-DD in Budapest time — the format OTP's `date` argument wants. */
  function fmtDateParam(d) {
    return dateParts.format(d);
  }

  /** HH:MM for display. */
  function fmtClock(ms) {
    return timeParts.format(new Date(ms));
  }

  /** Seconds -> "1:22", the duration format the original table used. */
  function fmtDuration(sec) {
    var m = Math.round(sec / 60);
    return Math.floor(m / 60) + ":" + String(m % 60).padStart(2, "0");
  }

  /** Delay in seconds -> "+3 perc" / "-1 perc" (shown to the reader). */
  function fmtDelay(sec) {
    var m = Math.round(sec / 60);
    return (m > 0 ? "+" : "") + m + " perc";
  }

  // ------------------------------------------------------------------ exports

  return {
    get apiUrl() {
      return API_URL;
    },
    set apiUrl(v) {
      API_URL = v;
    },
    isConfigured: function () {
      return API_URL.indexOf("YOUR-SUBDOMAIN") === -1;
    },
    GROUPS: GROUPS,
    search: search,
    transitLegs: transitLegs,
    isNationalRail: isNationalRail,
    isReplacementBus: isReplacementBus,
    fmtClock: fmtClock,
    fmtDuration: fmtDuration,
    fmtDelay: fmtDelay,
    fmtDateParam: fmtDateParam,
    TZ: TZ,
  };
})();
