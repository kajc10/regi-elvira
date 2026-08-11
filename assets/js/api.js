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

  /* GET rather than POST, to skip a round trip: a POST carrying
   * Content-Type: application/json is not a "simple" cross-origin request, so
   * the browser asks the proxy for permission with an OPTIONS preflight before
   * every single call. A GET with no custom headers does not. Answers are still
   * never cached — see the proxy — because live delays are the whole point.
   *
   * Older deployments of the proxy answer 405 to a GET. Rather than making the
   * page and the proxy have to be updated in lockstep, the first such refusal
   * switches this back to POST for the rest of the session. */
  var useGet = true;

  function send(query, variables) {
    if (useGet) {
      var url =
        API_URL +
        "?query=" + encodeURIComponent(query) +
        "&variables=" + encodeURIComponent(JSON.stringify(variables));
      return fetch(url).then(function (r) {
        if (r.status !== 405) return r;
        useGet = false;
        return send(query, variables);
      });
    }
    return fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: query, variables: variables }),
    });
  }

  function gql(query, variables) {
    return send(query, variables || {})
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
    "    routingErrors{ code inputField }",
    "    itineraries{",
    "      startTime endTime duration walkDistance",
    "      legs{",
    "        mode realTime distance startTime endTime departureDelay arrivalDelay",
    "        from{ name departureTime }",
    "        to{ name arrivalTime }",
    "        trip{ gtfsId tripShortName tripHeadsign }",
    "        route{ shortName longName mode }",
    "        agency{ name }",
    /* The per-stop delay, so the detail panel can mark a late stop the way the
     * table outside does. Only the delay is asked for, not scheduledTime as
     * well: the scheduled time is the shown time minus it, and this list is
     * already the largest thing in the response. */
    "        intermediatePlaces{ name arrivalTime departureTime",
    "          arrival{ estimated{ delay } } departure{ estimated{ delay } } }",
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
      var plan = data.plan || {};
      /* OTP reports LOCATION_NOT_FOUND when it cannot attach a coordinate to its
       * routing graph. MÁV's graph covers Hungary and stops at the border, so
       * every foreign station in the list produces it — the timetable knows
       * Wien Hbf and its railjets, but nothing can be planned to it. Recorded
       * here so the page can say that instead of "no connection found". */
      (plan.routingErrors || []).forEach(function (e) {
        if (e.code === "LOCATION_NOT_FOUND") {
          unreachable[e.inputField === "TO" ? "to" : "from"] = true;
        }
      });
      return plan.itineraries || [];
    });
  }

  /* Set while a search runs, read once it finishes. Which endpoint OTP could not
   * place, if either. */
  var unreachable = { from: false, to: false };

  /* Leg-level delays arrive as plain seconds, but a stop's own delay is an
   * ISO-8601 duration ("PT3M", "PT0S", and "PT-1M" when a train is running
   * early). Both forms end up here so the caller never has to care which it got. */
  function delaySeconds(v) {
    if (typeof v === "number") return v;
    if (!v) return 0;
    var m = /^(-?)P(?:(-?[\d.]+)D)?(?:T(?:(-?[\d.]+)H)?(?:(-?[\d.]+)M)?(?:(-?[\d.]+)S)?)?$/.exec(v);
    if (!m) return 0;
    var n = function (x) { return parseFloat(x || 0); };
    var total = n(m[2]) * 86400 + n(m[3]) * 3600 + n(m[4]) * 60 + n(m[5]);
    return Math.round(m[1] === "-" ? -total : total);
  }

  /* What a stop's arrival or departure is actually doing: the time to print, how
   * late it is, and whether that is a live figure at all. */
  function stopTime(place, which) {
    var side = place[which]; // "arrival" | "departure"
    var live = !!(side && side.estimated);
    return {
      at: which === "arrival" ? place.arrivalTime : place.departureTime,
      delay: live ? delaySeconds(side.estimated.delay) : 0,
      realTime: live,
    };
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
      /* Keyed on which trains are boarded and when, not on the arrival time.
       * BUDAPEST* plans from four terminals in eight separate calls, and MÁV's
       * realtime estimate can move between them — the same journey came back
       * arriving at 21:10 from one call and 21:11 from another, which an
       * arrival-based key read as two different trains and listed twice. */
      var key = t
        .map(function (l) {
          return l.startTime + ":" + ((l.trip && l.trip.gtfsId) || l.mode);
        })
        .join(",");
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
      /* COACH is the Volán intercity network — the one that actually reaches the
       * village stops, and a different OTP mode from the city BUS. Without it,
       * clearing "csak vasúti járat" offered bus stops it could not plan to. */
      if (!f.noBus) all.push({ mode: "BUS" }, { mode: "COACH" }, { mode: "TROLLEYBUS" });
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
    unreachable = { from: false, to: false };

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
    /* Which endpoint of the last search OTP could not place on its graph, if
     * either. Only meaningful once search() has resolved. */
    unreachable: function () {
      return unreachable;
    },
    transitLegs: transitLegs,
    isNationalRail: isNationalRail,
    isReplacementBus: isReplacementBus,
    stopTime: stopTime,
    delaySeconds: delaySeconds,
    fmtClock: fmtClock,
    fmtDuration: fmtDuration,
    fmtDelay: fmtDelay,
    fmtDateParam: fmtDateParam,
    TZ: TZ,
  };
})();
