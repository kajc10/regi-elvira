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
    return fetch("data/stations.json")
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
          var k = norm(s.n);
          if (!stationIndex.has(k)) stationIndex.set(k, s);
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

  function suggest(term, limit) {
    var q = norm(term);
    if (q.length < 2) return [];
    var starts = [];
    var contains = [];
    for (var i = 0; i < stations.length; i++) {
      var n = norm(stations[i].n);
      var at = n.indexOf(q);
      if (at === 0) starts.push(stations[i]);
      else if (at > 0) contains.push(stations[i]);
      if (starts.length >= limit) break;
    }
    return starts.concat(contains).slice(0, limit);
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

    function highlight(name, term) {
      var n = norm(name);
      var at = n.indexOf(norm(term));
      if (at < 0) return document.createTextNode(name);
      var frag = document.createDocumentFragment();
      frag.appendChild(document.createTextNode(name.slice(0, at)));
      frag.appendChild(el("span", "m", name.slice(at, at + term.length)));
      frag.appendChild(document.createTextNode(name.slice(at + term.length)));
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

  /** Resolve typed text to a station record. */
  function resolveStation(text) {
    if (!text || !text.trim()) return null;
    var exact = stationIndex && stationIndex.get(norm(text));
    if (exact) return exact;
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
    img.src = "img/button01.gif";
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
      var head = document.createElement("tr");
      var th = document.createElement("th");
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
        var d = leg.departureDelay || 0;
        var note = el(
          "span",
          d ? "latenew" : "ontime",
          "  " + (d ? API.fmtDelay(d) + t("late") : t("onTime")),
        );
        note.style.fontSize = "90%";
        th.appendChild(note);
      }
      head.appendChild(th);
      tbody.appendChild(head);

      var stops = [{ name: leg.from.name, arr: null, dep: leg.startTime }];
      (leg.intermediatePlaces || []).forEach(function (p) {
        stops.push({ name: p.name, arr: p.arrivalTime, dep: p.departureTime });
      });
      stops.push({ name: leg.to.name, arr: leg.endTime, dep: null });

      stops.forEach(function (s) {
        var row = document.createElement("tr");
        row.appendChild(el("td", "l", s.name));
        row.appendChild(
          el("td", "r", s.arr == null ? "" : t("arrShort") + API.fmtClock(s.arr)),
        );
        row.appendChild(
          el("td", "r", s.dep == null ? "" : t("depShort") + API.fmtClock(s.dep)),
        );
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

    loadStations();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
