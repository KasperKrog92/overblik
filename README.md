# Afgangsoverblik · Aarhus H — overblik.kasper-krog.dk

Offentlig, statisk afgangstavle for letbanen på Aarhus H, bygget til den store
skærm på OCC-kontoret. **Ingen førernavne** — kun vagtnumre, førernumre, løb,
tognumre, machine shift-numre og tider. Førernumrene blev tilføjet 27-10-2026
efter Kaspers bevidste valg. Han blev gjort opmærksom på, at de er
(pseudonyme) persondata, der bliver offentlige og bliver liggende i
git-historikken. Navne vises aldrig og findes ikke i repoet. Siden er
markeret `noindex`.

Designet er OCC Overbliks infoskærm (samme logik), men med **Vagt**/**Afgiver**
i stedet for fører-kolonnerne. Under vagtnummeret står førernummeret (ved
oplæringspar begge, adskilt af "·"); i Afgiver står det før "ank HH:MM".
Numrene stammer fra bemandingen på hentetidspunktet (~04:20 og ~12/13), så en
omrokering senere på dagen ses først ved næste kørsel. Fallback-planen har ingen
førernumre. Der er ingen bynavne under vagtnumrene, og
Tognr.-kolonnen er skjult bag flaget `VIS_TOGNR` i `overblik.js` (sæt `true` og
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
   (events, sporarbejde) — dagen mærkes da "SÆRPLAN". Machine shift-numrene
   medtages ved match med en verificeret særplan: **7.–10., 14.–17., 21.–24.
   september, 28. september–1. oktober og 5.–8. oktober 2026** er verificeret
   mod AVLS v302 (23 løb, start/slut matcher
   præcist). **Ikke-skoledagsplanen man–tors** (ferier/helligdage, 17 løb,
   udledt 12-10-2026) er ikke datobundet og får MS-numre på alle man–tors-
   datoer, hvor samtlige løbs tidsvinduer matcher. Feedet kontrollerer perioden
   og alle løbs tidsvinduer ved hver hentning; andre særplaner får ingen
   MS-numre. Alle fire faste dagtyper har egne
   tabeller. Fredag er genudledt 11-09-2026 fra AVLS
   (23 entydige løb; løb 1 har ét minuts forskel i sluttiden); søndag er udledt
   25-10-2026 (14 løb, ren bijektion).
   Mangler dagsfilen, falder siden tilbage til `data/fallback.json` (de fire
   faste dagtyper).
2. **Realtid**: Rejseplanens HAFAS-endpoint kaldes direkte fra browseren
   (CORS er åben). AR-afgangstavlen er facit for afgange, forsinkelser og
   aflysninger; ankomsttavlen fanger indadgående aflysninger (vises som
   "Indgående aflyst"); JourneyGeoPos/-Details giver løb-forsinkelser og
   delvise aflysninger. Vendetid på Aarhus H trækkes fra forsinkelsen. Har
   afgangstavlen ikke selv en prognose på afgangen, bruges et **løb-skøn**
   (forsinkelsen på det tog, der kører på løbet nu) — men **kun når det tog
   faktisk er afgiveren** (samme tognr som den indgående ankomst). Ellers ville
   et fremmed tog, fx efter et machine shift-/løb-bytte, kunne smitte en
   spøgelses-forsinkelse af på en afgang, Rejseplanen slet ingen prognose har
   på (set 29-08-2026: 19:48 mod Grenaa vist +9 min i et par min, mens
   Rejseplanens egen tavle viste den til tiden). Endpointet er uofficielt —
   fejler det, viser siden plantider.

   **Tognummer-afvigelser (27-10-2026):** Rejseplanen og OnlinePlan kan
   nummerere samme tur forskelligt — man–tors er Mårslet→Lystrup kl. 18:31 tog
   12121 på tavlen, men 13125 kl. 18:29 i OnlinePlan, så rækken stod uden
   løb/vagt. Findes tavlens tognummer ikke i planen, matches nu en planafgang
   fra Aarhus H mod samme endestation inden for ±3 min, hvis eget tognummer
   ikke står på tavlen (`planMatch` i `infoAfgange`).

   **Robusthed (12-10-2026):** alle kald har 10 s timeout, og der kører højst
   én realtids-/planopdatering ad gangen. Realtid ældre end 3 min ignoreres
   helt (også aflysninger, depotrækker og løb-skøn), så gamle forsinkelser
   ikke hænger fast ved udfald. JourneyDetails (tognr + delaflyste stop)
   caches pr. jid, men genhentes efter 5 min (højst 5 kald pr. opdatering,
   parallelt), så delaflysninger der kommer til undervejs fanges. GeoPos'
   `stopL` er kun de ~4 nærmeste stop: ét aflyst stop dér er en delvis
   aflysning, ikke et aflyst tog.

**TILLYST** (28-10-2026): en afgang, der har stået aflyst og igen står som
kørende på Rejseplanens tavle, får et grønt "TILLYST"-mærke til venstre for
tiden (Midttrafiks kører-grøn `#068A1C`; samme mønster som AFLYST). Rejseplanen
markerer ikke tillysninger, så siden husker pr. driftsdøgn i `localStorage`
(`overblik.aflyst.<dato>`), hvilke tognumre den har set aflyst — begge
tilstande skal ses i 2 opdateringer, før de tæller. Kun **tognummer-skift**
tæller, ikke at et løb kører igen efter en aflyst periode: efter D&G aflyses i
1-timesblokke, og afgangene efter en blok står som kørende, selvom næste blok
blot ikke er besluttet endnu. Da tillysning kræver ≥ 1 times varsel (D&G R5,
AUH undtaget), hentes hele døgnets AR-afgangs- og ankomsttavle (fra kl. 04,
`dur 1439`) hver 3. opdatering (~2 min), så tillysninger uden for de 90 min
også fanges. **Kun løbets første tillyste afgang får mærket** (30-10-2026):
når et løb tillyses, skifter alle dets aflyste tognumre, så mærket
undertrykkes, hvis løbets forrige afgang fra Aarhus H i planen selv er tillyst.
En ny tillysning senere i samme løb (efter en kørende eller stadig aflyst
afgang) får mærket igen. Depotrækker får TILLYST ud fra ankomsttavlen efter
samme regel. Er den indgående
tur aflyst, men afgangen kører, står der nu grønt "Tillyst fra Aarhus H"
(før rødt "Indgående aflyst").

**Afkortede ture** (28-10-2026): Rejseplanens tavle siger ikke, hvor langt en
afkortet tur kører — retningsteksten er den planlagte endestation, og tavlen
har kun aflyst-flaget for Aarhus H-stoppet. Derfor hentes JourneyDetails
(aflyst ind/ud pr. stop) også for de næste 12 afgange på AR-DEP (samme cache
som for de kørende tog: 5 min, højst 8 kald pr. opdatering, nye afgange
først). Er de sidste stop efter Aarhus H aflyst, vises turen som
**"Grenaa (Hornslet)"** — planlagt endestation, og hvor toget faktisk ender i
rød parentes (aflyste stop i tooltip). Er kun mellemstop aflyst, står der
"Delvist aflyst" (springer over: … i tooltip). Aflyste stop før Aarhus H er den
indgående del og tæller ikke her. Målt 28-10-2026: 11 kald pr. runde de to
første runder, derefter 3–5. Forudsætter, at aflysningen ligger pr. stop i
Rejseplanen (ikke som aflyst tur + ny tur) — endnu ikke set live.

**Fører forsinket** (28-10-2026): ved førerskift kommer afgangens fører ofte
med et andet tog end det, der holder klar. Er førerens forrige tur (seneste tur
i vagten, der ender på Aarhus H før afgangen) forsinket mindst 4 min, så der er
højst 2 min tilbage til afgangen, står der orange "Fører forsinket +N" under
vagtnummeret (detaljer i tooltip: tog, planlagt/forventet ankomst, hvor mange
minutter føreren kommer for sent). Samme regel som "overtagelse i fare" i OCC
Overblik. Kører føreren selv toget ind, dækker afgangsforsinkelsen det; vagter
der starter fra CMC (ingen forrige tur) kan ikke vurderes.

**Depotkørsler** (12-10-2026): ender et løb på Aarhus H og kører toget derefter i
depot (CMY), vises det som en egen række "Depot" på ankomsttiden, flettet ind
blandt afgangene — med noten "Vask + sand" eller "Parkering" (ren hensættelse
har ingen note). Vagt = føreren der kører toget ind; forsinkelse/aflysning
kommer fra ankomsttavlens post for turens tognummer (ingen vendetid). Kilden
er OnlinePlans synlige "Aarhus depot…"/"v+s"-række efter turen (markeret af
`parse_vagt_fuld`); fallback-planen har ingen depotdata. Depotrækker efter den
sidste viste afgang udelades, når tavlen er fuld.

Der er ingen synlig statuslinje/footer (fjernet på Kaspers ønske) — plan- og
realtidsstatus (inkl. fallback-/særplan-advarsler) ligger som tooltip på uret.
Tavlen viser op til 12 afgange, men beskærer selv antallet af rækker, så der
aldrig kommer lodret scrollbar — heller ikke ved kraftig zoom (rækkeantallet
tilpasser sig i stedet; genberegnes ved resize/zoom).

Driftsdøgnet skifter kl. 04 (som planen). Siden genindlæser sig selv ved
døgnskiftet, så kioskskærmen kører uden betjening — men kun når siden kan nås
(HEAD-tjek først): et reload uden net ville give browserens fejlside, hvor
intet script kører. Uden net hentes dagens plan i den kørende side, og reload
forsøges igen hvert minut.

**Lys/mørk følger klokken**: mørk tilstand fra kl. 20:00 og lys fra kl.
05:40 — skiftet er øjeblikkeligt (den gradvise 10 min-overgang blev fjernet
05-09-2026, fordi den ikke så godt ud på skærmen). `data-theme` på `:root`
tjekkes hvert 5. sek. og styrer alle farve-tokens inkl. logoet (`--moerk`).
Anti-blink-scriptet i `<head>` sætter samme klokke-tema før første maling. Øverst til højre sidder
⛶ (fuld skærm) med en sol/måne-toggle lige under — et klik gælder til næste
planlagte skifte (og kiosken genindlæser alligevel kl. 04). `?tema=moerk` /
`?tema=lys` fastlåser valget og slår skemaet fra (localStorage-nøglen
`temaFast`); `?tema=auto` fjerner låsen. Begge knapper fader væk når musen er
i ro og kommer igen ved bevægelse, så skærmen står ren.

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
 "foerere": {"1101": ["62037"], "1102": ["62011", "62301"]},
 "ture": [{"vagt":"1101","loeb":"11","linje":"l2","tog":"13013",
           "afg":"04:31","fra":"AR1","ank":"05:03","til":"LP2"}]}
```

`"gentaget": true` på en tur = tognummeret er genbrugt i samme vagt
(pendul på særplaner); dens plan-tider er upålidelige (kendt OnlinePlan-
begrænsning), så siden bruger dem ikke til vendetids-beregningen.

`"depot": "vask" | "parkering" | "depot"` + `"depot_tid"` (ankomst CMY) på en tur
= toget kører fra Aarhus H i depot efter turen.

`data/fallback.json`: samme turformat pr. fast dagtype + MS-tabeller.
Genereres med `python scripts/overblik_publish.py fallback` ved planskift.

Stationskoder er tognumre.json-koderne (AR1, GR2, …); ukendte stationer på
særplaner sendes som `"Navn|pos"` og vises råt.
