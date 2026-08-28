# Afgangsoverblik · Aarhus H — overblik.kasper-krog.dk

Offentlig, statisk afgangstavle for letbanen på Aarhus H, bygget til den store
skærm på OCC-kontoret. **Ingen persondata** — kun vagtnumre, løb, tognumre,
machine shift-numre og tider (GDPR: førernavne og førernumre vises aldrig og
findes ikke i repoet). Siden er markeret `noindex`.

Designet er OCC Overbliks infoskærm (samme logik), men med **Vagt**/**Afgiver**
i stedet for fører-kolonnerne, uden bynavne under vagtnumrene, og med
Tognr.-kolonnen skjult bag flaget `VIS_TOGNR` i `overblik.js` (sæt `true` og
bump `?v=` for at vise den igen). Typografien er sat op til læsning på afstand
(storskærm) og skalerer med skærmbredden. Afgang-kolonnen viser **altid den
planlagte afgangstid** som det store tal; en forsinkelse står som et rødt
"+N min"-mærke til venstre for tiden (samme mønster som AFLYST-mærket), og den
forventede faktiske afgang ligger i cellens tooltip.

## Sådan virker den

To datakilder, begge uden backend:

1. **Plan** (hvilken vagt/hvilket løb kører hvert tognummer):
   `data/dage/<driftsdato>.json`, publiceret dagligt fra OnlinePlan af
   `scripts/overblik_publish.py` i hovedprojektet (privat repo). Fordi dagens
   faktiske vagtsæt hentes pr. dato, virker tavlen også på **særplandage**
   (events, sporarbejde) — dagen mærkes da "SÆRPLAN" og machine shift-numrene
   udelades (de kendes kun for de faste man–tors-/fredagsplaner).
   Mangler dagsfilen, falder siden tilbage til `data/fallback.json` (de fire
   faste dagtyper).
2. **Realtid**: Rejseplanens HAFAS-endpoint kaldes direkte fra browseren
   (CORS er åben). AR-afgangstavlen er facit for afgange, forsinkelser og
   aflysninger; ankomsttavlen fanger indadgående aflysninger (vises som
   "Indgående aflyst"); JourneyGeoPos/-Details giver løb-forsinkelser og
   delvise aflysninger. Vendetid på Aarhus H trækkes fra forsinkelsen som på
   den interne infoskærm. Endpointet er uofficielt — fejler det, viser siden
   plantider.

Der er ingen synlig statuslinje/footer (fjernet på Kaspers ønske) — plan- og
realtidsstatus (inkl. fallback-/særplan-advarsler) ligger som tooltip på uret.
Tavlen viser op til 12 afgange, men beskærer selv antallet af rækker, så der
aldrig kommer lodret scrollbar — heller ikke ved kraftig zoom (rækkeantallet
tilpasser sig i stedet; genberegnes ved resize/zoom).

Driftsdøgnet skifter kl. 04 (som planen). Siden genindlæser sig selv ved
døgnskiftet, så kioskskærmen kører uden betjening. Øverst til højre sidder ⛶
(fuld skærm) med en sol/måne-toggle lige under (ingen Auto-knap; uden gemt
valg følges systemet, og valget gemmes under localStorage-nøglen `tema`, som
anti-blink-scriptet i `<head>` læser). Begge knapper fader væk når musen er i
ro og kommer igen ved bevægelse, så skærmen står ren. `?tema=moerk` /
`?tema=lys` i URL'en sætter valget til kioskbrug.

## Drift

| Hvad | Værdi |
|---|---|
| Repo | github.com/KasperKrog92/overblik (public — krav for gratis GitHub Pages) |
| Hosting | GitHub Pages, branch `main`, rod |
| Domæne | `overblik.kasper-krog.dk` (styret af `CNAME`-filen — slet/ret ikke) |
| DNS | CNAME-record: navn `overblik` → `kasperkrog92.github.io` |
| HTTPS | GitHub udsteder certifikat automatisk når DNS-recorden svarer; slå derefter "Enforce HTTPS" til (repo → Settings → Pages) |
| Dagligt datafeed | **GitHub Actions i det private vagtplan-repo** (`.github/workflows/overblik-publish.yml`): kører i skyen kl. ~04:20 og ~12/13 dansk tid, logger ind i OnlinePlan med krypterede Actions-secrets, bygger dagsfilerne og pusher hertil med en skrive-deploy-nøgle. Ingen lokal maskine involveret. |

**Ved ændring af css/js: bump `?v=` på begge links i `index.html`.**
Cloudflare-proxyen edge-cacher `.js`/`.css` i op til 10 min (max-age=600), så
uden versionering kan besøgende få ny HTML blandet med gammel JS/CSS (set
27-08-2026). Selve HTML'en og JSON-dagsfilerne edge-caches ikke.

## Dataformater

`data/dage/<ÅÅÅÅ-MM-DD>.json` (én pr. driftsdato, prunes efter 7 dage):

```json
{"dato": "2026-08-27", "hentet": "…", "kilde": "OnlinePlan",
 "kalender_dagtype": "man-tors", "saerplan": false,
 "ms": {"11": "262", "...": "..."},
 "vagter": ["1101", "..."],
 "ture": [{"vagt":"1101","loeb":"11","linje":"l2","tog":"13013",
           "afg":"04:31","fra":"AR1","ank":"05:03","til":"LP2"}]}
```

`"gentaget": true` på en tur = tognummeret er genbrugt i samme vagt
(pendul på særplaner); dens plan-tider er upålidelige (kendt OnlinePlan-
begrænsning), så siden bruger dem ikke til vendetids-beregningen.

`data/fallback.json`: samme turformat pr. fast dagtype + MS-tabeller.
Genereres med `python scripts/overblik_publish.py fallback` ved planskift.

Stationskoder er tognumre.json-koderne (AR1, GR2, …); ukendte stationer på
særplaner sendes som `"Navn|pos"` og vises råt.
