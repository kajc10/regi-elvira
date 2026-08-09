/* Page text in both languages.
 *
 * Hungarian is the default, because that is what ELVIRA was. The English wording
 * is not a translation of mine — it is what MÁV itself put on the English edition
 * of the same page, taken from the archive.
 *
 * Keys marked in index.html with data-i18n / -placeholder / -title / -value are
 * swapped wholesale when the language changes; anything drawn at runtime goes
 * through t() in elvira.js.
 */

var ELVIRA_I18N = {
  hu: {
    // Must match the <title> in index.html: applyStaticText() rewrites it on load,
    // so a mismatch would silently throw the page's own title away.
    docTitle: "Régi ELVIRA – vasúti menetrend és útvonaltervező",
    wordmark: "régi ELVIRA",
    wordmarkSub: "nosztalgia menetrend",
    banner: "nosztalgia kiadás<br>nem hivatalos oldal",
    route: "Honnan, hova",
    from: "Honnan:",
    to: "Hova:",
    via: "Érintve:",
    fromPh: "induló állomás?",
    toPh: "célállomás?",
    viaTitle: "Egy köztes állomás adható meg",
    when: "Mikor",
    reduction: "Kedvezmény",
    domesticOnly: " (csak belföldi utazásnál)",
    reductionTitle: "A nyilvános adatforrás nem tartalmaz díjszabást – korhű dísz.",
    searchOptions: "Keresési feltételek",
    noChange: "átszállás nélkül",
    noBus: "pótlóbusz nélkül",
    noBusTitle: "A vonatpótló autóbuszos szakaszokat is tartalmazó eljutások elhagyása",
    railOnly: "csak vasúti járat",
    railOnlyTitle:
      "Csak MÁV és GYSEV vonatok (és vonatpótlóik). Kikapcsolva a BKK, Volán és a helyi járatok is szerepelnek.",
    submit: "Menetrend",
    back: "Visszaút",
    source: "Forráskód",
    official: "MÁVPlusz (hivatalos)",
    tickets: "Jegyvásárlás",
    edition: "nosztalgia kiadás",
    disclaimer:
      "Nosztalgiából készült magánprojekt. <strong>Nem hivatalos oldal</strong>, semmilyen " +
      "kapcsolatban nem áll a MÁV-START Zrt.-vel. Az adatok a MÁVPlusz nyilvános " +
      "felületéről származnak; kötelező érvényű információért a " +
      '<a href="https://mavplusz.hu/">hivatalos oldalt</a> használja.',

    searching: "Keresés folyamatban…",
    noResults:
      "Ezen a napon nem található eljutási lehetőség a megadott feltételekkel. " +
      "Próbáljon másik napot, vagy kapcsolja ki a keresési feltételeket.",
    stationsError:
      "Az állomáslistát nem sikerült betölteni (data/stations.json). " +
      "Futtassa: node tools/build-stations.mjs",
    proxyError:
      "Az adatlekérő proxy nincs beállítva. Nyissa meg a js/api.js fájlt, és írja be " +
      "a saját proxy címét az API_URL változóba (lásd proxy/README.md).",
    queryError: "Hiba a menetrendi adatok lekérdezésekor: ",
    noFrom: "Nincs ilyen induló állomás: ",
    noTo: "Nincs ilyen célállomás: ",
    noViaSt: "Nincs ilyen érintett állomás: ",
    empty: "(üres)",

    thDetails: "Rész-<br>le-<br>tek",
    thDep: "Indulás",
    thArr: "Érkezés",
    thChanges: "Át-<br>szál-<br>lás",
    thDuration: "Idő-<br>tartam",
    thKm: "Összes<br>km",
    detailsTitle: "Részletesen",
    moreAlt: "Bővebb információ",
    now: "most",
    prevDay: "<<< előző nap",
    nextDay: "következő nap >>>",
    arrShort: "érk. ",
    depShort: "ind. ",
    transferTime: "átszállási idő: ",
    minutes: " perc",
    walkTotal: "gyaloglás összesen: ",
    late: " késés",
    onTime: "pontos",
    replacementBus: "  (vonatpótló autóbusz)",
    rtYes:
      "A piros áthúzott időpont a menetrend szerinti, mellette a késés alapján várható " +
      "időpont. Az adatok a MÁVPlusz valós idejű adatfolyamából származnak.",
    rtNo:
      "Ehhez a kereséshez még nincs valós idejű adat – a MÁV csak a hamarosan induló " +
      "vonatok késését teszi közzé, ezért itt a menetrend szerinti időpontok láthatók.",

    months: ["január", "február", "március", "április", "május", "június",
             "július", "augusztus", "szeptember", "október", "november", "december"],
    weekdays: ["h", "k", "sze", "cs", "p", "szo", "v"],
    weekdaysLong: ["hétfő", "kedd", "szerda", "csütörtök", "péntek", "szombat", "vasárnap"],
  },

  en: {
    docTitle: "Régi ELVIRA – Hungarian train timetable and journey planner",
    wordmark: "régi ELVIRA",
    wordmarkSub: "nostalgia timetable",
    banner: "nostalgia edition<br>unofficial site",
    route: "Route",
    from: "From:",
    to: "To:",
    via: "Via:",
    fromPh: "From?",
    toPh: "Destination?",
    viaTitle: "One intermediate station",
    when: "Date",
    reduction: "Reduction",
    domesticOnly: " (for domestic journeys only)",
    reductionTitle: "The public data source carries no fares – period-correct decoration.",
    searchOptions: "Search Options",
    noChange: "direct connections only",
    noBus: "no replacement bus",
    noBusTitle: "Hide journeys that include a rail replacement bus section",
    railOnly: "rail services only",
    railOnlyTitle:
      "MÁV and GYSEV trains only (plus their replacement coaches). Unchecked, BKK, Volán and local services are included too.",
    submit: "Timetable",
    back: "Return trip",
    source: "Source code",
    official: "MÁVPlusz (official)",
    tickets: "Tickets",
    edition: "nostalgia edition",
    disclaimer:
      "A personal nostalgia project. <strong>Unofficial site</strong>, not affiliated with " +
      "MÁV-START Zrt. Data comes from the public MÁVPlusz interface; for anything " +
      'binding, use the <a href="https://mavplusz.hu/">official site</a>.',

    searching: "Searching…",
    noResults:
      "No connection found on this day with the selected options. " +
      "Try another day, or clear the search options.",
    stationsError:
      "Could not load the station list (data/stations.json). " +
      "Run: node tools/build-stations.mjs",
    proxyError:
      "The data proxy is not configured. Open js/api.js and set API_URL to your own " +
      "proxy address (see proxy/README.md).",
    queryError: "Could not fetch timetable data: ",
    noFrom: "No such departure station: ",
    noTo: "No such destination: ",
    noViaSt: "No such via station: ",
    empty: "(empty)",

    thDetails: "De-<br>tails",
    thDep: "Departure",
    thArr: "Arrival",
    thChanges: "Chan-<br>ges",
    thDuration: "Dura-<br>tion",
    thKm: "Total<br>km",
    detailsTitle: "Details",
    moreAlt: "More information",
    now: "now",
    prevDay: "<<< previous day",
    nextDay: "next day >>>",
    arrShort: "arr. ",
    depShort: "dep. ",
    transferTime: "transfer time: ",
    minutes: " min",
    walkTotal: "walking in total: ",
    late: " late",
    onTime: "on time",
    replacementBus: "  (rail replacement bus)",
    rtYes:
      "A struck-through red time is the scheduled one; the time beside it is the " +
      "prediction based on the current delay. Live data from MÁVPlusz.",
    rtNo:
      "No live data for this search yet – MÁV only publishes delays for trains departing " +
      "soon, so these are scheduled times.",

    months: ["January", "February", "March", "April", "May", "June",
             "July", "August", "September", "October", "November", "December"],
    weekdays: ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"],
    weekdaysLong: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
  },
};
