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
Numrene stammer fra bemandingen på hentetidspunktet (fire kørsler i døgnet, se
Drift — hentetidspunktet står i urets tooltip), så en omrokering senere på
dagen ses først ved næste kørsel. Fallback-planen har ingen
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
blandt afgangene — med noten "Vask + sand", "Ophold indtil H:MM" (løbet kører
fra Aarhus H igen senere i driftsdøgnet; tiden = afgangen fra CMY før løbets
næste AR-afgang, `fra_depot_tid`; ældre dagsfiler uden feltet viser
AR-afgangen) eller
"Parkering" (løbet er slut for dagen) (Kasper 07-11-2026; før fulgte noten
OnlinePlans depot-type, hvor "parkering" netop var de korte ophold). Vagt = føreren der kører toget ind; forsinkelse/aflysning
kommer fra ankomsttavlens post for turens tognummer (ingen vendetid). Kilden
er OnlinePlans synlige "Aarhus depot…"/"v+s"-række efter turen (markeret af
`parse_vagt_fuld`); fallback-planen har ingen depotdata. Depotrækker efter den
sidste viste afgang udelades, når tavlen er fuld; er den ikke fuld, vises kun
depotrækker inden for live-tavlens horisont (`TAVLE_DUR` = 90 min) — ellers
fyldte dagens senere depotkørsler de tomme pladser (07-11-2026: 08:56 → 16:33).

**Driftsbeskeder** (05-11-2026): Rejseplanens driftsbeskeder (HIM) vises i et
banner nederst på tavlen, som på Rejseplanens egen infoskærm. De følger med i
AR-DEP-/AR-ARR-svaret (`common.himL`), så de koster ingen ekstra kald, og de
kommer og går, når Midttrafik/Rejseplanen ændrer dem. Der dedupliceres på
teksten, poster uden tekst udelades, HTML renses væk, og nyeste besked står
først; siden bestemmer ikke selv indholdet. Flere beskeder skifter hvert 15. sek.
med tæller ("1/2"), og banneret er lige så højt som den længste, så rækkerne ikke
hopper. Når banneret er foldet ud, dukker to pile op ved hover: de skifter besked
i hånden og holder den valgte besked i 2 min., før det automatiske skift
fortsætter. Klik på banneret folder det sammen til én smal linje med overskriften
(`beskedFoldet` i `localStorage`, pr. skærm, overlever genindlæsning). Tavlen får
rækkerne tilbage, når banneret er foldet. En ny eller ændret besked folder det ud
af sig selv og vises først; sete beskeder huskes (`beskedSet`, de seneste 50), så
genindlæsning eller en uændret besked, der kommer igen, ikke åbner det. Forældet realtid (> 3 min) skjuler
beskederne. Udvalget kan afvige fra Rejseplanens egen skærm, da kun beskeder
knyttet til afgange/ankomster på tavlen de næste 90 min. kommer med.

**Spor** (rettet 10-11-2026): perronen læses fra tavlesvarets `dPltfS`/`aPltfS`
(planlagt) og `dPltfR`/`aPltfR` (ændret) — et objekt `{type:"PL", txt:"1"}`,
hvor spor 0 står som bogstavet "O". Koden læste før `dPlatf*`, som ikke findes,
så kolonnen altid faldt tilbage på reglen Mårslet/Odder = 0, ellers 1, og
depotrækker viste "—". Reglen er nu kun reserve; depotrækker bruger
ankomstperronen og ellers planens position (`AR0` → 0).

**Gennemgående tog har ingen vendetid** — heller ikke ved førerskift på Aarhus
H (rettet 10-11-2026). Turen står da i planen som to dele med samme tognummer,
og Rejseplanens afgang ligger 2 min efter planens ankomst; de 2 min blev før
regnet som vendetid og trukket fra tavlens egen prognose (41 tognumre på en
man–tors-dag). Afgiver-kolonnen viser fortsat førerskiftet.

En skjult fane (minimeret eller i baggrunden) henter ikke realtid; den hentede
før ca. én gang i minuttet. Når fanen vises igen, hentes friske data straks.

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

**Siden må aldrig kræve betjening for at blive opdateret** (Kaspers regel
10-11-2026): et nyt deploy samles altid op ved døgnskiftet kl. 04, uden at
nogen rører skærmen.

**Fuldskærm og døgnskiftet:** ⛶-knappen bruger browserens Fullscreen API, og
den fuldskærm overlever ikke et reload — siden kan heller ikke selv gå i
fuldskærm igen uden et klik. Derfor springes genindlæsningen over i præcis ét
tilfælde: siden står i ⛶-fuldskærm, **og** sidens HTML er bevist uændret siden
indlæsningen (css/js skifter altid `?v=` i HTML'en, så uændret HTML = intet nyt
deploy). Så hentes den nye dagsfil i den kørende side, og fuldskærmen bevares.
Er der deployet nyt, genindlæses der også i fuldskærm, som så forlades den
morgen; kan det ikke afgøres, genindlæses der. Sammenligningsgrundlaget
(`sideVedStart`) gemmes kun, når HTML'en hentet ved opstart har samme
`Last-Modified` som det indlæste dokument. **F11 eller browserens
kiosk-tilstand anbefales fortsat til den faste skærm**: den fuldskærm overlever
reload, så skærmen bliver i fuldskærm også efter et deploy.

**Lys/mørk følger klokken**: mørk tilstand fra kl. 20:00 og lys fra kl.
05:40 — skiftet er øjeblikkeligt (den gradvise 10 min-overgang blev fjernet
05-09-2026, fordi den ikke så godt ud på skærmen). `data-theme` på `:root`
tjekkes hvert 5. sek. og styrer alle farve-tokens inkl. logoet (`--moerk`).
Anti-blink-scriptet i `<head>` sætter samme klokke-tema før første maling. Øverst til højre sidder
⛶ (fuld skærm) med en sol/måne-toggle lige under — et klik gælder til næste
planlagte skifte. `?tema=moerk` /
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
| HTTPS | Cloudflare-proxyen serverer HTTPS til besøgende. **`http://` omdirigeres ikke** (målt 10-11-2026: HTTP 200). GitHub har ikke udstedt eget certifikat og kan ikke, så længe recorden er proxied, så "Enforce HTTPS" i Pages kan ikke slås til; løsningen er "Always Use HTTPS" i Cloudflare (SSL/TLS → Edge Certificates). |
| Dagligt datafeed | **GitHub Actions i dette repo** (`.github/workflows/publish.yml`, siden 19-10-2026): fire planlagte kørsler i døgnet (cron 03:20, 11:00, 19:00 og 23:00 UTC), som henter koden fra det private vagtplan-repo med læse-nøglen `VAGTPLAN_DEPLOY_KEY`, logger ind i OnlinePlan med krypterede Actions-secrets, bygger dagsfilerne og pusher dem med `GITHUB_TOKEN`. Loggen er offentlig. Ingen lokal maskine involveret. **GitHub starter kørslerne 5–10 timer forsinket** (målt 10-11-2026 — se `docs/overblik-actions.md` i hovedprojektet), så klokkeslættene er ikke til at regne med; hver kørsel henter både driftsdatoen og dagen efter, og det er "i morgen"-filen, tavlen starter på kl. 04. |

**Ved ændring af css/js: bump `?v=` på begge links i `index.html`.**
Cloudflare-proxyen lader browseren cache `.js`/`.css` i 4 timer
(`max-age=14400`, målt 10-11-2026), så uden versionering kan besøgende få ny
HTML blandet med gammel JS/CSS (set 27-08-2026). Selve HTML'en og
JSON-dagsfilerne caches højst 10 min.

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
= toget kører fra Aarhus H i depot efter turen. `"fra_depot_tid"` (afgang CMY)
på en tur = toget kommer fra depotet til Aarhus H før turen (OnlinePlans
"Aarhus depot…"-række før turen); bruges som tiden i "Ophold indtil H:MM" og
vises som "Fra CMY H:MM" under endestationen på ALLE afgange med feltet
(også dagens første udkørsler) (Kasper 07-11-2026).

`data/fallback.json`: samme turformat pr. fast dagtype + MS-tabeller.
Genereres med `python scripts/overblik_publish.py fallback` ved planskift.

Stationskoder er tognumre.json-koderne (AR1, GR2, …); ukendte stationer på
særplaner sendes som `"Navn|pos"` og vises råt.
