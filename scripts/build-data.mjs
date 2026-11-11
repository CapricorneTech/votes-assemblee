// Télécharge l'open data de l'Assemblée nationale et génère les fichiers JSON du site.
// Usage : node scripts/build-data.mjs [--force]   (aucune dépendance npm)
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const LEG = "17";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = path.join(ROOT, ".cache");
const OUT = path.join(ROOT, "site", "data");
const BASE = `https://data.assemblee-nationale.fr/static/openData/repository/${LEG}`;
const SOURCES = {
  scrutins: `${BASE}/loi/scrutins/Scrutins.json.zip`,
  acteurs: `${BASE}/amo/deputes_actifs_mandats_actifs_organes/AMO10_deputes_actifs_mandats_actifs_organes.json.zip`,
  historique: `${BASE}/amo/tous_acteurs_mandats_organes_xi_legislature/AMO30_tous_acteurs_tous_mandats_tous_organes_historique.json.zip`,
  dossiers: `${BASE}/loi/dossiers_legislatifs/Dossiers_Legislatifs.json.zip`,
};
const FORCE = process.argv.includes("--force");
const MAX_AGE_MS = 12 * 3600 * 1000;

const rd = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const arr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
const txt = (x) => (x && typeof x === "object" ? x["#text"] : x);

async function fetchAndExtract(name, url) {
  const zip = path.join(CACHE, `${name}.zip`);
  const dir = path.join(CACHE, name);
  const fresh = fs.existsSync(zip) && Date.now() - fs.statSync(zip).mtimeMs < MAX_AGE_MS;
  if (FORCE || !fresh) {
    console.log(`↓ ${name}`);
    // Le serveur coupe parfois la connexion : on réessaie plusieurs fois.
    for (let essai = 1; ; essai++) {
      try {
        const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (suivi-votes-an)" } });
        if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
        fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
        break;
      } catch (e) {
        if (essai >= 5) throw e;
        console.log(`  échec (${e.cause?.code || e.message}), nouvel essai ${essai + 1}/5…`);
        await new Promise((r) => setTimeout(r, essai * 5000));
      }
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    try {
      execFileSync("unzip", ["-q", "-o", zip, "-d", dir], { stdio: "ignore" });
    } catch {
      execFileSync("tar", ["-xf", zip, "-C", dir], { stdio: "ignore" });
    }
  }
  return dir;
}

function writeJson(rel, data) {
  const f = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(data));
}

// Ordre d'affichage des groupes, de la gauche vers la droite de l'hémicycle.
const ORDRE = ["GDR", "LFI-NFP", "ECOS", "SOC", "LIOT", "EPR", "DEM", "HOR", "DR", "UDR", "UDDPLR", "RN", "NI"];
const rang = (abbr) => {
  const i = ORDRE.indexOf(String(abbr).toUpperCase());
  return i < 0 ? ORDRE.length - 1.5 : i;
};

// « l'amendement n° 3 … du projet de loi X (première lecture). » → « projet de loi X »
function nomTexte(titre) {
  const m = titre.match(/((?:projet|proposition) de (?:loi|résolution)[^(]*)/i);
  if (!m) return null;
  return m[1].replace(/[\s.,;]+$/, "").replace(/\s+/g, " ").trim();
}
const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const maj = (s) => s.charAt(0).toUpperCase() + s.slice(1);

async function main() {
  fs.mkdirSync(CACHE, { recursive: true });
  const dirs = {};
  for (const [name, url] of Object.entries(SOURCES)) dirs[name] = await fetchAndExtract(name, url);

  // ---------- Groupes politiques ----------
  const groupes = new Map();
  const organeDir = path.join(dirs.acteurs, "json", "organe");
  for (const f of fs.readdirSync(organeDir)) {
    const o = rd(path.join(organeDir, f)).organe;
    if (o.codeType !== "GP" || o.legislature !== LEG) continue;
    groupes.set(o.uid, {
      id: o.uid,
      abbr: o.libelleAbrev || o.libelleAbrege,
      nom: o.libelle,
      couleur: o.couleurAssociee || "#888888",
      actif: !(o.viMoDe && o.viMoDe.dateFin),
      membres: 0,
    });
  }

  // ---------- Députés ----------
  const deputes = new Map();
  const acteurDir = path.join(dirs.acteurs, "json", "acteur");
  for (const f of fs.readdirSync(acteurDir)) {
    const a = rd(path.join(acteurDir, f)).acteur;
    const id = txt(a.uid);
    const mandats = arr(a.mandats && a.mandats.mandat);
    const ma = mandats.find((m) => m.typeOrgane === "ASSEMBLEE" && m.legislature === LEG && !m.dateFin);
    if (!ma) continue;
    const mg = mandats.find((m) => m.typeOrgane === "GP" && m.legislature === LEG && !m.dateFin);
    const lieu = (ma.election && ma.election.lieu) || {};
    const g = mg ? mg.organes.organeRef : null;
    if (g && groupes.has(g)) groupes.get(g).membres++;
    deputes.set(id, {
      id,
      civ: a.etatCivil.ident.civ,
      prenom: a.etatCivil.ident.prenom,
      nom: a.etatCivil.ident.nom,
      g,
      dep: lieu.departement || "",
      numDep: lieu.numDepartement || "",
      circo: lieu.numCirco || "",
      debut: ma.dateDebut,
      actif: 1,
    });
  }
  // Noms des anciens députés (pour les votes passés).
  const noms = new Map();
  const histDir = path.join(dirs.historique, "json", "acteur");
  if (fs.existsSync(histDir)) {
    for (const f of fs.readdirSync(histDir)) {
      const id = f.replace(".json", "");
      if (deputes.has(id)) continue;
      try {
        const i = rd(path.join(histDir, f)).acteur.etatCivil.ident;
        noms.set(id, i);
      } catch {}
    }
  }

  // ---------- Dossiers législatifs ----------
  const dossiers = new Map();
  const dosDir = path.join(dirs.dossiers, "json", "dossierParlementaire");
  for (const f of fs.readdirSync(dosDir)) {
    const d = rd(path.join(dosDir, f)).dossierParlementaire;
    dossiers.set(d.uid, {
      titre: d.titreDossier.titre,
      type: d.procedureParlementaire ? d.procedureParlementaire.libelle : "",
      url: d.titreDossier.titreChemin
        ? `https://www.assemblee-nationale.fr/dyn/${d.legislature}/dossiers/${d.titreDossier.titreChemin}`
        : null,
    });
  }

  // ---------- Scrutins ----------
  const scrDir = path.join(dirs.scrutins, "json");
  const bruts = fs.readdirSync(scrDir).map((f) => rd(path.join(scrDir, f)).scrutin);
  bruts.sort((a, b) => +a.numero - +b.numero);

  // 1re passe : associer un nom de texte à un dossier quand un scrutin fournit les deux.
  const nomVersDossier = new Map();
  for (const s of bruts) {
    const ref = s.objet.dossierLegislatif && s.objet.dossierLegislatif.dossierRef;
    const n = nomTexte(s.titre);
    if (ref && n) nomVersDossier.set(norm(n), ref);
  }

  const groupesVus = new Set();
  const textes = new Map(); // clé → {id, titre, type, url, n, date, sort}
  const votesParDepute = new Map(); // id → tableau de caractères (index = position du scrutin)
  const dernierGroupe = new Map();
  const lots = new Map(); // numéro de lot → {num: {gid: {p,c,a,n}}}
  const N = bruts.length;
  const liste = [];

  bruts.forEach((s, idx) => {
    const num = +s.numero;
    const type = s.typeVote.codeTypeVote;
    const titre = maj(s.titre.trim());
    const important = type === "SPS" || type === "MOC" || /^l'ensemble/i.test(s.titre.trim()) ? 1 : 0;

    // Texte de rattachement
    let ref = s.objet.dossierLegislatif && s.objet.dossierLegislatif.dossierRef;
    const n = nomTexte(s.titre);
    if (!ref && n) ref = nomVersDossier.get(norm(n));
    let cle = null;
    if (ref) {
      cle = ref;
      if (!textes.has(cle)) {
        const d = dossiers.get(ref) || {};
        const lib = s.objet.dossierLegislatif && s.objet.dossierLegislatif.libelle;
        textes.set(cle, { id: cle, titre: d.titre || lib || maj(n || titre), type: d.type || "", url: d.url || null, n: 0 });
      }
    } else if (n) {
      cle = "T-" + norm(n).replace(/ /g, "-").slice(0, 90);
      if (!textes.has(cle)) {
        const type = /^projet de loi de finances/i.test(n) ? "Projet de loi de finances"
          : /^projet de loi de financement/i.test(n) ? "Projet de loi de financement de la sécurité sociale"
          : /^projet/i.test(n) ? "Projet de loi" : /résolution/i.test(n) ? "Résolution" : "Proposition de loi";
        textes.set(cle, { id: cle, titre: maj(n), type, url: null, n: 0 });
      }
    }
    if (cle) {
      const t = textes.get(cle);
      t.n++;
      t.date = s.dateScrutin;
      // Vote sur l'ensemble du texte (et non d'une partie) : c'est lui qui donne le sort du texte.
      if (/^l'ensemble d(u|e la) (projet|proposition)/i.test(s.titre.trim())) { t.sort = s.sort.code === "adopté" ? 1 : 0; t.final = num; }
    }

    // Ventilation par groupe + votes nominatifs
    const parGroupe = {};
    const nominatif = {};
    for (const g of arr(s.ventilationVotes.organe.groupes.groupe)) {
      const gid = g.organeRef;
      groupesVus.add(gid);
      const dv = g.vote.decompteVoix;
      parGroupe[gid] = [+dv.pour, +dv.contre, +dv.abstentions];
      const dn = g.vote.decompteNominatif || {};
      const cat = { p: dn.pours, c: dn.contres, a: dn.abstentions, n: dn.nonVotants };
      const ng = {};
      for (const [k, v] of Object.entries(cat)) {
        const ids = arr(v && v.votant).map((x) => x.acteurRef);
        if (!ids.length) continue;
        ng[k] = ids.map((x) => x.slice(2)).join(",");
        for (const id of ids) {
          let t = votesParDepute.get(id);
          if (!t) votesParDepute.set(id, (t = new Array(N).fill(".")));
          t[idx] = k;
          dernierGroupe.set(id, gid);
        }
      }
      if (Object.keys(ng).length) nominatif[gid] = ng;
    }
    const lot = Math.floor(num / 100);
    if (!lots.has(lot)) lots.set(lot, {});
    lots.get(lot)[num] = nominatif;

    const d = s.syntheseVote.decompte;
    liste.push({ num, date: s.dateScrutin, type, ok: s.sort.code === "adopté" ? 1 : 0, titre, p: +d.pour, c: +d.contre, a: +d.abstentions, cle, important, parGroupe });
  });

  // Groupes : uniquement ceux qui ont voté ou qui ont des membres, triés gauche → droite.
  const listeGroupes = [...groupes.values()]
    .filter((g) => groupesVus.has(g.id) || g.membres)
    .sort((a, b) => rang(a.abbr) - rang(b.abbr) || a.abbr.localeCompare(b.abbr));
  for (const gid of groupesVus) {
    if (groupes.has(gid)) continue;
    // Groupe disparu : on le cherche dans l'historique.
    let o = null;
    try { o = rd(path.join(dirs.historique, "json", "organe", gid + ".json")).organe; } catch {}
    listeGroupes.push({ id: gid, abbr: (o && (o.libelleAbrev || o.libelleAbrege)) || "Autre", nom: (o && o.libelle) || "Groupe non identifié", couleur: (o && o.couleurAssociee) || "#888888", actif: false, membres: 0 });
  }
  const gi = new Map(listeGroupes.map((g, i) => [g.id, i]));

  // Anciens députés ayant voté sous cette législature
  for (const id of votesParDepute.keys()) {
    if (deputes.has(id)) continue;
    const i = noms.get(id);
    deputes.set(id, { id, civ: i ? i.civ : "", prenom: i ? i.prenom : "", nom: i ? i.nom : id, g: dernierGroupe.get(id), dep: "", numDep: "", circo: "", debut: null, actif: 0 });
  }
  for (const d of deputes.values()) if (!d.g || !gi.has(d.g)) d.g = dernierGroupe.get(d.id) || d.g;

  const listeTextes = [...textes.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
  const ti = new Map(listeTextes.map((t, i) => [t.id, i]));

  // ---------- Écriture ----------
  fs.rmSync(OUT, { recursive: true, force: true });
  writeJson("index.json", {
    maj: new Date().toISOString(),
    legislature: +LEG,
    nbScrutins: N,
    dernier: bruts[N - 1].dateScrutin,
    groupes: listeGroupes.map((g) => [g.id, g.abbr, g.nom, g.couleur, g.membres, g.actif ? 1 : 0]),
    deputes: [...deputes.values()]
      .sort((a, b) => a.nom.localeCompare(b.nom, "fr") || a.prenom.localeCompare(b.prenom, "fr"))
      .map((d) => [d.id.slice(2), d.civ, d.prenom, d.nom, gi.has(d.g) ? gi.get(d.g) : -1, d.dep, d.numDep, d.circo, d.actif, d.debut]),
    textes: listeTextes.map((t) => [t.id, t.titre, t.type, t.url, t.n, t.date, t.sort ?? -1, t.final ?? 0]),
  });
  writeJson("scrutins.json", liste.map((s) => [
    s.num, s.date, s.type, s.ok, s.titre, s.p, s.c, s.a, s.cle ? ti.get(s.cle) : -1, s.important,
    listeGroupes.map((g) => (s.parGroupe[g.id] ? s.parGroupe[g.id].join(",") : "")).join("|"),
  ]));
  for (const [lot, data] of lots) {
    const o = {};
    for (const [num, ng] of Object.entries(data)) {
      o[num] = {};
      for (const [gid, v] of Object.entries(ng)) o[num][gi.get(gid)] = v;
    }
    writeJson(`votes/${lot}.json`, o);
  }
  for (const [id, t] of votesParDepute) writeJson(`deputes/${id.slice(2)}.json`, { v: t.join("") });

  const taille = (f) => (fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0) + " Ko";
  console.log(`✓ ${N} scrutins (jusqu'au ${bruts[N - 1].dateScrutin}), ${listeTextes.length} textes, ${deputes.size} députés, ${listeGroupes.length} groupes`);
  console.log(`  index.json ${taille("index.json")} · scrutins.json ${taille("scrutins.json")} · ${lots.size} lots de votes · ${votesParDepute.size} fiches députés`);
  console.log("  groupes : " + listeGroupes.map((g) => `${g.abbr}(${g.membres})`).join(" "));
}

main().catch((e) => { console.error(e); process.exit(1); });
