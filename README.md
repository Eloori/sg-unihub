# sg/unihub

Zentrale, zweisprachige (DE/EN) Linkübersicht über offizielle und studentische
Angebote der Universität St. Gallen (HSG) – gebaut von [Eloori Interactive](https://eloori-interactive.com).

**Status:** Prototyp / Kollegen-Feedback-Phase.

## Struktur

Reine statische Single-File-Seite (`index.html`) – HTML, CSS und JS in einer
Datei, keine Build-Schritte, kein Framework. Läuft 1:1 als GitHub Pages Site.

## Lokal ansehen

```
open index.html
```

## Deploy (GitHub Pages)

1. Repo-Settings → Pages → Branch `main`, Ordner `/ (root)` → Save.
2. Seite ist danach unter `https://<username>.github.io/sg-unihub/` erreichbar
   (oder auf einer eigenen Domain, sobald DNS bei Infomaniak eingerichtet ist).

## Analytics

Eingebunden ist [GoatCounter](https://www.goatcounter.com/) (cookiefrei, DSGVO-
freundlich) – Site-Code im `<head>` von `index.html` (`data-goatcounter`)
nach dem Erstellen eines kostenlosen Kontos ersetzen.

## Rechtliches

Impressum & Datenschutzerklärung sind direkt in der Seite unter `#impressum`
bzw. `#datenschutz` enthalten (Fusszeile).

