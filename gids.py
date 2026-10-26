"""Telenet-gids ophalen.

Haalt de zenders van het Telenet-basisaanbod op en de programma's van vandaag
plus de komende dagen, en schrijft ze als statische JSON naar web/data/:

    web/data/index.json            zenders, beschikbare dagen, tijdstip
    web/data/dag-JJJJ-MM-DD.json   programma's van één tv-dag (06u-06u)

Programma's die 's avonds starten (17u-01u) krijgen details (beschrijving,
genre, cast). Die worden in .cache/details.json bewaard, zodat ze maar één keer
opgehaald worden.

    python3 gids.py                  # regio Antwerpen, 8 dagen
    python3 gids.py --stad 28001     # andere regio (postcode + 01)
"""
import argparse
import datetime as dt
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from zoneinfo import ZoneInfo

API = "https://spark-prod-be.gnp.cloud.telenet.tv/eng/web"
TZ = ZoneInfo("Europe/Brussels")
UTC = dt.timezone.utc
BASIS = "400000012"  # entitlement van het Telenet-basisaanbod
HIER = Path(__file__).resolve().parent
UIT = HIER / "web" / "data"
CACHE = HIER / ".cache" / "details.json"
AVOND_VAN, AVOND_TOT = 17, 25  # details voor programma's die starten tussen 17u en 01u


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def get(url):
    """JSON ophalen; bij een tijdelijke storing (verbinding verbroken, time-out) tot 3 keer opnieuw proberen."""
    req = urllib.request.Request(url, headers={"User-Agent": "telenet-tvgids/1.0"})
    for poging in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code < 500 or poging == 2:
                raise
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            if poging == 2:
                raise
        log(f"  opnieuw ({poging + 1}): {url[-60:]}")
        time.sleep(2 + 3 * poging)


def zenders(stad):
    alle = get(f"{API}/linear-service/v2/channels?cityId={stad}&language=nl&productClass=Orion-DASH")
    basis = [
        c for c in alle
        if BASIS in c.get("linearProducts", [])
        and not c.get("isRadio") and not c.get("isAdult") and not c.get("isHidden")
    ]
    return sorted(basis, key=lambda c: c.get("logicalChannelNumber", 9999))


def details(event_id):
    q = urllib.parse.quote(event_id, safe="~:,")
    try:
        d = get(f"{API}/linear-service/v2/replayEvent/{q}?returnLinearContent=true&language=nl")
    except Exception:
        return None
    return {
        "d": d.get("longDescription") or d.get("shortDescription") or "",
        "g": d.get("genres") or [],
        "se": d.get("seasonNumber"),
        "ep": d.get("episodeNumber"),
        "en": d.get("episodeName") or "",
        "j": d.get("productionDate") or "",
        "land": d.get("countryOfOrigin") or "",
        "cast": (d.get("actors") or [])[:5],
    }


TAAL_UITZONDERING = {"france24": "fr", "bbcfirst": "nl", "horse": "en"}


def zender_taal(n, zid):
    """Taal die je nodig hebt om de zender te volgen (Vlaamse zenders ondertitelen in het Nederlands)."""
    if zid in TAAL_UITZONDERING:
        return TAAL_UITZONDERING[zid]
    if n < 120 or 200 <= n < 400:
        return "nl"   # Vlaams, NPO, sport, docu
    if n < 130 or n >= 400:
        return "en"   # BBC en internationale nieuwszenders
    if n < 170:
        return "fr"
    if n < 180:
        return "de"
    return "andere"   # Rai, TVE, TRT, TVP, Mediaset, 2M, ...


def tv_dag(ts):
    """Een tv-dag loopt van 06u tot 06u."""
    return (dt.datetime.fromtimestamp(ts, TZ) - dt.timedelta(hours=6)).date()


def is_avond(ts):
    t = dt.datetime.fromtimestamp(ts, TZ)
    uur = t.hour if t.hour >= 6 else t.hour + 24
    return AVOND_VAN <= uur < AVOND_TOT


def vernieuw(stad, dagen):
    log(f"Zenders ophalen (regio {stad})…")
    kanalen = zenders(stad)
    ids = {c["id"] for c in kanalen}

    nu = dt.datetime.now(TZ)
    eerste = tv_dag(nu.timestamp())
    start = dt.datetime.combine(eerste, dt.time(6), TZ)
    einde = start + dt.timedelta(days=dagen)
    t = start.astimezone(UTC).replace(minute=0, second=0, microsecond=0)
    t = t.replace(hour=t.hour - t.hour % 6)
    segs = []
    while t < einde:
        segs.append(t.strftime("%Y%m%d%H%M%S"))
        t += dt.timedelta(hours=6)

    log(f"{len(segs)} programmablokken ophalen…")
    events = {}
    with ThreadPoolExecutor(max_workers=6) as pool:
        for blok in pool.map(lambda s: get(f"{API}/epg-service-lite/be/nl/events/segments/{s}"), segs):
            for entry in blok.get("entries", []):
                if entry["channelId"] not in ids:
                    continue
                for ev in entry["events"]:
                    if start.timestamp() <= ev["startTime"] < einde.timestamp():
                        events[ev["id"]] = dict(ev, channelId=entry["channelId"])

    try:
        cache = json.loads(CACHE.read_text())
    except Exception:
        cache = {}
    nodig = [i for i, ev in events.items() if i not in cache and is_avond(ev["startTime"])]
    log(f"{len(events)} programma's; details ophalen voor {len(nodig)} nieuwe avondprogramma's…")
    with ThreadPoolExecutor(max_workers=8) as pool:
        for n, (i, d) in enumerate(zip(nodig, pool.map(details, nodig)), 1):
            if d is not None:
                cache[i] = d
            if n % 500 == 0:
                log(f"  {n}/{len(nodig)}")
    cache = {i: d for i, d in cache.items() if i in events}
    CACHE.parent.mkdir(exist_ok=True)
    CACHE.write_text(json.dumps(cache, ensure_ascii=False))

    per_dag = {}
    for i, ev in events.items():
        d = cache.get(i, {})
        p = {
            "c": ev["channelId"],
            "t": ev["title"],
            "s": ev.get("seriesName") or d.get("en", ""),
            "b": ev["startTime"],
            "e": ev["endTime"],
        }
        # lege velden weglaten houdt de bestanden klein
        extra = {
            "d": d.get("d"), "g": d.get("g"), "se": d.get("se"), "ep": d.get("ep"),
            "j": d.get("j"), "land": d.get("land"), "cast": d.get("cast"),
            "p": 1 if ev.get("premiere") else None, "l": 1 if ev.get("isLive") else None,
            "a": ev.get("minimumAge") or None,
        }
        p.update({k: v for k, v in extra.items() if v})
        per_dag.setdefault(tv_dag(ev["startTime"]).isoformat(), []).append(p)

    UIT.mkdir(parents=True, exist_ok=True)
    for oud in UIT.glob("dag-*.json"):
        oud.unlink()
    for dag, progs in per_dag.items():
        progs.sort(key=lambda x: (x["c"], x["b"]))
        (UIT / f"dag-{dag}.json").write_text(json.dumps(progs, ensure_ascii=False, separators=(",", ":")))

    index = {
        "gemaakt": int(nu.timestamp()),
        "stad": stad,
        "dagen": sorted(per_dag),
        "zenders": [
            {"id": c["id"], "n": c.get("logicalChannelNumber"), "naam": c["name"],
             "logo": c.get("logo", {}).get("focused", ""),
             "taal": zender_taal(c.get("logicalChannelNumber") or 999, c["id"])}
            for c in kanalen
        ],
    }
    (UIT / "index.json").write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")))
    log(f"Klaar: {len(events)} programma's op {len(kanalen)} zenders, {len(per_dag)} dagen.")


if __name__ == "__main__":
    a = argparse.ArgumentParser(description="Telenet-gids ophalen naar web/data/")
    a.add_argument("--stad", default="20001", help="Telenet cityId: postcode + 01 (standaard 20001 = Antwerpen)")
    a.add_argument("--dagen", type=int, default=8)
    args = a.parse_args()
    vernieuw(args.stad, args.dagen)
