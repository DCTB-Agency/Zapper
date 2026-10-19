# Zapper

Made by [DCTB Agency](https://www.dctb.be).


Zapper is een web-app die elke dag de tv-gids van het Telenet-basisaanbod ophaalt (97 zenders, regio
Antwerpen, vandaag + 7 dagen) en er een persoonlijke avondgids van maakt.

- **Onboarding**: bij de eerste keer 7 vragen (talen, soort programma's, verhalen, shows, onderwerpen,
  sport en je voorkeurzenders in volgorde; telkens meerdere antwoorden mogelijk). Daarna zie je meteen
  je profiel en hoeveel tips je er vanavond mee krijgt. Je kan de vragen later opnieuw doen.
- **Voorkeurzenders in volgorde**: tips komen eerst van je nummer 1, dan nummer 2, enzovoort, en worden
  daarna aangevuld met andere zenders. Een tip moet wel bij je interesses passen.
- **Lerend profiel**: wat je bewaart, als reeks volgt of opent, telt mee voor je volgende tips (per genre en
  per zender). Met **Niet voor mij** haal je een programma uit je tips. In je profiel zie je wat de gids
  leerde, en je kan het laten vergeten.
- **Vanavond**: zoekveld bovenaan, tips op maat volgens je interesses, trefwoorden en voorkeurzenders, plus wat er nu op je zenders loopt.
- **Gids**: tijdrooster per dag, filter op zendergroep of favorieten.
- **Zenders**: het volledige dagprogramma van één zender.
- **Zoeken**: slim zoeken, volledig in de browser (geen betalende AI-dienst). Begrijpt dagen
  (*vanavond, morgen, vrijdag, weekend*), uren (*na 21u, voor 20u, om 20u30*), zenders (*op canvas, vtm*),
  soorten (*film, live, nieuw, voetbal, misdaad…*) en verdraagt typfouten (*verader* → *De Verraders*).
- **Kijklijst**: bewaar een uitzending, of volg een hele reeks zodat elke uitzending vanzelf meetelt.
- **Meldingen**: elke dag op een uur naar keuze een pushmelding op Android of iPhone met wat er
  vanavond op je kijklijst staat, aangevuld met tips.
- **Gebruikers**: meerdere mensen loggen in met een link via e-mail. Alleen wie uitgenodigd is, kan erin.

Alles draait gratis: GitHub Pages (website), GitHub Actions (dagelijkse gids en meldingen) en
Supabase (logins en opslag).

```
gids.py                 haalt de Telenet-gids op naar web/data/ (draait in GitHub Actions)
melding.py              stuurt de dagelijkse pushmeldingen (draait in GitHub Actions)
maak_vapid.py           maakt eenmalig de sleutels voor pushmeldingen
maak_icoon.py           tekent de app-iconen
supabase/schema.sql     database: profielen, kijklijst, toestellen
web/                    de web-app (statisch, geen build-stap)
.github/workflows/      gids.yml (elke nacht + namiddag) en meldingen.yml (elk uur 14u-21u)
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

> De ingebouwde e-mail van Supabase verstuurt maar een paar mails per uur. Voor een kleine groep
> volstaat dat. Wil je meer, koppel dan bij **Authentication → SMTP** een gratis dienst zoals Resend of Brevo.

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

## Goed om te weten

- De gids komt van de publieke Telenet TV-webapp. Dat is geen officiële API: als Telenet die wijzigt,
  moet `gids.py` aangepast worden.
- Beschrijvingen en genres worden alleen opgehaald voor programma's die tussen 17u en 01u starten.
  Overdag zijn er titels en uren, maar vinden tips en zoeken-op-genre minder.
- GitHub start geplande workflows soms wat later dan het uur. Meldingen komen dus rond het gekozen uur, niet op de minuut.
- Een gratis Supabase-project pauzeert na een week zonder activiteit. De meldingen-workflow raakt het elke dag aan, dus dat gebeurt niet zolang die draait.
