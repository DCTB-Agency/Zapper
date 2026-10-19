# Telenet Avondgids: context voor Claude

Persoonlijke tv-gids als web-app (PWA) voor een kleine groep familie/vrienden. Taal van de app,
de code-identifiers en de commits: **Nederlands (Vlaams)**. Houd dat aan.

## Wat de gebruiker wil (oorspronkelijke vraag)

- Alle zenders van het Telenet-**basisaanbod**, **regio Antwerpen** (cityId `20001`, regionale zender ATV op kanaal 8).
- Een **tv-gids voor de avond**, maar ook manueel per zender kunnen bekijken.
- **Voorstellen op basis van interesses**, **favoriete zenders**.
- **Slim zoeken** zonder betalende AI-dienst, waarmee je een specifiek programma vindt.
- **Kijklijst** voor uitzendingen in de toekomst.
- **Dagelijkse meldingen op Android en iPhone** (op de dag zelf: wat er vanavond is volgens kijklijst of interesses).
- **Web-app met meerdere gebruikers die inloggen.**

Gekozen (door de gebruiker): Supabase + GitHub Pages/Actions, alleen genodigden, login via magic link,
meldingen via web-push vanuit de PWA.

## Architectuur

- `gids.py` (alleen stdlib, Python 3.9+): haalt de gids op en schrijft statische JSON naar `web/data/`
  (`index.json` + `dag-JJJJ-MM-DD.json` per tv-dag van 06u tot 06u). Detailcache in `.cache/details.json`
  (in Actions bewaard met `actions/cache`). `web/data/` staat in `.gitignore`: de data wordt in de workflow gebouwd.
- `web/`: statische app zonder build-stap. `app.js` (vanilla JS), `style.css`, `index.html`, `sw.js`
  (push + offline), `manifest.webmanifest`, `config.js` (publieke Supabase-URL/anon key/VAPID public key),
  `themas.json` (interessethema's → regex op Telenet-genres; gedeeld met `melding.py`).
  Zonder `SUPABASE_URL` draait de app in **demo-modus** (`LokaleOpslag`, localStorage).
- `supabase/schema.sql`: tabellen `profielen`, `kijklijst` (soort `uitzending` of `reeks`),
  `push_abonnementen`, `meldingen_log`; RLS op alles; RPC `registreer_toestel`.
- `melding.py`: draait elk uur 14u-21u (`meldingen.yml`), stuurt per gebruiker één melding per dag
  zodra `melding_uur` bereikt is. Gebruikt de service_role-sleutel en `pywebpush`.
  **De scorefunctie staat dubbel**: `score()` in `web/app.js` en `score()` in `melding.py`. Pas ze samen aan.

## Telenet-API (onofficieel, uit de Telenet TV-webapp)

Basis: `https://spark-prod-be.gnp.cloud.telenet.tv/eng/web`
- Zenders: `linear-service/v2/channels?cityId=20001&language=nl&productClass=Orion-DASH`.
  `cityId` = postcode + `01`. Basisaanbod = entitlement `400000012` in `linearProducts`;
  filter verder op `isRadio`, `isAdult`, `isHidden`.
- Gids: `epg-service-lite/be/nl/events/segments/JJJJMMDDHHmmss`: blokken van 6 uur, uitgelijnd op **UTC** (00/06/12/18).
  Data loopt minstens 11 dagen vooruit.
- Details: `linear-service/v2/replayEvent/{eventId}?returnLinearContent=true&language=nl`
  (beschrijving, genres, cast, seizoen/aflevering). Alleen opgehaald voor starts tussen 17u en 01u (~1300 per dag).

## Lokaal draaien

```bash
python3 gids.py && cd web && python3 -m http.server 8765
```

Na wijzigingen aan bestanden in `web/`: verhoog `VERSIE` in `web/sw.js`, anders blijven toestellen een oude schil tonen.

## Status (19 oktober 2026)

Klaar en lokaal getest in demo-modus (desktop + gsm-breedte): Vanavond met tips, Gids-rooster, Zenders,
Zoeken (dagen, uren, zenders, thema's, typfouten), Kijklijst (uitzending + reeks volgen), Profiel,
detailvenster, en `melding.py`'s opbouw van de melding met een testprofiel.

**Nog niet getest**, want daar was nog geen account voor:
- Supabase-login, opslag en RLS (`SupaOpslag` in `app.js`, `schema.sql`).
- Echte web-push: abonneren op een toestel, `melding.py` die verstuurt, iOS als beginscherm-app.
- De GitHub Actions-workflows (`gids.yml`, `meldingen.yml`).

## Volgende stappen

1. Repo op GitHub zetten (publiek), Pages-bron op "GitHub Actions".
2. De gebruiker begeleiden door de Supabase-setup (README stap 2-4). Accounts aanmaken doet de gebruiker zelf.
3. `python3 maak_vapid.py` lokaal laten draaien; `web/config.js` invullen; secrets/variables zetten.
4. End-to-end testen: inloggen via magic link, voorkeuren bewaren, meldingen aanzetten op Android en iPhone,
   `meldingen.yml` met `droog` en daarna echt.
5. Mogelijke uitbreidingen: herinnering vlak voor de start van een kijklijst-uitzending (vraagt een vaker
   draaiende planner dan GitHub cron), details ook overdag ophalen, gedeelde lijsten tussen gebruikers.
