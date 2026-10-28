"use strict";
/* Afgangsoverblik · Aarhus H — offentlig, statisk udgave af OCC Overbliks
   infoskærm. INGEN førernavne: kun vagtnumre, førernumre, løb, tognumre og tider.

   Datakilder:
   - Plan: data/dage/<driftsdato>.json (publiceret dagligt fra OnlinePlan af
     scripts/overblik_publish.py i hovedprojektet — virker også på særplandage).
     Fallback: data/fallback.json (de fire faste dagtyper) + tydelig advarsel.
   - Realtid: Rejseplanens HAFAS-endpoint direkte fra browseren (CORS er åben).
     AR-DEP-tavlen er facit for afgangene; AR-ARR fanger indadgående
     aflysninger; JourneyGeoPos + JourneyDetails giver løb-forsinkelser og
     delvise aflysninger. Logikken (vendetid, delaflysninger, tillyst) er
     porteret 1:1 fra server/web/js/view-tabel.js + vagtplan_app/rejseplanen.py. */

/* ---------- små hjælpere ---------- */
const $ = (s) => document.querySelector(s);
/* Escaper også ' — alle title-attributter står i enkelte anførselstegn og får
   tekst fra Rejseplanen (retninger, stationsnavne). */
const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const T = (s) => { if (!s) return null; const [h, m] = String(s).split(":").map(Number); return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null; };
/* Driftsdøgnet skifter kl. 04: tider før kl. 4 hører til foregående driftsdato. */
const driftT = (s) => { const t = typeof s === "number" ? s : T(s); return t != null && t < 4 * 60 ? t + 1440 : t; };
const localISO = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const driftsdatoISO = (nu = new Date()) => { const d = new Date(nu.getTime()); d.setHours(d.getHours() - 4); return localISO(d); };
const nowMin = () => { const n = new Date(); let t = n.getHours() * 60 + n.getMinutes(); if (n.getHours() < 4) t += 1440; return t; };
const fmtHM = (t) => t == null ? "—" : String(Math.floor((t % 1440) / 60)).padStart(2, "0") + ":" + String(t % 1440 % 60).padStart(2, "0");

const STATION = {
  AR: "Aarhus H", AUH: "Universitetshospitalet", GR: "Grenaa", LP: "Lystrup",
  LSK: "Lisbjergskolen", MST: "Mårslet", ODD: "Odder", OS: "Hornslet", VSA: "Vestre Strandallé",
};
function stNavn(kode) {
  if (kode == null || kode === "") return "";
  const k = String(kode);
  if (k.includes("|")) return k.split("|")[0];      // ukendt station: "Navn|pos"
  const base = k.replace(/\d+$/, "");
  return STATION[base] !== undefined ? STATION[base] : k;
}
const stBase = (kode) => String(kode || "").split("|")[0].replace(/\d+$/, "");
/* Rejseplanens retningsnavne: "Odder (Letbane)" -> "Odder" osv. */
const rpNavn = (n) => String(n || "").replace(/\s*\(Letbane\)\s*$/i, "")
  .replace(/^Aarhus Universitetshospital.*/i, "Universitetshospitalet");
/* Tognr.-kolonnen er skjult (Kasper 27-08-2026) men koden er bevaret —
   sæt VIS_TOGNR = true for at vise den igen. */
const VIS_TOGNR = false;

/* ---------- state ---------- */
const S = {
  plan: null,          // {dato, saerplan, ms, ture:[...]} (dagsfil eller fallback)
  planKilde: null,     // 'dag' | 'fallback' | null
  planDato: null,      // driftsdatoen planen blev indlæst for
  tavle: [],           // flettede tavle-poster (AR-DEP facit for afgange)
  tog: [],             // JourneyGeoPos: kørende tog {jid, tognr?, forsinkelse_min, aflyst}
  detaljer: {},        // jid -> {ts, d: JourneyDetails {tognr, aflyst, aflyste_stop}} (cache)
  idx: null,           // opslag bygget én gang pr. plan (se indekser)
  rtOk: false, rtSidst: null, rtFejl: null,
  sidsteDrift: driftsdatoISO(),
};

/* Netværkskald må aldrig hænge: et kald uden svar ville ellers blokere
   opdateringen for altid, mens timerne blev ved med at starte nye. */
const NET_TIMEOUT_MS = 10 * 1000;
function medTimeout(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), NET_TIMEOUT_MS);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(t));
}
/* Højst én kørsel ad gangen: kaldes fn mens den kører, deles det igangværende
   løfte, så langsomme svar ikke kan overlappe og overskrive nyere data. */
function enAdGangen(fn) {
  let igang = null;
  return () => igang || (igang = fn().finally(() => { igang = null; }));
}

/* Realtid ældre end dette ignoreres helt (fx ved netværksudfald), så gamle
   forsinkelser og aflysninger ikke bliver hængende på skærmen. Korte udfald
   dækkes af de seneste data. */
const RT_MAX_ALDER_MS = 3 * 60 * 1000;
const rtFrisk = () => !!S.rtSidst && Date.now() - S.rtSidst.getTime() < RT_MAX_ALDER_MS;
const rtNu = () => (rtFrisk() ? { tavle: S.tavle, tog: S.tog } : { tavle: [], tog: [] });

/* ---------- Rejseplanen (HAFAS mgate, uofficielt — fejl håndteres blødt) ---------- */
const MGATE = "https://www.rejseplanen.dk/bin/iphone.exe";
const LID_AR = "A=1@L=860005301@";
const PROD_LETBANE = [{ type: "PROD", mode: "INC", value: 2048 }];

async function mgate(meth, req) {
  const body = {
    ver: "1.24", ext: "DK.11", lang: "dan",
    auth: { type: "AID", aid: "irkmpm9mdznstenr-android" },
    client: { id: "DK", type: "AND", name: "rejseplan", v: 100 },
    formatted: false,
    svcReqL: [{ meth, req }],
  };
  const r = await medTimeout(MGATE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const j = await r.json();
  const svc = (j.svcResL || [])[0] || {};
  if (j.err && j.err !== "OK") throw new Error("mgate: " + j.err);
  if (svc.err && svc.err !== "OK") throw new Error(meth + ": " + svc.err);
  return svc.res || {};
}

/* HAFAS-tid 'hhmmss' evt. med dagsoffset foran -> driftsminutter. */
function hafasMin(s) {
  if (!s || s.length < 6) return null;
  const dage = parseInt(s.slice(0, -6) || "0", 10);
  let m = dage * 1440 + parseInt(s.slice(-6, -4), 10) * 60 + parseInt(s.slice(-4, -2), 10);
  if (m < 240) m += 1440;      // efter midnat uden dagsoffset: hører til driftsdøgnet
  return m;
}

/* heleDoegn: hele driftsdøgnet fra kl. 04 (også kørte afgange) — bruges kun
   til at spore aflyst/tillyst, så en tillysning ≥ 1 time ude (D&G R5) også
   fanges, før afgangen når de næste 90 min. */
async function hentTavle(typ, heleDoegn = false) {
  const res = await mgate("StationBoard", heleDoegn
    ? { type: typ, stbLoc: { lid: LID_AR }, jnyFltrL: PROD_LETBANE, maxJny: 500, dur: 1439,
        date: driftsdatoISO().replace(/-/g, ""), time: "040000" }
    : { type: typ, stbLoc: { lid: LID_AR }, jnyFltrL: PROD_LETBANE, maxJny: 60, dur: 90 });
  const prodL = (res.common || {}).prodL || [];
  return (res.jnyL || []).map((jny) => {
    const st = jny.stbStop || {};
    const prod = prodL[jny.prodX] || {};
    const plan = hafasMin(st.dTimeS || st.aTimeS);
    const rt = hafasMin(st.dTimeR || st.aTimeR);
    return {
      tognr: (prod.prodCtx || {}).num || null,
      jid: jny.jid || null,
      retning: rpNavn(jny.dirTxt),
      afg_plan: plan, afg_rt: rt,
      forsinkelse_min: plan != null && rt != null ? rt - plan : null,
      spor_plan: st.dPlatfS || st.aPlatfS || null,
      spor_rt: st.dPlatfR || st.aPlatfR || null,
      aflyst: !!(st.dCncl || st.aCncl || jny.isCncl),
      tavle: "AR-" + typ,
    };
  });
}

/* Fletning DEP+ARR — porteret fra rejseplanen._hent_tavler: afgangstavlen er
   facit for om AFGANGEN kører, ankomsttavlen for ANKOMSTEN. Uenige ender =
   delaflysning: afgangen kører, men entryet får ind_aflyst (+ ind_retning). */
function fletTavler(dep, arr) {
  const flet = new Map();
  for (const [typ, liste] of [["DEP", dep], ["ARR", arr]]) {
    for (const r of liste) {
      const key = r.tognr || r.jid || Math.random();
      const eks = flet.get(key);
      if (!eks) {
        r._dep = typ === "DEP" ? r.aflyst : null;
        r._arr = typ === "ARR" ? r.aflyst : null;
        r._arrRet = typ === "ARR" ? r.retning : null;
        flet.set(key, r);
      } else if (typ === "DEP") {
        eks._dep = !!eks._dep || r.aflyst;
      } else {
        eks._arr = !!eks._arr || r.aflyst;
        eks._arrRet = eks._arrRet || r.retning;
      }
    }
  }
  const ud = [];
  for (const r of flet.values()) {
    const { _dep, _arr, _arrRet } = r;
    delete r._dep; delete r._arr; delete r._arrRet;
    if (_dep == null) r.aflyst = !!_arr;          // kun set på ankomsttavlen
    else {
      r.aflyst = !!_dep;
      r.ind_aflyst = !!_arr && !_dep;
      if (r.ind_aflyst) r.ind_retning = _arrRet;
    }
    ud.push(r);
  }
  return ud;
}

async function hentGeoPos() {
  const res = await mgate("JourneyGeoPos", {
    maxJny: 60, onlyRT: false, jnyFltrL: PROD_LETBANE,
    rect: { llCrd: { x: 10050000, y: 55950000 }, urCrd: { x: 10950000, y: 56450000 } },
    ageOfReport: true,
  });
  return (res.jnyL || []).map((jny) => {
    let fors = null;
    const stopL = jny.stopL || [];
    for (let i = stopL.length - 1; i >= 0 && fors == null; i--) {
      for (const [p, r] of [["dTimeS", "dTimeR"], ["aTimeS", "aTimeR"]]) {
        const pm = hafasMin(stopL[i][p]), rm = hafasMin(stopL[i][r]);
        if (pm != null && rm != null) { fors = rm - pm; break; }
      }
    }
    return {
      jid: jny.jid || null,
      retning: rpNavn(jny.dirTxt),
      forsinkelse_min: fors,
      /* stopL er kun de ~4 nærmeste stop: ét aflyst stop dér er en DELVIS
         aflysning (fanges via JourneyDetails), ikke et aflyst tog. */
      aflyst: !!jny.isCncl || (stopL.length > 0 && stopL.every((s) => s.aCncl || s.dCncl)),
    };
  });
}

/* JourneyDetails pr. jid — for de kørende tog (GeoPos) OG de næste afgange på
   AR-DEP-tavlen (afkortede ture, 28-10-2026). Tognummeret ændrer sig aldrig,
   men delvise aflysninger kan komme til undervejs, så en post ældre end
   DETALJE_TTL_MS genhentes. Højst DETALJE_BUDGET kald pr. opdatering
   (parallelt); nye afgange på tavlen går forud for nye tog, og begge forud for
   genhentning. Ved fejl beholdes den gamle post. Ca. 30 ture à 5 min ≈ 6 kald
   pr. minut; budgettet giver op til 12. */
const DETALJE_TTL_MS = 5 * 60 * 1000;
const DETALJE_BUDGET = 8;
const DETALJE_TAVLE = 12;            // så mange kommende AR-afgange følges
async function hentDetaljer(geo, dep) {
  const nu = Date.now(), nm = nowMin();
  const tavle = dep.filter((r) => r.jid && !r.aflyst && r.afg_plan != null && r.afg_plan >= nm - 1)
    .sort((a, b) => a.afg_plan - b.afg_plan).slice(0, DETALJE_TAVLE).map((r) => r.jid);
  const nye = [], gamle = [];
  for (const jid of new Set(tavle.concat(geo.map((g) => g.jid)))) {
    if (!jid) continue;
    const c = S.detaljer[jid];
    if (!c) nye.push(jid);
    else if (nu - c.ts >= DETALJE_TTL_MS) gamle.push(jid);
  }
  gamle.sort((a, b) => S.detaljer[a].ts - S.detaljer[b].ts);    // ældste først
  await Promise.all(nye.concat(gamle).slice(0, DETALJE_BUDGET).map(detalje));
  const aktive = new Set(tavle.concat(geo.map((g) => g.jid)));  // afsluttede ture ud
  for (const jid of Object.keys(S.detaljer)) if (!aktive.has(jid)) delete S.detaljer[jid];
}

/* Afkortning efter Aarhus H ud fra stopforløbet: aflyste stop EFTER Aarhus H
   (dem passagererne her kan nå). Er de sidste stop aflyst, ender turen ved
   det sidste stop med ankomst — {til: "Hornslet"}; er kun mellemstop aflyst,
   er til null (springer over). Aflyste stop før Aarhus H er den indgående
   del og vises ikke her. */
function afkortning(d) {
  const stop = (d && d.stop) || [];
  const ar = stop.findIndex((s) => s.navn === "Aarhus H");
  if (ar < 0) return null;
  const efter = stop.slice(ar + 1);
  const aflyste = efter.filter((s) => s.ind).map((s) => s.navn);
  if (!aflyste.length) return null;
  let sidst = -1;
  for (let i = efter.length - 1; i >= 0; i--) if (!efter[i].ind) { sidst = i; break; }
  if (sidst < 0) return null;         // intet stop efter Aarhus H: hele afgangen er aflyst
  return { til: sidst < efter.length - 1 ? efter[sidst].navn : null, aflyste };
}

async function detalje(jid) {
  try {
    const res = await mgate("JourneyDetails", { jid, getPolyline: false });
    const jny = res.journey || {};
    const common = res.common || {};
    const prod = (common.prodL || [])[jny.prodX] || {};
    const locL = common.locL || [];
    const aflyste = [], stop = [];
    for (const s of jny.stopL || []) {
      const navn = rpNavn((locL[s.locX] || {}).name);
      stop.push({ navn, ind: !!s.aCncl, ud: !!s.dCncl });
      if ((s.aCncl || s.dCncl) && navn) aflyste.push(navn);
    }
    S.detaljer[jid] = { ts: Date.now(),
      d: { tognr: (prod.prodCtx || {}).num || null, aflyst: !!jny.isCncl, aflyste_stop: aflyste, stop } };
  } catch (e) { /* midlertidig fejl: behold evt. gammel post */ }
}

/* ---------- tillyst: aflyst → kører igen (Kasper 28-10-2026) ----------
   Rejseplanen markerer ikke en tillysning; den ses kun som at et tognummer,
   der stod aflyst, igen står som kørende. Siden husker derfor pr. driftsdøgn
   (localStorage, så det overlever genindlæsning), hvad den har set aflyst.
   Kun TOGNUMMER-skift tæller — ikke at et løb "kører igen" efter en aflyst
   periode: efter D&G aflyses i 1-timesblokke, og afgangene efter en blok står
   som kørende, selv om næste blok blot ikke er besluttet endnu.
   Begge tilstande skal ses i TILLYST_BEKRAEFT opdateringer, så et enkelt
   fejlsvar fra Rejseplanen ikke giver udslag. Nøgle: "DEP|tognr" / "ARR|tognr". */
const TILLYST_BEKRAEFT = 2;
const SPOR_PREFIKS = "overblik.aflyst.";
const DAGSTAVLE_HVER = 3;            // hele døgnets tavler hver 3. opdatering (~2 min)
let spor = { dato: null, t: {} };    // t: nøgle -> {a: aflyst-observationer, k: kørende siden sidste aflyst}
let rtRunde = 0;

function sporNu() {
  const dato = driftsdatoISO();
  if (spor.dato === dato) return spor.t;
  spor = { dato, t: {} };
  try {
    spor.t = JSON.parse(localStorage.getItem(SPOR_PREFIKS + dato) || "{}") || {};
    for (let i = localStorage.length - 1; i >= 0; i--) {        // gamle døgn ud
      const k = localStorage.key(i);
      if (k && k.startsWith(SPOR_PREFIKS) && k !== SPOR_PREFIKS + dato) localStorage.removeItem(k);
    }
  } catch (e) { /* uden localStorage huskes kun i den kørende side */ }
  return spor.t;
}

/* Én observation pr. opdatering: alle tavler fra samme runde flettes først
   (aflyst på én af dem = aflyst), så to tavler ikke tæller som to runder. */
function noterAflysninger(lister) {
  const runde = new Map();
  for (const r of lister.flat()) {
    if (!r.tognr) continue;
    const k = r.tavle.slice(3) + "|" + r.tognr;
    runde.set(k, !!runde.get(k) || r.aflyst);
  }
  const t = sporNu();
  for (const [k, aflyst] of runde) {
    const e = t[k];
    if (aflyst) { t[k] = { a: (e ? e.a : 0) + 1, k: 0 }; }
    else if (e && e.a) e.k++;
  }
  try { localStorage.setItem(SPOR_PREFIKS + spor.dato, JSON.stringify(t)); } catch (e) {}
}

const erTillyst = (typ, tognr) => {
  const e = tognr && sporNu()[typ + "|" + tognr];
  return !!e && e.a >= TILLYST_BEKRAEFT && e.k >= TILLYST_BEKRAEFT;
};

const hentRt = enAdGangen(async () => {
  try {
    const doegn = rtRunde++ % DAGSTAVLE_HVER === 0;
    const [dep, arr, geo, dDep, dArr] = await Promise.all([hentTavle("DEP"), hentTavle("ARR"), hentGeoPos(),
      /* døgntavlerne er kun til sporingen: fejler de, kører resten videre */
      doegn ? hentTavle("DEP", true).catch(() => []) : [],
      doegn ? hentTavle("ARR", true).catch(() => []) : []]);
    noterAflysninger([dep, arr, dDep, dArr]);
    await hentDetaljer(geo, dep);
    for (const g of geo) {                          // tognr på kørende tog (cachet)
      const c = g.jid && S.detaljer[g.jid];
      if (c) { g.tognr = c.d.tognr; g.aflyste_stop = c.d.aflyste_stop; g.aflyst = g.aflyst || c.d.aflyst; }
    }
    S.tavle = fletTavler(dep, arr);
    S.tog = geo;
    S.rtOk = true; S.rtFejl = null;
    S.rtSidst = new Date();
  } catch (e) {
    S.rtOk = false;
    S.rtFejl = String(e.message || e);
  }
});

/* ---------- plan ---------- */
const KAL_DAGTYPE = ["soendag", "man-tors", "man-tors", "man-tors", "man-tors", "fredag", "loerdag"];
function saetPlan(plan, kilde, dato) {
  S.plan = plan; S.planKilde = kilde; S.planDato = dato;
  S.idx = indekser(plan);
}

/* Opslag bygget én gang pr. plan, i stedet for at gennemsøge alle ture for
   hver række ved hver opdatering. */
function indekser(plan) {
  const tog = new Map();          // tognr -> [ture]
  const arAnk = new Map();        // løb -> ture der ender på Aarhus H (ikke gentagne)
  const vagt = new Map();         // vagt -> ture (til førerens forrige tur)
  const arAfg = [], depot = [];
  for (const t of (plan && plan.ture) || []) {
    const k = String(t.tog);
    if (!tog.has(k)) tog.set(k, []);
    tog.get(k).push(t);
    const v = String(t.vagt);
    if (!vagt.has(v)) vagt.set(v, []);
    vagt.get(v).push(t);
    if (stBase(t.fra) === "AR") arAfg.push(t);
    if (stBase(t.til) === "AR" && !t.gentaget) {
      const l = String(t.loeb);
      if (!arAnk.has(l)) arAnk.set(l, []);
      arAnk.get(l).push(t);
      if (t.depot) depot.push(t);
    }
  }
  arAfg.sort((a, b) => driftT(a.afg) - driftT(b.afg));
  return { tog, vagt, arAnk, arAfg, depot };
}
const IDX_TOM = indekser(null);
const idx = () => S.idx || IDX_TOM;
const turePaaTog = (tognr) => idx().tog.get(String(tognr)) || [];

const hentPlan = enAdGangen(async () => {
  const dato = driftsdatoISO();
  try {
    const r = await medTimeout("data/dage/" + dato + ".json", { cache: "no-store" });
    if (r.ok) { saetPlan(await r.json(), "dag", dato); return; }
  } catch (e) { /* falder videre til fallback */ }
  if (S.planKilde === "dag" && S.planDato === dato) return;   // behold hvad vi har
  try {
    const r = await medTimeout("data/fallback.json", { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const fb = await r.json();
    const dt = KAL_DAGTYPE[new Date(dato + "T12:00:00").getDay()];
    saetPlan({ dato, kalender_dagtype: dt, saerplan: false, fallback: true, ...fb.dagtyper[dt] }, "fallback", dato);
  } catch (e) {
    if (S.planDato !== dato) saetPlan(null, null, dato);
  }
});

/* ---------- afgange (porteret fra view-tabel.js:infoAfgange) ---------- */
function msNr(loeb) { return (S.plan && S.plan.ms && S.plan.ms[String(loeb)]) || null; }

function aflystPrLoeb(rt) {
  /* Aflyste ture pr. løb: tavleposter med aflyst -> plan-tur (fuld aflysning),
     kørende tog med skippede stop -> delvis. Bruges til "Delvist aflyst". */
  const ud = {};
  const put = (loeb, post) => { if (loeb != null) (ud[String(loeb)] = ud[String(loeb)] || []).push(post); };
  const findTur = (tognr) => turePaaTog(tognr)[0] || null;
  for (const r of rt.tavle) {
    if (!r.aflyst || !r.tognr) continue;
    const t = findTur(r.tognr);
    if (t) put(t.loeb, { tognr: r.tognr, delvist: false });
  }
  for (const g of rt.tog) {
    if (!g.tognr || g.aflyst || !(g.aflyste_stop || []).length) continue;
    const t = findTur(g.tognr);
    if (t) put(t.loeb, { tognr: g.tognr, delvist: true, aflyste_stop: g.aflyste_stop });
  }
  return ud;
}

function infoAfgange(rt) {
  const nm = nowMin();
  const medAnkomst = (afgang, infoRt = null) => {
    const dep = afgang.afg_min;      // alle kaldere sætter afg_min (driftsminutter)
    let ankomst = null;               // seneste AR-ankomst på løbet højst 45 min før afgangen
    for (const x of idx().arAnk.get(String(afgang.loeb)) || []) {
      const a = driftT(x.ank);
      if (a <= dep && dep - a <= 45 && (!ankomst || a > driftT(ankomst.ank))) ankomst = x;
    }
    return { afgang, ankomst, infoRt };
  };

  const liveTavle = rt.tavle.filter((x) => x.tavle === "AR-DEP" && x.afg_plan != null && x.afg_plan >= nm - 1)
    .sort((a, b) => a.afg_plan - b.afg_plan).slice(0, 12);
  /* Rejseplanen og OnlinePlan kan nummerere samme tur forskelligt (27-10-2026:
     Mårslet→Lystrup 18:31 er tog 12121 på tavlen, men 13125 kl. 18:29 i
     OnlinePlan). Findes tavlens tognummer ikke i planen, matches en planafgang
     fra Aarhus H mod samme endestation inden for ±3 min, hvis eget tognummer
     ikke står på tavlen. */
  const paaTavle = new Set(rt.tavle.filter((x) => x.tavle === "AR-DEP" && x.tognr).map((x) => String(x.tognr)));
  const planMatch = (infoRt) => {
    const t = turePaaTog(infoRt.tognr);
    if (t.length) return t;
    return idx().arAfg.filter((x) => !paaTavle.has(String(x.tog))
      && Math.abs(driftT(x.afg) - infoRt.afg_plan) <= 3 && stNavn(x.til) === infoRt.retning);
  };

  if (liveTavle.length) return medDepot(liveTavle.map((infoRt) => {
    const plan = planMatch(infoRt).slice()
      .sort((a, b) => Math.abs(driftT(a.afg) - infoRt.afg_plan) - Math.abs(driftT(b.afg) - infoRt.afg_plan))[0] || {};
    /* Tavlesvaret har ikke altid perronfeltet. På Aarhus H går sydgående L2 mod
       Mårslet/Odder fra spor 0; øvrige letbaneafgange fra spor 1. */
    const retning = infoRt.retning || stNavn(plan.til);
    const spor = infoRt.spor_rt || infoRt.spor_plan ||
      (["Mårslet", "Odder"].includes(retning) ? "0" : "1");
    return medAnkomst({
      ...plan,
      tog: infoRt.tognr || plan.tog,
      afg: null, afg_min: infoRt.afg_plan,
      til_navn: retning, spor,
    }, infoRt);
  }), nm, rt);

  /* Fallback uden realtid: planens egne afgange fra Aarhus H (forudsorteret). */
  return medDepot(idx().arAfg.filter((x) => driftT(x.afg) >= nm - 1)
    .slice(0, 12).map((afgang) => medAnkomst({
      ...afgang, afg_min: driftT(afgang.afg), til_navn: stNavn(afgang.til), spor: null,
    })), nm, rt);
}

/* Depotkørsler (Kasper 12-10-2026): ture der ender på Aarhus H og derefter
   kører i depot (CMY) — markeret af publisheren ud fra OnlinePlans
   "Aarhus depot…"-række efter turen (depot = vask | parkering | depot).
   Vises som "Depot" på ankomsttiden, flettet ind blandt afgangene. Rækker
   efter den sidste viste afgang udelades, når listen allerede er fuld, så der
   ikke opstår huller i tidsforløbet. Realtid = ankomsttavlens post for turens
   eget tognummer (forsinkelse/aflyst). */
function medDepot(afgange, nm, rt) {
  const graense = afgange.length >= 12 ? afgange[afgange.length - 1].afgang.afg_min : Infinity;
  const depot = idx().depot
    .filter((x) => driftT(x.ank) >= nm - 1 && driftT(x.ank) <= graense)
    .map((x) => {
      const infoRt = rt.tavle.find((r) => r.tognr && String(r.tognr) === String(x.tog)) || null;
      return {
        afgang: { ...x, afg_min: driftT(x.ank), til_navn: "Depot",
          spor: infoRt ? (infoRt.spor_rt || infoRt.spor_plan) : null },
        ankomst: null, infoRt,
      };
    });
  return afgange.concat(depot).sort((a, b) => a.afgang.afg_min - b.afgang.afg_min).slice(0, 12);
}

const DEPOT_NOTE = { vask: "Vask + sand", parkering: "Parkering" };

/* ---------- rendering ---------- */
/* Førernummer/-numre under vagtnummeret (Kasper 27-10-2026) — fra dagsfilens
   bemanding på hentetidspunktet; oplæringspar giver to numre. Fallback-planen
   har ingen bemanding, og så vises kun vagtnummeret. */
function foererNr(vagt) {
  const nr = S.plan && S.plan.foerere && S.plan.foerere[String(vagt)];
  return nr && nr.length ? nr.join(" · ") : "";
}

function vagtCelle(vagt, ekstra, advarsel) {
  if (!vagt) return "<span class='mangler' title='Tognummeret findes ikke i dagens plan'>—</span>";
  const under = [foererNr(vagt), ekstra].filter(Boolean).join(" · ");
  return "<strong>" + esc(vagt) + "</strong>" + (under ? "<small>" + esc(under) + "</small>" : "") +
    (advarsel ? "<small class='foererwarn'>" + esc(advarsel) + "</small>" : "");
}

/* Fører forsinket (Kasper 28-10-2026; samme regel som "overtagelse i fare" i
   server/vagtplan_app/afvigelser.py): ved førerskift kommer afgangens fører
   med et ANDET tog end det, der holder klar. Er dét tog så forsinket, at der
   er højst OVERTAGELSE_MARGIN min tilbage til afgangen, er afgangen i fare,
   selv om toget selv er til tiden. Forsinkelser under FORSINKET_MIN ses bort
   fra (jitter). Kører føreren selv toget ind, dækker afgangsforsinkelsen det. */
const FORSINKET_MIN = 4;
const OVERTAGELSE_MARGIN = 2;
function foererForsinket(afgang, ankomst, rt, rtTog, nm) {
  if (!afgang.vagt || afgang.gentaget) return null;
  const dep = afgang.afg_min;
  let forrige = null;                 // førerens seneste tur, der ankommer inden afgangen
  for (const t of idx().vagt.get(String(afgang.vagt)) || []) {
    const a = driftT(t.ank);
    if (a != null && a <= dep && String(t.tog) !== String(afgang.tog)
      && (!forrige || a > driftT(forrige.ank))) forrige = t;
  }
  if (!forrige || forrige.gentaget || stBase(forrige.til) !== "AR") return null;
  if (ankomst && String(ankomst.tog) === String(forrige.tog)) return null;
  const tavle = rt.tavle.find((r) => r.tognr && String(r.tognr) === String(forrige.tog) && r.forsinkelse_min != null);
  const kilde = tavle || rtTog.get(String(forrige.tog));
  if (!kilde || kilde.aflyst) return null;
  const fors = Number(kilde.forsinkelse_min);
  if (!Number.isFinite(fors) || fors < FORSINKET_MIN) return null;
  const ank = driftT(forrige.ank);
  if (ank + fors < nm) return null;   // føreren er allerede ankommet
  const rest = dep - ank - fors;
  if (rest > OVERTAGELSE_MARGIN) return null;
  return { tog: forrige.tog, fra: stNavn(forrige.fra), ank, fors, rest };
}

function buildBoard() {
  const board = $("#board");
  const rt = rtNu();                // tom hvis realtiden er forældet
  const afgange = infoAfgange(rt);
  const aflyst = aflystPrLoeb(rt);
  const rtTog = new Map(rt.tog.filter((x) => x.tognr).map((x) => [String(x.tognr), x]));
  /* Løb -> aktuel forsinkelse (det kørende tog på løbet nu): fallback-estimat
     for kommende afgange, hvor det indgående tog har et andet tognummer. */
  const rtLoeb = {};
  for (const [tognr, g] of rtTog) {
    const t = turePaaTog(tognr)[0];
    if (t && g.forsinkelse_min != null) rtLoeb[String(t.loeb)] = g;
  }

  let html = "<thead><tr><th class='c-linje'>Linje</th><th class='num c-afgang'>Afgang</th><th class='c-til'>Til</th>" +
    (VIS_TOGNR ? "<th class='c-tognr'>Tognr.</th>" : "") +
    "<th class='c-lobms'>Løb" + (S.plan && S.plan.ms && Object.keys(S.plan.ms).length ? " / MS" : "") + "</th>" +
    "<th class='c-vagt'>Vagt</th><th class='c-afgiver'>Afgiver</th><th class='num c-spor'>Spor</th></tr></thead><tbody>";

  for (const { afgang, ankomst, infoRt } of afgange) {
    const linje = afgang.linje ? afgang.linje.toUpperCase()
      : (["Mårslet", "Odder", "Universitetshospitalet", "Lystrup", "Lisbjergskolen"].includes(afgang.til_navn) ? "L2" : "L1");
    const ms = afgang.loeb ? msNr(afgang.loeb) : null;
    if (afgang.depot) { html += depotRaekke(afgang, infoRt, rtTog.get(String(afgang.tog)), linje, ms); continue; }
    const cn = ((afgang.loeb && aflyst[String(afgang.loeb)]) || []).find((x) => String(x.tognr) === String(afgang.tog));
    const boardRealtime = infoRt && infoRt.forsinkelse_min != null ? infoRt : null;
    /* Kilder til forsinkelse, i faldende pålidelighed:
       1) boardRealtime — afgangens EGEN prognose fra AR-DEP-tavlen (facit).
       2) togMatch — et kørende tog der broadcaster afgangens eget tognummer.
       3) løb-skøn (rtLoeb) — forsinkelsen på "det tog der kører på løbet nu".
       (3) er kun et gæt og må KUN bruges, når det lånte tog faktisk er
       afgiveren (samme tognr som den indgående ankomst). Ellers kan et fremmed
       tog — fx efter et machine shift-/løb-bytte — smitte en spøgelses-
       forsinkelse af på en afgang, Rejseplanen slet ingen prognose har på
       (set 29-08-2026: 19:48 mod Grenaa vist +9 min i et par minutter, mens
       Rejseplanens egen tavle viste den til tiden). */
    const togMatch = rtTog.get(String(afgang.tog));
    const loebSkoen = afgang.loeb ? rtLoeb[String(afgang.loeb)] : null;
    const afgiverSkoen = loebSkoen && ankomst && String(loebSkoen.tognr) === String(ankomst.tog)
      ? loebSkoen : null;
    const realtime = boardRealtime || togMatch || afgiverSkoen;
    const delayValue = realtime ? Number(realtime.forsinkelse_min) : 0;
    const delay = Number.isFinite(delayValue) ? delayValue : 0;
    /* Vendetid på Aarhus H: tiden fra det indgående togs planlagte ankomst til
       afgangen. En forsinkelse på det indgående tog æder først af vendetiden —
       kun overskuddet er reel afgangsforsinkelse. Gennemgående tog (ingen
       AR-ankomst på samme løb) beholder hele forsinkelsen. */
    const vendetid = ankomst && ankomst.ank != null && !afgang.gentaget
      ? Math.max(0, afgang.afg_min - driftT(ankomst.ank)) : null;
    const reelDelay = delay > 0 && vendetid != null ? Math.max(0, delay - vendetid) : delay;
    const bufret = delay > 0 && reelDelay < delay;
    const heltAflyst = !!((infoRt && infoRt.aflyst) || (cn && !cn.delvist));
    /* Indgående aflyst, afgangen kører: afgangen er tillyst fra Aarhus H. */
    const indAflyst = !!(infoRt && infoRt.ind_aflyst && !heltAflyst);
    /* Afkortning/overspringning efter Aarhus H fra afgangens egne turdetaljer.
       Findes de, er de facit; ellers bruges løb-opslaget fra de kørende tog. */
    const det = infoRt && infoRt.jid ? S.detaljer[infoRt.jid] : null;
    const aft = det && !heltAflyst ? afkortning(det.d) : null;
    const delvistAflyst = !heltAflyst && (det ? !!aft : !!(cn && cn.delvist));
    const tillyst = !heltAflyst && !!infoRt && erTillyst("DEP", infoRt.tognr);
    const skifte = !!(ankomst && afgang.vagt && String(ankomst.vagt) !== String(afgang.vagt));
    const risiko = heltAflyst ? null : foererForsinket(afgang, ankomst, rt, rtTog, nowMin());
    const risikoTitel = risiko ? "Føreren (vagt " + afgang.vagt + ") kommer med tog " + risiko.tog +
      (risiko.fra ? " fra " + risiko.fra : "") + ", planlagt ank. " + fmtHM(risiko.ank) + ", forsinket " +
      risiko.fors + " min → " + fmtHM(risiko.ank + risiko.fors) + ". Afgang " + fmtHM(afgang.afg_min) + ": " +
      (risiko.rest < 0 ? "føreren kommer " + (-risiko.rest) + " min for sent." : "kun " + risiko.rest + " min til overtagelsen.") : "";

    const depTitel = bufret
      ? "Indgående tog +" + delay + " min, men " + vendetid + " min vendetid på Aarhus H"
        + (reelDelay > 0 ? " → reel afgangsforsinkelse " + reelDelay + " min."
          : " → afgår til tiden (forsinkelsen sluges af vendetiden).")
      : reelDelay > 0
        ? "Forsinket " + reelDelay + " min, forventet afgang " + fmtHM(afgang.afg_min + reelDelay) + "."
        : "";
    /* Afgang-kolonnen viser ALTID den planlagte tid som det store tal (Kasper
       28-08-2026); en forsinkelse står som rødt "+N min"-mærke til venstre for
       tiden — samme mønster som AFLYST-mærket. Forventet tid ligger i title. */
    /* TILLYST: grønt mærke til venstre for tiden som AFLYST; en evt.
       forsinkelse står under som rødt "+N min". */
    const dep = heltAflyst
      ? "<span class='cancelled-departure'><strong>AFLYST</strong><time class='planned'>" + fmtHM(afgang.afg_min) + "</time></span>"
      : tillyst
        ? "<span class='reinstated-departure'><small>TILLYST</small><strong>" + fmtHM(afgang.afg_min) + "</strong></span>" +
          (reelDelay > 0 ? "<small>+" + reelDelay + " min</small>" : "")
      : reelDelay > 0
        ? "<span class='delayed-departure'><small>+" + reelDelay + " min</small><strong>" + fmtHM(afgang.afg_min) + "</strong></span>"
        : bufret
          ? "<strong>" + fmtHM(afgang.afg_min) + "</strong><small class='buffered'>+" + delay + " i vendetid</small>"
          : "<strong>" + fmtHM(afgang.afg_min) + "</strong>";

    const delvistNote = indAflyst
      ? "<small class='tillysttext' title='" + esc("Delaflysning: den indgående tur"
          + (infoRt.ind_retning ? " fra " + infoRt.ind_retning : "") + " er aflyst, men afgangen mod "
          + afgang.til_navn + " er tillyst.") + "'>Tillyst fra Aarhus H</small>"
      : aft && aft.til
        ? ""                          // afkortet: står som "(Hornslet)" efter endestationen
      : delvistAflyst
        ? "<small class='canceltext'" + ((aft ? aft.aflyste : cn && cn.aflyste_stop || []).length
            ? " title='Springer over: " + esc((aft ? aft.aflyste : cn.aflyste_stop).join(", ")) + "'" : "") +
          ">Delvist aflyst</small>"
        : "";
    /* Afkortet tur (Kasper 28-10-2026): "Grenaa (Hornslet)" — planlagt
       endestation først, det sted toget faktisk vender i parentes. */
    const tilHtml = esc(afgang.til_navn || "?") + (aft && aft.til
      ? " <span class='afkortet' title='" + esc("Kører kun til " + aft.til + ". Aflyst: " + aft.aflyste.join(", ")) +
        "'>(" + esc(aft.til) + ")</span>" : "");

    const titel = [tillyst ? "Afgangen var aflyst og er tillyst igen." : "", depTitel].filter(Boolean).join(" ");
    html += "<tr class='" + (heltAflyst ? "cancelled" : delvistAflyst ? "partial" : tillyst ? "reinstated" : "") + "'>" +
      "<td><span class='infoline " + linje.toLowerCase() + "'>" + linje + "</span></td>" +
      "<td class='departure num tnum'" + (titel ? " title='" + esc(titel) + "'" : "") + ">" + dep + "</td>" +
      "<td class='destination'>" + tilHtml + delvistNote + "</td>" +
      (VIS_TOGNR ? "<td class='train tnum'>" + esc(afgang.tog || "—") + "</td>" : "") +
      "<td class='c-lobms'>" + (afgang.loeb
        ? "<span class='inforun'>" + esc(afgang.loeb) + "</span>" + (ms ? "<small>MS " + esc(ms) + "</small>" : "")
        : "<span class='mangler' title='Tognummeret findes ikke i dagens plan'>—</span>") + "</td>" +
      "<td class='vagt'" + (risikoTitel ? " title='" + esc(risikoTitel) + "'" : "") + ">" +
        vagtCelle(afgang.vagt, null, risiko ? "Fører forsinket +" + risiko.fors : "") + "</td>" +
      "<td class='handoff'>" + (skifte
        ? vagtCelle(ankomst.vagt, "ank " + fmtHM(driftT(ankomst.ank)))
        : "<span class='same'>—</span>") + "</td>" +
      "<td class='track num tnum'>" + (afgang.spor != null ? esc(afgang.spor) : "—") + "</td></tr>";
  }
  if (!afgange.length) {
    html += "<tr><td colspan='" + (VIS_TOGNR ? 8 : 7) + "' class='infoempty'>" +
      (S.plan ? "Ingen flere afgange fra Aarhus H lige nu." : "Ingen plandata tilgængelig.") + "</td></tr>";
  }
  board.innerHTML = html + "</tbody>";
  trimRows();
  buildStatus();
}

/* Én depotrække: toget ankommer Aarhus H (tiden = planlagt ankomst) og kører
   i depot. Ingen vendetid — en forsinket ankomst forsinker depotkørslen 1:1.
   Vagt = føreren der bringer toget ind; ingen afgiver. */
function depotRaekke(afgang, infoRt, togMatch, linje, ms) {
  const rt = infoRt && infoRt.forsinkelse_min != null ? infoRt : togMatch;
  const delay = rt && Number.isFinite(Number(rt.forsinkelse_min)) ? Math.max(0, Number(rt.forsinkelse_min)) : 0;
  const aflyst = !!(infoRt && infoRt.aflyst);
  const tillyst = !aflyst && !!infoRt && erTillyst("ARR", afgang.tog);
  const note = DEPOT_NOTE[afgang.depot];
  const titel = "Tog " + afgang.tog + " ankommer Aarhus H " + fmtHM(afgang.afg_min) +
    " og kører i depot" + (afgang.depot_tid ? " (CMY " + fmtHM(driftT(afgang.depot_tid)) + ")" : "") +
    (note ? " · " + note.toLowerCase() : "") +
    (aflyst ? " · ankomsten er aflyst" : tillyst ? " · ankomsten var aflyst og er tillyst igen" : "") +
    (!aflyst && delay > 0 ? " · forsinket " + delay + " min" : "") + ".";
  const dep = aflyst
    ? "<span class='cancelled-departure'><strong>AFLYST</strong><time class='planned'>" + fmtHM(afgang.afg_min) + "</time></span>"
    : tillyst
      ? "<span class='reinstated-departure'><small>TILLYST</small><strong>" + fmtHM(afgang.afg_min) + "</strong></span>" +
        (delay > 0 ? "<small>+" + delay + " min</small>" : "")
    : delay > 0
      ? "<span class='delayed-departure'><small>+" + delay + " min</small><strong>" + fmtHM(afgang.afg_min) + "</strong></span>"
      : "<strong>" + fmtHM(afgang.afg_min) + "</strong>";
  return "<tr class='depot" + (aflyst ? " cancelled" : tillyst ? " reinstated" : "") + "' title='" + esc(titel) + "'>" +
    "<td><span class='infoline " + linje.toLowerCase() + "'>" + linje + "</span></td>" +
    "<td class='departure num tnum'>" + dep + "</td>" +
    "<td class='destination'>Depot" + (note ? "<small class='depotnote'>" + esc(note) + "</small>" : "") + "</td>" +
    (VIS_TOGNR ? "<td class='train tnum'>" + esc(afgang.tog || "—") + "</td>" : "") +
    "<td class='c-lobms'><span class='inforun'>" + esc(afgang.loeb) + "</span>" + (ms ? "<small>MS " + esc(ms) + "</small>" : "") + "</td>" +
    "<td class='vagt'>" + vagtCelle(afgang.vagt) + "</td>" +
    "<td class='handoff'><span class='same'>—</span></td>" +
    "<td class='track num tnum'>" + (afgang.spor != null ? esc(afgang.spor) : "—") + "</td></tr>";
}

/* Aldrig lodret scrollbar (Kasper 27-08-2026): passer alle rækker ikke i
   højden (fx ved kraftig zoom), fjernes de bagerste til tavlen går op —
   antallet af viste afgange tilpasser sig i stedet for at scrolle. */
function trimRows() {
  const scroll = $(".infoscroll"), body = $("#board tbody");
  if (!scroll || !body) return;
  let vagt = 0;   // værn mod uendelig løkke hvis én række aldrig kan passe
  while (scroll.scrollHeight > scroll.clientHeight + 1 && body.rows.length > 1 && vagt++ < 20)
    body.deleteRow(body.rows.length - 1);
}

/* Ingen synlig statuslinje (fjernet 27-08-2026) — status ligger i stedet som
   tooltip på uret, så den stadig kan findes ved hover uden at fylde noget. */
function buildStatus() {
  const dele = [];
  if (S.planKilde === "dag") {
    dele.push("Plan: OnlinePlan · hentet " + (S.plan.hentet || "").slice(0, 16).replace("T", " kl. ") +
      (S.plan.saerplan ? " · SÆRPLAN" + (Object.keys(S.plan.ms || {}).length ? "" : " (ingen MS-numre)") : ""));
  } else if (S.planKilde === "fallback") {
    dele.push("OBS: dagens plan er ikke hentet fra OnlinePlan. Viser fast " +
      S.plan.kalender_dagtype + "-plan (vagt/løb kan afvige på særplandage)");
  } else {
    dele.push("OBS: ingen plandata, viser kun Rejseplanens tavle");
  }
  const sidst = S.rtSidst ? S.rtSidst.toLocaleTimeString("da-DK") : null;
  dele.push(S.rtOk && sidst
    ? "Realtid: Rejseplanen · opdateret " + sidst
    : rtFrisk()
      ? "OBS: seneste realtidsopdatering fejlede. Viser realtid fra " + sidst
      : "OBS: realtid utilgængelig" + (sidst ? " (sidst " + sidst + ")" : "") + ", viser plantider");
  $("#clock").title = dele.join("\n");
}

const DATO_FMT = new Intl.DateTimeFormat("da-DK", { weekday: "long", day: "numeric", month: "long" });
let visKlokke = null;
function tickClock() {
  const n = new Date();
  const klokke = String(n.getHours()).padStart(2, "0") + ":" + String(n.getMinutes()).padStart(2, "0");
  if (klokke !== visKlokke) {
    visKlokke = klokke;
    $("#clock").textContent = klokke;
    $("#date").textContent = DATO_FMT.format(n);
  }
  if (driftsdatoISO() !== S.sidsteDrift) nytDriftsdoegn();
}

/* Nyt driftsdøgn (kl. 04): genindlæs siden, så ny dagsfil og evt. nyt deploy
   samles op — kiosk-skærmen kører i ugevis uden betjening. Genindlæs KUN når
   siden kan nås: et reload uden net giver browserens fejlside, hvor intet
   script kører, og skærmen står død. Uden net hentes dagens plan i den kørende
   side i stedet (dagsfil eller fallback), og reload forsøges igen om et minut. */
let naesteGenindlaes = 0;
async function nytDriftsdoegn() {
  if (Date.now() < naesteGenindlaes) return;
  naesteGenindlaes = Date.now() + 60 * 1000;
  try {
    const r = await medTimeout(location.href, { method: "HEAD", cache: "no-store" });
    if (r.ok) { location.reload(); return; }
  } catch (e) { /* offline: prøv igen om et minut */ }
  if (S.planDato !== driftsdatoISO()) opdater(true);
}

/* ---------- opstart & timere ---------- */
async function opdater(medPlan) {
  if (medPlan) await hentPlan();
  await hentRt();
  buildBoard();
}

/* ---------- udseende: lys/mørk efter klokken + sol/måne-toggle ----------
   Skema (Kasper 28-08-2026): mørk tilstand fra kl. 20:00, lys fra kl. 05:40.
   Skiftet er ØJEBLIKKELIGT (05-09-2026: den gradvise 10 min-overgang med
   interpolerede farve-tokens er fjernet — den så ikke godt ud på skærmen).
   data-theme på :root styrer alle tokens i overblik.css (inkl. logoet via
   --moerk). Head-scriptet i index.html sætter samme klokke-tema før første
   maling mod blink. Et klik på sol/måne gælder til næste planlagte skifte;
   ?tema=moerk|lys fastlåser valget og slår skemaet fra (gemmes som "temaFast"
   i localStorage; ?tema=auto fjerner låsen igen). */
const TEMA_MOERK_FRA = 20 * 60;     // mørk fra 20:00
const TEMA_LYS_FRA = 5 * 60 + 40;   // lys fra 05:40
const temaFast = () => {
  try { const t = localStorage.getItem("temaFast"); return t === "light" || t === "dark" ? t : null; }
  catch (e) { return null; }
};
const moerkNu = () => {
  const t = document.documentElement.getAttribute("data-theme");
  return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
};
const klokkeMin = () => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); };

/* Planlagt fase efter klokken: "dark" 20:00–05:40, ellers "light". */
const temaFase = (min) => (min >= TEMA_MOERK_FRA || min < TEMA_LYS_FRA ? "dark" : "light");

let temaManuel = null;   // fasen da der blev klikket — valget gælder til fasen skifter
function tickTema() {
  if (temaFast()) return;
  const fase = temaFase(klokkeMin());
  if (temaManuel != null) {
    if (fase === temaManuel) return;   // planlagt skifte ikke nået endnu
    temaManuel = null;
  }
  if (document.documentElement.getAttribute("data-theme") !== fase) {
    document.documentElement.setAttribute("data-theme", fase);
    opdaterTemaIkon();
  }
}

function opdaterTemaIkon() {
  const btn = $("#themeBtn");
  btn.textContent = moerkNu() ? "☀" : "☾";
  const til = moerkNu() ? "lys" : "mørk";
  btn.title = "Skift til " + til + " tilstand";
  btn.setAttribute("aria-label", "Skift til " + til + " tilstand");
}
function initTheme() {
  const p = new URLSearchParams(location.search).get("tema");
  const valg = { moerk: "dark", dark: "dark", lys: "light", light: "light" }[p];
  try {
    if (valg) localStorage.setItem("temaFast", valg);
    else if (p === "auto") localStorage.removeItem("temaFast");
    localStorage.removeItem("tema");   // nøglen fra før skemaet (28-08-2026)
  } catch (e) {}
  const fast = temaFast();
  if (fast) document.documentElement.setAttribute("data-theme", fast);
  else document.documentElement.setAttribute("data-theme", temaFase(klokkeMin()));
  opdaterTemaIkon();
  $("#themeBtn").addEventListener("click", () => {
    temaManuel = temaFase(klokkeMin());
    document.documentElement.setAttribute("data-theme", moerkNu() ? "light" : "dark");
    try { if (temaFast()) localStorage.setItem("temaFast", moerkNu() ? "dark" : "light"); } catch (e) {}
    opdaterTemaIkon();
  });
}

/* Fuldskærms- og temaknappen fader væk i ro og vises ved musebevægelse —
   porteret fra view-tabel.js' showInfoFullscreenControl (1,6 s), men aktiv
   hele tiden, så kioskskærmen står helt ren. */
let uiFadeTimer = null;
function visUiKnapper() {
  const board = $(".infoboard");
  board.classList.add("ui-visible");
  clearTimeout(uiFadeTimer);
  uiFadeTimer = setTimeout(() => board.classList.remove("ui-visible"), 1600);
}

function initFullscreen() {
  const btn = $("#fullscreen");
  btn.addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  });
  document.addEventListener("fullscreenchange", () => {
    btn.textContent = document.fullscreenElement ? "↙" : "⛶";
  });
}

initTheme();
initFullscreen();
for (const ev of ["mousemove", "pointerdown", "touchstart"])
  document.addEventListener(ev, visUiKnapper, { passive: true });
/* Skrifter kan lande efter første render og ændre rækkehøjderne — efterbeskær. */
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => trimRows());
tickClock();
opdater(true);
setInterval(tickClock, 1000);
setInterval(tickTema, 5 * 1000);                       // planlagt lys/mørk-skifte (øjeblikkeligt)
let resizeTimer = null;   // zoom udløser resize: genbyg så rækkeantallet passer
window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(buildBoard, 200); });
setInterval(() => opdater(false), 40 * 1000);          // realtid
setInterval(() => hentPlan().then(buildBoard), 15 * 60 * 1000);   // ny dagsfil publiceret?
document.addEventListener("visibilitychange", () => { if (!document.hidden) opdater(true); });
