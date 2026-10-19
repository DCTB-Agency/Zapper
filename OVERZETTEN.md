# Zapper overzetten naar je eigen Claude

Alles wat je nodig hebt, zit in deze map: de code, de volledige geschiedenis (git), de setup-handleiding
(`README.md`) en de context voor Claude (`CLAUDE.md`). Je eigen Claude heeft het oorspronkelijke gesprek niet nodig.

## Waar staat wat

| | |
|---|---|
| Map op je Mac | `~/Documents/GitHub/Zapper` |
| Zip (zelfde inhoud, met geschiedenis) | `~/Documents/GitHub/Zapper.zip` |
| GitHub-repo (privé, nog leeg) | https://github.com/DCTB-Agency/Zapper |

De map is al gekoppeld aan die repo (`origin`). Pushen is dus één opdracht, zie hieronder.

## 1. In je eigen Claude openen

**Claude Code (desktop-app of terminal) op deze Mac**: open de map `~/Documents/GitHub/Zapper` als project.
Claude leest `CLAUDE.md` automatisch.

**Op een andere computer**: pak `Zapper.zip` uit en open die map. De git-geschiedenis en de koppeling met
GitHub zitten erin.

**claude.ai (web) met GitHub-koppeling**: push eerst (stap 2). Koppel daarna de repo `DCTB-Agency/Zapper` in je project.

## 2. Pushen naar GitHub

Eén keer de toestemming geven om workflows te pushen (opent je browser):

```bash
gh auth refresh -h github.com -s workflow
```

Daarna, vanuit de map:

```bash
git push -u origin main
```

Of vraag het gewoon aan Claude: *"Push dit naar DCTB-Agency/Zapper."*

> Gebruik je in je eigen Claude een **ander GitHub-account** dan DCTB-Agency? Nodig dat account dan uit via
> **Settings → Collaborators** van de repo, of verplaats de repo via **Settings → Transfer**.

## 3. Online zetten

Volg `README.md` → *Online zetten* (Supabase-project, sleutels, GitHub-instellingen). Let op:

- **GitHub Pages werkt gratis alleen op een publieke repo.** De repo is nu privé. Maak hem publiek via
  **Settings → General → Change visibility**, of neem GitHub Pro. Er staan geen geheimen in de code;
  de geheime sleutels gaan in GitHub Secrets.
- Daarna: **Settings → Pages → Source: GitHub Actions**.

## 4. Wat al werkt en wat nog getest moet worden

Lokaal getest in demo-modus: onboarding, tips, gids, zenders, zoeken, kijklijst, favoriete programma's,
agenda-export, lerend profiel, mobile first design.

Nog te testen na de setup: inloggen via Supabase, pushmeldingen op Android en iPhone, de GitHub Actions.
De lijst staat ook in `CLAUDE.md` onder *Status*.

## Lokaal starten

```bash
python3 gids.py
```

```bash
cd web && python3 -m http.server 8765
```

Open http://localhost:8765.
