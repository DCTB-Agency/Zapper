# Zapper

Made by [DCTB Agency](https://www.dctb.be).


Zapper is een web-app die elke dag de tv-gids van het Telenet-basisaanbod ophaalt (97 zenders, regio
Antwerpen, vandaag + 7 dagen) en er een persoonlijke avondgids van maakt.

- **Onboarding**: bij de eerste keer 9 vragen (talen, soort programma's, verhalen, shows, onderwerpen,
  sport, je streamingdiensten, favoriete programma's en je voorkeurzenders in volgorde). Telkens meerdere antwoorden mogelijk,
  of **Geen voorkeur**. Daarna zie je meteen je profiel en hoeveel tips je er vanavond mee krijgt.
  Je kan de vragen later opnieuw doen.
- **Favoriete programma's**: zoek op naam (typfouten mogen) en voeg toe, in de onboarding of op je
  kijklijst. Elke uitzending komt vanzelf op je kijklijst en in je melding, ook van titels die pas later
  op tv komen.
- **Voorkeurzenders in volgorde**: tips komen eerst van je nummer 1, dan nummer 2, enzovoort, en worden
  daarna aangevuld met andere zenders. Een tip moet wel bij je interesses passen.
- **Lerend profiel**: wat je bewaart, als reeks volgt of opent, telt mee voor je volgende tips (per genre en
  per zender). Met **Niet voor mij** haal je een programma uit je tips. In je profiel zie je wat de gids
  leerde, en je kan het laten vergeten.
- **Vanavond**: zoekveld bovenaan, tips op maat volgens je interesses, trefwoorden en voorkeurzenders, plus wat er nu op je zenders loopt.
  De tips staan **per tijdstip** (per halfuur): je ziet tot 4 tips die op hetzelfde moment op verschillende zenders beginnen.
  Op de gsm schuif je per tijdstip opzij.
- **Streaming**: wat er nieuw is op Netflix, Disney+, Prime Video, HBO Max, Apple TV+, VRT MAX, VTM GO, Streamz,
  Hayu, Crunchyroll en MUBI, met de dag waarop het online kwam, wat **binnenkort** komt (met datum) en wat populair is.
  Bovenaan tips volgens je interesses. De gegevens komen van JustWatch en worden 4 keer per dag vernieuwd.
  Wat vandaag nieuw is op jouw diensten, staat ook in je dagelijkse melding.
  Twee luiken: **Nu te zien** (vandaag nieuw, eerder nieuw, populair) en **Binnenkort** (per dag waarop het online komt).
  Elke titel toont *Nu te zien* of *Vanaf …*. De knop **Bekijk op Netflix** (of een andere dienst) opent de titel
  rechtstreeks op die dienst; JustWatch staat er nog als kleine link onder.
  Met het **zoekveld** vind je ook oudere films en reeksen (de ~4.000 populairste titels van alle diensten, typfouten mogen),
  met op welke dienst ze staan. Niet gevonden? Eén tik zoekt verder op JustWatch.
- **Gids**: tijdrooster per dag, filter op zendergroep of favorieten.
- **Zenders**: het volledige dagprogramma van één zender.
- **Zoeken**: slim zoeken, volledig in de browser (geen betalende AI-dienst). Begrijpt dagen
  (*vanavond, morgen, vrijdag, weekend*), uren (*na 21u, voor 20u, om 20u30*), zenders (*op canvas, vtm*),
  soorten (*film, live, nieuw, voetbal, misdaad…*) en verdraagt typfouten (*verader* → *De Verraders*).
  Films en reeksen op streamingdiensten verschijnen er ook, in een apart blok **Op streaming**.
- **Eerst bevestigen**: iets weghalen (van de kijklijst, uit je favorieten of voorkeurzenders, een trefwoord, *Niet voor mij*
  of *Vergeet wat de gids leerde*) vraagt altijd eerst of je het zeker weet.
- **Kijklijst**: bewaar een uitzending, of maak er een favoriet programma van zodat elke uitzending vanzelf meetelt.
- **Agenda**: zet een uitzending in de agenda van je gsm (bestand voor iPhone, Android en Outlook, of
  rechtstreeks in Google Agenda), met een herinnering 10 minuten voor de start. Op de kijklijst zet
  **Alles in mijn agenda** al je komende uitzendingen er in één keer in.
- **Meldingen**: elke dag op een uur naar keuze een pushmelding op Android of iPhone met wat er
  vanavond op je kijklijst staat, aangevuld met tips.
- **Profielen**: op één login kunnen meerdere mensen een eigen profiel hebben (zoals bij Netflix), elk met eigen
  vragenlijst, tips, kijklijst en meldingen. Wisselen, toevoegen en verwijderen
  doe je in je profiel. Elk toestel onthoudt welk profiel er actief is; na de update toont Zapper één keer een kaartje
  om te kiezen wie je bent of een profiel toe te voegen. Een toestel krijgt de meldingen van het actieve profiel.
  Eenmalig nodig in Supabase: `supabase/update-profielen.sql` uitvoeren.
- **Op het beginscherm**: op een gsm vraagt Zapper (na een paar seconden, hoogstens eens per week) om de app op het
  beginscherm te zetten. Android: één knop. iPhone: de stappen via de deelknop (Apple laat geen knop toe).
- **Gebruikers**: meerdere mensen loggen in met een link via e-mail. Alleen wie uitgenodigd is, kan erin.

Alles draait gratis: GitHub Pages (website), GitHub Actions (dagelijkse gids en meldingen) en
Supabase (logins en opslag).

```
gids.py                 haalt de Telenet-gids op naar web/data/ (draait in GitHub Actions)
streaming.py            haalt nieuw, binnenkort en populair op streamingdiensten op (JustWatch)
melding.py              stuurt de dagelijkse pushmeldingen (draait in GitHub Actions)
maak_vapid.py           maakt eenmalig de sleutels voor pushmeldingen
maak_icoon.py           maakt app-iconen en het woordmerk uit merk/zapper-logo-bron.webp (pip3 install pillow)
supabase/schema.sql     database: profielen, kijklijst, toestellen
supabase/update-*.sql   kleine updates voor een database die al bestond
web/                    de web-app (statisch, geen build-stap)
.github/workflows/      gids.yml (4 keer per dag) en meldingen.yml (elk uur 14u-21u)
```

## Lokaal uitproberen (demo-modus)

Zonder Supabase draait de app in demo-modus: je voorkeuren blijven in je browser.

```bash
python3 gids.py
```

```bash
cd web && python3 -m http.server 8765
```

Open daarna http://localhost:8765.

## Online zetten

Reken op een half uur. Je hebt een GitHub-account en een (gratis) Supabase-account nodig.

### 1. GitHub

1. Maak een nieuwe repository, bv. `telenet-tvgids`, en push deze map. Maak ze **publiek**:
   GitHub Pages en Actions-minuten zijn dan gratis. Er staan geen geheimen in de code.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
3. Het adres wordt `https://<gebruikersnaam>.github.io/telenet-tvgids/`.

### 2. Supabase

1. Maak op [supabase.com](https://supabase.com) een nieuw project (regio *Central EU (Frankfurt)*).
2. **SQL Editor** → plak de inhoud van `supabase/schema.sql` → **Run**.
3. **Authentication → Sign In / Providers**: laat *Email* aan en zet **Allow new users to sign up uit**.
   Zo kan alleen wie jij uitnodigt binnen.
4. **Authentication → URL Configuration**: zet *Site URL* en een *Redirect URL* op het adres uit stap 1.3.
5. **Authentication → Users → Invite user** voor elk familielid of elke vriend.
6. **Project Settings → API**: noteer de *Project URL*, de *anon public*-sleutel en de *service_role*-sleutel.

7. *(Aanbevolen)* **Inloggen met Google**: dan zijn er geen inlogmails nodig. Zie *Inloggen met Google* hieronder.
   Zodra Google aan staat in Supabase, verschijnt de knop vanzelf op het inlogscherm.

> De ingebouwde e-mail van Supabase verstuurt maar een paar mails per uur. Voor een kleine groep
> volstaat dat. Wil je meer, koppel dan bij **Authentication → SMTP** een gratis dienst zoals Resend of Brevo.

### Inloggen met Google

1. Ga naar [console.cloud.google.com](https://console.cloud.google.com) en maak een project, bv. `Zapper`.
2. **APIs & Services → OAuth consent screen**: type *External*, app-naam `Zapper`, je e-mailadres. Zet de app
   daarna op **In production** (anders kunnen alleen testgebruikers inloggen).
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**, type *Web application*.
   Bij **Authorized redirect URIs**: `https://<project>.supabase.co/auth/v1/callback` (staat ook in Supabase bij de Google-provider).
4. Kopieer de **Client ID** en het **Client secret**.
5. Supabase → **Authentication → Sign In / Providers → Google**: zet aan, plak beide, **Save**.

Alleen wie uitgenodigd is (of als gebruiker toegevoegd), kan binnen: met *Allow new users to sign up* uit
weigert Supabase onbekende Google-accounts. Gebruik bij het uitnodigen hetzelfde e-mailadres als het Google-account.

### 3. Sleutels voor pushmeldingen

```bash
pip3 install cryptography
```

```bash
python3 maak_vapid.py
```

Dit toont de publieke sleutel en bewaart de private sleutel in `.vapid/private.pem` (komt niet op GitHub).

### 4. Instellingen invullen

In `web/config.js`: `SUPABASE_URL`, `SUPABASE_ANON_KEY` en `VAPID_PUBLIC_KEY`. Die mogen publiek zijn.

In GitHub, **Settings → Secrets and variables → Actions**:

| Soort | Naam | Waarde |
|---|---|---|
| Secret | `SUPABASE_URL` | Project URL |
| Secret | `SUPABASE_SERVICE_KEY` | service_role-sleutel (geheim!) |
| Secret | `VAPID_PRIVATE_KEY` | volledige inhoud van `.vapid/private.pem` |
| Secret | `VAPID_SUBJECT` | `mailto:` + jouw e-mailadres |
| Variable | `SITE_URL` | adres uit stap 1.3 |
| Variable | `TELENET_STAD` | optioneel, standaard `20001` (Antwerpen). Formule: postcode + `01`, bv. `28001` = Mechelen |

Commit `web/config.js` en push. De workflow **Gids vernieuwen en publiceren** start vanzelf.
De eerste keer duurt hij ongeveer 4 minuten, daarna ongeveer 1 minuut.

### 5. Meldingen op je gsm

- **Android**: open de site in Chrome, log in, ga naar je profiel (rondje rechtsboven) → **Meldingen aanzetten op dit toestel**.
- **iPhone** (iOS 16.4 of nieuwer): open de site in Safari → **Deel → Zet op beginscherm**. Open de app
  via het nieuwe icoon, log in en zet meldingen aan in je profiel. Vanuit gewoon Safari kan iOS geen meldingen tonen.

Testen: **Actions → Dagelijkse meldingen → Run workflow**. Met *droog* aangevinkt zie je in het logboek
wat iedereen zou krijgen, zonder iets te versturen. Zonder vinkje wordt het echt verstuurd.

## Onderhoud: hoe vaak moet dit bijgewerkt worden?

Eens Zapper online staat, werkt hij zelfstandig. Er is geen handmatige update nodig.

| Wat | Wanneer | Door |
|---|---|---|
| Tv-gids ophalen (8 dagen vooruit) en streaming | elke dag rond 05u, 11u, 15u en 19u | workflow *Gids vernieuwen en publiceren* |
| Dagelijkse meldingen | elk uur van 14u tot 21u | workflow *Dagelijkse meldingen* |
| Geplande workflows actief houden | bij elke geplande gidsrun | job *levend-houden* in `gids.yml` |

Waar je wel op moet letten:

- **Telenet wijzigt zijn website.** De gids komt uit de Telenet TV-webapp, niet uit een officiële API. Als het ophalen
  mislukt, mailt GitHub je dat de workflow faalde. Dan moet `gids.py` aangepast worden. De app blijft intussen de
  laatst opgehaalde gids tonen.
- **GitHub pauzeert geplande workflows** in een publieke repo na 60 dagen zonder commits. De job *levend-houden*
  zet ze bij elke run opnieuw aan. Staat er bij **Actions** toch een gele melding "workflow disabled", klik dan op
  **Enable workflow**.
- **Supabase pauzeert gratis projecten** na een week zonder gebruik. De meldingen-workflow gebruikt de database elke
  dag, dus dat gebeurt niet zolang die draait.
- **JustWatch wijzigt zijn website.** Ook de streaminggegevens komen niet uit een officiële API. Mislukt het ophalen,
  dan blijft de tv-gids gewoon werken en toont het tabblad Streaming de laatste gegevens. Dan moet `streaming.py` aangepast worden.
  VTM GO en Streamz houdt JustWatch minder goed bij: daar is "nieuw" wat er sinds de vorige run bijkwam.
- **Pushmeldingen** van een toestel dat de app verwijderd heeft, worden automatisch opgeruimd.

## Goed om te weten

- De gids komt van de publieke Telenet TV-webapp. Dat is geen officiële API: als Telenet die wijzigt,
  moet `gids.py` aangepast worden.
- Beschrijvingen en genres worden alleen opgehaald voor programma's die tussen 17u en 01u starten.
  Overdag zijn er titels en uren, maar vinden tips en zoeken-op-genre minder.
- GitHub start geplande workflows soms wat later dan het uur. Meldingen komen dus rond het gekozen uur, niet op de minuut.
- Een gratis Supabase-project pauzeert na een week zonder activiteit. De meldingen-workflow raakt het elke dag aan, dus dat gebeurt niet zolang die draait.
