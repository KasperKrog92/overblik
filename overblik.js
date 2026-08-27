"use strict";
/* Afgangsoverblik · Aarhus H — offentlig, statisk udgave af OCC Overbliks
   infoskærm. INGEN persondata: kun vagtnumre, løb, tognumre og tider.

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
const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
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
const BASE_NAVN = { "1": "Aarhus", "2": "Grenaa", "3": "Odder" };
const vagtBase = (v) => BASE_NAVN[String(v || "").length === 5 ? String(v)[1] : String(v)[0]] || "";

/* ---------- state ---------- */
const S = {
  plan: null,          // {dato, saerplan, ms, ture:[...]} (dagsfil eller fallback)
  planKilde: null,     // 'dag' | 'fallback' | null
  planDato: null,      // driftsdatoen planen blev indlæst for
  tavle: [],           // flettede tavle-poster (AR-DEP facit for afgange)
  tog: [],             // JourneyGeoPos: kørende tog {jid, tognr?, forsinkelse_min, aflyst}
  detaljer: {},        // jid -> JourneyDetails {tognr, aflyst, aflyste_stop} (cache)
  rtOk: false, rtSidst: null, rtFejl: null,
  sidsteDrift: driftsdatoISO(),
};

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
  const r = await fetch(MGATE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
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

async function hentTavle(typ) {
  const res = await mgate("StationBoard", {
    type: typ, stbLoc: { lid: LID_AR }, jnyFltrL: PROD_LETBANE, maxJny: 60, dur: 90,
  });
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
      aflyst: !!jny.isCncl || stopL.some((s) => s.aCncl || s.dCncl),
    };
  });
}

/* JourneyDetails pr. jid (cache; højst `budget` nye kald pr. opdatering). */
let detaljeBudget = 0;
async function detalje(jid) {
  if (!jid) return null;
  if (jid in S.detaljer) return S.detaljer[jid];
  if (detaljeBudget <= 0) return null;
  detaljeBudget--;
  try {
    const res = await mgate("JourneyDetails", { jid, getPolyline: false });
    const jny = res.journey || {};
    const common = res.common || {};
    const prod = (common.prodL || [])[jny.prodX] || {};
    const locL = common.locL || [];
    const aflyste = [];
    for (const s of jny.stopL || []) {
      if (s.aCncl || s.dCncl) {
        const loc = locL[s.locX] || {};
        if (loc.name) aflyste.push(rpNavn(loc.name));
      }
    }
    const d = { tognr: (prod.prodCtx || {}).num || null, aflyst: !!jny.isCncl, aflyste_stop: aflyste };
    S.detaljer[jid] = d;
    return d;
  } catch (e) { return null; }    // midlertidig fejl: cache ikke
}

async function hentRt() {
  detaljeBudget = 5;
  try {
    const [dep, arr, geo] = await Promise.all([hentTavle("DEP"), hentTavle("ARR"), hentGeoPos()]);
    S.tavle = fletTavler(dep, arr);
    for (const g of geo) {                          // tognr på kørende tog (cachet)
      const d = await detalje(g.jid);
      if (d) { g.tognr = d.tognr; g.aflyste_stop = d.aflyste_stop; g.aflyst = g.aflyst || d.aflyst; }
    }
    S.tog = geo;
    S.rtOk = true; S.rtFejl = null;
    S.rtSidst = new Date();
  } catch (e) {
    S.rtOk = false;
    S.rtFejl = String(e.message || e);
  }
}

/* ---------- plan ---------- */
const KAL_DAGTYPE = ["soendag", "man-tors", "man-tors", "man-tors", "man-tors", "fredag", "loerdag"];
async function hentPlan() {
  const dato = driftsdatoISO();
  try {
    const r = await fetch("data/dage/" + dato + ".json", { cache: "no-store" });
    if (r.ok) {
      S.plan = await r.json();
      S.planKilde = "dag"; S.planDato = dato;
      return;
    }
  } catch (e) { /* falder videre til fallback */ }
  if (S.planKilde === "dag" && S.planDato === dato) return;   // behold hvad vi har
  try {
    const r = await fetch("data/fallback.json", { cache: "no-store" });
    const fb = await r.json();
    const dt = KAL_DAGTYPE[new Date(dato + "T12:00:00").getDay()];
    S.plan = { dato, kalender_dagtype: dt, saerplan: false, fallback: true, ...fb.dagtyper[dt] };
    S.planKilde = "fallback"; S.planDato = dato;
  } catch (e) {
    if (S.planDato !== dato) { S.plan = null; S.planKilde = null; S.planDato = dato; }
  }
}

/* ---------- afgange (porteret fra view-tabel.js:infoAfgange) ---------- */
function msNr(loeb) { return (S.plan && S.plan.ms && S.plan.ms[String(loeb)]) || null; }

function aflystPrLoeb() {
  /* Aflyste ture pr. løb: tavleposter med aflyst -> plan-tur (fuld aflysning),
     kørende tog med skippede stop -> delvis. Bruges til "Delvist aflyst". */
  const ud = {};
  const put = (loeb, post) => { if (loeb != null) (ud[String(loeb)] = ud[String(loeb)] || []).push(post); };
  const ture = (S.plan && S.plan.ture) || [];
  const findTur = (tognr) => ture.filter((t) => String(t.tog) === String(tognr))[0] || null;
  for (const r of S.tavle) {
    if (!r.aflyst || !r.tognr) continue;
    const t = findTur(r.tognr);
    if (t) put(t.loeb, { tognr: r.tognr, delvist: false });
  }
  for (const g of S.tog) {
    if (!g.tognr || g.aflyst || !(g.aflyste_stop || []).length) continue;
    const t = findTur(g.tognr);
    if (t) put(t.loeb, { tognr: g.tognr, delvist: true, aflyste_stop: g.aflyste_stop });
  }
  return ud;
}

function infoAfgange() {
  const alle = (S.plan && S.plan.ture) || [];
  const nm = nowMin();
  const medAnkomst = (afgang, infoRt = null) => {
    const dep = afgang.afg_min;      // alle kaldere sætter afg_min (driftsminutter)
    const ankomst = alle
      .filter((x) => String(x.loeb) === String(afgang.loeb) && stBase(x.til) === "AR" &&
        !x.gentaget && driftT(x.ank) <= dep && dep - driftT(x.ank) <= 45)
      .sort((a, b) => driftT(b.ank) - driftT(a.ank))[0] || null;
    return { afgang, ankomst, infoRt };
  };

  const liveTavle = S.rtOk
    ? S.tavle.filter((x) => x.tavle === "AR-DEP" && x.afg_plan != null && x.afg_plan >= nm - 1)
      .sort((a, b) => a.afg_plan - b.afg_plan).slice(0, 12)
    : [];
  if (liveTavle.length) return liveTavle.map((infoRt) => {
    const plan = alle.filter((x) => String(x.tog) === String(infoRt.tognr))
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
      iPlan: !!plan.tog,
    }, infoRt);
  });

  /* Fallback uden realtid: planens egne afgange fra Aarhus H. */
  return alle.filter((x) => stBase(x.fra) === "AR" && driftT(x.afg) >= nm - 1)
    .sort((a, b) => driftT(a.afg) - driftT(b.afg))
    .slice(0, 12).map((afgang) => medAnkomst({
      ...afgang, afg_min: driftT(afgang.afg), til_navn: stNavn(afgang.til),
      spor: null, iPlan: true,
    }));
}

/* ---------- rendering ---------- */
function vagtCelle(vagt, ekstra) {
  if (!vagt) return "<span class='mangler' title='Tognummeret findes ikke i dagens plan'>—</span>";
  const base = vagtBase(vagt);
  return "<strong>" + esc(vagt) + "</strong><small>" + esc([base, ekstra].filter(Boolean).join(" · ")) + "</small>";
}

function buildBoard() {
  const board = $("#board");
  const afgange = infoAfgange();
  const aflyst = aflystPrLoeb();
  const rtTog = new Map(S.tog.filter((x) => x.tognr).map((x) => [String(x.tognr), x]));
  const ture = (S.plan && S.plan.ture) || [];
  /* Løb -> aktuel forsinkelse (det kørende tog på løbet nu): fallback-estimat
     for kommende afgange, hvor det indgående tog har et andet tognummer. */
  const rtLoeb = {};
  for (const [tognr, g] of rtTog) {
    const t = ture.filter((x) => String(x.tog) === tognr)[0];
    if (t && g.forsinkelse_min != null) rtLoeb[String(t.loeb)] = g;
  }

  let html = "<thead><tr><th>Linje</th><th class='num'>Afgang</th><th>Til</th><th>Tognr.</th>" +
    "<th>Løb" + (S.plan && S.plan.ms && Object.keys(S.plan.ms).length ? " / MS" : "") + "</th>" +
    "<th>Vagt</th><th>Afgiver</th><th class='num'>Spor</th></tr></thead><tbody>";

  for (const { afgang, ankomst, infoRt } of afgange) {
    const linje = afgang.linje ? afgang.linje.toUpperCase()
      : (["Mårslet", "Odder", "Universitetshospitalet", "Lystrup", "Lisbjergskolen"].includes(afgang.til_navn) ? "L2" : "L1");
    const ms = afgang.loeb ? msNr(afgang.loeb) : null;
    const cn = ((afgang.loeb && aflyst[String(afgang.loeb)]) || []).find((x) => String(x.tognr) === String(afgang.tog));
    const boardRealtime = infoRt && infoRt.forsinkelse_min != null ? infoRt : null;
    const realtime = boardRealtime || rtTog.get(String(afgang.tog)) || (afgang.loeb && rtLoeb[String(afgang.loeb)]);
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
    const indAflyst = !!(infoRt && infoRt.ind_aflyst && !heltAflyst);
    const delvistAflyst = !!(((cn && cn.delvist) || indAflyst) && !heltAflyst);
    const skifte = !!(ankomst && afgang.vagt && String(ankomst.vagt) !== String(afgang.vagt));

    const bufTitel = bufret
      ? "Indgående tog +" + delay + " min, men " + vendetid + " min vendetid på Aarhus H"
        + (reelDelay > 0 ? " → reel afgangsforsinkelse " + reelDelay + " min."
          : " → afgår til tiden (forsinkelsen sluges af vendetiden).")
      : "";
    const dep = heltAflyst
      ? "<span class='cancelled-departure'><strong>AFLYST</strong><time class='planned'>" + fmtHM(afgang.afg_min) + "</time></span>"
      : reelDelay > 0
        ? "<time class='planned'>" + fmtHM(afgang.afg_min) + "</time><strong>" + fmtHM(afgang.afg_min + reelDelay) + "</strong><small>+" + reelDelay + " min</small>"
        : bufret
          ? "<strong>" + fmtHM(afgang.afg_min) + "</strong><small class='buffered'>+" + delay + " i vendetid</small>"
          : "<strong>" + fmtHM(afgang.afg_min) + "</strong>";

    const delvistNote = indAflyst
      ? "<small class='canceltext' title='" + esc("Delaflysning: den indgående tur"
          + (infoRt.ind_retning ? " fra " + infoRt.ind_retning : "") + " er aflyst, men afgangen mod "
          + afgang.til_navn + " er tillyst.") + "'>Indgående aflyst</small>"
      : delvistAflyst
        ? "<small class='canceltext'" + (cn && cn.aflyste_stop && cn.aflyste_stop.length
            ? " title='Springer over: " + esc(cn.aflyste_stop.join(", ")) + "'" : "") + ">Delvist aflyst</small>"
        : "";

    html += "<tr class='" + (heltAflyst ? "cancelled" : delvistAflyst ? "partial" : "") + "'>" +
      "<td><span class='infoline " + linje.toLowerCase() + "'>" + linje + "</span></td>" +
      "<td class='departure num tnum'" + (bufTitel ? " title='" + esc(bufTitel) + "'" : "") + ">" + dep + "</td>" +
      "<td class='destination'>" + esc(afgang.til_navn || "?") + delvistNote + "</td>" +
      "<td class='train tnum'>" + esc(afgang.tog || "—") + "</td>" +
      "<td>" + (afgang.loeb
        ? "<span class='inforun'>" + esc(afgang.loeb) + "</span>" + (ms ? "<small>MS " + esc(ms) + "</small>" : "")
        : "<span class='mangler' title='Tognummeret findes ikke i dagens plan'>—</span>") + "</td>" +
      "<td class='vagt'>" + vagtCelle(afgang.vagt) + "</td>" +
      "<td class='handoff'>" + (skifte
        ? vagtCelle(ankomst.vagt, "ank " + fmtHM(driftT(ankomst.ank)))
        : "<span class='same'>—</span>") + "</td>" +
      "<td class='track num tnum'>" + (afgang.spor != null ? esc(afgang.spor) : "—") + "</td></tr>";
  }
  if (!afgange.length) {
    html += "<tr><td colspan='8' class='infoempty'>" +
      (S.plan ? "Ingen flere afgange fra Aarhus H lige nu." : "Ingen plandata tilgængelig.") + "</td></tr>";
  }
  board.innerHTML = html + "</tbody>";
  buildStatus();
}

function buildStatus() {
  const dele = [];
  if (S.planKilde === "dag") {
    dele.push("<span>Plan: OnlinePlan · hentet " + esc((S.plan.hentet || "").replace("T", " kl. ").slice(0, 22)) + "</span>");
    if (S.plan.saerplan) dele.push("<span class='badge saer'>SÆRPLAN — ingen MS-numre</span>");
  } else if (S.planKilde === "fallback") {
    dele.push("<span class='badge warn'>Dagens plan er ikke hentet fra OnlinePlan — viser fast " +
      esc(S.plan.kalender_dagtype) + "-plan (vagt/løb kan afvige på særplandage)</span>");
  } else {
    dele.push("<span class='badge warn'>Ingen plandata — viser kun Rejseplanens tavle</span>");
  }
  if (S.rtOk && S.rtSidst) {
    dele.push("<span>Realtid: Rejseplanen · opdateret " + S.rtSidst.toLocaleTimeString("da-DK") + "</span>");
  } else {
    dele.push("<span class='badge warn'>Realtid utilgængelig" +
      (S.rtSidst ? " (sidst " + S.rtSidst.toLocaleTimeString("da-DK") + ")" : "") + " — viser plantider</span>");
  }
  $("#status").innerHTML = dele.join("<span class='dot'>·</span>");
}

function tickClock() {
  const n = new Date();
  $("#clock").textContent = String(n.getHours()).padStart(2, "0") + ":" + String(n.getMinutes()).padStart(2, "0");
  $("#date").textContent = new Intl.DateTimeFormat("da-DK", { weekday: "long", day: "numeric", month: "long" }).format(n);
  /* Nyt driftsdøgn (kl. 04): genindlæs siden, så ny dagsfil og evt. nyt deploy
     samles op — kiosk-skærmen kører i ugevis uden betjening. */
  if (driftsdatoISO() !== S.sidsteDrift) location.reload();
}

/* ---------- opstart & timere ---------- */
async function opdater(medPlan) {
  if (medPlan) await hentPlan();
  await hentRt();
  buildBoard();
}

function initTheme() {
  const p = new URLSearchParams(location.search).get("tema");
  if (p === "moerk" || p === "dark") document.documentElement.dataset.theme = "dark";
  else if (p === "lys" || p === "light") document.documentElement.dataset.theme = "light";
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
tickClock();
opdater(true);
setInterval(tickClock, 1000);
setInterval(() => opdater(false), 40 * 1000);          // realtid
setInterval(() => hentPlan().then(buildBoard), 15 * 60 * 1000);   // ny dagsfil publiceret?
document.addEventListener("visibilitychange", () => { if (!document.hidden) opdater(true); });
