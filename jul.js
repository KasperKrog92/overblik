/* Juletema til afgangsoverblikket — selvstændigt, rører ikke overblik.js.

   Sæson: 1.–26. december. Uden for sæsonen sker der intet, og knappen er væk,
   så filen kan blive liggende året rundt. ?jul=1 tvinger temaet til (afprøvning),
   ?jul=0 slår det helt fra, ?jul=demo spiller en scene hvert 8. sekund.

   Statisk pynt (jul.css): lyskæde, sne på sidehovedets kant og nissehue på uret.
   En gang imellem (hvert 8.–22. minut, tilfældigt) laver en nisse et nummer i
   sidehovedet, og ved hvert timeskift sner det dér i et halvt minut. Intet
   dækker afgangstavlen. Ved "færre animationer" i systemet vises kun pynten.

   Knappen (nissehue ved siden af fuldskærm) slår temaet fra og til og er skjult
   i ro som de andre hjørneknapper. Valget huskes pr. skærm i localStorage. */
(() => {
  const NOEGLE = "julFra";
  const SAESON_SLUT = 26;                       // sidste dag i december med tema
  const q = new URLSearchParams(location.search).get("jul");
  const demo = q === "demo";
  const rod = document.documentElement;
  const hoved = document.querySelector(".infohead");
  const ur = document.getElementById("clock");
  if (!hoved || !ur) return;

  const HUE = "<path d='M10.5 20.5 Q12 7 27 3 Q25 10 29.5 20.5 Q20 16.5 10.5 20.5 Z' fill='var(--jul-roed)'/>" +
    "<circle cx='27.6' cy='3.8' r='3' fill='#fff' stroke='#c3c8cf' stroke-width='.5'/>";
  const NISSE = "<svg class='jul-fig' viewBox='0 0 40 56' xmlns='http://www.w3.org/2000/svg'>" +
    "<g class='jul-ben-v'><rect x='14' y='42' width='5' height='9' rx='2' fill='var(--jul-roed)'/><ellipse cx='17' cy='52.6' rx='4.8' ry='2.6' fill='#3a2a1e'/></g>" +
    "<g class='jul-ben-h'><rect x='21' y='42' width='5' height='9' rx='2' fill='var(--jul-roed)'/><ellipse cx='24' cy='52.6' rx='4.8' ry='2.6' fill='#3a2a1e'/></g>" +
    "<path d='M11 45.5 Q10 30 20 30 Q30 30 29 45.5 Z' fill='var(--jul-graa)'/>" +
    "<g class='jul-arm-v'><path d='M12.5 35 L6.5 41' stroke='var(--jul-graa)' stroke-width='4' stroke-linecap='round'/><circle cx='6' cy='41.6' r='2.4' fill='#f2c9a5'/></g>" +
    "<g class='jul-arm-h'><path d='M27.5 35 L33.5 41' stroke='var(--jul-graa)' stroke-width='4' stroke-linecap='round'/><circle cx='34' cy='41.6' r='2.4' fill='#f2c9a5'/></g>" +
    "<circle cx='20' cy='24' r='8.6' fill='#f2c9a5'/>" +
    "<circle cx='13.8' cy='26' r='1.9' fill='#e8957f' opacity='.6'/><circle cx='26.2' cy='26' r='1.9' fill='#e8957f' opacity='.6'/>" +
    "<g class='jul-oejne' fill='#2b2b2b'><circle cx='16.8' cy='22.6' r='1.3'/><circle cx='23.2' cy='22.6' r='1.3'/></g>" +
    "<path d='M11.6 26 Q12 40 20 42.5 Q28 40 28.4 26 Q24 30.5 20 28 Q16 30.5 11.6 26 Z' fill='#fff' stroke='#c3c8cf' stroke-width='.6'/>" +
    "<circle cx='20' cy='26.8' r='2.3' fill='#e8957f'/>" +
    HUE + "<g class='jul-bytte' transform='translate(-3 -13) rotate(-8 20 12)'>" + HUE + "</g></svg>";

  const fra = () => { try { return localStorage.getItem(NOEGLE) === "1"; } catch (e) { return false; } };
  const iSaeson = () => {
    if (q === "0") return false;
    if (q === "1" || demo) return true;
    const n = new Date();
    return n.getMonth() === 11 && n.getDate() <= SAESON_SLUT;
  };
  const rolig = matchMedia("(prefers-reduced-motion: reduce)");

  const knap = document.createElement("button");
  knap.type = "button";
  knap.className = "infofullscreen infojul";
  knap.hidden = true;
  knap.innerHTML = "<svg viewBox='0 0 40 34' aria-hidden='true'><path d='M6 26 Q10 6 31 4 Q26 13 33 26 Z' fill='currentColor'/>" +
    "<rect x='3' y='23' width='33' height='8.5' rx='4.2' fill='currentColor' opacity='.55'/><circle cx='32' cy='5' r='4.2' fill='currentColor' opacity='.55'/></svg>";
  hoved.appendChild(knap);
  const scene = document.createElement("div");
  scene.className = "julscene";
  scene.setAttribute("aria-hidden", "true");
  hoved.appendChild(scene);

  let aktiv = false, gen = 0, timer = null, hueTimer = null, sidste = null, sneTime = -1, optaget = false;

  /* ---- hjælpere: en scene afbrydes (kaster), hvis temaet slås fra undervejs ---- */
  const AFBRUDT = {};
  const tjek = (g) => { if (g !== gen) throw AFBRUDT; };
  const vent = (ms, g) => new Promise((r) => setTimeout(r, ms)).then(() => tjek(g));
  const anim = (el, rammer, valg, g) =>
    el.animate(rammer, Object.assign({ fill: "forwards" }, valg)).finished.then(() => tjek(g));
  const nisse = () => {
    const n = document.createElement("div");
    n.className = "jul-nisse";
    n.innerHTML = NISSE;
    scene.appendChild(n);
    return n;
  };
  const FART = 170;   // px pr. sekund
  const loeb = (n, x0, x1, g, fart) => {
    n.classList.add("hopper");
    return anim(n, [{ transform: `translateX(${x0}px)` }, { transform: `translateX(${x1}px)` }],
      { duration: Math.abs(x1 - x0) / (fart || FART) * 1000, easing: "linear" }, g)
      .then(() => n.classList.remove("hopper"));
  };
  const hop = (n, x, g) =>
    anim(n, [{ transform: `translate(${x}px,0)` }, { transform: `translate(${x}px,-45%)`, easing: "ease-in" },
      { transform: `translate(${x}px,0)` }], { duration: 420, easing: "ease-out" }, g);
  const venstre = (el) => el.getBoundingClientRect().left - hoved.getBoundingClientRect().left;
  const hoejre = (el) => el.getBoundingClientRect().right - hoved.getBoundingClientRect().left;

  /* ---- scenerne ---- */
  const scener = {
    /* Hopper tværs over sidehovedet og standser halvvejs for at vinke. */
    async loeb(g) {
      const n = nisse(), w = scene.clientWidth, b = n.offsetWidth;
      const fraV = Math.random() < .5, a = fraV ? -b - 10 : w + 10, z = fraV ? w + 10 : -b - 10;
      const midt = w * (.3 + Math.random() * .4);
      await loeb(n, a, midt, g);
      n.classList.add("vinker"); await vent(1700, g); n.classList.remove("vinker");
      await loeb(n, midt, z, g);
    },
    /* Dukker op bag snekanten et ledigt sted, kigger sig omkring, vinker og dukker sig. */
    async kig(g) {
      const n = nisse(), b = n.offsetWidth;
      const led = [[hoejre(hoved.querySelector(".infobrand")) + 24, venstre(hoved.querySelector(".infotitle")) - 24 - b],
        [hoejre(hoved.querySelector(".infotitle")) + 24, venstre(hoved.querySelector(".infoactions")) - 24 - b]]
        .filter(([a, z]) => z > a);
      const [a, z] = led.length ? led[Math.floor(Math.random() * led.length)] : [scene.clientWidth * .4, scene.clientWidth * .4];
      const x = a + Math.random() * (z - a);
      const y = (p) => ({ transform: `translate(${x}px,${p}%)` });
      await anim(n, [y(105), y(54)], { duration: 700, easing: "ease-out" }, g);
      n.classList.add("kigger"); await vent(2600, g);
      await anim(n, [y(54), y(8)], { duration: 350, easing: "ease-out" }, g);
      n.classList.add("vinker"); await vent(1800, g); n.classList.remove("vinker");
      await anim(n, [y(8), y(105)], { duration: 380, easing: "ease-in" }, g);
    },
    /* Drilleri: løber hen og skubber til uret, så det gynger, griner og stikker af. */
    async vip(g) {
      const n = nisse(), w = scene.clientWidth, x = venstre(ur) - n.offsetWidth - 4;
      await loeb(n, w + 10, x, g);
      ur.animate([{ transform: "rotate(0)" }, { transform: "rotate(7deg)" }, { transform: "rotate(-5deg)" },
        { transform: "rotate(3deg)" }, { transform: "rotate(-1.5deg)" }, { transform: "rotate(0)" }],
        { duration: 2400, easing: "ease-in-out" });
      await hop(n, x, g);
      n.classList.add("griner"); await vent(1500, g); n.classList.remove("griner");
      await loeb(n, x, w + 10, g, FART * 1.5);
    },
    /* Drilleri: stjæler nissehuen fra uret og løber med den. Huen falder på plads igen lidt efter. */
    async hue(g) {
      const n = nisse(), b = n.offsetWidth, x = venstre(ur) - b * .7;
      await loeb(n, -b - 10, x, g);
      await vent(350, g);
      const op = hop(n, x, g);
      await vent(200, g);
      ur.classList.add("jul-hue-vaek"); n.classList.add("har-hue");
      await op;
      n.classList.add("griner"); await vent(900, g); n.classList.remove("griner");
      await loeb(n, x, -b - 10, g, FART * 1.6);
      hueTimer = setTimeout(() => {
        ur.classList.remove("jul-hue-vaek");
        ur.classList.add("jul-hue-retur");
        setTimeout(() => ur.classList.remove("jul-hue-retur"), 1000);
      }, demo ? 3000 : 45 * 1000);
    },
  };

  async function spil(navn) {
    if (!aktiv || optaget) return;
    const valg = Object.keys(scener).filter((s) => s !== sidste);
    navn = scener[navn] ? navn : valg[Math.floor(Math.random() * valg.length)];
    sidste = navn; optaget = true;
    const g = gen;
    try { await scener[navn](g); }
    catch (e) { if (e !== AFBRUDT) console.warn("jul:", e); }
    finally { optaget = false; if (g === gen) scene.querySelectorAll(".jul-nisse").forEach((n) => n.remove()); }
  }

  /* Snefald i sidehovedet: fnuggene falder i ca. 25 s og løber så ud af sig selv. */
  function sne() {
    if (!aktiv || rolig.matches || document.hidden) return;
    const g = gen, fnug = [];
    for (let i = 0; i < 34; i++) {
      const f = document.createElement("span"), d = 3 + Math.random() * 4;
      f.className = "jul-fnug";
      f.style.cssText = `left:${Math.random() * 100}%;width:${d}px;height:${d}px;` +
        `animation-duration:${4 + Math.random() * 5}s;animation-delay:${Math.random() * 5}s;` +
        `--drift:${Math.round(Math.random() * 50 - 25)}px`;
      scene.appendChild(f); fnug.push(f);
    }
    setTimeout(() => { if (g === gen) scene.classList.add("sne-slut"); }, 25 * 1000);
    setTimeout(() => { if (g === gen) { fnug.forEach((f) => f.remove()); scene.classList.remove("sne-slut"); } }, 36 * 1000);
  }

  function planlaeg() {
    clearTimeout(timer);
    if (!aktiv) return;
    const ms = demo ? 8000 : (8 + Math.random() * 14) * 60 * 1000;
    timer = setTimeout(async () => {
      if (!document.hidden && !rolig.matches) await spil();
      planlaeg();
    }, ms);
  }

  function ryd() {
    gen++;
    clearTimeout(timer); clearTimeout(hueTimer);
    scene.replaceChildren();
    scene.classList.remove("sne-slut");
    ur.getAnimations().forEach((a) => a.cancel());
    ur.classList.remove("jul-hue-vaek", "jul-hue-retur");
    optaget = false;
  }

  function opdater() {
    const saeson = iSaeson(), skalVaere = saeson && !fra();
    knap.hidden = !saeson;
    knap.classList.toggle("fra", !skalVaere);
    const tekst = skalVaere ? "Slå juletema fra" : "Slå juletema til";
    knap.title = tekst; knap.setAttribute("aria-label", tekst);
    if (skalVaere === aktiv) return;
    aktiv = skalVaere;
    rod.classList.toggle("jul", aktiv);
    if (aktiv) planlaeg(); else ryd();
  }

  knap.addEventListener("click", () => {
    try { localStorage.setItem(NOEGLE, fra() ? "0" : "1"); } catch (e) {}
    opdater();
  });
  /* Hvert halve minut: sæsonen kan begynde/slutte, mens kioskskærmen kører, og
     ved timeskift sner det. */
  setInterval(() => {
    opdater();
    const n = new Date();
    if (aktiv && n.getMinutes() === 0 && sneTime !== n.getHours()) { sneTime = n.getHours(); sne(); }
  }, 30 * 1000);
  opdater();
  window.jul = { spil, sne };   // til afprøvning i konsollen: jul.spil("hue"), jul.sne()
})();
