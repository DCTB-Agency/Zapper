"use strict";
/* Zapper: persoonlijke tv-gids voor het Telenet-basisaanbod.
   Gegevens: web/data/*.json (dagelijks gemaakt door gids.py).
   Gebruikers en voorkeuren: Supabase, of localStorage in demo-modus. */

const CFG = window.TVGIDS_CONFIG || {};
const TZ = "Europe/Brussels";
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = s => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9+&' ]+/g, " ").replace(/\s+/g, " ").trim();
const nu = () => Math.floor(Date.now() / 1000);

/* ---------- Tijd (altijd Belgische tijd, ook als het toestel elders staat) ---------- */
const fUur = new Intl.DateTimeFormat("nl-BE", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const fIso = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const fDelen = new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" });
const tijd = ts => fUur.format(new Date(ts * 1000));
const isoVan = ts => fIso.format(new Date(ts * 1000));
const tvDag = ts => isoVan(ts - 6 * 3600);
function uurVan(ts) { const p = Object.fromEntries(fDelen.formatToParts(new Date(ts * 1000)).map(x => [x.type, x.value])); return +p.hour + +p.minute / 60; }
function offset(ts) {
  const p = Object.fromEntries(fDelen.formatToParts(new Date(ts * 1000)).map(x => [x.type, +x.value]));
  return (Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute) / 1000) - ts;
}
function lokaal(iso, uur, min = 0) {
  const [y, m, d] = iso.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d, uur, min) / 1000;
  return t - offset(t - offset(t));
}
const vandaag = () => tvDag(nu());
function dagNaam(iso, lang = false) {
  const dagen = G.index ? G.index.dagen : [];
  const i = dagen.indexOf(iso), v = dagen.indexOf(vandaag());
  if (iso === vandaag()) return "Vandaag";
  if (i === v + 1 && v >= 0) return "Morgen";
  const d = new Date(lokaal(iso, 12) * 1000);
  return d.toLocaleDateString("nl-BE", lang ? { timeZone: TZ, weekday: "long", day: "numeric", month: "long" } : { timeZone: TZ, weekday: "short", day: "numeric" });
}

/* ---------- Gegevens ---------- */
const G = { index: null, dagen: {}, zMap: {}, themas: [] };
async function haal(url) { const r = await fetch(url, { cache: "no-cache" }); if (!r.ok) throw new Error(url + " " + r.status); return r.json(); }
async function laadIndex() {
  [G.index, G.themas] = await Promise.all([haal("data/index.json"), haal("themas.json")]);
  G.zMap = Object.fromEntries(G.index.zenders.map(z => [z.id, z]));
  for (const t of G.themas) { t.rx = new RegExp(t.genres, "i"); if (t.ook) t.rxOok = new RegExp(t.ook, "i"); }
}
const laden = {};
function laadDag(iso) {
  if (G.dagen[iso]) return Promise.resolve(G.dagen[iso]);
  return laden[iso] ||= haal(`data/dag-${iso}.json`).then(ps => {
    for (const p of ps) { p.g ||= []; p.cast ||= []; p.s ||= ""; p.d ||= ""; }
    return (G.dagen[iso] = ps);
  }).catch(() => (G.dagen[iso] = []));
}
const laadAlles = () => Promise.all(G.index.dagen.map(laadDag));
const alleProgs = () => G.index.dagen.flatMap(d => G.dagen[d] || []);
const sleutel = p => `${p.c}|${p.b}`;
function vind(k) {
  const [c, b] = k.split("|"), zoekIn = l => (l || []).find(p => p.c === c && p.b === +b);
  return zoekIn(G.dagen[tvDag(+b)]) || zoekIn(alleProgs());
}

/* ---------- Opslag ---------- */
const STANDAARD = { naam: "", favorieten: [], themas: [], trefwoorden: [], talen: [], melding_aan: true, melding_uur: 17, tips_in_melding: true, onboarding_klaar: false, geleerd: {} };

class LokaleOpslag {
  constructor() { this.demo = true; this.email = "demo"; }
  lees(k, d) { try { return JSON.parse(localStorage.getItem("avondgids." + k)) ?? d; } catch (_) { return d; } }
  schrijf(k, v) { try { localStorage.setItem("avondgids." + k, JSON.stringify(v)); } catch (_) {} }
  async profiel() { return { ...STANDAARD, ...this.lees("profiel", {}) }; }
  async bewaarProfiel(p) { this.schrijf("profiel", p); }
  async kijklijst() { return this.lees("kijklijst", []); }
  async voegToe(item) { const l = this.lees("kijklijst", []); item.id = Date.now(); l.push(item); this.schrijf("kijklijst", l); return item; }
  async verwijder(id) { this.schrijf("kijklijst", this.lees("kijklijst", []).filter(x => x.id !== id)); }
  async registreerToestel() { throw new Error("In demo-modus worden er geen meldingen verstuurd."); }
  async uitloggen() {}
}

class SupaOpslag {
  constructor(sb, user) { this.sb = sb; this.uid = user.id; this.email = user.email; this.demo = false; }
  async profiel() {
    const { data, error } = await this.sb.from("profielen").select("*").eq("user_id", this.uid).maybeSingle();
    if (error) throw error;
    if (data) return { ...STANDAARD, ...data };
    const p = { ...STANDAARD, naam: (this.email || "").split("@")[0].split(/[._-]/)[0].replace(/^./, c => c.toUpperCase()) };
    await this.bewaarProfiel(p);
    return p;
  }
  async bewaarProfiel(p) {
    const rij = { user_id: this.uid, bijgewerkt: new Date().toISOString() };
    for (const k of Object.keys(STANDAARD)) rij[k] = p[k];
    const { error } = await this.sb.from("profielen").upsert(rij);
    if (error) throw error;
  }
  async kijklijst() { const { data, error } = await this.sb.from("kijklijst").select("*"); if (error) throw error; return data; }
  async voegToe(item) { const { data, error } = await this.sb.from("kijklijst").insert(item).select().single(); if (error) throw error; return data; }
  async verwijder(id) { const { error } = await this.sb.from("kijklijst").delete().eq("id", id); if (error) throw error; }
  async registreerToestel(sub, toestel) {
    const j = sub.toJSON();
    const { error } = await this.sb.rpc("registreer_toestel", { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_toestel: toestel });
    if (error) throw error;
  }
  async uitloggen() { await this.sb.auth.signOut(); }
}

/* ---------- Toestand ---------- */
let OP = null;
const S = {
  profiel: { ...STANDAARD }, kijk: [],
  gidsDag: null, gidsVan: 18, groep: "alle",
  zender: null, zenderDag: null, zenderFilter: "", zoek: ""
};
try { const v = JSON.parse(localStorage.getItem("avondgids.ui") || "{}"); Object.assign(S, { groep: v.groep || S.groep, gidsVan: v.gidsVan ?? S.gidsVan }); } catch (_) {}
const bewaarUi = () => { try { localStorage.setItem("avondgids.ui", JSON.stringify({ groep: S.groep, gidsVan: S.gidsVan })); } catch (_) {} };

function toast(t) {
  const el = $("#toast"); el.textContent = t; el.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (el.hidden = true), 2600);
}

/* ---------- Kijklijst ---------- */
const reeksen = () => new Set(S.kijk.filter(k => k.soort === "reeks").map(k => norm(k.titel)));
function opKijklijst(p) {
  if (S.kijk.some(k => k.soort === "uitzending" && k.zender === p.c && +k.start === p.b)) return "uitzending";
  if (reeksen().has(norm(p.t))) return "reeks";
  return null;
}
async function wisselUitzending(p) {
  const bestaand = S.kijk.find(k => k.soort === "uitzending" && k.zender === p.c && +k.start === p.b);
  try {
    if (bestaand) { await OP.verwijder(bestaand.id); S.kijk = S.kijk.filter(k => k !== bestaand); toast("Van je kijklijst gehaald"); }
    else { S.kijk.push(await OP.voegToe({ soort: "uitzending", titel: p.t, zender: p.c, start: p.b, einde: p.e })); toast("Op je kijklijst gezet"); }
    leer(p, bestaand ? -1 : 3);
  } catch (e) { toast("Bewaren lukte niet: " + e.message); }
  herteken();
}
async function wisselReeks(titel, stil = false) {
  const bestaand = S.kijk.find(k => k.soort === "reeks" && norm(k.titel) === norm(titel));
  try {
    if (bestaand) { await OP.verwijder(bestaand.id); S.kijk = S.kijk.filter(k => k !== bestaand); if (!stil) toast(`${titel} is geen favoriet programma meer`); }
    else { S.kijk.push(await OP.voegToe({ soort: "reeks", titel })); if (!stil) toast(`${titel} staat bij je favoriete programma's`); }
    const voorbeeld = alleProgs().find(x => norm(x.t) === norm(titel) && x.g.length) || alleProgs().find(x => norm(x.t) === norm(titel));
    if (voorbeeld) leer(voorbeeld, bestaand ? -2 : 4);
  } catch (e) { toast("Bewaren lukte niet: " + e.message); }
  if (!stil) herteken();
}
async function ruimKijklijstOp() {
  const oud = S.kijk.filter(k => k.soort === "uitzending" && +k.einde < nu() - 86400);
  for (const k of oud) { try { await OP.verwijder(k.id); } catch (_) {} }
  S.kijk = S.kijk.filter(k => !oud.includes(k));
}

/* ---------- Score: zelfde regels als melding.py ---------- */
const isFilm = p => p.g.includes("Film") && p.e - p.b >= 75 * 60;
const themaMatch = (p, t) => t.id === "film" ? isFilm(p) : p.g.some(g => t.rx.test(g)) && (!t.rxOok || p.g.some(g => t.rxOok.test(g)));
/* Kan de kijker deze zender volgen? Zonder gekozen talen telt alles. */
const taalOk = p => !S.profiel.talen.length || S.profiel.talen.includes(G.zMap[p.c]?.taal || "nl");
const isNieuws = p => /nieuws|journaal|het weer|news|météo|meteo/i.test(p.t);
function score(p) {
  const pr = S.profiel; let s = 0; const reden = [];
  const hits = G.themas.filter(t => pr.themas.includes(t.id) && themaMatch(p, t));
  if (hits.length) { s += 14 + 6 * (hits.length - 1); reden.push(hits[0].naam); }
  const titel = norm(p.t), rest = norm([p.s, p.d, p.cast.join(" ")].join(" "));
  for (let w of pr.trefwoorden) {
    w = norm(w); if (!w) continue;
    if (titel.includes(w)) { s += 40; reden.push(`“${w}”`); }
    else if (rest.includes(w)) { s += 15; reden.push(`“${w}”`); }
  }
  const rang = pr.favorieten.indexOf(p.c);
  if (rang >= 0) s += Math.max(6, 14 - 2 * rang); // eerste voorkeurzender weegt het zwaarst
  const L = pr.geleerd || {};
  if (L.nee?.includes(norm(p.t))) s -= 100;
  const lg = Math.max(-15, Math.min(20, p.g.reduce((t, g) => t + (L.g?.[g] || 0), 0)));
  const lc = Math.max(-6, Math.min(8, L.c?.[p.c] || 0));
  s += lg + lc;
  const geleerd = lg + lc >= 5;
  if (p.p) s += 6;
  if (p.l) s += 5;
  if ((G.zMap[p.c]?.n ?? 999) <= 30) s += 3;
  if (p.e - p.b < 20 * 60) s -= 30;
  if (isNieuws(p) && !pr.themas.includes("nieuws")) s -= 25;
  if (!taalOk(p)) s -= 40;
  return { s, reden, geleerd };
}
const heeftInteresses = () => S.profiel.themas.length > 0 || S.profiel.trefwoorden.length > 0 || (S.profiel.geleerd?.n || 0) >= 3;

/* ---------- Lerend profiel ----------
   Bewaren (+3), een reeks volgen (+4), een programma openen (+0,5) en "Niet voor mij" (−1,5 en de titel verdwijnt uit je tips) verschuiven
   gewichten per genre en per zender. Oudere signalen wegen bij elke nieuwe stap iets minder. */
const geopend = new Set();
function leer(p, w) {
  const L = S.profiel.geleerd = { g: {}, c: {}, nee: [], n: 0, ...(S.profiel.geleerd || {}) };
  for (const soort of ["g", "c"]) for (const k of Object.keys(L[soort])) {
    L[soort][k] = Math.round(L[soort][k] * 0.97 * 100) / 100;
    if (Math.abs(L[soort][k]) < 0.2) delete L[soort][k];
  }
  for (const g of p.g) L.g[g] = Math.max(-10, Math.min(15, (L.g[g] || 0) + w));
  L.c[p.c] = Math.max(-6, Math.min(8, (L.c[p.c] || 0) + w / 2));
  L.n = (L.n || 0) + 1;
  bewaarProfiel();
}
function nietVoorMij(p) {
  leer(p, -1.5); // de titel zelf wordt hieronder geweerd; het genre maar licht
  const L = S.profiel.geleerd;
  L.nee = [...new Set([norm(p.t), ...(L.nee || [])])].slice(0, 150);
  bewaarProfiel();
  toast(`Je krijgt ${p.t} niet meer als tip`);
  herteken();
}

/* Algemene tips als er nog geen interesses zijn: nieuwe afleveringen, films en live op de grote zenders. */
function algemeneScore(p) {
  const n = G.zMap[p.c]?.n ?? 999; let s = 0;
  if (!(p.p || p.l || isFilm(p))) return -1;
  s += n <= 9 ? 50 : n <= 30 ? 30 : n < 200 ? 10 : 0;
  if (p.p) s += 20; if (p.l) s += 25; if (isFilm(p)) s += 15;
  if (S.profiel.favorieten.includes(p.c)) s += 20;
  if (isNieuws(p) || p.e - p.b < 25 * 60) s -= 80;
  if (!taalOk(p)) s -= 80;
  return s;
}

function tipsVoor(iso, van, tot, max = 9) {
  const ps = (G.dagen[iso] || []).filter(p => p.b >= van && p.b <= tot && p.e > nu());
  const persoonlijk = heeftInteresses();
  const kand = ps.map(p => {
    if (persoonlijk) { const r = score(p); return { p, s: r.s, reden: r.reden, geleerd: r.geleerd }; }
    return { p, s: algemeneScore(p), reden: [] };
  }).filter(x => x.s >= (persoonlijk ? 20 : 30) && (!persoonlijk || x.reden.length || x.geleerd) && !opKijklijst(x.p));
  kand.sort((a, b) => b.s - a.s || a.p.b - b.p.b);
  const titels = new Set(), perZender = {}, uit = [];
  const neem = x => {
    const t = norm(x.p.t);
    if (uit.length >= max || titels.has(t) || (perZender[x.p.c] || 0) >= 2) return;
    titels.add(t); perZender[x.p.c] = (perZender[x.p.c] || 0) + 1; uit.push(x);
  };
  // Eerst de voorkeurzenders, in de volgorde die je koos; daarna aanvullen met andere zenders.
  for (const id of S.profiel.favorieten) for (const x of kand) if (x.p.c === id) neem(x);
  for (const x of kand) neem(x);
  return uit.sort((a, b) => a.p.b - b.p.b);
}

/* ---------- Bouwstenen ---------- */
function logo(z, mini = false) {
  if (!z) return "";
  return `<span class="logo${mini ? " mini" : ""}">${z.logo ? `<img src="${esc(z.logo)}" alt="${esc(z.naam)}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:this.alt}))">` : `<span>${esc(z.naam)}</span>`}</span>`;
}
function chips(p) {
  let h = "";
  const k = opKijklijst(p);
  if (k) h += `<span class="chip kijk">${k === "reeks" ? "★ Favoriet" : "Kijklijst"}</span>`;
  if (p.l) h += `<span class="chip live">Live</span>`; else if (p.p) h += `<span class="chip">Nieuw</span>`;
  if (isFilm(p)) h += `<span class="chip">Film</span>`;
  return h ? `<span class="chips">${h}</span>` : "";
}
const BOEK = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4Z"/></svg>`;
const STER = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.5 2.9 1-6.1L3.2 9.5l6.1-.9Z"/></svg>`;

function kaart(p, reden = [], { geleerd = false, nee = false } = {}) {
  const z = G.zMap[p.c];
  const rang = S.profiel.favorieten.indexOf(p.c);
  const waarom = [
    reden.length ? `Omdat je houdt van <b>${esc(reden.slice(0, 2).join(", "))}</b>` : "",
    geleerd ? "Lijkt op wat je bewaarde" : "",
    rang >= 0 && rang < 5 ? `Voorkeurzender ${rang + 1}` : ""
  ].filter(Boolean).join(" · ");
  return `<div class="kaart" role="button" tabindex="0" data-p="${sleutel(p)}">
    ${nee ? `<button class="nee" data-nee="${sleutel(p)}" aria-label="Niet voor mij" title="Niet voor mij">×</button>` : ""}
    <span class="wanneer"><strong>${tijd(p.b)}</strong>${logo(z, true)}<span class="zn">${esc(z?.naam)}</span></span>
    <span class="titel">${esc(p.t)}</span>
    ${chips(p)}
    <span class="sub">${esc(p.d || p.s || p.g.join(", "))}</span>
    ${waarom ? `<span class="reden">${waarom}</span>` : ""}
  </div>`;
}
function item(p, { metDag = false, markeer = null, voortgang = false, volgende = null } = {}) {
  const z = G.zMap[p.c];
  const t = markeer ? markeer(p.t) : esc(p.t);
  const pct = Math.min(100, Math.max(0, Math.round((nu() - p.b) / (p.e - p.b) * 100)));
  const kijk = opKijklijst(p);
  return `<div class="item" role="button" tabindex="0" data-p="${sleutel(p)}">${logo(z)}
    <span class="tekst">
      <span class="m">${metDag ? esc(dagNaam(tvDag(p.b))) + " · " : ""}${tijd(p.b)}–${tijd(p.e)} · ${esc(z?.naam)}</span>
      <span class="t">${t}</span>
      ${voortgang ? `<span class="balkje"><i style="width:${pct}%"></i></span>` : ""}
      ${volgende ? `<span class="m">daarna ${tijd(volgende.b)} ${esc(volgende.t)}</span>` : (p.s ? `<span class="m">${esc(p.s)}</span>` : "")}
    </span>
    <button class="ster${kijk ? " aan" : ""}" data-kijk="${sleutel(p)}" aria-pressed="${!!kijk}" aria-label="${kijk ? "Van kijklijst halen" : "Op kijklijst zetten"}">${BOEK}</button>
  </div>`;
}

/* ---------- Vanavond ---------- */
async function tekenVanavond() {
  const iso = vandaag();
  await laadDag(iso);
  const uur = uurVan(nu());
  const naam = S.profiel.naam;
  const groet = uur < 12 && uur >= 6 ? "Goeiemorgen" : uur < 18 && uur >= 6 ? "Goeiemiddag" : "Goeieavond";
  $("#heroDag").textContent = dagNaam(iso, true);
  $("#heroTitel").innerHTML = naam ? `${groet}, <em>${esc(naam)}</em>` : `Vanavond op <em>tv</em>`;
  $("#regioTxt").textContent = `${G.index.zenders.length} zenders · regio ${G.index.stad === "20001" ? "Antwerpen" : G.index.stad}`;
  $("#setupKaart").hidden = heeftInteresses();

  const ps = G.dagen[iso] || [];
  const avondVan = lokaal(iso, 17), avondTot = lokaal(iso, 26);
  const kijk = ps.filter(p => p.b >= avondVan && p.b < avondTot && p.e > nu() && opKijklijst(p)).sort((a, b) => a.b - b.b);
  $("#blokKijk").hidden = !kijk.length;
  $("#kijkVanavond").innerHTML = kijk.map(p => kaart(p)).join("");

  const tips = tipsVoor(iso, Math.max(lokaal(iso, 18), nu() - 600), lokaal(iso, 23, 30));
  $("#tipsTitel").textContent = heeftInteresses() ? "Voor jou vanavond" : "Tips voor vanavond";
  $("#tipsUitleg").textContent = heeftInteresses() ? "Volgens je interesses en favoriete zenders" : "Nieuwe afleveringen, films en live uitzendingen";
  $("#tips").innerHTML = tips.map(x => kaart(x.p, x.reden, { geleerd: x.geleerd, nee: true })).join("") || `<p class="leeg">Geen tips meer voor vanavond. Kijk eens in de <a href="#gids">gids</a> of <a href="#zoeken">zoek</a> naar iets voor morgen.</p>`;

  const favs = S.profiel.favorieten.length ? S.profiel.favorieten : G.index.zenders.filter(z => z.n <= 12).map(z => z.id);
  const t = nu();
  const nuOp = favs.map(id => {
    const lijst = ps.filter(p => p.c === id);
    const i = lijst.findIndex(p => p.b <= t && p.e > t);
    return i >= 0 ? { p: lijst[i], v: lijst[i + 1] } : null;
  }).filter(Boolean);
  if ($("#snelZoek").value.trim()) tekenSnelZoek();
  $("#nuLijst").innerHTML = nuOp.map(x => item(x.p, { voortgang: true, volgende: x.v })).join("") || `<p class="leeg">Geen programma's gevonden voor dit moment.</p>`;
}

/* ---------- Gids (rooster) ---------- */
const GROEPEN = [
  { id: "fav", naam: "★ Favorieten", test: z => S.profiel.favorieten.includes(z.id) },
  { id: "alle", naam: "Alle", test: () => true },
  { id: "vl", naam: "Vlaams", test: z => z.n < 100 },
  { id: "nl", naam: "NL & UK", test: z => z.n >= 100 && z.n < 130 },
  { id: "fr", naam: "Franstalig", test: z => z.n >= 130 && z.n < 170 },
  { id: "int", naam: "Internationaal", test: z => z.n >= 170 && z.n < 200 },
  { id: "sport", naam: "Sport", test: z => z.n >= 200 && z.n < 300 },
  { id: "docu", naam: "Docu", test: z => z.n >= 300 && z.n < 400 },
  { id: "nieuws", naam: "Nieuws", test: z => z.n >= 400 }
];
function dagKnoppen(el, gekozen, attr) {
  el.innerHTML = G.index.dagen.map(d => {
    const n = new Date(lokaal(d, 12) * 1000);
    return `<button class="pil dag" ${attr}="${d}" aria-pressed="${d === gekozen}">${esc(dagNaam(d))}<small>${n.toLocaleDateString("nl-BE", { timeZone: TZ, day: "numeric", month: "numeric" })}</small></button>`;
  }).join("");
}
async function tekenGids() {
  S.gidsDag ||= vandaag();
  if (!G.index.dagen.includes(S.gidsDag)) S.gidsDag = G.index.dagen[0];
  dagKnoppen($("#gidsDagen"), S.gidsDag, "data-gdag");
  const groepen = GROEPEN.filter(g => g.id !== "fav" || S.profiel.favorieten.length);
  if (!groepen.some(g => g.id === S.groep)) S.groep = "alle";
  $("#groepen").innerHTML = groepen.map(g => `<button class="pil" data-groep="${g.id}" aria-pressed="${g.id === S.groep}">${esc(g.naam)}</button>`).join("");
  $("#gidsVan").innerHTML = [6, 9, 12, 15, 17, 18, 19, 20, 21, 22].map(u => `<option value="${u}"${u === S.gidsVan ? " selected" : ""}>vanaf ${u}u</option>`).join("");

  const ps = await laadDag(S.gidsDag);
  const van = lokaal(S.gidsDag, S.gidsVan), tot = Math.min(van + 8 * 3600, lokaal(S.gidsDag, 30));
  const mins = (tot - van) / 60;
  $("#raster").style.setProperty("--mins", mins);
  const ppm = parseFloat(getComputedStyle($("#rooster")).getPropertyValue("--ppm")) || 4.2;
  const x = ts => (Math.max(ts, van) - van) / 60 * ppm;

  const groep = GROEPEN.find(g => g.id === S.groep);
  let zenders = G.index.zenders.filter(groep.test);
  if (S.groep !== "fav") zenders = [...zenders.filter(z => S.profiel.favorieten.includes(z.id)), ...zenders.filter(z => !S.profiel.favorieten.includes(z.id))];
  const perZ = {};
  for (const p of ps) if (p.e > van && p.b < tot) (perZ[p.c] ||= []).push(p);

  let uren = "";
  for (let t = van; t < tot; t += 1800) {
    const heel = Math.abs(uurVan(t) % 1) < 0.01;
    uren += `<div class="uur${heel ? "" : " half"}" style="left:${x(t)}px">${heel ? tijd(t) : ""}</div>`;
  }
  const t0 = nu(), pers = heeftInteresses();
  const rijen = zenders.map(z => {
    const progs = (perZ[z.id] || []).map(p => {
      const l = x(p.b), w = Math.max(x(Math.min(p.e, tot)) - l - 2, 3);
      const kijk = opKijklijst(p), tip = pers && !kijk && score(p).s >= 20;
      const cls = ["prog", p.e <= t0 ? "voorbij" : "", p.b <= t0 && p.e > t0 ? "nu" : "", kijk ? "kijk" : "", tip ? "tip" : ""].join(" ");
      return `<button class="${cls}" style="left:${l}px;width:${w}px" data-p="${sleutel(p)}" title="${esc(tijd(p.b) + " " + p.t)}">
        <span class="pt">${(p.p || p.l) && w > 40 ? '<i class="stip"></i>' : ""}${w > 22 ? esc(p.t) : ""}</span>${w > 54 ? `<span class="ps">${tijd(p.b)}${w > 120 && p.s ? " · " + esc(p.s) : ""}</span>` : ""}</button>`;
    }).join("");
    const fav = S.profiel.favorieten.includes(z.id);
    return `<div class="rij${fav ? " fav" : ""}"><button class="zcel" data-zender="${z.id}" title="${esc(z.naam)}"><span class="nr">${z.n}</span>${logo(z)}<span class="znaam">${esc(z.naam)}</span></button><div class="baan">${progs}</div></div>`;
  }).join("");
  const lijn = t0 >= van && t0 < tot ? `<div class="nulijn" style="left:calc(var(--chan) + ${x(t0)}px)"></div>` : "";
  $("#raster").innerHTML = `<div class="liniaal"><div class="hoek"></div><div class="uren">${uren}</div></div>${rijen || `<p class="leeg">Geen zenders in deze groep.</p>`}${lijn}`;
  if (t0 >= van && t0 < tot) $("#rooster").scrollLeft = Math.max(0, x(t0) - 80);
  else $("#rooster").scrollLeft = 0;
}

/* ---------- Zenders ---------- */
const DAGDELEN = [[6, "Ochtend"], [12, "Middag"], [18, "Avond"], [24, "Nacht"]];
async function tekenZenders() {
  const favs = S.profiel.favorieten;
  S.zender ||= favs[0] || G.index.zenders[0].id;
  S.zenderDag ||= vandaag();
  if (!G.index.dagen.includes(S.zenderDag)) S.zenderDag = G.index.dagen[0];
  const f = norm(S.zenderFilter);
  const geordend = [...G.index.zenders.filter(z => favs.includes(z.id)), ...G.index.zenders.filter(z => !favs.includes(z.id))]
    .filter(z => !f || norm(z.naam).includes(f) || String(z.n) === f);
  $("#zenderLijst").innerHTML = geordend.map(z => `<button class="zknop" data-zender="${z.id}" aria-current="${z.id === S.zender}" title="${esc(z.naam)}"><span class="nr">${z.n}</span>${logo(z, true)}<span class="nm">${esc(z.naam)}</span>${favs.includes(z.id) ? '<span class="fv">★</span>' : ""}</button>`).join("");

  const z = G.zMap[S.zender];
  const ps = (await laadDag(S.zenderDag)).filter(p => p.c === z.id);
  const t0 = nu(); let deel = -1, html = "";
  for (const p of ps) {
    let u = uurVan(p.b); if (u < 6) u += 24;
    const d = DAGDELEN.findLastIndex(([h]) => u >= h);
    if (d !== deel) { deel = d; html += `<div class="dagdeel" id="deel-${d}">${DAGDELEN[d][1]}</div>`; }
    const cls = ["tl", p.e <= t0 ? "voorbij" : "", p.b <= t0 && p.e > t0 ? "nu" : ""].join(" ");
    const kijk = opKijklijst(p);
    html += `<div class="${cls}" role="button" tabindex="0" data-p="${sleutel(p)}"><span class="u">${tijd(p.b)}</span>
      <span class="mn"><span class="tt">${esc(p.t)}</span>${chips(p)}${p.s ? `<span class="ds">${esc(p.s)}</span>` : ""}${p.d ? `<span class="ds">${esc(p.d)}</span>` : ""}</span>
      <button class="ster${kijk ? " aan" : ""}" data-kijk="${sleutel(p)}" aria-pressed="${!!kijk}" aria-label="${kijk ? "Van kijklijst halen" : "Op kijklijst zetten"}">${BOEK}</button></div>`;
  }
  const fav = favs.includes(z.id);
  $("#zenderDetail").innerHTML = `
    <div class="zkop">${logo(z)}<div><div class="eyebrow">Kanaal ${z.n}</div><h2>${esc(z.naam)}</h2></div>
      <button class="ster${fav ? " aan" : ""}" data-fav="${z.id}" aria-pressed="${fav}" aria-label="${fav ? "Uit favorieten" : "Bij favorieten"}" style="margin-left:auto">${STER}</button></div>
    <div class="dagen" id="zenderDagen" role="group" aria-label="Dag"></div>
    <div class="tijdlijn">${html || `<p class="leeg">Geen programma's voor deze dag.</p>`}</div>`;
  dagKnoppen($("#zenderDagen"), S.zenderDag, "data-zdag");
  const doel = $("#zenderDetail .tl.nu") || $("#deel-2");
  if (doel && S.scrollZender) doel.scrollIntoView({ block: "center" });
  S.scrollZender = false;
}

/* ---------- Slim zoeken (alles lokaal, geen externe dienst) ---------- */
const WEEKDAGEN = ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"];
const THEMAWOORDEN = {
  film: "film", films: "film", speelfilm: "film", misdaad: "misdaad", thriller: "misdaad", detective: "misdaad", krimi: "misdaad",
  humor: "humor", comedy: "humor", grappig: "humor", komedie: "humor", sitcom: "humor", docu: "docu", documentaire: "docu", reportage: "docu",
  natuur: "natuur", dieren: "natuur", geschiedenis: "geschiedenis", oorlog: "geschiedenis", koken: "koken", kook: "koken", reality: "reality",
  quiz: "spel", spel: "spel", sport: "sport", voetbal: "voetbal", wielrennen: "wielrennen", koers: "wielrennen", veldrijden: "wielrennen",
  formule: "motorsport", f1: "motorsport", motorsport: "motorsport", kids: "kids", kinderen: "kids", tekenfilm: "kids", muziek: "muziek",
  concert: "muziek", reizen: "reizen", horror: "horror", romantisch: "romantiek", nieuws: "nieuws", journaal: "nieuws", actua: "nieuws",
  drama: "drama", serie: "drama", reeks: "drama", wonen: "wonen", tuin: "wonen", wetenschap: "wetenschap"
};
// "een" (één) telt alleen als zender met "op" ervoor, anders is het gewoon het woord "een".
const ZENDER_ALIAS = { "op een": "eenhd", "vrt 1": "eenhd", vrt1: "eenhd", canvas: "ketnetcanvashd", play4: "vierhd", "play 4": "vierhd", vtm: "vtmhd", "vtm 1": "vtmhd" };
const STOP = new Set(["de", "het", "een", "op", "met", "en", "van", "in", "om", "is", "er", "wat", "iets", "programma", "programmas", "tv", "uur", "u", "graag", "ik", "wil", "zoek", "kijken", "naar", "the", "a", "of", "le", "la"]);

function begrijp(q) {
  const ruw = norm(q);
  const f = { dagen: null, vanUur: null, totUur: null, rondUur: null, live: false, nieuw: false, zenders: [], termen: [], labels: [] };
  let rest = " " + ruw + " ";
  const weg = (re, fn) => { rest = rest.replace(re, (...m) => { fn(...m); return " "; }); };
  const dagen = G.index.dagen;
  weg(/ (vanavond|vandaag|nu) /g, (_, w) => { f.dagen = [vandaag()]; f.labels.push(w === "vanavond" ? "Vanavond" : "Vandaag"); if (w === "vanavond") f.vanUur ??= 17; if (w === "nu") f.nu = true; });
  weg(/ overmorgen /g, () => { f.dagen = [dagen[dagen.indexOf(vandaag()) + 2]]; f.labels.push("Overmorgen"); });
  weg(/ morgen(avond)? /g, (_, a) => { f.dagen = [dagen[dagen.indexOf(vandaag()) + 1]]; f.labels.push(a ? "Morgenavond" : "Morgen"); if (a) f.vanUur ??= 17; });
  weg(/ (weekend|dit weekend) /g, () => { f.dagen = dagen.filter(d => [0, 6].includes(new Date(lokaal(d, 12) * 1000).getUTCDay())); f.labels.push("Weekend"); });
  weg(new RegExp(` (${WEEKDAGEN.join("|")})(avond)? `, "g"), (_, w, a) => {
    const i = WEEKDAGEN.indexOf(w);
    f.dagen = dagen.filter(d => new Date(lokaal(d, 12) * 1000).getUTCDay() === i).slice(0, 1);
    f.labels.push(w[0].toUpperCase() + w.slice(1) + (a ? "avond" : "")); if (a) f.vanUur ??= 17;
  });
  weg(/ (na|vanaf|later dan) (\d{1,2})(?:[u:h.](\d{2})?)? /g, (_, w, h, m) => { f.vanUur = +h + (+m || 0) / 60; f.labels.push(`na ${h}u${m || ""}`); });
  weg(/ (voor|tot|ten laatste) (\d{1,2})(?:[u:h.](\d{2})?)? /g, (_, w, h, m) => { f.totUur = +h + (+m || 0) / 60; f.labels.push(`voor ${h}u${m || ""}`); });
  weg(/ (?:om )?(\d{1,2})[u:h.](\d{2})? /g, (_, h, m) => { f.rondUur = +h + (+m || 0) / 60; f.labels.push(`rond ${h}u${m || ""}`); });
  weg(/ (laat|nacht) /g, () => { f.vanUur ??= 22; f.labels.push("Laat"); });
  weg(/ live /g, () => { f.live = true; f.labels.push("Live"); });
  weg(/ (nieuw|nieuwe|premiere) /g, () => { f.nieuw = true; f.labels.push("Nieuw"); });
  for (const [alias, id] of Object.entries(ZENDER_ALIAS)) {
    weg(new RegExp(` (?:op )?${alias} `, "g"), () => { if (!f.zenders.includes(id)) f.zenders.push(id); f.labels.push("op " + G.zMap[id]?.naam); });
  }
  for (const z of G.index.zenders) {
    const n = norm(z.naam).replace(/ hd$/, "");
    if (n.length >= 3 && rest.includes(` ${n} `) && !THEMAWOORDEN[n]) {
      rest = rest.replace(` ${n} `, " "); f.zenders.push(z.id); f.labels.push("op " + z.naam);
    }
  }
  const woorden = rest.split(" ").filter(w => w && !STOP.has(w));
  f.termen = woorden.map(w => ({ w, thema: THEMAWOORDEN[w] ? G.themas.find(t => t.id === THEMAWOORDEN[w]) : null }));
  f.zin = woorden.join(" ");
  return f;
}

function afstand(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let vorige = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const rij = [i]; let min = i;
    for (let j = 1; j <= b.length; j++) {
      rij[j] = Math.min(vorige[j] + 1, rij[j - 1] + 1, vorige[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (rij[j] < min) min = rij[j];
    }
    if (min > max) return max + 1;
    vorige = rij;
  }
  return vorige[b.length];
}
function index(p) {
  if (p._i) return p._i;
  const z = G.zMap[p.c];
  const velden = [[norm(p.t), 10], [norm(p.s), 5], [norm(p.cast.join(" ")), 5], [norm(p.g.join(" ")), 4], [norm(z?.naam), 3], [norm(p.d), 1.5]];
  return (p._i = velden.map(([tekst, gewicht]) => ({ tekst, gewicht, woorden: tekst ? tekst.split(" ") : [] })));
}
function termScore(term, p) {
  const w = term.w; let best = 0;
  if (term.thema && themaMatch(p, term.thema)) best = 8;
  for (const v of index(p)) {
    if (!v.tekst) continue;
    let q = 0;
    for (const woord of v.woorden) {
      if (woord === w) { q = 1; break; }
      if (w.length >= 2 && woord.startsWith(w)) q = Math.max(q, 0.85);
      else if (w.length >= 4 && woord.includes(w)) q = Math.max(q, 0.6);
      else if (w.length >= 4 && q < 0.55 && v.gewicht >= 5) { // typfouten alleen in titel, reeks en cast
        const max = w.length >= 8 ? 2 : 1;
        if (afstand(w, woord.slice(0, w.length + max), max) <= max || afstand(w, woord, max) <= max) q = 0.55;
      }
    }
    best = Math.max(best, q * v.gewicht);
  }
  return best;
}
function zoek(q) {
  const f = begrijp(q);
  const t0 = nu();
  let ps = alleProgs().filter(p => p.e > t0);
  if (f.dagen) ps = ps.filter(p => f.dagen.includes(tvDag(p.b)));
  const uurNorm = p => { let u = uurVan(p.b); return u < 6 ? u + 24 : u; };
  if (f.nu) ps = ps.filter(p => p.b <= t0 + 1800);
  if (f.vanUur != null) ps = ps.filter(p => uurNorm(p) >= (f.vanUur < 6 ? f.vanUur + 24 : f.vanUur));
  if (f.totUur != null) ps = ps.filter(p => uurNorm(p) < (f.totUur < 6 ? f.totUur + 24 : f.totUur));
  if (f.rondUur != null) ps = ps.filter(p => Math.abs(uurNorm(p) - (f.rondUur < 6 ? f.rondUur + 24 : f.rondUur)) <= 0.75);
  if (f.live) ps = ps.filter(p => p.l);
  if (f.nieuw) ps = ps.filter(p => p.p);
  if (f.zenders.length) ps = ps.filter(p => f.zenders.includes(p.c));
  if (!f.termen.length) {
    return { f, res: ps.filter(p => p.e - p.b >= 15 * 60).sort((a, b) => a.b - b.b).slice(0, 120).map(p => ({ p, s: 0 })), bijna: false };
  }
  const zin = f.zin;
  const scoor = (p, nodig) => {
    let s = 0, ok = 0;
    for (const t of f.termen) { const x = termScore(t, p); if (x > 0) ok++; s += x; }
    if (ok < nodig) return -1;
    if (zin.length > 3 && norm(p.t).includes(zin)) s += 20;
    if (norm(p.t) === zin) s += 15;
    if (opKijklijst(p)) s += 3;
    const rang = S.profiel.favorieten.indexOf(p.c);
    if (rang >= 0) s += Math.max(1, 4 - rang / 2); // voorkeurzenders iets hoger
    if (!taalOk(p)) s *= 0.6;                      // andere talen lager, niet weg
    return s;
  };
  let res = ps.map(p => ({ p, s: scoor(p, f.termen.length) })).filter(x => x.s > 0);
  let bijna = false;
  if (!res.length && f.termen.length > 1) { res = ps.map(p => ({ p, s: scoor(p, f.termen.length - 1) })).filter(x => x.s > 0); bijna = res.length > 0; }
  res.sort((a, b) => b.s - a.s || a.p.b - b.p.b);
  const top = res.length ? res[0].s : 0;
  res = res.filter(x => x.s >= top * 0.35); // zwakke treffers weglaten als er sterke zijn
  return { f, res: res.slice(0, 120), bijna };
}
function markeerder(f) {
  const ws = f.termen.map(t => t.w).filter(w => w.length >= 2);
  if (!ws.length) return esc;
  return tekst => {
    const h = esc(tekst);
    const stukken = []; const lager = tekst.toLowerCase();
    for (const w of ws) { let i = lager.indexOf(w); if (i >= 0) stukken.push([i, i + w.length]); }
    if (!stukken.length) return h;
    stukken.sort((a, b) => a[0] - b[0]);
    let uit = "", pos = 0;
    for (const [a, b] of stukken) { if (a < pos) continue; uit += esc(tekst.slice(pos, a)) + "<mark>" + esc(tekst.slice(a, b)) + "</mark>"; pos = b; }
    return uit + esc(tekst.slice(pos));
  };
}
const VOORBEELDEN = ["film vanavond", "de verraders", "voetbal live", "koken morgen", "misdaad na 21u", "thuis", "docu weekend", "canvas vanavond"];
async function tekenZoeken() {
  $("#zoekHulp").innerHTML = VOORBEELDEN.map(v => `<button class="pil" data-voorbeeld="${esc(v)}">${esc(v)}</button>`).join("");
  const q = S.zoek.trim();
  if ($("#zoekInput").value !== S.zoek) $("#zoekInput").value = S.zoek;
  if (!q) { $("#zoekBegrip").innerHTML = ""; $("#zoekResultaten").innerHTML = `<p class="leeg">Zoek op titel, persoon, genre, zender, dag of uur, voor de komende ${G.index.dagen.length} dagen.<br>Typfouten mogen: <i>verader</i> vindt ook <i>De Verraders</i>.</p>`; return; }
  if (!G.alles) { $("#zoekResultaten").innerHTML = `<p class="leeg">De gids van de komende dagen wordt geladen…</p>`; await laadAlles(); G.alles = true; }
  const { f, res, bijna } = zoek(q);
  $("#zoekBegrip").innerHTML = (f.labels.length ? "Filters: " + f.labels.map(l => `<span class="chip">${esc(l)}</span>`).join(" ") + " · " : "") + `${res.length === 120 ? "120+" : res.length} resultaten` + (bijna ? " · geen exacte treffer, dit lijkt er het meest op" : "");
  if (!res.length) { $("#zoekResultaten").innerHTML = `<p class="leeg">Niets gevonden voor “${esc(q)}”. Probeer minder woorden of een andere dag.</p>`; return; }
  const m = markeerder(f);
  const perDag = {};
  for (const x of res) (perDag[tvDag(x.p.b)] ||= []).push(x.p);
  $("#zoekResultaten").innerHTML = Object.keys(perDag).sort().map(d =>
    `<div class="dagkop">${esc(dagNaam(d, true))}</div>` + perDag[d].sort((a, b) => a.b - b.b).map(p => item(p, { markeer: m })).join("")
  ).join("");
}

/* Zoeken op het overzicht: de beste treffers meteen onder het zoekveld. */
async function tekenSnelZoek() {
  const q = $("#snelZoek").value.trim(), el = $("#snelResultaten");
  if (!q) { el.hidden = true; el.innerHTML = ""; return; }
  el.hidden = false;
  if (!G.alles) { el.innerHTML = `<p class="klein">De gids van de komende dagen wordt geladen…</p>`; await laadAlles(); G.alles = true; }
  if ($("#snelZoek").value.trim() !== q) return; // intussen verder getypt
  const { f, res, bijna } = zoek(q);
  const m = markeerder(f);
  const aantal = res.length === 120 ? "120+" : res.length;
  el.innerHTML = `<div class="blok-kop"><h2>Gevonden</h2>${res.length > 6 ? `<button class="tekstknop" data-allezoek type="button">Alle ${aantal} resultaten</button>` : ""}</div>
    ${f.labels.length || bijna ? `<div class="begrip">${f.labels.map(l => `<span class="chip">${esc(l)}</span>`).join(" ")}${bijna ? " geen exacte treffer, dit lijkt er het meest op" : ""}</div>` : ""}
    <div class="resultaten">${res.slice(0, 6).map(x => item(x.p, { metDag: true, markeer: m })).join("") || `<p class="leeg">Niets gevonden voor “${esc(q)}”.</p>`}</div>`;
}

/* ---------- Kijklijst ---------- */
async function tekenKijklijst() {
  const rs = S.kijk.filter(k => k.soort === "reeks");
  $("#reeksen").innerHTML = rs.map(k => `<button class="pil" data-ontvolg="${esc(k.titel)}" aria-label="${esc(k.titel)} uit favorieten">${esc(k.titel)} <span class="x">×</span></button>`).join("")
    || `<p class="klein">Nog geen favoriete programma's. Zoek er hierboven een, of open een programma en tik op <b>☆ Favoriet programma</b>.</p>`;
  if (!G.alles) { $("#kijkLijst").innerHTML = `<p class="leeg">Laden…</p>`; await laadAlles(); G.alles = true; }
  const t0 = nu();
  const ps = alleProgs().filter(p => p.e > t0 && opKijklijst(p)).sort((a, b) => a.b - b.b);
  const perDag = {};
  for (const p of ps) (perDag[tvDag(p.b)] ||= []).push(p);
  $("#kijkLijst").innerHTML = Object.keys(perDag).sort().map(d => `<div class="dagkop">${esc(dagNaam(d, true))}</div>` + perDag[d].map(p => item(p)).join("")).join("")
    || `<p class="leeg">Je kijklijst is leeg. Tik bij een programma op het bladwijzer-icoon, of open het en kies <b>Op kijklijst</b>.</p>`;
}

/* ---------- Profiel ---------- */
let bewaarTimer;
function bewaarProfiel() {
  $("#bewaarStatus").textContent = "Bewaren…";
  clearTimeout(bewaarTimer);
  bewaarTimer = setTimeout(async () => {
    try { await OP.bewaarProfiel(S.profiel); $("#bewaarStatus").textContent = "Bewaard"; }
    catch (e) { $("#bewaarStatus").textContent = "Bewaren lukte niet: " + e.message; }
  }, 500);
}
function tekenProfiel() {
  const p = S.profiel;
  $("#profielMail").textContent = OP.demo ? "Demo-modus" : OP.email;
  if (document.activeElement !== $("#pNaam")) $("#pNaam").value = p.naam || "";
  $("#pTalen").innerHTML = TALEN.map(t => `<button class="pil" data-taal="${t.id}" aria-pressed="${p.talen.includes(t.id)}">${esc(t.naam)}</button>`).join("");
  const groepen = [...new Set(G.themas.map(t => t.groep))];
  $("#pThemas").innerHTML = groepen.map(g => `<div><h3>${esc(g)}</h3><div class="pillen groot">${G.themas.filter(t => t.groep === g).map(t =>
    `<button class="pil" data-thema="${t.id}" aria-pressed="${p.themas.includes(t.id)}">${esc(t.naam)}</button>`).join("")}</div></div>`).join("");
  $("#pWoorden").innerHTML = p.trefwoorden.map(w => `<button class="pil" data-woordweg="${esc(w)}" aria-label="${esc(w)} verwijderen">${esc(w)} <span class="x">×</span></button>`).join("") || `<span class="klein">Nog geen trefwoorden.</span>`;
  const favEerst = [...p.favorieten.map(id => G.zMap[id]).filter(Boolean), ...G.index.zenders.filter(z => !p.favorieten.includes(z.id))];
  $("#pFavs").innerHTML = favEerst.map(z => { const r = p.favorieten.indexOf(z.id);
    return `<button class="zendertegel" data-favknop="${z.id}" aria-pressed="${r >= 0}" title="${esc(z.naam)}"><span class="rang">${r >= 0 ? r + 1 : ""}</span>${logo(z, true)}<span class="nm">${esc(z.naam)}</span></button>`; }).join("");
  const L = p.geleerd || {};
  const top = (o, n) => Object.entries(o || {}).sort((a, b) => b[1] - a[1]).filter(x => x[1] > 0).slice(0, n);
  const lg = top(L.g, 6), lc = top(L.c, 4);
  $("#pGeleerd").innerHTML = (L.n || 0) < 1 ? `<p class="klein">Nog niets geleerd. Bewaar programma's, volg reeksen of tik op <b>Niet voor mij</b>, dan worden je tips vanzelf beter.</p>` : `
    <p class="klein">Gebaseerd op ${L.n} keer bewaren, volgen, openen of wegtikken.</p>
    ${lg.length ? `<div><h3>Je kijkt graag naar</h3><div class="pillen">${lg.map(([g]) => `<span class="pil">${esc(g)}</span>`).join("")}</div></div>` : ""}
    ${lc.length ? `<div><h3>Zenders die vaker opduiken</h3><div class="pillen">${lc.map(([c]) => `<span class="pil">${esc(G.zMap[c]?.naam || c)}</span>`).join("")}</div></div>` : ""}
    ${L.nee?.length ? `<p class="klein">${L.nee.length} programma's krijg je niet meer als tip.</p>` : ""}
    <button class="knop stil klein" data-vergeet type="button">Vergeet wat de gids leerde</button>`;
  $("#pMeldAan").checked = p.melding_aan;
  $("#pMeldTips").checked = p.tips_in_melding;
  $("#pMeldUur").innerHTML = Array.from({ length: 8 }, (_, i) => i + 14).map(u => `<option value="${u}"${u === p.melding_uur ? " selected" : ""}>${u}:00</option>`).join("");
  pushStatus();
}

/* ---------- Pushmeldingen ---------- */
const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
function b64NaarBytes(b64) { const p = "=".repeat((4 - b64.length % 4) % 4); const r = atob((b64 + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(r, c => c.charCodeAt(0)); }
async function pushStatus() {
  const st = $("#pushStatus"), knop = $("#pushKnop"), uitleg = $("#pushUitleg");
  uitleg.textContent = "";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    if (isIos && !isStandalone) {
      st.textContent = "Op iPhone werken meldingen alleen vanuit de app op je beginscherm.";
      uitleg.innerHTML = "Tik in Safari op <b>Deel</b> en kies <b>Zet op beginscherm</b>. Open Zapper daarna via het nieuwe icoon en kom hier terug.";
    } else st.textContent = "Deze browser ondersteunt geen pushmeldingen.";
    knop.hidden = true; return;
  }
  knop.hidden = false;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (Notification.permission === "denied") { st.textContent = "Meldingen zijn geblokkeerd voor deze site. Zet ze aan in de instellingen van je browser of toestel."; knop.hidden = true; return; }
  if (sub && Notification.permission === "granted") {
    st.innerHTML = `Meldingen op dit toestel: <b style="color:var(--ok)">aan</b>. Je krijgt dagelijks om ${S.profiel.melding_uur}:00 een overzicht.`;
    knop.textContent = "Testmelding tonen"; knop.dataset.actie = "test";
  } else {
    st.textContent = "Meldingen op dit toestel: uit";
    knop.textContent = "Meldingen aanzetten op dit toestel"; knop.dataset.actie = "aan";
  }
}
async function pushKnop() {
  const knop = $("#pushKnop"); knop.disabled = true;
  try {
    const reg = await navigator.serviceWorker.ready;
    if (knop.dataset.actie === "test") {
      await reg.showNotification("Zapper werkt", { body: "Zo ziet je dagelijkse melding eruit.", icon: "icoon-192.png", tag: "test" });
    } else {
      const toestemming = await Notification.requestPermission();
      if (toestemming !== "granted") throw new Error("Je gaf geen toestemming voor meldingen.");
      if (OP.demo) {
        await reg.showNotification("Zapper werkt", { body: "In demo-modus zie je alleen deze testmelding.", icon: "icoon-192.png", tag: "test" });
        throw new Error("Demo-modus: dagelijkse meldingen werken pas met een account (config.js invullen).");
      }
      if (!CFG.VAPID_PUBLIC_KEY) throw new Error("De meldingssleutel ontbreekt in config.js. Vraag de beheerder om VAPID_PUBLIC_KEY in te vullen.");
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64NaarBytes(CFG.VAPID_PUBLIC_KEY) });
      const toestel = isIos ? "iPhone/iPad" : /android/i.test(navigator.userAgent) ? "Android" : "Computer";
      await OP.registreerToestel(sub, toestel);
      toast("Meldingen staan aan op dit toestel");
    }
  } catch (e) { $("#pushUitleg").textContent = e.message; }
  knop.disabled = false;
  pushStatus();
}

/* ---------- Detailvenster ---------- */
function toonDetail(k) {
  const p = vind(k); if (!p) return;
  if (!geopend.has(k) && !$("#detail").open) { geopend.add(k); leer(p, 0.5); }
  const z = G.zMap[p.c];
  const kijk = opKijklijst(p), volgt = reeksen().has(norm(p.t));
  const feiten = [p.se ? `Seizoen ${p.se}${p.ep ? `, afl. ${p.ep}` : ""}` : "", ...p.g, p.j, p.land, p.a ? `${p.a}+` : "", `${Math.round((p.e - p.b) / 60)} min`].filter(Boolean);
  const ook = alleProgs().filter(x => x !== p && norm(x.t) === norm(p.t) && x.b > nu()).sort((a, b) => a.b - b.b).slice(0, 4);
  const r = heeftInteresses() ? score(p).reden : [];
  $("#detailIn").innerHTML = `
    <div class="kopje">${logo(z)}<span>${z.n} · ${esc(z.naam)}</span><button class="sluit" data-sluit>Sluiten</button></div>
    <h3>${esc(p.t)}</h3>
    <div class="tijd">${esc(dagNaam(tvDag(p.b)))} ${tijd(p.b)}–${tijd(p.e)} ${chips(p)}</div>
    ${p.s ? `<p><strong>${esc(p.s)}</strong></p>` : ""}
    ${p.d ? `<p>${esc(p.d)}</p>` : `<p class="klein">Geen beschrijving beschikbaar.</p>`}
    ${p.cast.length ? `<p class="klein">Met ${esc(p.cast.join(", "))}</p>` : ""}
    ${r.length ? `<p class="klein">Tip omdat je houdt van <b>${esc(r.join(", "))}</b></p>` : ""}
    <div class="feiten">${feiten.map(f => `<span>${esc(f)}</span>`).join("")}</div>
    <div class="knoppen">
      ${p.e > nu() ? `<button class="knop${kijk === "uitzending" ? " aan" : ""}" data-kijk="${sleutel(p)}">${kijk === "uitzending" ? "Op je kijklijst ✓" : "Op kijklijst"}</button>` : ""}
      <button class="knop lijn${volgt ? " aan" : ""}" data-volg="${esc(p.t)}">${volgt ? "★ Favoriet programma" : "☆ Favoriet programma"}</button>
      <button class="knop stil" data-zender="${z.id}" data-dag="${tvDag(p.b)}">Meer op ${esc(z.naam)}</button>
      <button class="knop stil" data-nee="${sleutel(p)}">Niet voor mij</button>
    </div>
    ${ook.length ? `<div class="ookop">Ook te zien: ${ook.map(x => `<button data-p="${sleutel(x)}">${esc(dagNaam(tvDag(x.b)))} ${tijd(x.b)} op ${esc(G.zMap[x.c]?.naam)}</button>`).join(" · ")}</div>` : ""}`;
  if (!$("#detail").open) $("#detail").showModal();
  $("#detail").dataset.k = k;
}

/* ---------- Onboarding: 6 vragen die een eerste interesseprofiel maken ---------- */
const TALEN = [
  { id: "nl", naam: "Nederlands", sub: "Vlaamse zenders en NPO, ook ondertitelde reeksen" },
  { id: "en", naam: "Engels", sub: "BBC One, BBC Two, CNN, BBC News" },
  { id: "fr", naam: "Frans", sub: "La Une, RTL tvi, TF1, France 2" },
  { id: "de", naam: "Duits", sub: "ARD, ZDF, RTL, VOX" },
  { id: "andere", naam: "Andere talen", sub: "Italiaans, Spaans, Turks, Pools, Arabisch" }
];
const UITLEG = {
  series: "Thuis, Familie, misdaadreeksen, sitcoms", film: "Speelfilms op alle zenders", docu: "Reportages en documentaires",
  show: "Spel, reality en talkshows", sport: "Live wedstrijden en sportmagazines", nieuws: "Journaal, duiding en debat", kids: "Tekenfilms en kinderprogramma's",
  misdaad: "Speurders, politie en rechtbank", thriller: "Spanning en ontknopingen", humor: "Sitcoms, comedy en satire", drama: "Familie, relaties, het echte leven",
  spanning: "Achtervolgingen en avonturen", scifi: "Andere werelden en de toekomst", romantiek: "Liefde en romcoms", horror: "Griezelen en het bovennatuurlijke",
  historisch: "Kostuumdrama en oorlog", spel: "Quizzen en spelprogramma's", reality: "Reality, dating en competitie", koken: "Kookprogramma's en culinair",
  wonen: "Verbouwen, interieur en tuin", reizen: "Verre reizen en buitenleven", muziek: "Concerten, muziekprogramma's", talk: "Gesprekken en late night",
  lifestyle: "Gezondheid, mode, consument", natuur: "Dieren, natuur en klimaat", geschiedenis: "Van de oudheid tot vandaag", wetenschap: "Ontdekkingen, techniek, medisch",
  truecrime: "Echte misdaadverhalen", samenleving: "Portretten en maatschappij", kunst: "Kunst, boeken en theater",
  voetbal: "Competitie en grote toernooien", wielrennen: "Koers, cross en mountainbike", motorsport: "Formule 1, MotoGP, rally", tennis: "Grand slams en toernooien"
};
const VRAGEN = [
  { id: "talen", vraag: "In welke talen kijk je tv?", uitleg: "Programma's in een taal die je niet kiest, krijg je niet als tip. Je kan meerdere talen kiezen." },
  { id: "Soort", vraag: "Wat kijk je het liefst?", uitleg: "Kies alles wat past, ook als je er maar af en toe naar kijkt." },
  { id: "Verhalen", vraag: "Welke verhalen grijpen je?", uitleg: "Voor series en films. Detective of liever een romcom?" },
  { id: "Shows", vraag: "Welke programma's zet je graag op?", uitleg: "Spel, reality, koken en meer." },
  { id: "Onderwerpen", vraag: "Welke onderwerpen boeien je?", uitleg: "Voor documentaires en reportages." },
  { id: "Sport", vraag: "Welke sport volg je?", uitleg: "Kies Geen sport als je er niets van wil zien." },
  { id: "programmas", vraag: "Welke programma's wil je zeker niet missen?", uitleg: "Zoek op naam en voeg ze toe aan je favoriete programma's. Elke uitzending komt dan vanzelf op je kijklijst en in je dagelijkse melding." },
  { id: "zenders", vraag: "Wat zijn je voorkeurzenders?", uitleg: "Tik ze aan in volgorde van voorkeur: je eerste keuze weegt het zwaarst. Je tips komen eerst van deze zenders, daarna vullen we aan met andere zenders." }
];
const SPORT_EXTRA = [{ id: "sport", naam: "Andere sport", sub: "Atletiek, basket, darts, snooker…" }, { id: "geen", naam: "Geen sport", sub: "Liever geen sport in mijn tips" }];

const geenTegel = v => `<button class="tegel geenvoorkeur" data-obkeuze="${v.id}|_geen" aria-pressed="${S.ob.geen.has(v.id)}"><b>Geen voorkeur</b><small>Alles is goed, dit telt niet mee</small></button>`;
const THEMAVRAGEN = () => VRAGEN.filter(v => !["talen", "programmas", "zenders"].includes(v.id));
function optiesVoor(v) {
  if (v.id === "talen") return TALEN;
  const lijst = G.themas.filter(t => t.groep === v.id).map(t => ({ id: t.id, naam: t.naam, sub: UITLEG[t.id] || "" }));
  return v.id === "Sport" ? [...lijst, ...SPORT_EXTRA] : lijst;
}

function startOnboarding() {
  const pr = S.profiel, a = {};
  const geen = new Set(), terug = pr.onboarding_klaar; // bij opnieuw doen: lege antwoorden = geen voorkeur
  a.talen = new Set(pr.talen.length ? pr.talen : terug ? [] : ["nl"]);
  if (terug && !pr.talen.length) geen.add("talen");
  for (const v of THEMAVRAGEN()) {
    a[v.id] = new Set(optiesVoor(v).map(o => o.id).filter(id => pr.themas.includes(id)));
    if (terug && !a[v.id].size && v.id !== "Sport") geen.add(v.id);
  }
  if (terug && !a.Sport.size) a.Sport.add("geen");
  const programmas = S.kijk.filter(k => k.soort === "reeks").map(k => k.titel);
  if (terug && !programmas.length) geen.add("programmas");
  if (terug && !pr.favorieten.length) geen.add("zenders");
  S.ob = { stap: 0, a, geen, programmas, zenders: [...pr.favorieten], alleZenders: false, naam: pr.naam || "", uur: pr.melding_uur, meldAan: pr.melding_aan };
}

/* Antwoorden omzetten naar profielvelden. */
function obProfiel() {
  const a = S.ob.a, themas = new Set();
  for (const v of THEMAVRAGEN()) for (const id of a[v.id]) if (id !== "geen") themas.add(id);
  if (a.Sport.has("geen")) for (const t of G.themas) if (t.groep === "Sport" || t.id === "sport") themas.delete(t.id);
  return { talen: S.ob.geen.has("talen") ? [] : [...a.talen], themas: [...themas] };
}

function voorgesteldeFavs(talen, themas) {
  const ids = [];
  const voeg = (...l) => { for (const id of l) if (G.zMap[id] && !ids.includes(id)) ids.push(id); };
  if (talen.includes("nl")) {
    voeg("vtmhd", "eenhd", "vierhd", "ketnetcanvashd", "2behd", "vijfhd");
    const regio = G.index.zenders.find(z => z.n === 8); if (regio) voeg(regio.id);
  }
  if (talen.includes("en")) voeg("bbc1", "bbc2");
  if (talen.includes("fr")) voeg("launehd", "rtltvihd", "tf1hd", "france2");
  if (talen.includes("de")) voeg("ard", "zdf");
  if (S.ob) { // zenders waar je favoriete programma's op komen
    const tel = {};
    for (const t of S.ob.programmas) for (const p of alleProgs()) if (norm(p.t) === norm(t)) tel[p.c] = (tel[p.c] || 0) + 1;
    voeg(...Object.keys(tel).sort((x, y) => tel[y] - tel[x]).slice(0, 4));
  }
  const heeft = (...l) => l.some(x => themas.includes(x));
  if (heeft("docu", "natuur", "geschiedenis", "wetenschap", "truecrime")) voeg("dicoveryhd", "natgeohd", "history");
  if (heeft("misdaad", "thriller", "truecrime")) voeg("playcrime", "iddiscovery");
  if (heeft("kids")) voeg("ketnet", "studio100tv", "nickelodeon");
  if (heeft("koken")) voeg("njam");
  if (heeft("sport", "voetbal", "wielrennen", "motorsport", "tennis")) voeg("eurosporthd");
  if (heeft("humor")) voeg("tmf");
  if (heeft("nieuws") && talen.includes("en")) voeg("bbcworld");
  return ids.slice(0, 14);
}

function tekenWelkom() {
  if (!S.ob) startOnboarding();
  const { stap, a } = S.ob, laatste = stap === VRAGEN.length;
  $("#obStap").textContent = laatste ? "Je profiel" : `Vraag ${stap + 1} van ${VRAGEN.length}`;
  $("#obVoortgang").style.width = `${Math.round(stap / VRAGEN.length * 100)}%`;
  $("#obTerug").style.visibility = stap === 0 ? "hidden" : "visible";
  $("#obLater").hidden = laatste;

  if (!laatste && VRAGEN[stap].id === "zenders") {
    const v = VRAGEN[stap], { talen, themas } = obProfiel();
    const voorstel = voorgesteldeFavs(talen, themas);
    const inTaal = G.index.zenders.filter(z => !talen.length || talen.includes(z.taal)).map(z => z.id);
    const rest = (S.ob.alleZenders ? G.index.zenders.map(z => z.id) : inTaal).filter(id => !voorstel.includes(id));
    const tegel = id => {
      const z = G.zMap[id], r = S.ob.zenders.indexOf(id);
      return `<button class="zendertegel" data-obfav="${id}" aria-pressed="${r >= 0}" title="${esc(z.naam)}">
        <span class="rang">${r >= 0 ? r + 1 : ""}</span>${logo(z, true)}<span class="nm">${esc(z.naam)}</span></button>`;
    };
    $("#obVraag").textContent = v.vraag;
    $("#obUitleg").textContent = v.uitleg;
    $("#obInhoud").innerHTML = `
      <div class="tegels">${geenTegel(v)}</div>
      ${S.ob.zenders.length ? `<p class="volgorde">Jouw volgorde: ${S.ob.zenders.map((id, i) => `<b>${i + 1}</b> ${esc(G.zMap[id]?.naam)}`).join(" · ")}</p>` : ""}
      <h3 class="tegelkop">Voorgesteld voor jou</h3>
      <div class="zendertegels">${voorstel.map(tegel).join("")}</div>
      <h3 class="tegelkop">${S.ob.alleZenders ? "Alle andere zenders" : "Andere zenders in jouw talen"}</h3>
      <div class="zendertegels">${rest.map(tegel).join("")}</div>
      <button class="tekstknop" data-alzend type="button">${S.ob.alleZenders ? "Alleen zenders in mijn talen" : "Toon alle zenders"}</button>`;
    $("#obVolgende").textContent = S.ob.zenders.length || S.ob.geen.has("zenders") ? "Volgende" : "Overslaan";
    return;
  }
  if (!laatste && VRAGEN[stap].id === "programmas") {
    const v = VRAGEN[stap];
    $("#obVraag").textContent = v.vraag;
    $("#obUitleg").textContent = v.uitleg;
    $("#obInhoud").innerHTML = `
      <div class="tegels">${geenTegel(v)}</div>
      <div class="progzoek">
        <label class="vh" for="obProgZoek">Zoek een programma</label>
        <input id="obProgZoek" type="search" autocomplete="off" placeholder="Zoek op naam, bv. Thuis, De Verraders, Dagelijkse kost">
        <div id="obProgSug" class="suggesties"></div>
      </div>
      <h3 class="tegelkop">Je favoriete programma's</h3>
      <div id="obProgLijst" class="pillen"></div>
      <h3 class="tegelkop">Populair deze week</h3>
      <div id="obProgPop" class="pillen"></div>`;
    tekenObProgs();
    progZoeker($("#obProgZoek"), $("#obProgSug"), "ob");
    if (!G.alles) laadAlles().then(() => { G.alles = true; if (S.ob?.stap === stap) tekenObProgs(); });
    $("#obVolgende").textContent = S.ob.programmas.length || S.ob.geen.has("programmas") ? "Volgende" : "Overslaan";
    return;
  }
  if (!laatste) {
    const v = VRAGEN[stap];
    $("#obVraag").textContent = v.vraag;
    $("#obUitleg").textContent = v.uitleg;
    $("#obInhoud").innerHTML = `<div class="tegels" role="group" aria-label="${esc(v.vraag)}">${geenTegel(v)}${optiesVoor(v).map(o =>
      `<button class="tegel" data-obkeuze="${v.id}|${o.id}" aria-pressed="${a[v.id].has(o.id)}"><b>${esc(o.naam)}</b>${o.sub ? `<small>${esc(o.sub)}</small>` : ""}</button>`).join("")}</div>`;
    $("#obVolgende").textContent = a[v.id].size || S.ob.geen.has(v.id) ? "Volgende" : "Overslaan";
    return;
  }

  // Samenvatting
  const { talen, themas } = obProfiel();
  const favs = obFavs(talen, themas);
  const kandidaat = { ...S.profiel, talen, themas, favorieten: favs };
  const echt = S.profiel; S.profiel = kandidaat;
  const iso = vandaag();
  const tips = tipsVoor(iso, Math.max(lokaal(iso, 18), nu() - 600), lokaal(iso, 23, 30), 20);
  S.profiel = echt;
  const namen = themas.map(id => G.themas.find(t => t.id === id)?.naam).filter(Boolean);

  $("#obVraag").textContent = "Klaar! Dit is je profiel";
  $("#obUitleg").textContent = "Pas aan wat je wil. Alles kan je later nog wijzigen in je profiel.";
  $("#obInhoud").innerHTML = `<div class="ob-samen">
    <div class="voorproef"><span><b>${tips.length >= 20 ? "20+" : tips.length}</b> tips voor vanavond met dit profiel</span>
      ${tips.length ? `<ul>${tips.slice(0, 3).map(x => `<li>${tijd(x.p.b)} ${esc(x.p.t)} · ${esc(G.zMap[x.p.c]?.naam)}</li>`).join("")}</ul>` : `<span class="klein">Vanavond valt er weinig in je smaak. Kies wat meer interesses of kijk morgen opnieuw.</span>`}
    </div>
    <section><h2>Je naam</h2><label class="vh" for="obNaam">Je naam</label><input id="obNaam" type="text" autocomplete="given-name" placeholder="Je voornaam" value="${esc(S.ob.naam)}"></section>
    <section><h2>Talen</h2><div class="pillen">${talen.map(t => `<span class="pil">${esc(TALEN.find(x => x.id === t)?.naam)}</span>`).join("") || `<span class="klein">Geen voorkeur: je krijgt tips in alle talen.</span>`}</div></section>
    <section><h2>Je interesses</h2><div class="pillen">${namen.map(n => `<span class="pil">${esc(n)}</span>`).join("") || `<span class="klein">Nog geen interesses gekozen. Je krijgt algemene tips.</span>`}</div></section>
    <section><h2>Voorkeurzenders</h2>
      ${S.ob.geen.has("zenders") ? `<p class="klein" style="margin:0">Geen voorkeur: je tips komen van alle zenders.</p>`
        : S.ob.zenders.length ? "" : `<p class="klein" style="margin:0">Je koos er geen, dus we nemen deze voorstellen. Aanpassen kan bij de vorige vraag of in je profiel.</p>`}
      ${favs.length ? `<ol class="rangLijst">${favs.map(id => `<li>${logo(G.zMap[id], true)} ${esc(G.zMap[id]?.naam)}</li>`).join("")}</ol>` : ""}</section>
    <section><h2>Favoriete programma's</h2>${S.ob.programmas.length ? `<div class="pillen">${S.ob.programmas.map(t => `<span class="pil">${esc(t)}</span>`).join("")}</div>` : `<p class="klein" style="margin:0">Geen gekozen. Je kan ze later toevoegen op je kijklijst.</p>`}</section>
    <section><h2>Dagelijkse melding</h2>
      <label class="schakel"><input type="checkbox" id="obMeldAan"${S.ob.meldAan ? " checked" : ""}> <span>Stuur me elke dag wat er vanavond voor mij op tv is</span></label>
      <div class="instelrij"><label for="obUur">Om</label><select id="obUur">${Array.from({ length: 8 }, (_, i) => i + 14).map(u => `<option value="${u}"${u === S.ob.uur ? " selected" : ""}>${u}:00</option>`).join("")}</select></div>
      <p class="klein" style="margin:0">Meldingen zet je per toestel aan in je profiel${isIos ? " (op iPhone eerst via Deel → Zet op beginscherm)" : ""}.</p>
    </section>
  </div>`;
  $("#obVolgende").textContent = "Start mijn gids";
  $("#obNaam").addEventListener("input", e => { S.ob.naam = e.target.value; });
  $("#obMeldAan").addEventListener("change", e => { S.ob.meldAan = e.target.checked; });
  $("#obUur").addEventListener("change", e => { S.ob.uur = +e.target.value; });
}

function obKies(vraag, optie) {
  if (optie === "_geen") {
    if (S.ob.geen.has(vraag)) S.ob.geen.delete(vraag);
    else {
      S.ob.geen.add(vraag);
      if (S.ob.a[vraag]) S.ob.a[vraag].clear();
      if (vraag === "zenders") S.ob.zenders = [];
      if (vraag === "programmas") S.ob.programmas = [];
    }
    return tekenWelkom();
  }
  S.ob.geen.delete(vraag);
  const set = S.ob.a[vraag];
  if (set.has(optie)) set.delete(optie);
  else {
    if (vraag === "Sport" && optie === "geen") set.clear();
    if (vraag === "Sport" && optie !== "geen") set.delete("geen");
    set.add(optie);
  }
  tekenWelkom();
}

const obFavs = (talen, themas) => S.ob.geen.has("zenders") ? [] : S.ob.zenders.length ? [...S.ob.zenders] : voorgesteldeFavs(talen, themas).slice(0, 6);

/* Favoriete programma's = gevolgde reeksen op de kijklijst. Toevoegen wat nieuw is, weghalen wat werd uitgevinkt. */
async function bewaarObProgs() {
  const gewenst = new Set(S.ob.programmas.map(norm));
  const nu_ = S.kijk.filter(k => k.soort === "reeks");
  for (const k of nu_) if (!gewenst.has(norm(k.titel))) await wisselReeks(k.titel, true);
  for (const t of S.ob.programmas) if (!nu_.some(k => norm(k.titel) === norm(t))) await wisselReeks(t, true);
}

async function obKlaar(overslaan = false) {
  const p = S.profiel;
  if (!overslaan) {
    const { talen, themas } = obProfiel();
    const favs = obFavs(talen, themas);
    await bewaarObProgs();
    Object.assign(p, { talen, themas, favorieten: favs, naam: S.ob.naam.trim() || p.naam, melding_uur: S.ob.uur, melding_aan: S.ob.meldAan });
  }
  p.onboarding_klaar = true;
  try { await OP.bewaarProfiel(p); } catch (e) { toast("Bewaren lukte niet: " + e.message); return; }
  S.ob = null;
  $("#initiaal").textContent = initiaal();
  toast(overslaan ? "Je kan de vragen later beantwoorden in je profiel" : "Je profiel staat klaar");
  location.hash = "vanavond";
}

/* ---------- Programma's zoeken op naam ---------- */
const OPVUL = /geen uitzending|einde uitzending|uitzending onderbroken|teleshop|nachtprogramma|programma onbekend|to be announced|^tba$|^weer$|^het weer$|^météo$/i;
function titelIndex() {
  if (G.titels && G.titelsVan === alleProgs().length) return G.titels;
  const m = new Map(), t0 = nu();
  for (const p of alleProgs()) {
    if (p.e < t0 || p.e - p.b < 10 * 60 || isNieuws(p) || OPVUL.test(p.t)) continue;
    const k = norm(p.t); if (!k) continue;
    const x = m.get(k) || { titel: p.t, n: 0, zenders: new Set(), g: p.g, woorden: k.split(" ") };
    x.n++; x.zenders.add(p.c); if (!x.g.length && p.g.length) x.g = p.g;
    m.set(k, x);
  }
  G.titelsVan = alleProgs().length;
  return (G.titels = [...m.values()]);
}
function zoekTitels(q, max = 8) {
  const ws = norm(q).split(" ").filter(Boolean);
  if (!ws.length) return [];
  const res = [];
  for (const x of titelIndex()) {
    let s = 0;
    for (const w of ws) {
      let best = 0;
      for (const woord of x.woorden) {
        if (woord === w) best = Math.max(best, 3);
        else if (woord.startsWith(w)) best = Math.max(best, 2);
        else if (w.length >= 4 && afstand(w, woord.slice(0, w.length + 1), 1) <= 1) best = Math.max(best, 1);
      }
      if (!best) { s = 0; break; }
      s += best;
    }
    if (!s) continue;
    if (norm(x.titel).startsWith(norm(q))) s += 3;
    res.push({ x, s: s + Math.min(x.n, 10) / 10 });
  }
  return res.sort((a, b) => b.s - a.s).slice(0, max).map(r => r.x);
}
function sugHtml(lijst, doel, q) {
  const gekozen = doel === "ob" ? S.ob.programmas.map(norm) : S.kijk.filter(k => k.soort === "reeks").map(k => norm(k.titel));
  const rijen = lijst.map(x => {
    const al = gekozen.includes(norm(x.titel));
    const zn = [...x.zenders].slice(0, 2).map(c => G.zMap[c]?.naam).join(", ");
    return `<button class="sug" data-progkies="${esc(x.titel)}" data-doel="${doel}"${al ? " disabled" : ""}>
      <b>${esc(x.titel)}</b><small>${x.n}× de komende dagen · ${esc(zn)}${al ? " · al toegevoegd" : ""}</small></button>`;
  });
  const exact = lijst.some(x => norm(x.titel) === norm(q));
  if (q.trim().length >= 3 && !exact) rijen.push(`<button class="sug ander" data-progkies="${esc(q.trim())}" data-doel="${doel}"><b>“${esc(q.trim())}” toevoegen</b><small>Ook als het nu niet op tv is: we houden het in de gaten</small></button>`);
  return rijen.join("");
}
function progZoeker(input, doelEl, doel) {
  let t;
  input.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const q = input.value;
      if (!q.trim()) { doelEl.innerHTML = ""; return; }
      if (!G.alles) { doelEl.innerHTML = `<p class="klein">Even laden…</p>`; await laadAlles(); G.alles = true; }
      doelEl.innerHTML = sugHtml(zoekTitels(q), doel, q);
    }, 150);
  });
  input.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); doelEl.querySelector(".sug:not([disabled])")?.click(); }
  });
}
async function progGekozen(titel, doel) {
  if (doel === "ob") {
    S.ob.geen.delete("programmas");
    if (!S.ob.programmas.some(t => norm(t) === norm(titel))) S.ob.programmas.push(titel);
    $("#obProgZoek").value = ""; $("#obProgSug").innerHTML = ""; $("#obProgZoek").focus();
    tekenObProgs();
    $("#obVolgende").textContent = "Volgende";
    $$(".geenvoorkeur").forEach(b => b.setAttribute("aria-pressed", "false"));
  } else {
    if (!S.kijk.some(k => k.soort === "reeks" && norm(k.titel) === norm(titel))) await wisselReeks(titel);
    $("#kProgZoek").value = ""; $("#kProgSug").innerHTML = "";
  }
}
function tekenObProgs() {
  if (!$("#obProgLijst")) return;
  $("#obProgLijst").innerHTML = S.ob.programmas.map(t => `<button class="pil" data-obprogweg="${esc(t)}" aria-label="${esc(t)} verwijderen">${esc(t)} <span class="x">×</span></button>`).join("")
    || `<span class="klein">Nog geen programma's toegevoegd.</span>`;
  // Populair: titels die vaak terugkomen op de grote zenders en bij je interesses passen
  if (!G.alles) { $("#obProgPop").innerHTML = `<span class="klein">Laden…</span>`; return; }
  const { themas } = obProfiel();
  const pop = titelIndex().filter(x => x.n >= 3 && [...x.zenders].some(c => (G.zMap[c]?.n ?? 999) <= 30))
    .map(x => ({ x, s: x.n + (themas.length && G.themas.some(t => themas.includes(t.id) && x.g.some(g => t.rx.test(g))) ? 20 : 0) }))
    .sort((a, b) => b.s - a.s).slice(0, 16).map(r => r.x)
    .filter(x => !S.ob.programmas.some(t => norm(t) === norm(x.titel))).slice(0, 12);
  $("#obProgPop").innerHTML = pop.map(x => `<button class="pil" data-progkies="${esc(x.titel)}" data-doel="ob">+ ${esc(x.titel)}</button>`).join("");
}

function obVolgende() {
  if (S.ob.stap === VRAGEN.length) return obKlaar();
  S.ob.stap++; tekenWelkom(); window.scrollTo(0, 0);
}
function obTerug() { if (S.ob.stap > 0) { S.ob.stap--; tekenWelkom(); window.scrollTo(0, 0); } }

/* ---------- Navigatie ---------- */
const VIEWS = ["welkom", "vanavond", "gids", "zenders", "zoeken", "kijklijst", "profiel"];
let huidig = "vanavond";
function route() {
  const [v, a] = location.hash.replace("#", "").split("/");
  huidig = VIEWS.includes(v) ? v : "vanavond";
  if (huidig === "zenders" && a && G.zMap[a]) { if (S.zender !== a) S.scrollZender = true; S.zender = a; }
  for (const x of VIEWS) $("#v-" + x).hidden = x !== huidig;
  document.body.classList.toggle("ob-modus", huidig === "welkom");
  for (const a of $$("[data-tab]")) {
    if (a.dataset.tab === huidig) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  }
  herteken();
  window.scrollTo(0, 0);
}
function herteken() {
  ({ welkom: tekenWelkom, vanavond: tekenVanavond, gids: tekenGids, zenders: tekenZenders, zoeken: tekenZoeken, kijklijst: tekenKijklijst, profiel: tekenProfiel })[huidig]();
  if ($("#detail").open) toonDetail($("#detail").dataset.k);
}

/* ---------- Gebeurtenissen ---------- */
function koppel() {
  window.addEventListener("hashchange", route);
  document.addEventListener("click", e => {
    const t = e.target.closest("[data-kijk],[data-volg],[data-fav],[data-zender],[data-gdag],[data-zdag],[data-groep],[data-voorbeeld],[data-ontvolg],[data-thema],[data-woordweg],[data-favknop],[data-sluit],[data-obkeuze],[data-obfav],[data-taal],[data-nee],[data-vergeet],[data-allezoek],[data-alzend],[data-progkies],[data-obprogweg],[data-p]");
    if (!t) return;
    const d = t.dataset;
    if (d.nee) { e.stopPropagation(); const p = vind(d.nee); if (p) { $("#detail").close(); nietVoorMij(p); } return; }
    if (d.vergeet !== undefined) { S.profiel.geleerd = {}; bewaarProfiel(); toast("De gids is vergeten wat hij over je leerde"); return tekenProfiel(); }
    if (d.allezoek !== undefined) { S.zoek = $("#snelZoek").value; location.hash = "zoeken"; return; }
    if (d.alzend !== undefined) { S.ob.alleZenders = !S.ob.alleZenders; return tekenWelkom(); }
    if (d.kijk) { e.stopPropagation(); const p = vind(d.kijk); if (p) wisselUitzending(p); return; }
    if (d.volg) return wisselReeks(d.volg);
    if (d.ontvolg) return wisselReeks(d.ontvolg);
    if (d.fav) { wisselFav(d.fav); return; }
    if (d.zender) { if (d.dag) S.zenderDag = d.dag; $("#detail").close(); S.scrollZender = true; location.hash = "zenders/" + d.zender; if (huidig === "zenders") herteken(); return; }
    if (d.gdag) { S.gidsDag = d.gdag; return tekenGids(); }
    if (d.zdag) { S.zenderDag = d.zdag; S.scrollZender = true; return tekenZenders(); }
    if (d.groep) { S.groep = d.groep; bewaarUi(); return tekenGids(); }
    if (d.voorbeeld) { S.zoek = d.voorbeeld; return tekenZoeken(); }
    if (d.thema) { const l = S.profiel.themas; S.profiel.themas = l.includes(d.thema) ? l.filter(x => x !== d.thema) : [...l, d.thema]; bewaarProfiel(); return tekenProfiel(); }
    if (d.woordweg) { S.profiel.trefwoorden = S.profiel.trefwoorden.filter(x => x !== d.woordweg); bewaarProfiel(); return tekenProfiel(); }
    if (d.favknop) { wisselFav(d.favknop); return; }
    if (d.sluit !== undefined) return $("#detail").close();
    if (d.obkeuze) { const [v, o] = d.obkeuze.split("|"); return obKies(v, o); }
    if (d.obfav) { S.ob.geen.delete("zenders"); const z = S.ob.zenders, i = z.indexOf(d.obfav); i >= 0 ? z.splice(i, 1) : z.push(d.obfav); return tekenWelkom(); }
    if (d.progkies) { return progGekozen(d.progkies, d.doel); }
    if (d.obprogweg) { S.ob.programmas = S.ob.programmas.filter(t => t !== d.obprogweg); tekenObProgs(); return; }
    if (d.taal) { const l = S.profiel.talen; S.profiel.talen = l.includes(d.taal) ? l.filter(x => x !== d.taal) : [...l, d.taal]; bewaarProfiel(); return tekenProfiel(); }
    if (d.p) return toonDetail(d.p);
  });
  document.addEventListener("keydown", e => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches("[role=button][data-p]")) { e.preventDefault(); toonDetail(e.target.dataset.p); }
  });
  $("#detail").addEventListener("click", e => { if (e.target === $("#detail")) $("#detail").close(); });
  $("#gidsVan").addEventListener("change", e => { S.gidsVan = +e.target.value; bewaarUi(); tekenGids(); });
  $("#zenderFilter").addEventListener("input", e => { S.zenderFilter = e.target.value; tekenZenders(); });
  let zt;
  $("#zoekInput").addEventListener("input", e => { S.zoek = e.target.value; clearTimeout(zt); zt = setTimeout(tekenZoeken, 180); });
  let st;
  $("#snelZoek").addEventListener("input", () => { clearTimeout(st); st = setTimeout(tekenSnelZoek, 180); });
  $("#snelForm").addEventListener("submit", e => { e.preventDefault(); S.zoek = $("#snelZoek").value; location.hash = "zoeken"; });
  $("#zoekForm").addEventListener("submit", e => { e.preventDefault(); $("#zoekInput").blur(); tekenZoeken(); });
  $("#pNaam").addEventListener("input", e => { S.profiel.naam = e.target.value.trim(); $("#initiaal").textContent = initiaal(); bewaarProfiel(); });
  $("#pWoordForm").addEventListener("submit", e => {
    e.preventDefault(); const w = $("#pWoord").value.trim();
    if (w && !S.profiel.trefwoorden.some(x => norm(x) === norm(w))) { S.profiel.trefwoorden = [...S.profiel.trefwoorden, w]; bewaarProfiel(); }
    $("#pWoord").value = ""; tekenProfiel();
  });
  $("#pMeldAan").addEventListener("change", e => { S.profiel.melding_aan = e.target.checked; bewaarProfiel(); });
  $("#pMeldTips").addEventListener("change", e => { S.profiel.tips_in_melding = e.target.checked; bewaarProfiel(); });
  $("#pMeldUur").addEventListener("change", e => { S.profiel.melding_uur = +e.target.value; bewaarProfiel(); pushStatus(); });
  $("#pushKnop").addEventListener("click", pushKnop);
  progZoeker($("#kProgZoek"), $("#kProgSug"), "kijk");
  $("#obVolgende").addEventListener("click", obVolgende);
  $("#obTerug").addEventListener("click", obTerug);
  $("#obLater").addEventListener("click", () => obKlaar(true));
  $("#uitloggen").addEventListener("click", async () => { await OP.uitloggen(); location.hash = ""; location.reload(); });
  setInterval(() => { $("#klok").textContent = tijd(nu()); }, 15000);
  setInterval(() => { if (!$("#detail").open && ["vanavond", "gids"].includes(huidig)) herteken(); }, 60000);
}
function wisselFav(id) {
  const l = S.profiel.favorieten;
  S.profiel.favorieten = l.includes(id) ? l.filter(x => x !== id) : [...l, id];
  bewaarProfiel();
  toast(S.profiel.favorieten.includes(id) ? `${G.zMap[id].naam} bij je favorieten` : `${G.zMap[id].naam} uit je favorieten`);
  herteken();
}
const initiaal = () => (S.profiel.naam || OP?.email || "?").trim()[0]?.toUpperCase() || "?";

/* ---------- Opstarten ---------- */
async function startApp(opslag) {
  OP = opslag;
  $("#login").hidden = true; $("#app").hidden = false;
  $("#demoBalk").hidden = !OP.demo;
  try { await laadIndex(); }
  catch (e) { document.querySelector(".inhoud").innerHTML = `<p class="leeg">De tv-gids kon niet geladen worden (${esc(e.message)}). Probeer het later opnieuw.</p>`; return; }
  try { [S.profiel, S.kijk] = await Promise.all([OP.profiel(), OP.kijklijst()]); }
  catch (e) { toast("Je voorkeuren konden niet geladen worden: " + e.message); }
  S.profiel = { ...STANDAARD, ...S.profiel };
  $("#initiaal").textContent = initiaal();
  $("#klok").textContent = tijd(nu());
  await laadDag(vandaag());
  ruimKijklijstOp();
  if (!S.profiel.onboarding_klaar && !heeftInteresses()) location.hash = "welkom";
  koppel();
  route();
  laadAlles().then(() => { G.alles = true; });
}

function toonLogin(sb) {
  $("#login").hidden = false; $("#app").hidden = true;
  $("#loginForm").addEventListener("submit", async e => {
    e.preventDefault();
    const mail = $("#loginMail").value.trim(), m = $("#loginMelding");
    m.textContent = "Even geduld…";
    const { error } = await sb.auth.signInWithOtp({ email: mail, options: { shouldCreateUser: false, emailRedirectTo: location.origin + location.pathname } });
    if (!error) m.textContent = `Check je mailbox (${mail}) en tik op de link om in te loggen.`;
    else if (/signups not allowed|not found|user not found/i.test(error.message)) m.textContent = "Dit e-mailadres heeft nog geen toegang. Vraag de beheerder om je uit te nodigen.";
    else m.textContent = "Dat lukte niet: " + error.message;
  });
}

(async function boot() {
  if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {});
  if (!CFG.SUPABASE_URL || !window.supabase) return startApp(new LokaleOpslag());
  const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
  let gestart = false;
  sb.auth.onAuthStateChange((_, sessie) => { if (sessie && !gestart) { gestart = true; startApp(new SupaOpslag(sb, sessie.user)); } });
  const { data: { session } } = await sb.auth.getSession();
  if (session && !gestart) { gestart = true; startApp(new SupaOpslag(sb, session.user)); }
  else if (!session) toonLogin(sb);
})();
