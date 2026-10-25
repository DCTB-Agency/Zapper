"""Streamingdiensten: wat er nieuw is, wat binnenkort komt en wat populair is.

Bron: JustWatch (onofficiële GraphQL-API van justwatch.com, land België). Schrijft
web/data/streaming.json met per titel de dienst en de datum waarop hij online kwam
(of komt).

- Nieuw: de dag waarop een titel online kwam op Netflix, Disney+, Prime Video, ...
  Voor diensten waarvoor JustWatch dat niet bijhoudt (VTM GO, Streamz)
  vergelijken we met de vorige run: wat er nog niet was, is nieuw van vandaag.
  Die lijst staat in .cache/streaming-gezien.json (in Actions bewaard met actions/cache).
- Binnenkort: titels met een aangekondigde datum.
- Populair: de top per dienst.
- Zoeken: web/data/streaming-zoek.json met de populairste titels per dienst (alleen titel,
  jaar, diensten, poster), zodat je in de app ook oudere titels vindt.

    python3 streaming.py
"""
import datetime as dt
import json
import sys
import time
import urllib.request
from pathlib import Path
from zoneinfo import ZoneInfo

API = "https://apis.justwatch.com/graphql"
TZ = ZoneInfo("Europe/Brussels")
HIER = Path(__file__).resolve().parent
UIT = HIER / "web" / "data" / "streaming.json"
ZOEK = HIER / "web" / "data" / "streaming-zoek.json"   # klein zoekregister, alleen geladen als je zoekt
GEZIEN = HIER / ".cache" / "streaming-gezien.json"
DAGEN_TERUG = 21      # hoeveel dagen "nieuw" we tonen
POPULAIR = 40         # titels per dienst in "populair"
ZOEK_PER_DIENST = 500  # zoekregister: de populairste titels per dienst
MAX_NIEUW = 80        # per dienst: Prime Video en Crunchyroll zetten honderden titels per maand online

# JustWatch-code → naam in de app. De volgorde is de volgorde in de app.
DIENSTEN = {
    "nfx": "Netflix", "dnp": "Disney+", "prv": "Prime Video", "mxx": "HBO Max", "atp": "Apple TV+",
    "vrt": "VRT MAX", "vtm": "VTM GO",
    "tel": "Streamz",  # JustWatch noemt dit pakket "Telenet"; daar staat de Streamz-catalogus (links naar telenet.tv)
    "hay": "Hayu", "cru": "Crunchyroll", "mbi": "MUBI",
}
ABONNEMENT = ["FLATRATE", "FREE", "ADS"]  # geen huur of aankoop

# JustWatch-genre → (naam in de app, thema-id's uit web/themas.json)
GENRES = {
    "act": ("Actie", ["spanning"]), "ani": ("Animatie", ["kids"]), "cmy": ("Komedie", ["humor"]),
    "crm": ("Misdaad", ["misdaad"]), "doc": ("Documentaire", ["docu"]), "drm": ("Drama", ["drama"]),
    "fml": ("Familie", ["kids"]), "fnt": ("Fantasy", ["scifi"]), "hrr": ("Horror", ["horror"]),
    "hst": ("Historisch", ["historisch"]), "msc": ("Muziek", ["muziek"]), "rly": ("Reality", ["reality", "show"]),
    "rma": ("Romantiek", ["romantiek"]), "scf": ("Sciencefiction", ["scifi"]), "spt": ("Sport", ["sport"]),
    "trl": ("Thriller", ["thriller"]), "war": ("Oorlog", ["historisch"]), "wsn": ("Western", ["spanning"]),
}

INHOUD = """title shortDescription originalReleaseYear posterUrl fullPath runtime ageCertification
  genres { shortName } scoring { imdbScore }"""
LINKS = "offers(country: BE, platform: WEB) { package { shortName } standardWebURL }"  # rechtstreekse link per dienst
FILM = f"""... on Movie {{ {LINKS} content(country: BE, language: "nl") {{ {INHOUD}
    upcomingReleases(releaseTypes: [DIGITAL]) {{ releaseDate package {{ shortName }} }} }} }}"""
NODE_POP = f"""id objectType {FILM}
  ... on Show {{ {LINKS} content(country: BE, language: "nl") {{ {INHOUD} }} }}"""
NODE = f"""id objectType {FILM}
  ... on Season {{ {LINKS} content(country: BE, language: "nl") {{ seasonNumber
    upcomingReleases(releaseTypes: [DIGITAL]) {{ releaseDate package {{ shortName }} }} }}
    show {{ id {LINKS} content(country: BE, language: "nl") {{ {INHOUD} }} }} }}"""

Q_NIEUW = f"""query($d: Date!, $pt: NewPageType!, $p: [String!], $na: String) {{
  newTitles(country: BE, date: $d, first: 100, after: $na, priceDrops: false, pageType: $pt,
            filter: {{ packages: $p, monetizationTypes: [{", ".join(ABONNEMENT)}] }}) {{
    edges {{ newOffer(platform: WEB) {{ package {{ shortName }} }} node {{ {NODE} }} }}
    pageInfo {{ hasNextPage endCursor }} }} }}"""

Q_POP = f"""query($p: [String!], $n: Int!, $na: String) {{
  popularTitles(country: BE, first: $n, after: $na,
                filter: {{ packages: $p, monetizationTypes: [{", ".join(ABONNEMENT)}] }}) {{
    totalCount edges {{ node {{ {NODE_POP} }} }}
    pageInfo {{ hasNextPage endCursor }} }} }}"""


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def vraag(query, **var):
    body = json.dumps({"query": query, "variables": var}).encode()
    req = urllib.request.Request(API, data=body, headers={"Content-Type": "application/json", "User-Agent": "zapper/1.0"})
    for poging in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                d = json.loads(r.read())
            if d.get("errors"):
                raise RuntimeError(d["errors"][0].get("message"))
            time.sleep(0.3)  # rustig aan voor de bron
            return d["data"]
        except Exception as e:
            if poging == 2:
                raise
            log("  opnieuw:", e)
            time.sleep(2 + poging * 3)


def alle_paginas(query, sleutel, max_paginas=20, **var):
    na, uit = None, []
    for _ in range(max_paginas):
        d = vraag(query, na=na, **var)[sleutel]
        uit += d["edges"]
        if not d["pageInfo"]["hasNextPage"]:
            break
        na = d["pageInfo"]["endCursor"]
    return uit


def kort(tekst, max_=240):
    return tekst if len(tekst) <= max_ else tekst[:max_].rsplit(" ", 1)[0] + "…"


def titel(node):
    """JustWatch-node → compacte titel voor de app. Een seizoen wordt de reeks + seizoennummer."""
    c = node.get("content") or {}
    if node["objectType"] == "SHOW_SEASON":
        reeks = (node.get("show") or {})
        hoofd, sid, se = reeks.get("content") or {}, reeks.get("id"), c.get("seasonNumber")
    else:
        hoofd, sid, se = c, node["id"], None
    if not hoofd.get("title"):
        return None
    film = node["objectType"] == "MOVIE"
    codes = [g["shortName"] for g in hoofd.get("genres") or [] if g["shortName"] in GENRES]
    themas = sorted({t for g in codes for t in GENRES[g][1]} | {"film" if film else "series"})
    poster = hoofd.get("posterUrl")
    # Link naar de titel op de dienst zelf (netflix.com/title/...), per dienst; de reekspagina gaat voor het seizoen.
    links = {}
    for bron in ((node.get("show") or {}).get("offers"), node.get("offers")):
        for o in bron or []:
            code = (o.get("package") or {}).get("shortName")
            if code in DIENSTEN and o.get("standardWebURL") and code not in links:
                links[code] = o["standardWebURL"]
    return {
        "id": sid,
        "t": hoofd["title"],
        "soort": "film" if film else "reeks",
        "se": se,
        "j": hoofd.get("originalReleaseYear"),
        "d": kort((hoofd.get("shortDescription") or "").strip()),
        "g": [GENRES[g][0] for g in codes],
        "th": themas,
        "min": hoofd.get("runtime") if film else None,
        "imdb": (hoofd.get("scoring") or {}).get("imdbScore"),
        "leeftijd": hoofd.get("ageCertification"),
        "poster": "https://images.justwatch.com" + poster.replace("{profile}", "s332").replace("{format}", "webp") if poster else None,
        "url": "https://www.justwatch.com" + hoofd["fullPath"] if hoofd.get("fullPath") else None,
        "w": links,
    }


def main():
    vandaag = dt.datetime.now(TZ).date()
    codes = list(DIENSTEN)
    titels, items = {}, []   # titels: id → info; items: (soort, dienst, datum, id, seizoen)

    def bewaar(node, soort, dienst, datum):
        t = titel(node)
        if not t or dienst not in DIENSTEN:
            return
        bestaand = titels.setdefault(t["id"], {k: v for k, v in t.items() if k != "se"})
        for code, url in t["w"].items():
            bestaand["w"].setdefault(code, url)
        items.append({"soort": soort, "dienst": dienst, "datum": datum, "id": t["id"], "se": t["se"]})

    log(f"Nieuw: {DAGEN_TERUG} dagen terug")
    met_datum = set()  # diensten waarvoor JustWatch echt datums bijhoudt
    for i in range(DAGEN_TERUG):
        dag = (vandaag - dt.timedelta(days=i)).isoformat()
        for e in alle_paginas(Q_NIEUW, "newTitles", d=dag, pt="NEW", p=codes):
            dienst = ((e.get("newOffer") or {}).get("package") or {}).get("shortName")
            met_datum.add(dienst)
            bewaar(e["node"], "nieuw", dienst, dag)

    log("Binnenkort")
    for e in alle_paginas(Q_NIEUW, "newTitles", d=vandaag.isoformat(), pt="UPCOMING", p=codes):
        n = e["node"]
        for r in (n.get("content") or {}).get("upcomingReleases") or []:
            if r.get("releaseDate") and r["releaseDate"] >= vandaag.isoformat():
                bewaar(n, "binnenkort", (r.get("package") or {}).get("shortName"), r["releaseDate"])

    log("Populair per dienst")
    gezien = json.loads(GEZIEN.read_text()) if GEZIEN.exists() else {}
    register = {}  # id → zoekrij

    def registreer(node, code):
        t = titel(node)
        if not t:
            return
        r = register.setdefault(t["id"], {"i": t["id"], "t": t["t"], "s": "f" if t["soort"] == "film" else "r",
                                          "j": t["j"], "p": t["poster"], "u": t["url"], "d": [], "w": {}})
        r["nu"] = True  # populair = nu te zien
        if code not in r["d"]:
            r["d"].append(code)
        for c, url in t["w"].items():
            r["w"].setdefault(c, url)

    for code in codes:
        try:
            pop = vraag(Q_POP, p=[code], n=POPULAIR, na=None)["popularTitles"]
        except Exception as e:
            log(f"  {code}: {e}")
            continue
        for e in pop["edges"]:
            bewaar(e["node"], "populair", code, None)
        try:
            for e in alle_paginas(Q_POP, "popularTitles", max_paginas=ZOEK_PER_DIENST // 100, p=[code], n=100):
                registreer(e["node"], code)
        except Exception as e:
            log(f"  zoekregister {code}: {e}")
        # Diensten zonder datums bij JustWatch: zelf bijhouden wat er nieuw bijkomt.
        if code in met_datum or pop["totalCount"] > 3000:
            continue
        nu = {e["node"]["id"]: e["node"] for e in alle_paginas(Q_POP, "popularTitles", p=[code], n=100)}
        oud = gezien.get(code)
        if oud is not None:
            for nid in set(nu) - set(oud):
                bewaar(nu[nid], "nieuw", code, vandaag.isoformat())
            # wat eerder als nieuw gemarkeerd werd, blijft DAGEN_TERUG dagen staan
            for nid, dag in (gezien.get(code + ":nieuw") or {}).items():
                if nid in nu and dag >= (vandaag - dt.timedelta(days=DAGEN_TERUG)).isoformat() and dag != vandaag.isoformat():
                    bewaar(nu[nid], "nieuw", code, dag)
        nieuw_log = {k: v for k, v in (gezien.get(code + ":nieuw") or {}).items() if k in nu}
        if oud is not None:
            nieuw_log.update({nid: vandaag.isoformat() for nid in set(nu) - set(oud)})
        gezien[code], gezien[code + ":nieuw"] = sorted(nu), nieuw_log
        log(f"  {code}: {len(nu)} titels, {len(set(nu) - set(oud or nu))} nieuw")

    # Dubbels weg (zelfde titel, dienst, soort en seizoen), recentste eerst.
    uniek, rijen, per_dienst = set(), [], {}
    for it in sorted(items, key=lambda x: x["datum"] or "", reverse=True):
        k = (it["soort"], it["dienst"], it["id"], it["se"])
        if k in uniek:
            continue
        if it["soort"] == "nieuw":
            per_dienst[it["dienst"]] = per_dienst.get(it["dienst"], 0) + 1
            if per_dienst[it["dienst"]] > MAX_NIEUW:
                continue
        uniek.add(k)
        rijen.append({k: v for k, v in it.items() if v is not None})
    gebruikt = {r["id"] for r in rijen}
    titels = {k: v for k, v in titels.items() if k in gebruikt}

    UIT.parent.mkdir(parents=True, exist_ok=True)
    UIT.write_text(json.dumps({
        "bijgewerkt": dt.datetime.now(TZ).isoformat(timespec="minutes"),
        "diensten": [{"id": k, "naam": v, "datums": k in met_datum} for k, v in DIENSTEN.items()],
        "titels": {k: {a: b for a, b in v.items() if b not in (None, "", [])} for k, v in titels.items()},
        "items": rijen,
    }, ensure_ascii=False, separators=(",", ":")))
    # Alles wat in het overzicht staat, moet je ook kunnen vinden.
    for it in rijen:
        t = titels.get(it["id"])
        if t:
            r = register.setdefault(it["id"], {"i": it["id"], "t": t["t"], "s": "f" if t["soort"] == "film" else "r",
                                               "j": t.get("j"), "p": t.get("poster"), "u": t.get("url"), "d": [], "w": {}})
            if it["dienst"] not in r["d"]:
                r["d"].append(it["dienst"])
            for c, url in (t.get("w") or {}).items():
                r["w"].setdefault(c, url)
            if it["soort"] == "binnenkort":
                r["k"] = min(r.get("k") or it["datum"], it["datum"])  # nog niet te zien: vanaf deze datum
            else:
                r["nu"] = True
    for r in register.values():  # korter: de app zet de domeinnaam er weer voor
        if r.pop("nu", False):
            r.pop("k", None)
        r["p"] = (r["p"] or "").replace("https://images.justwatch.com", "")
        r["u"] = (r["u"] or "").replace("https://www.justwatch.com", "")
    ZOEK.write_text(json.dumps([{k: v for k, v in r.items() if v not in (None, "", [])} for r in register.values()],
                               ensure_ascii=False, separators=(",", ":")))
    log(f"Zoekregister: {len(register)} titels ({ZOEK.stat().st_size // 1024} kB)")
    GEZIEN.parent.mkdir(parents=True, exist_ok=True)
    GEZIEN.write_text(json.dumps(gezien))
    tel = {s: sum(1 for r in rijen if r["soort"] == s) for s in ("nieuw", "binnenkort", "populair")}
    log(f"Klaar: {len(titels)} titels, {tel} → {UIT.relative_to(HIER)} ({UIT.stat().st_size // 1024} kB)")


if __name__ == "__main__":
    main()
