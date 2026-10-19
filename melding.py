"""Dagelijkse pushmelding: wat staat er vanavond op tv voor elke gebruiker.

Draait elk uur in de namiddag via GitHub Actions. Wie zijn meldingsuur bereikt
heeft en vandaag nog niets kreeg, krijgt één melding met:
  - uitzendingen van vanavond die op zijn kijklijst staan,
  - nieuwe uitzendingen van reeksen die hij volgt,
  - en (als hij dat wil) de beste tips volgens zijn interesses.

Omgevingsvariabelen:
  SUPABASE_URL, SUPABASE_SERVICE_KEY   service_role-sleutel (geheim!)
  VAPID_PRIVATE_KEY                    PEM-tekst uit maak_vapid.py
  VAPID_SUBJECT                        bv. mailto:jij@voorbeeld.be
  SITE_URL                             adres van de web-app, bv. https://naam.github.io/telenet-tvgids/

    python3 melding.py            # echt versturen
    python3 melding.py --droog    # alleen tonen wat er verstuurd zou worden
"""
import argparse
import datetime as dt
import json
import os
import re
import sys
import unicodedata
import urllib.request
from pathlib import Path
from zoneinfo import ZoneInfo

TZ = ZoneInfo("Europe/Brussels")
HIER = Path(__file__).resolve().parent


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def norm(s):
    s = unicodedata.normalize("NFD", str(s or "").lower())
    return re.sub(r"\s+", " ", "".join(c for c in s if unicodedata.category(c) != "Mn")).strip()


def lees_json(naam):
    """Uit web/ als het lokaal bestaat (na gids.py), anders van de site."""
    lokaal = HIER / "web" / naam
    if lokaal.exists():
        return json.loads(lokaal.read_text())
    url = os.environ["SITE_URL"].rstrip("/") + "/" + naam
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.loads(r.read())


class Supabase:
    def __init__(self):
        self.url = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/"
        sleutel = os.environ["SUPABASE_SERVICE_KEY"]
        self.h = {"apikey": sleutel, "Authorization": f"Bearer {sleutel}", "Content-Type": "application/json"}

    def req(self, methode, pad, body=None, extra=None):
        data = json.dumps(body).encode() if body is not None else None
        r = urllib.request.Request(self.url + pad, data=data, method=methode, headers={**self.h, **(extra or {})})
        with urllib.request.urlopen(r, timeout=30) as resp:
            txt = resp.read()
        return json.loads(txt) if txt else None


# --- Zelfde score als in web/app.js (functie score) ---------------------------------
def is_film(p):
    return any("film" in g.lower() for g in p.get("g", [])) and p["e"] - p["b"] >= 75 * 60


def thema_match(p, thema):
    if thema["id"] == "film":
        return is_film(p)
    return any(re.search(thema["genres"], g, re.I) for g in p.get("g", []))


def score(p, profiel, themas, zender_n):
    s, reden = 0, []
    duur = p["e"] - p["b"]
    gekozen = [t for t in themas if t["id"] in (profiel.get("themas") or [])]
    hits = [t["naam"] for t in gekozen if thema_match(p, t)]
    if hits:
        s += 14 + 6 * (len(hits) - 1)
        reden.append(hits[0])
    titel, rest = norm(p["t"]), norm(" ".join([p.get("s", ""), p.get("d", ""), " ".join(p.get("cast", []))]))
    for w in profiel.get("trefwoorden") or []:
        w = norm(w)
        if not w:
            continue
        if w in titel:
            s += 40; reden.append(f"'{w}'")
        elif w in rest:
            s += 15; reden.append(f"'{w}'")
    if p["c"] in (profiel.get("favorieten") or []):
        s += 8
    if p.get("p"):
        s += 6
    if p.get("l"):
        s += 5
    if zender_n.get(p["c"], 999) <= 30:
        s += 3
    if duur < 20 * 60:
        s -= 30
    if re.search(r"nieuws|journaal|het weer|news|météo|meteo", p["t"], re.I) and "nieuws" not in (profiel.get("themas") or []):
        s -= 25
    return s, reden


def melding_voor(profiel, kijklijst, progs, themas, zenders, nu):
    zender_naam = {z["id"]: z["naam"] for z in zenders}
    zender_n = {z["id"]: z["n"] for z in zenders}
    def is_avond(ts):
        uur = dt.datetime.fromtimestamp(ts, TZ).hour
        return uur >= 17 or uur < 2
    avond = [p for p in progs if p["b"] >= nu.timestamp() - 600 and is_avond(p["b"])]
    regels, gezien = [], set()

    uitz = {(k["zender"], k["start"]) for k in kijklijst if k["soort"] == "uitzending"}
    reeksen = {norm(k["titel"]) for k in kijklijst if k["soort"] == "reeks"}
    al_gemeld = set()
    for p in sorted(avond, key=lambda p: p["b"]):
        if (p["c"], p["b"]) in uitz or (norm(p["t"]) in reeksen and norm(p["t"]) not in al_gemeld):
            regels.append((p, "kijklijst"))
            gezien.add((p["c"], p["b"]))
            al_gemeld.add(norm(p["t"]))
        elif norm(p["t"]) in reeksen:
            gezien.add((p["c"], p["b"]))  # herhaling van een gevolgde reeks: niet nog eens als tip

    if profiel.get("tips_in_melding", True):
        kand = []
        for p in avond:
            if (p["c"], p["b"]) in gezien:
                continue
            s, _ = score(p, profiel, themas, zender_n)
            if s >= 20:
                kand.append((s, p))
        kand.sort(key=lambda x: -x[0])
        titels = set()
        for s, p in kand:
            if norm(p["t"]) in titels:
                continue
            titels.add(norm(p["t"]))
            regels.append((p, "tip"))
            if sum(1 for _, w in regels if w == "tip") >= 3:
                break

    if not regels:
        return None
    regels.sort(key=lambda x: x[0]["b"])
    n_kijk = sum(1 for _, w in regels if w == "kijklijst")
    tekst = "\n".join(
        f"{dt.datetime.fromtimestamp(p['b'], TZ):%H:%M} {p['t']} · {zender_naam.get(p['c'], p['c'])}{' ★' if w == 'kijklijst' else ''}"
        for p, w in regels[:6]
    )
    if n_kijk:
        titel = f"Vanavond: {n_kijk} van je kijklijst" + (" + tips" if len(regels) > n_kijk else "")
    else:
        titel = "Tips voor vanavond"
    return {"title": titel, "body": tekst, "tag": f"avond-{nu.date()}", "url": "./#vanavond"}


def main():
    a = argparse.ArgumentParser()
    a.add_argument("--droog", action="store_true", help="niets versturen, alleen tonen")
    a.add_argument("--forceer", action="store_true", help="negeer meldingsuur en log (om te testen)")
    args = a.parse_args()

    nu = dt.datetime.now(TZ)
    dag = (nu - dt.timedelta(hours=6)).date().isoformat()
    index = lees_json("data/index.json")
    progs = lees_json(f"data/dag-{dag}.json")
    themas = lees_json("themas.json")

    sb = Supabase()
    profielen = sb.req("GET", "profielen?melding_aan=eq.true&select=*")
    al_gehad = {r["user_id"] for r in sb.req("GET", f"meldingen_log?dag=eq.{dag}&select=user_id")}
    log(f"{len(profielen)} profielen met meldingen aan, {len(al_gehad)} kregen vandaag al een melding.")

    if not args.droog:
        from pywebpush import WebPushException, webpush
        from py_vapid import Vapid
        vapid = Vapid.from_pem(os.environ["VAPID_PRIVATE_KEY"].encode())
        claims = {"sub": os.environ.get("VAPID_SUBJECT", "mailto:tvgids@example.com")}

    for prof in profielen:
        uid = prof["user_id"]
        if not args.forceer and (uid in al_gehad or nu.hour < prof["melding_uur"]):
            continue
        kijk = sb.req("GET", f"kijklijst?user_id=eq.{uid}&select=*")
        msg = melding_voor(prof, kijk, progs, themas, index["zenders"], nu)
        wie = prof.get("naam") or uid[:8]
        if not msg:
            log(f"- {wie}: niets voor vanavond")
        else:
            log(f"- {wie}: {msg['title']}\n    " + msg["body"].replace("\n", "\n    "))
            if not args.droog:
                toestellen = sb.req("GET", f"push_abonnementen?user_id=eq.{uid}&select=*")
                for t in toestellen:
                    try:
                        webpush({"endpoint": t["endpoint"], "keys": {"p256dh": t["p256dh"], "auth": t["auth"]}},
                                json.dumps(msg, ensure_ascii=False), vapid_private_key=vapid,
                                vapid_claims=dict(claims), ttl=6 * 3600)
                    except WebPushException as e:
                        code = getattr(e.response, "status_code", None)
                        if code in (404, 410):  # toestel heeft het abonnement opgezegd
                            sb.req("DELETE", f"push_abonnementen?id=eq.{t['id']}")
                        log(f"    push mislukt ({code}) voor toestel {t['id']}")
        if not args.droog and not args.forceer:
            sb.req("POST", "meldingen_log", {"user_id": uid, "dag": dag}, {"Prefer": "resolution=ignore-duplicates"})


if __name__ == "__main__":
    main()
