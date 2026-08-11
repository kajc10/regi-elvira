/* ELVIRA nosztalgia — user interface.
 *
 * Rebuilds the three pieces of behaviour the original page had: the station
 * autocomplete, the month calendar, and the results table with its expandable
 * "Részletek" panels. Markup and class names follow the archived page so the
 * recovered stylesheet applies unchanged.
 */

(function () {
  "use strict";

  var API = window.ELVIRA_API;

  var stations = [];
  var stationIndex = null; // normalised name -> station

  /* Coach and bus stops, fetched only if the user clears "csak vasúti járat".
   * They outnumber the railway stations and are named "Település, Utca", so
   * mixing them in by default would bury Szeged-Rókus under three hundred Szeged
   * bus stops — and cost every visitor the download for something ELVIRA never
   * did. Opt in, and only then pay for it. */
  var roadStations = [];
  var roadIndex = null; // kept apart from stationIndex so ticking the box hides it again
  var roadPromise = null;
  var lastQuery = null;
  var lastResults = null;

  /* Page language. Hungarian by default — that is what ELVIRA was — with the
   * English edition reachable from the flags in the header, the way the original
   * offered it. Wording lives in js/i18n.js. */
  var LANG = "hu";
  var I18N = window.ELVIRA_I18N;

  function t(key) {
    var v = I18N[LANG][key];
    return v === undefined ? I18N.hu[key] : v;
  }

  function $(id) {
    return document.getElementById(id);
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /** Lowercase and strip accents so "Gyor" finds "Győr". */
  function norm(s) {
    return s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();
  }

  /* The timetable spells its separators in ways nobody types: "Budapest-Keleti",
   * "K\u0151b\u00e1nya als\u00f3", "Szeged, R\u00f3kus vas\u00fat\u00e1llom\u00e1s". Matching the query as one
   * uninterrupted run of characters therefore missed the obvious \u2014 "Budapest
   * Keleti" found nothing at all, and 1689 of the 16962 names carry a hyphen.
   * Both sides are cut into words instead, and every word of the query has to
   * turn up in the name. */
  var SEP = /[^0-9a-z]+/;

  function words(s) {
    return norm(s).split(SEP).filter(Boolean);
  }

  // ==================================================================== dates

  /** Today in Budapest, as "YYYY-MM-DD". */
  function todayYmd() {
    return API.fmtDateParam(new Date());
  }

  function ymdOf(y, m, d) {
    return (
      y + "-" + String(m + 1).padStart(2, "0") + "-" + String(d).padStart(2, "0")
    );
  }

  function parseYmd(s) {
    var p = s.split("-").map(Number);
    return { y: p[0], m: p[1] - 1, d: p[2] };
  }

  /** Weekday name of a "YYYY-MM-DD" string (Monday = 0). */
  function weekdayName(ymd) {
    var p = parseYmd(ymd);
    var wd = (new Date(Date.UTC(p.y, p.m, p.d)).getUTCDay() + 6) % 7;
    return t("weekdaysLong")[wd];
  }

  /** "2026-08-09" -> "2026.08.09" as the result header printed it. */
  function prettyYmd(ymd) {
    return ymd.replace(/-/g, ".");
  }

  // ================================================================= calendar

  var calState = { selected: todayYmd(), viewY: 0, viewM: 0 };
  var calMin = todayYmd();
  var calMax = (function () {
    var d = new Date(Date.now() + 330 * 86400000);
    return API.fmtDateParam(d);
  })();

  function drawCalendar() {
    var host = $("cal");
    host.innerHTML = "";

    var table = document.createElement("table");
    var y = calState.viewY;
    var m = calState.viewM;

    var head = document.createElement("tr");
    var prev = document.createElement("th");
    prev.className = "nav";
    var prevA = el("a", null, "<<<");
    prevA.href = "#";
    prevA.onclick = function (e) {
      e.preventDefault();
      shiftMonth(-1);
    };
    prev.appendChild(prevA);

    var title = el(
      "th",
      "y",
      LANG === "hu" ? y + ". " + t("months")[m] : t("months")[m] + " " + y,
    );
    title.colSpan = 5;

    var next = document.createElement("th");
    next.className = "nav";
    var nextA = el("a", null, ">>>");
    nextA.href = "#";
    nextA.onclick = function (e) {
      e.preventDefault();
      shiftMonth(1);
    };
    next.appendChild(nextA);

    head.appendChild(prev);
    head.appendChild(title);
    head.appendChild(next);
    table.appendChild(head);

    var days = document.createElement("tr");
    t("weekdays").forEach(function (w) {
      days.appendChild(el("th", "w", w));
    });
    table.appendChild(days);

    var first = new Date(Date.UTC(y, m, 1));
    var lead = (first.getUTCDay() + 6) % 7; // Monday-first
    var count = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

    var row = document.createElement("tr");
    for (var i = 0; i < lead; i++) row.appendChild(el("td", "off"));

    for (var d = 1; d <= count; d++) {
      if ((lead + d - 1) % 7 === 0 && d > 1) {
        table.appendChild(row);
        row = document.createElement("tr");
      }
      var ymd = ymdOf(y, m, d);
      var wd = (lead + d - 1) % 7;
      var cell = document.createElement("td");
      var out = ymd < calMin || ymd > calMax;

      if (out) {
        cell.className = "off";
        cell.appendChild(el("span", null, String(d)));
      } else {
        if (ymd === calState.selected) cell.className = "s";
        else if (wd >= 5) cell.className = "v";
        var a = el("a", null, String(d));
        a.href = "#";
        a.dataset.ymd = ymd;
        a.onclick = function (e) {
          e.preventDefault();
          calState.selected = this.dataset.ymd;
          drawCalendar();
        };
        cell.appendChild(a);
      }
      row.appendChild(cell);
    }
    while (row.children.length < 7) row.appendChild(el("td", "off"));
    table.appendChild(row);

    host.appendChild(table);
  }

  function shiftMonth(delta) {
    var m = calState.viewM + delta;
    var y = calState.viewY;
    if (m < 0) {
      m = 11;
      y--;
    } else if (m > 11) {
      m = 0;
      y++;
    }
    var lastOfView = ymdOf(y, m, new Date(Date.UTC(y, m + 1, 0)).getUTCDate());
    var firstOfView = ymdOf(y, m, 1);
    if (lastOfView < calMin || firstOfView > calMax) return;
    calState.viewY = y;
    calState.viewM = m;
    drawCalendar();
  }

  function initCalendar() {
    var p = parseYmd(calState.selected);
    calState.viewY = p.y;
    calState.viewM = p.m;
    drawCalendar();
  }

  // ============================================================= autocomplete

  function loadStations() {
    return fetch("data/stations-rail.json")
      .then(function (r) {
        return r.json();
      })
      .then(function (list) {
        var byName = new Map();
        list.forEach(function (s) {
          if (!byName.has(s.n)) byName.set(s.n, s);
        });

        // Wildcard stations go in front so "Budapest" offers BUDAPEST* first.
        var groups = API.GROUPS.map(function (g) {
          var members = g.members.map(function (n) { return byName.get(n); }).filter(Boolean);
          return members.length ? { n: g.n, members: members } : null;
        }).filter(Boolean);

        stations = groups.concat(list);
        stationIndex = new Map();
        stations.forEach(function (s) {
          // Normalising 17k names on every keystroke is wasteful; do it once.
          s._n = norm(s.n);
          s._w = words(s.n);
          if (!stationIndex.has(s._n)) stationIndex.set(s._n, s);
        });
        // "budapest" on its own should resolve to the wildcard, not to a terminal.
        groups.forEach(function (g) {
          stationIndex.set(norm(g.n.replace(/\*$/, "")), g);
        });
      })
      .catch(function () {
        showError(
          t("stationsError"),
        );
      });
  }

  /** True while "csak vasúti járat" is cleared, i.e. buses are wanted. */
  function roadWanted() {
    var cb = $("csv");
    return !!cb && !cb.checked;
  }

  /* Fetched at most once, the first time the checkbox is cleared. A failure
   * leaves roadPromise null so a later attempt can try again. */
  function loadRoadStations() {
    if (roadPromise) return roadPromise;
    roadPromise = fetch("data/stations-road.json")
      .then(function (r) {
        return r.json();
      })
      .then(function (list) {
        roadIndex = new Map();
        list.forEach(function (s) {
          s._n = norm(s.n);
          s._w = words(s.n);
          if (!roadIndex.has(s._n)) roadIndex.set(s._n, s);
        });
        roadStations = list;
      })
      .catch(function () {
        roadPromise = null;
        showError(t("roadStationsError"));
      });
    return roadPromise;
  }

  /* How well a name answers the query, best first; -1 for no match at all.
   * 0 and 1 are the old behaviour and still win, so nothing that used to be
   * offered first drops down the list. */
  function rank(s, q, qw) {
    var at = s._n.indexOf(q);
    if (at === 0) return 0; // the query opens the name
    if (at > 0) return 1; // …or appears in it unbroken
    if (!qw.length) return -1;
    var everyWordStarts = qw.every(function (w) {
      return s._w.some(function (x) {
        return x.indexOf(w) === 0;
      });
    });
    if (everyWordStarts) return 2; // "budapest kel" → Budapest-Keleti
    var everyWordSomewhere = qw.every(function (w) {
      return s._n.indexOf(w) >= 0;
    });
    return everyWordSomewhere ? 3 : -1; // "pest kel" → Budapest-Keleti
  }

  function suggest(term, limit) {
    var q = norm(term);
    if (q.length < 2) return [];
    var qw = words(term);
    // Railway stations first and always; road stops only when asked for, and
    // after them, so a station never loses its place to a bus stop.
    var lists = roadWanted() && roadStations.length ? [stations, roadStations] : [stations];
    var buckets = [[], [], [], []];
    for (var li = 0; li < lists.length; li++) {
      var arr = lists[li];
      for (var i = 0; i < arr.length; i++) {
        var r = rank(arr[i], q, qw);
        if (r >= 0) buckets[r].push(arr[i]);
        if (buckets[0].length >= limit) break;
      }
      if (buckets[0].length >= limit) break;
    }
    return buckets[0]
      .concat(buckets[1], buckets[2], buckets[3])
      .slice(0, limit);
  }

  function attachAutocomplete(inputId, listId) {
    var input = $(inputId);
    var list = $(listId);
    var items = [];
    var cursor = -1;

    function close() {
      list.style.display = "none";
      cursor = -1;
    }

    function pick(i) {
      if (i < 0 || i >= items.length) return;
      input.value = items[i].n;
      close();
    }

    /* One mark per matched word. The query is matched word by word now, so a
     * single range would leave half of what was typed unhighlighted. */
    function highlight(name, term) {
      var n = norm(name);
      var whole = norm(term);
      var ranges = [];
      var at = n.indexOf(whole);
      if (at >= 0) {
        ranges.push([at, at + whole.length]);
      } else {
        words(term).forEach(function (w) {
          var i = n.indexOf(w);
          if (i >= 0) ranges.push([i, i + w.length]);
        });
        ranges.sort(function (a, b) {
          return a[0] - b[0];
        });
      }
      if (!ranges.length) return document.createTextNode(name);

      var frag = document.createDocumentFragment();
      var pos = 0;
      ranges.forEach(function (r) {
        if (r[0] < pos) return; // words that overlap: keep the first
        frag.appendChild(document.createTextNode(name.slice(pos, r[0])));
        frag.appendChild(el("span", "m", name.slice(r[0], r[1])));
        pos = r[1];
      });
      frag.appendChild(document.createTextNode(name.slice(pos)));
      return frag;
    }

    function render() {
      list.innerHTML = "";
      items.forEach(function (s, i) {
        var li = document.createElement("li");
        li.appendChild(highlight(s.n, input.value));
        if (i === cursor) li.className = "sel";
        li.onmousedown = function (e) {
          e.preventDefault();
          pick(i);
        };
        list.appendChild(li);
      });
      list.style.display = items.length ? "block" : "none";
    }

    input.addEventListener("input", function () {
      items = suggest(input.value, 40);
      cursor = -1;
      render();
    });

    input.addEventListener("keydown", function (e) {
      if (list.style.display === "none") return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        cursor = Math.min(cursor + 1, items.length - 1);
        render();
        list.children[cursor] && list.children[cursor].scrollIntoView({ block: "nearest" });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        cursor = Math.max(cursor - 1, 0);
        render();
        list.children[cursor] && list.children[cursor].scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter") {
        if (cursor >= 0) {
          e.preventDefault();
          pick(cursor);
        } else {
          close();
        }
      } else if (e.key === "Escape") {
        close();
      }
    });

    input.addEventListener("blur", close);
  }

  /* Resolve typed text to a station record. Railway stations win an exact match
   * outright; a road stop is only considered while the checkbox asks for one, so
   * a bus stop left in the field from earlier stops being searchable the moment
   * "csak vasúti járat" is ticked again — the same rule the dropdown follows. */
  function resolveStation(text) {
    if (!text || !text.trim()) return null;
    var key = norm(text);
    var exact = stationIndex && stationIndex.get(key);
    if (exact) return exact;
    if (roadWanted() && roadIndex && roadIndex.has(key)) return roadIndex.get(key);
    var s = suggest(text, 1);
    return s.length ? s[0] : null;
  }

  // =================================================================== render

  function showError(msg) {
    var box = el("div", "figyutas");
    box.textContent = msg;
    var out = $("results");
    out.innerHTML = "";
    out.appendChild(box);
  }

  function showLoading() {
    var out = $("results");
    out.innerHTML = "";
    out.appendChild(el("div", "loading", t("searching")));
  }

  /** Route category pictogram + name, e.g. the InterCity glyph plus "IC SCARBANTIA". */
  function routeLabel(leg) {
    var span = el("span");
    var short = (leg.route && leg.route.shortName) || "";
    // OTP returns the category as an HTML fragment referencing the MNR2007 font.
    var m = /^<span class="MNR2007">&#(\d+);<\/span>$/.exec(short);
    if (m) {
      var glyph = el("span", "MNR2007", String.fromCharCode(Number(m[1])));
      span.appendChild(glyph);
      span.appendChild(document.createTextNode(" "));
    } else if (short && short.indexOf("<") === -1) {
      span.appendChild(document.createTextNode(short + " "));
    }
    var name = (leg.trip && leg.trip.tripShortName) || (leg.route && leg.route.longName) || "";
    var strong = el("span", "trainno", name);
    span.appendChild(strong);
    return span;
  }

  /**
   * A time cell. When realtime data says the train is off schedule, the planned
   * time is struck through in red and the predicted time is printed next to it.
   */
  function timeCell(actualMs, delaySec, realtime) {
    var frag = document.createDocumentFragment();
    if (realtime && delaySec) {
      var scheduled = actualMs - delaySec * 1000;
      frag.appendChild(el("span", "lateold", API.fmtClock(scheduled)));
      frag.appendChild(document.createTextNode(" "));
      frag.appendChild(el("span", "latenew", API.fmtClock(actualMs)));
    } else {
      frag.appendChild(document.createTextNode(API.fmtClock(actualMs)));
    }
    return frag;
  }

  function firstTransit(it) {
    return API.transitLegs(it)[0];
  }

  function lastTransit(it) {
    var t = API.transitLegs(it);
    return t[t.length - 1];
  }

  function totalKm(it) {
    var m = API.transitLegs(it).reduce(function (a, l) {
      return a + (l.distance || 0);
    }, 0);
    return Math.round(m / 1000);
  }

  function renderResults(itineraries, q) {
    var out = $("results");
    out.innerHTML = "";

    var top = el("div", "clear rtftop");
    top.appendChild(el("div", "lrtftop", q.fromName + " - " + q.toName));
    top.appendChild(
      el(
        "div",
        "rrtftop",
        LANG === "hu"
          ? prettyYmd(q.ymd) + ", " + weekdayName(q.ymd)
          : weekdayName(q.ymd) + ", " + prettyYmd(q.ymd),
      ),
    );
    top.appendChild(el("div", "clear"));
    out.appendChild(top);

    if (!itineraries.length) {
      var none = el("div", "figyutas");
      none.textContent =
        t("noResults");
      out.appendChild(none);
      out.appendChild(pager(q));
      return;
    }

    var wrap = el("div", "rtf");
    wrap.style.overflow = "auto";
    var tt = el("div", "timetable");
    tt.id = "timetable";

    var table = document.createElement("table");
    table.appendChild(buildHead());

    /* The table lists the whole day, so on today's date a single rule marks the
     * point the clock has already passed: everything above it has left. */
    var nowLineBefore = -1;
    if (q.ymd === todayYmd()) {
      var now = Date.now();
      nowLineBefore = itineraries.findIndex(function (it) {
        return API.transitLegs(it)[0].startTime >= now;
      });
      if (nowLineBefore === -1) nowLineBefore = itineraries.length; // whole day gone
    }

    var tbody = document.createElement("tbody");
    itineraries.forEach(function (it, idx) {
      if (idx === nowLineBefore) tbody.appendChild(buildNowLine());
      tbody.appendChild(buildRow(it, idx));
      tbody.appendChild(buildDetailRow(it, idx));
    });
    if (nowLineBefore === itineraries.length) tbody.appendChild(buildNowLine());
    table.appendChild(tbody);

    tt.appendChild(table);
    wrap.appendChild(tt);
    out.appendChild(wrap);
    out.appendChild(pager(q));
    out.appendChild(realtimeNote(itineraries));

    scrollToNowLine();
  }

  function buildNowLine() {
    var tr = el("tr", "nowline");
    tr.id = "nowline";
    var td = document.createElement("td");
    td.colSpan = 6;
    var bar = el("div", "nowbar");
    bar.appendChild(el("span", null, t("now") + " " + API.fmtClock(Date.now())));
    td.appendChild(bar);
    tr.appendChild(td);
    return tr;
  }

  /* Land the reader on the next departure rather than at half past midnight. */
  function scrollToNowLine() {
    var line = $("nowline");
    if (!line || !line.scrollIntoView) return;
    line.scrollIntoView({ block: "center" });
  }

  function buildHead() {
    var thead = document.createElement("thead");
    var tr = document.createElement("tr");

    var info = el("th", "info");
    info.setAttribute("align", "center");
    info.innerHTML = t("thDetails");
    tr.appendChild(info);

    [t("thDep"), t("thArr"), t("thChanges"), t("thDuration"), t("thKm")].forEach(
      function (t) {
        var th = document.createElement("th");
        th.innerHTML = t;
        tr.appendChild(th);
      },
    );
    thead.appendChild(tr);
    return thead;
  }

  function buildRow(it, idx) {
    var tr = document.createElement("tr");

    var a = firstTransit(it);
    var b = lastTransit(it);

    var info = el("td", "info");
    var btn = el("div", "morebutton");
    var link = el("a");
    link.href = "#";
    link.title = t("detailsTitle");
    var img = document.createElement("img");
    img.src = "assets/img/button01.gif";
    img.alt = t("moreAlt");
    link.appendChild(img);
    link.onclick = function (e) {
      e.preventDefault();
      toggleDetail(idx);
    };
    btn.appendChild(link);
    info.appendChild(btn);
    tr.appendChild(info);

    var dep = el("td", "l");
    dep.style.textAlign = "left";
    dep.appendChild(timeCell(a.startTime, a.departureDelay, a.realTime));
    dep.appendChild(document.createTextNode(" "));
    var depName = el("span", null, a.from.name);
    depName.style.fontSize = "80%";
    depName.style.whiteSpace = "nowrap";
    dep.appendChild(depName);
    tr.appendChild(dep);

    var arr = el("td", "l");
    arr.style.textAlign = "left";
    arr.appendChild(timeCell(b.endTime, b.arrivalDelay, b.realTime));
    arr.appendChild(document.createTextNode(" "));
    var arrName = el("span", null, b.to.name);
    arrName.style.fontSize = "80%";
    arrName.style.whiteSpace = "nowrap";
    arr.appendChild(arrName);
    tr.appendChild(arr);

    var changes = API.transitLegs(it).length - 1;
    tr.appendChild(el("td", null, changes === 0 ? "–" : String(changes)));

    tr.appendChild(el("td", null, API.fmtDuration((b.endTime - a.startTime) / 1000)));

    var km = el("td", "r", totalKm(it) + " km");
    tr.appendChild(km);

    return tr;
  }

  function buildDetailRow(it, idx) {
    var tr = el("tr", "det");
    tr.id = "det" + idx;
    var td = document.createElement("td");
    td.colSpan = 6;

    var more = el("div", "more");
    more.id = "more" + idx;

    var table = document.createElement("table");
    var tbody = document.createElement("tbody");

    API.transitLegs(it).forEach(function (leg, i) {
      /* The train's own name goes in the blue band, which then opens its block:
       * everything under one band belongs to that train, until the next band.
       * With the band below the name instead it read as a separator, leaving the
       * name looking like it belonged to whatever came before. */
      var head = document.createElement("tr");
      var th = el("th", "t");
      th.colSpan = 3;
      th.appendChild(routeLabel(leg));
      if (leg.trip && leg.trip.tripHeadsign) {
        var hs = el("span", null, "  → " + leg.trip.tripHeadsign);
        hs.style.fontWeight = "normal";
        hs.style.fontSize = "90%";
        th.appendChild(hs);
      }
      if (leg.mode === "BUS") {
        var bus = el("span", null, t("replacementBus"));
        bus.style.fontWeight = "normal";
        th.appendChild(bus);
      }
      if (leg.realTime) {
        /* The delay on arrival, not on departure. A train can leave punctually
         * and lose a quarter of an hour on the way — 2548 out of Nyugati did
         * exactly that — so a note taken from the departure would have read
         * "pontos" above stop rows showing nine minutes down. This is where the
         * passenger actually ends up. Arriving early counts as on time. */
        var d = leg.arrivalDelay || 0;
        var late = d > 0;
        var note = el(
          "span",
          late ? "latenew" : "ontime",
          "  " + (late ? API.fmtDelay(d) + t("late") : t("onTime")),
        );
        note.style.fontSize = "90%";
        th.appendChild(note);
      }
      head.appendChild(th);
      tbody.appendChild(head);

      /* Column names, directly under the band. Without them the two times were
       * told apart only by an "érk."/"ind." prefix on every single row, while
       * the table outside spends those same two words on something else. */
      var cols = el("tr", "cols");
      [
        ["thStation", "l"],
        ["thArr", "r"],
        ["thDep", "r"],
      ].forEach(function (c) {
        cols.appendChild(el("th", c[1], t(c[0])));
      });
      tbody.appendChild(cols);

      /* Every time here is already the live one, shifted by whatever delay the
       * train is carrying — but printed bare it was indistinguishable from the
       * timetable. Each stop now carries its own delay, marked exactly as the
       * table outside marks it: the scheduled time struck through in red, the
       * expected one beside it. A train can lose or make up minutes between
       * stops, so this is per stop, not per train. */
      var none = { at: null, delay: 0, realTime: false };
      var stops = [
        {
          name: leg.from.name,
          arr: none,
          dep: { at: leg.startTime, delay: leg.departureDelay || 0, realTime: !!leg.realTime },
        },
      ];
      (leg.intermediatePlaces || []).forEach(function (p) {
        stops.push({
          name: p.name,
          arr: API.stopTime(p, "arrival"),
          dep: API.stopTime(p, "departure"),
        });
      });
      stops.push({
        name: leg.to.name,
        arr: { at: leg.endTime, delay: leg.arrivalDelay || 0, realTime: !!leg.realTime },
        dep: none,
      });

      stops.forEach(function (s) {
        var row = document.createElement("tr");
        row.appendChild(el("td", "l", s.name));
        [s.arr, s.dep].forEach(function (x) {
          var td = el("td", "r");
          if (x.at != null) td.appendChild(timeCell(x.at, x.delay, x.realTime));
          row.appendChild(td);
        });
        tbody.appendChild(row);
      });

      if (i < API.transitLegs(it).length - 1) {
        var next = API.transitLegs(it)[i + 1];
        var gap = Math.round((next.startTime - leg.endTime) / 60000);
        var wait = document.createElement("tr");
        var wtd = el("td", "bottom", t("transferTime") + gap + t("minutes"));
        wtd.colSpan = 3;
        wait.appendChild(wtd);
        tbody.appendChild(wait);
      }
    });

    if (it.walkDistance > 20) {
      var w = document.createElement("tr");
      var wtd2 = el("td", "bottom", t("walkTotal") + Math.round(it.walkDistance) + " m");
      wtd2.colSpan = 3;
      w.appendChild(wtd2);
      tbody.appendChild(w);
    }

    table.appendChild(tbody);
    more.appendChild(table);
    td.appendChild(more);
    tr.appendChild(td);
    return tr;
  }

  function toggleDetail(idx) {
    var more = $("more" + idx);
    if (!more) return;
    more.style.display = more.style.display === "block" ? "none" : "block";
  }

  function realtimeNote(itineraries) {
    var any = itineraries.some(function (it) {
      return API.transitLegs(it).some(function (l) {
        return l.realTime;
      });
    });
    var p = el("div", "discl");
    p.textContent = any
      ? t("rtYes")
      : t("rtNo");
    return p;
  }

  function pager(q) {
    var box = el("div", "pager");

    // A search already covers the whole day, so paging moves by days.
    var earlier = document.createElement("input");
    earlier.type = "button";
    earlier.value = t("prevDay");
    earlier.disabled = shiftYmd(q.ymd, -1) < calMin;
    earlier.onclick = function () {
      runSearch(shiftQuery(q, -1));
    };

    var later = document.createElement("input");
    later.type = "button";
    later.value = t("nextDay");
    later.disabled = shiftYmd(q.ymd, 1) > calMax;
    later.onclick = function () {
      runSearch(shiftQuery(q, 1));
    };

    box.appendChild(earlier);
    box.appendChild(later);
    return box;
  }

  function shiftYmd(ymd, days) {
    var p = parseYmd(ymd);
    var d = new Date(Date.UTC(p.y, p.m, p.d + days));
    return (
      d.getUTCFullYear() +
      "-" +
      String(d.getUTCMonth() + 1).padStart(2, "0") +
      "-" +
      String(d.getUTCDate()).padStart(2, "0")
    );
  }

  function shiftQuery(q, days) {
    var next = Object.assign({}, q);
    next.ymd = shiftYmd(q.ymd, days);
    // Keep the calendar in step with what the table is showing.
    calState.selected = next.ymd;
    var p = parseYmd(next.ymd);
    calState.viewY = p.y;
    calState.viewM = p.m;
    drawCalendar();
    return next;
  }


  // ================================================================= language

  /* Swaps every tagged element in index.html, then redraws whatever is on screen.
   * The reduction dropdown carries MÁV's Hungarian wording inline; the English
   * wording for the same option values comes from js/reduction-en.js. */
  function applyStaticText() {
    document.documentElement.lang = LANG;
    document.title = t("docTitle");

    document.querySelectorAll("[data-i18n]").forEach(function (n) {
      var v = t(n.dataset.i18n);
      if (/[<&]/.test(v)) n.innerHTML = v;
      else n.textContent = v;
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach(function (n) {
      n.placeholder = t(n.dataset.i18nPlaceholder);
    });
    document.querySelectorAll("[data-i18n-title]").forEach(function (n) {
      n.title = t(n.dataset.i18nTitle);
    });
    document.querySelectorAll("[data-i18n-value]").forEach(function (n) {
      n.value = t(n.dataset.i18nValue);
    });

    var discl = $("discl");
    if (discl) discl.innerHTML = t("disclaimer");

    applyReductionText();
    markActiveLanguage();
  }

  /* Remember the Hungarian wording on first use, so switching back needs no
   * second copy of the list in the source. */
  function applyReductionText() {
    var sel = $("u");
    if (!sel) return;
    var en = window.ELVIRA_REDUCTION_EN;

    Array.prototype.forEach.call(sel.querySelectorAll("option"), function (o) {
      if (o.dataset.hu === undefined) o.dataset.hu = o.textContent;
      var text = LANG === "en" && en && en.options[o.value];
      o.textContent = text || o.dataset.hu;
    });
    Array.prototype.forEach.call(sel.querySelectorAll("optgroup"), function (g) {
      if (g.dataset.hu === undefined) g.dataset.hu = g.label;
      var text = LANG === "en" && en && en.groups[g.id];
      g.label = text || g.dataset.hu;
    });
  }

  function markActiveLanguage() {
    [["hu", "lang-hu"], ["en", "lang-en"]].forEach(function (pair) {
      var a = $(pair[1]);
      if (!a) return;
      a.style.textDecoration = LANG === pair[0] ? "underline" : "none";
    });
  }

  function setLang(lang) {
    if (lang !== "hu" && lang !== "en") return;
    LANG = lang;
    try {
      localStorage.setItem("elvira-lang", lang);
    } catch (e) {
      /* private mode; the choice just will not stick */
    }
    applyStaticText();
    drawCalendar();
    if (lastResults) renderResults(lastResults, lastQuery);
  }

  // =================================================================== search

  function collectQuery() {
    var from = resolveStation($("i").value);
    if (!from) throw new Error(t("noFrom") + ($("i").value || t("empty")));
    var to = resolveStation($("e").value);
    if (!to) throw new Error(t("noTo") + ($("e").value || t("empty")));

    var viaText = $("v").value.trim();
    var via = null;
    if (viaText) {
      via = resolveStation(viaText);
      if (!via) throw new Error(t("noViaSt") + viaText);
    }

    return {
      from: from,
      to: to,
      via: via,
      fromName: from.n,
      toName: to.n,
      ymd: calState.selected,
      filters: {
        noChange: $("sk").checked,
        noBus: $("nb").checked,
        railOnly: $("csv").checked,
      },
    };
  }

  function runSearch(q) {
    lastQuery = q;
    showLoading();
    API.search(q)
      .then(function (rows) {
        /* An empty result from a station the planner cannot even locate is not
         * "no train today" — it is a station it will never plan to. Say which,
         * rather than leaving the user to try other dates forever. */
        var out = API.unreachable();
        if (!rows.length && (out.from || out.to)) {
          var which = out.from && out.to ? q.fromName + " / " + q.toName : out.from ? q.fromName : q.toName;
          showError(t("outsideNetwork").replace("%s", which));
          return;
        }
        lastResults = rows;
        renderResults(rows, q);
      })
      .catch(function (err) {
        showError(t("queryError") + err.message);
      });
  }

  // ===================================================================== init

  function init() {
    try {
      LANG = localStorage.getItem("elvira-lang") || "hu";
    } catch (e) {
      LANG = "hu";
    }
    applyStaticText();

    $("lang-hu").onclick = function (e) {
      e.preventDefault();
      setLang("hu");
    };
    $("lang-en").onclick = function (e) {
      e.preventDefault();
      setLang("en");
    };

    $("verzio-date").textContent = prettyYmd(todayYmd());

    if (!API.isConfigured()) {
      showError(t("proxyError"));
    }

    calState.selected = todayYmd();
    initCalendar();

    attachAutocomplete("i", "ac-i");
    attachAutocomplete("e", "ac-e");
    attachAutocomplete("v", "ac-v");

    $("goback").onclick = function () {
      var a = $("i").value;
      $("i").value = $("e").value;
      $("e").value = a;
      if (lastQuery) $("uff").dispatchEvent(new Event("submit", { cancelable: true }));
    };

    $("uff").addEventListener("submit", function (e) {
      e.preventDefault();
      try {
        runSearch(collectQuery());
      } catch (err) {
        showError(err.message);
      }
    });

    /* Buses are opt-in. The stop list is fetched the moment the box is cleared,
     * not on submit, so the names are already there while the user is typing.
     * The check on load covers a browser restoring the box unticked on reload. */
    $("csv").addEventListener("change", function () {
      if (!this.checked) loadRoadStations();
    });

    loadStations().then(function () {
      if (roadWanted()) loadRoadStations();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
