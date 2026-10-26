# Zapper: context voor Claude

**Zapper** (made by DCTB Agency, www.dctb.be; die vermelding staat in de footer en op het loginscherm) is een persoonlijke tv-gids als web-app (PWA) voor een kleine groep familie/vrienden. Taal van de app,
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
  `themas.json` (interessethema's → regex op Telenet-genres, met optioneel `ook` = tweede genre dat ook
  moet voorkomen, en `groep` = de onboardingvraag; gedeeld met `melding.py`).
  Onboarding (`#welkom`, blok "Onboarding" in `app.js`): 9 vragen (o.a. `streaming`), elk met "Geen voorkeur" (`S.ob.geen`, sluit
  de andere keuzes uit; leeg = telt niet mee). Vraag "programmas" zoekt titels (`zoekTitels()`, ook gebruikt op de
  Kijklijst) en bewaart ze als kijklijst-rijen met soort `reeks` (in de UI "favoriete programma's").
  Antwoorden → `profielen.talen`, `profielen.themas`, `profielen.favorieten` (in volgorde) en reeksen.
  Start vanzelf zolang `onboarding_klaar` false is en er geen interesses zijn.
  Elke zender heeft in `index.json` een `taal` (nl/en/fr/de/andere, zie `zender_taal()` in `gids.py`);
  programma's op zenders buiten `profiel.talen` krijgen −40 in de score.
- Scoreregels (identiek in `app.js` `score()` en `melding.py` `score()`): thema +14 (+6 per extra), trefwoord
  +40 titel / +15 elders, voorkeurzender `max(6, 14 − 2·rang)`, nieuw +6, live +5, korte programma's −30,
  nieuws zonder nieuwsinteresse −25, andere taal −40, `geleerd.nee` −100, geleerde gewichten
  (som genres begrensd −15..20, zender −6..8). Een persoonlijke tip moet relevant zijn (thema/trefwoord
  gematcht of geleerde bonus ≥ 5) en ≥ 20 scoren. Selectie: eerst voorkeurzenders in volgorde, max 2
  per zender, dan aanvullen.
- Lerend profiel `profielen.geleerd` (jsonb): `g` genre→gewicht, `c` zender→gewicht, `nee` genormaliseerde
  titels, `n` aantal signalen. Signalen in `leer()`: bewaren +3, uit kijklijst −1, reeks volgen +4,
  ontvolgen −2, detail openen +0,5, Niet voor mij −1,5 + titel in `nee`. Elke stap ×0,97 verval.
  `norm()` moet in JS en Python hetzelfde blijven (de `nee`-titels worden ermee vergeleken).
  Zonder `SUPABASE_URL` draait de app in **demo-modus** (`LokaleOpslag`, localStorage).
- `supabase/schema.sql`: tabellen `profielen`, `kijklijst` (soort `uitzending` of `reeks`),
  `push_abonnementen`, `meldingen_log`; RLS op alles; RPC `registreer_toestel`.
- `streaming.py` (alleen stdlib): JustWatch GraphQL (`https://apis.justwatch.com/graphql`, onofficieel, geen sleutel,
  land BE) → `web/data/streaming.json` met `diensten`, `titels` (id → titel, soort, genres, `th` = thema-id's, poster, url)
  en `items` (`soort` nieuw/binnenkort/populair, `dienst`, `datum`, `se`). `newTitles` (pageType NEW per dag, UPCOMING met
  `upcomingReleases`) en `popularTitles`. Diensten zonder datums bij JustWatch (VTM GO, Streamz = JustWatch-pakket "Telenet", code `tel`): diff met
  `.cache/streaming-gezien.json`. De dienstcodes staan dubbel: `DIENSTEN` in `streaming.py` en in `web/app.js`.
  Profielveld `profielen.streaming` (text[]; `supabase/update-streaming.sql`). Zonder die kolom bewaart de app
  de keuze in localStorage (`SupaOpslag.bewaarProfiel`).
  Zoeken: `web/data/streaming-zoek.json` (top 500 populair per dienst + alles uit het overzicht; velden i/t/s/j/p/u/d,
  posterpad en JustWatch-pad zonder domein). `stZoek()` in `app.js`, ook gebruikt in Zoeken en het zoekveld op Vanavond.
  Live zoeken vanuit de browser bij JustWatch kan niet (geen CORS); daarom een link naar justwatch.com/be/zoeken.
  Directe links per dienst: `w` (dienstcode → `standardWebURL` uit JustWatch-offers) in `titels` en in het zoekregister;
  zonder link `DIENST_ZOEK` in `app.js` (zoekpagina of startpagina van de dienst). Zoekregister `k` = datum als de titel
  nog niet te zien is. Tabblad Streaming: luiken `S.stModus` "nu"/"straks".
- Meerdere profielen per login: kolom `profiel` (smallint, 0 = hoofdprofiel) in `profielen` (PK user_id+profiel),
  `kijklijst`, `push_abonnementen`, `meldingen_log` (PK user_id+profiel+dag); RPC `registreer_toestel(..., p_profiel)`.
  Zie `supabase/update-profielen.sql`. `SupaOpslag.profielen_ok` = de kolom bestaat; zo niet werkt alles als één profiel.
  Actief profiel per toestel in localStorage (`avondgids.actiefprofiel.<uid>`); geen keuzescherm bij opstarten,
  wel één keer het nieuwskaartje (met profielkeuze als er meerdere zijn). `#wie` alleen via "Profiel toevoegen". `melding.py` stuurt per (user_id, profiel) naar de toestellen van dat profiel.
- Nieuws na een update: lijst `NIEUWS` in `app.js` (id, titel, tekst, knop, actie, toon). Eén kaart bovenaan Vanavond,
  per toestel onthouden in localStorage `avondgids.nieuws`. Voor een volgende aankondiging: een item met een nieuwe id toevoegen.
- iOS 26 (web-app op beginscherm, WebKit-bug 301108): `@media (display-mode: standalone) { html { min-height: min(100lvh, calc(100% + env(safe-area-inset-top))) } }`, anders staat het menu op korte pagina's te hoog. Niet op `body` zetten.
- Kop: sticky `top: 0` met `padding-top: env(safe-area-inset-top)` en ondoorzichtig. Tegen het vervagend randeffect van
  iOS 26 (Liquid Glass) in de web-app: `.statusstrook`, een vaste ondoorzichtige strook bovenaan (min. 12px, alleen
  standalone; `html[data-standalone]` via navigator.standalone). Een sticky kop telt pas mee als hij "vastzit" (na scrollen).
  Bevestigd op een iPhone (26 oktober 2026). Ook het iOS 26-menu-gat (html min-height) is daar bevestigd. Zoekknop `#kopZoek` verschijnt via `body.gescrold` (scrollY > 140).
- Updates: sw.js haalt bestanden met `cache: "no-cache"`; app herlaadt één keer bij `controllerchange` (alleen als er al
  een service worker was). Verhoog `VERSIE` in sw.js bij elke wijziging in web/.
- Installeren: `<dialog id="installeer">`; Android via `beforeinstallprompt`, iOS met stappen. Alleen op gsm, niet in
  standalone, ook al op het inlogscherm (iOS deelt de login niet tussen Safari en de web-app); "Nu niet" = 7 dagen.
- Streaming op de kijklijst: kijklijst-rij `soort = 'streaming'`, `zender` = dienstcode, `start` = lanceerdag (12u UTC,
  of null), `ref` = JustWatch-id (`supabase/update-streaming-kijklijst.sql`). `stKnoppen()` / `wisselStKijk()` / `tekenStKijk()`
  in app.js; `melding.py` meldt "Vandaag uit" voor zulke rijen met start = vandaag.
- Weghalen altijd via `bevestig()` (eigen `<dialog id="bevestig">`), ook voor Niet voor mij en Vergeet.
- Tips op Vanavond: `tipsPerSlot()` groepeert per halfuur, max. 4 per slot, elk van een andere zender, max. 4 per zender
  per avond. `tipsVoor()` blijft voor de onboarding-voorproef. `melding.py` gebruikt nog de oude selectie (3 tips).
- `melding.py`: draait elk uur 14u-21u (`meldingen.yml`), stuurt per gebruiker één melding per dag
  zodra `melding_uur` bereikt is. Gebruikt de service_role-sleutel en `pywebpush`.
  **De scorefunctie staat dubbel**: `score()` in `web/app.js` en `score()` in `melding.py`. Pas ze samen aan.

## Ontwerp (web/style.css)

- Merk: icoon en woordmerk uit `merk/zapper-logo-bron.webp` via `maak_icoon.py` (Pillow). Woordmerk in twee versies
  (`logo-woord-licht.png` met donkere PER, `logo-woord-donker.png` met witte PER) via `<picture>` en prefers-color-scheme.
  Merkkleuren `--merk-1`/`--merk-2` en verloop `--merk`: primaire knoppen, lijn onder de kop, streepje voor kopjes,
  actief tabblad, voortgangsbalk, profielknop.

- **Mobile first**: de basisregels zijn voor de gsm; `@media (min-width: 720px)` voegt tabs, rasters en
  twee kolommen toe, `1080px` alleen een grotere titel. Schrijf nieuwe stijl eerst voor de gsm.
- **Vaste schaal** (bovenaan het bestand): afstanden `--s1..--s6`, afrondingen `--r-s/m/l`, tekst `--t-xs..--t-2xl`.
  Gebruik geen losse pixelwaarden.
- **Tikvlakken** minstens `--tik` (44px); invoervelden 16px tekst (anders zoomt iOS in).
- Alle klikbare vlakken (`.kaart .item .tegel .zendertegel .sug .zknop .tl`) delen één basisregel; gekozen = accentrand + `--accent-soft`.
- Hover alleen binnen `@media (hover: hover)`. Kleine kopjes in hoofdletters gebruiken één gedeelde stijl (`.eyebrow` e.a.).
- Detail = paneel van onder op gsm, gecentreerd venster vanaf 720px.

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

## Status (24 oktober 2026)

Online op https://dctb-agency.github.io/Zapper/ (publieke repo, Pages via Actions). Supabase-project
`wevtsetlcfbphixczmra` gekoppeld in `config.js`; GitHub-secrets en `SITE_URL` staan. Nieuw en lokaal getest in demo-modus:
tips per tijdslot, streamingvraag in onboarding en profiel, tabblad Streaming (gsm + desktop), streamingregel in `melding.py`.
Nog door de gebruiker te doen: `supabase/update-streaming.sql` uitvoeren; inschrijven uitzetten in Supabase.
Supabase' ingebouwde mail haalt maar enkele mails per uur: aanbevolen SMTP (Resend/Brevo).

### Eerder (19 oktober 2026)

Klaar en lokaal getest in demo-modus (desktop + gsm-breedte): onboarding (8 vragen met Geen voorkeur, favoriete programma's zoeken, voorkeurzenders in volgorde + samenvatting), programma's toevoegen op de Kijklijst, agenda-export (.ics + Google Agenda, ook de hele kijklijst), lerend profiel en Niet voor mij, zoekveld op Vanavond, Vanavond met tips, Gids-rooster, Zenders,
Zoeken (dagen, uren, zenders, thema's, typfouten), Kijklijst (uitzending + reeks volgen), Profiel,
detailvenster, en `melding.py`'s opbouw van de melding met een testprofiel.

**Nog niet getest**, want daar was nog geen account voor:
- Supabase-login, opslag en RLS (`SupaOpslag` in `app.js`, `schema.sql`).
- Echte web-push: abonneren op een toestel, `melding.py` die verstuurt, iOS als beginscherm-app.
- De GitHub Actions-workflows (`gids.yml`, `meldingen.yml`), ook de job `levend-houden`.
- De .ics-export op een echte iPhone en Android (vooral vanuit de beginscherm-app op iOS).

## Volgende stappen

1. Pushen naar de bestaande, nog lege privé-repo **DCTB-Agency/Zapper** (`origin` staat al goed). Daarvoor
   heeft `gh` het `workflow`-recht nodig: `gh auth refresh -h github.com -s workflow` (de gebruiker bevestigt in de
   browser), dan `git push -u origin main`. Voor gratis GitHub Pages moet de repo publiek; vraag dat eerst aan de
   gebruiker. Daarna Pages-bron op "GitHub Actions". Zie ook `OVERZETTEN.md`.
2. De gebruiker begeleiden door de Supabase-setup (README stap 2-4). `schema.sql` bevat ook de
   kolommen `talen`, `onboarding_klaar` en `geleerd`; op een bestaande database kan het script gewoon opnieuw. Accounts aanmaken doet de gebruiker zelf.
3. `python3 maak_vapid.py` lokaal laten draaien; `web/config.js` invullen; secrets/variables zetten.
4. End-to-end testen: inloggen via magic link, voorkeuren bewaren, meldingen aanzetten op Android en iPhone,
   `meldingen.yml` met `droog` en daarna echt.
5. Mogelijke uitbreidingen: een abonneerbare agenda-feed (webcal) per gebruiker die vanzelf bijwerkt
   (nu is het een eenmalige .ics-export of Google Agenda-link, met herinnering 10 min vooraf), details ook overdag ophalen, gedeelde lijsten tussen gebruikers.
