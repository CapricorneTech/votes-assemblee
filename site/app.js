(() => {
  "use strict";
  const app = document.getElementById("app");
  const AN = "https://www.assemblee-nationale.fr/dyn";
  let G = [], D = [], T = [], S = [], Snum = new Map(), Did = new Map(), INFO = {};
  const cache = new Map();

  // ---------- utilitaires ----------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const fdate = (d) => new Date(d + "T12:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
  const pct = (x) => (isFinite(x) ? Math.round(x * 100) + " %" : "–");
  const json = (url) => {
    if (!cache.has(url)) cache.set(url, fetch(url).then((r) => { if (!r.ok) throw new Error(url); return r.json(); }));
    return cache.get(url);
  };
  const LIB = { p: "Pour", c: "Contre", a: "Abstention", n: "Non-votant", ".": "Absent" };
  // Position majoritaire d'un groupe à partir de [pour, contre, abstention]
  const pos = (v) => { if (!v) return null; const [p, c, a] = v; if (p + c + a === 0) return null; return p >= c && p >= a ? "p" : c >= a ? "c" : "a"; };

  // ---------- composants ----------
  const badge = (s) => `<span class="badge ${s.ok ? "ok" : "ko"}">${s.ok ? "Adopté" : "Rejeté"}</span>`;
  const bar = (p, c, a) => { const t = p + c + a || 1; return `<div class="bar" role="img" aria-label="${p} pour, ${c} contre, ${a} abstentions"><i class="p" style="width:${(p / t) * 100}%"></i><i class="c" style="width:${(c / t) * 100}%"></i><i class="a" style="width:${(a / t) * 100}%"></i></div>`; };
  const counts = (p, c, a) => `<div class="counts"><span><i class="dot p"></i><b>${p}</b> pour</span><span><i class="dot c"></i><b>${c}</b> contre</span><span><i class="dot a"></i><b>${a}</b> abstention${a > 1 ? "s" : ""}</span></div>`;
  const chips = (s) => `<div class="chips">${G.map((g, i) => { if (!g.actif && !s.g[i]) return ""; const k = pos(s.g[i]); return `<span class="chip ${k || "x"}" title="${esc(g.nom)} : ${k ? LIB[k].toLowerCase() : "n'a pas pris part au vote"}">${esc(g.abbr)}</span>`; }).join("")}</div>`;
  const gtag = (g) => (g ? `<a class="gtag" href="#/groupe/${g.id}"><i style="background:${esc(g.couleur)}"></i>${esc(g.abbr)}</a>` : "");
  const legend = `<div class="legend"><span><span class="chip p">Groupe</span> majoritairement pour</span><span><span class="chip c">Groupe</span> contre</span><span><span class="chip a">Groupe</span> abstention</span><span><span class="chip x">Groupe</span> absent</span></div>`;
  const typeLib = (t) => ({ SPS: "Vote solennel", MOC: "Motion de censure", SPO: "Scrutin public" }[t] || t);

  const scrutinCard = (s, withTexte = true) => `
    <a class="card" href="#/scrutin/${s.num}">
      <div class="meta">${badge(s)}<span>${fdate(s.date)}</span><span>· ${typeLib(s.type)} n° ${s.num}</span></div>
      <h3>${esc(s.titre)}</h3>
      ${bar(s.p, s.c, s.a)}${chips(s)}
    </a>`;
  const texteCard = (t) => `
    <a class="card" href="#/texte/${encodeURIComponent(t.id)}">
      <div class="meta">${t.sort === 1 ? '<span class="badge ok">Adopté</span>' : t.sort === 0 ? '<span class="badge ko">Rejeté</span>' : '<span class="badge neutre">En cours / pas de vote final</span>'}<span>${esc(t.type)}</span></div>
      <h3>${esc(t.titre)}</h3>
      <div class="meta"><span>${t.n} scrutin${t.n > 1 ? "s" : ""}</span><span>· dernier vote le ${fdate(t.date)}</span></div>
    </a>`;

  // Liste paginée avec bouton « Afficher plus »
  function paged(el, items, render, size = 20, empty = "Aucun résultat.") {
    let n = 0;
    el.innerHTML = items.length ? "" : `<p class="empty">${empty}</p>`;
    const list = document.createElement("div"); list.className = "list";
    const btn = document.createElement("button"); btn.className = "more";
    const more = () => {
      list.insertAdjacentHTML("beforeend", items.slice(n, n + size).map(render).join(""));
      n += size;
      btn.hidden = n >= items.length;
      btn.textContent = `Afficher plus (${Math.max(items.length - n, 0)} restants)`;
    };
    btn.onclick = more;
    if (items.length) { el.append(list, btn); more(); }
  }

  // ---------- pages ----------
  function home() {
    const imp = S.filter((s) => s.imp).reverse();
    app.innerHTML = `
      <section class="hero">
        <h1>Qui a voté quoi à l'Assemblée nationale ?</h1>
        <p>Les textes de loi examinés par les députés, et le vote de chaque groupe politique et de chaque député, expliqués simplement.</p>
        <div class="filters"><input type="search" id="q" placeholder="Chercher un texte ou un député… (ex. retraites, budget, nom d'un député)" autocomplete="off"></div>
        <div id="res"></div>
      </section>
      <div class="stats">
        <div class="stat"><b>${INFO.nbScrutins.toLocaleString("fr-FR")}</b><span>scrutins publics depuis 2024</span></div>
        <div class="stat"><b>${T.length}</b><span>textes votés</span></div>
        <div class="stat"><b>${D.filter((d) => d.actif).length}</b><span>députés en exercice</span></div>
        <div class="stat"><b>${fdate(INFO.dernier)}</b><span>dernier scrutin</span></div>
      </div>
      <h2>Derniers votes sur l'ensemble d'un texte</h2>${legend}
      <div id="imp"></div>
      <h2>Textes récemment débattus</h2>
      <div class="list">${T.slice(0, 6).map(texteCard).join("")}</div>
      <p><a href="#/textes">Voir tous les textes →</a></p>`;
    paged(document.getElementById("imp"), imp, scrutinCard, 8);
    const res = document.getElementById("res");
    document.getElementById("q").oninput = (e) => {
      const q = norm(e.target.value.trim());
      if (q.length < 2) { res.innerHTML = ""; return; }
      const dep = D.filter((d) => d.rech.includes(q)).slice(0, 6);
      const tx = T.filter((t) => t.rech.includes(q)).slice(0, 8);
      res.innerHTML = dep.length + tx.length ? `<div class="list">${dep.map(deputeCard).join("")}${tx.map(texteCard).join("")}</div>` : `<p class="empty">Aucun résultat pour « ${esc(e.target.value)} ».</p>`;
    };
  }

  function textes() {
    const types = [...new Set(T.map((t) => t.type).filter(Boolean))].sort();
    app.innerHTML = `<h1>Textes de loi</h1>
      <p class="muted">Projets de loi (déposés par le gouvernement) et propositions de loi (déposées par les parlementaires) ayant fait l'objet d'au moins un scrutin public.</p>
      <div class="filters"><input type="search" id="q" placeholder="Filtrer par mot-clé…">
        <select id="ty" aria-label="Type de texte"><option value="">Tous les types</option>${types.map((t) => `<option>${esc(t)}</option>`).join("")}</select>
        <select id="so" aria-label="Sort du texte"><option value="">Tous les résultats</option><option value="1">Adoptés</option><option value="0">Rejetés</option><option value="-1">Sans vote final</option></select></div>
      <div id="l"></div>`;
    const upd = () => {
      const q = norm(q_.value.trim()), ty = ty_.value, so = so_.value;
      paged(document.getElementById("l"), T.filter((t) => (!q || t.rech.includes(q)) && (!ty || t.type === ty) && (so === "" || t.sort === +so)), texteCard);
    };
    const q_ = document.getElementById("q"), ty_ = document.getElementById("ty"), so_ = document.getElementById("so");
    q_.oninput = ty_.onchange = so_.onchange = upd; upd();
  }

  function groupTable(s) {
    return `<div class="tablewrap"><table><thead><tr><th>Groupe</th><th>Position</th><th class="num">Pour</th><th class="num">Contre</th><th class="num">Abst.</th><th style="min-width:90px">Répartition</th></tr></thead><tbody>
      ${G.map((g, i) => { const v = s.g[i]; if (!v && !g.actif) return ""; const k = pos(v); const [p, c, a] = v || [0, 0, 0];
        return `<tr><td>${gtag(g)}</td><td>${k ? `<span class="chip ${k}">${LIB[k]}</span>` : '<span class="muted small">Absent</span>'}</td><td class="num">${p}</td><td class="num">${c}</td><td class="num">${a}</td><td>${bar(p, c, a)}</td></tr>`; }).join("")}
    </tbody></table></div>`;
  }

  function texte(id) {
    const ti = T.findIndex((t) => t.id === id), t = T[ti];
    if (!t) return notFound();
    const sc = S.filter((s) => s.t === ti).reverse();
    const fin = sc.filter((s) => s.imp);
    app.innerHTML = `<a class="back" href="#/textes">← Tous les textes</a>
      <h1>${esc(t.titre)}</h1>
      <div class="meta">${t.sort === 1 ? '<span class="badge ok">Adopté par l\'Assemblée</span>' : t.sort === 0 ? '<span class="badge ko">Rejeté par l\'Assemblée</span>' : '<span class="badge neutre">Pas de vote final enregistré</span>'}<span>${esc(t.type)}</span>${t.url ? `<a href="${esc(t.url)}" target="_blank" rel="noopener">Dossier complet sur assemblee-nationale.fr ↗</a>` : ""}</div>
      ${fin.length ? `<h2>Vote${fin.length > 1 ? "s" : ""} sur l'ensemble du texte</h2>${fin.map((s) => `<div class="card" style="margin-bottom:10px"><div class="meta">${badge(s)}<span>${fdate(s.date)}</span><a href="#/scrutin/${s.num}">Détail du scrutin n° ${s.num} →</a></div><h3>${esc(s.titre)}</h3>${bar(s.p, s.c, s.a)}${counts(s.p, s.c, s.a)}</div>${groupTable(s)}`).join("<br>")}` : ""}
      <h2>Tous les scrutins sur ce texte (${sc.length})</h2>
      <p class="muted small">Articles, amendements et motions votés pendant l'examen du texte, du plus récent au plus ancien.</p>
      <div class="filters"><input type="search" id="q" placeholder="Filtrer (ex. article 3, amendement n° 12, nom d'un député)…"></div>${legend}
      <div id="l"></div>`;
    const q_ = document.getElementById("q");
    const upd = () => { const q = norm(q_.value.trim()); paged(document.getElementById("l"), sc.filter((s) => !q || s.rech.includes(q)), scrutinCard); };
    q_.oninput = upd; upd();
  }

  function scrutins() {
    app.innerHTML = `<h1>Scrutins</h1>
      <p class="muted">Tous les scrutins publics de la législature, du plus récent au plus ancien.</p>
      <div class="filters"><input type="search" id="q" placeholder="Filtrer par mot-clé…">
        <select id="ty" aria-label="Type de scrutin"><option value="imp">Votes sur l'ensemble d'un texte</option><option value="">Tous les scrutins</option><option value="MOC">Motions de censure</option></select>
        <select id="so" aria-label="Résultat"><option value="">Adoptés et rejetés</option><option value="1">Adoptés</option><option value="0">Rejetés</option></select></div>${legend}
      <div id="l"></div>`;
    const q_ = document.getElementById("q"), ty_ = document.getElementById("ty"), so_ = document.getElementById("so");
    const all = S.slice().reverse();
    const upd = () => {
      const q = norm(q_.value.trim()), ty = ty_.value, so = so_.value;
      paged(document.getElementById("l"), all.filter((s) => (!q || s.rech.includes(q)) && (ty === "" || (ty === "imp" ? s.imp : s.type === ty)) && (so === "" || s.ok === +so)), scrutinCard);
    };
    q_.oninput = ty_.onchange = so_.onchange = upd; upd();
  }

  async function scrutin(num) {
    const s = Snum.get(+num);
    if (!s) return notFound();
    const t = T[s.t];
    app.innerHTML = `${t ? `<a class="back" href="#/texte/${encodeURIComponent(t.id)}">← ${esc(t.titre)}</a>` : `<a class="back" href="#/scrutins">← Tous les scrutins</a>`}
      <h1>${esc(s.titre)}</h1>
      <div class="meta">${badge(s)}<span>${fdate(s.date)}</span><span>· ${typeLib(s.type)} n° ${s.num}</span><a href="${AN}/${INFO.legislature}/scrutins/${s.num}" target="_blank" rel="noopener">Source officielle ↗</a></div>
      <div class="card" style="margin-top:14px">${bar(s.p, s.c, s.a)}${counts(s.p, s.c, s.a)}
        <p class="small muted" style="margin:8px 0 0">${s.p + s.c + s.a} suffrages sur 577 députés. ${s.type === "MOC" ? "Pour une motion de censure, seuls les votes « pour » sont comptés : il en faut 289 pour renverser le gouvernement." : ""}</p></div>
      <h2>Vote des groupes</h2>${groupTable(s)}
      <h2>Vote de chaque député</h2><div id="noms"><p class="loading">Chargement…</p></div>`;
    let lot;
    try { lot = await json(`data/votes/${Math.floor(s.num / 100)}.json`); } catch { document.getElementById("noms").innerHTML = '<p class="empty">Détail nominatif indisponible.</p>'; return; }
    const v = lot[s.num] || {};
    const names = (str) => str.split(",").map((id) => { const d = Did.get(id); return d ? `<a href="#/depute/${id}">${esc(d.prenom)} ${esc(d.nom)}</a>` : "Ancien député"; }).join(", ");
    const el = document.getElementById("noms");
    if (!el) return;
    el.innerHTML = Object.keys(v).length ? `<div class="card">${G.map((g, i) => { const x = v[i]; if (!x) return "";
      const nb = (k) => (x[k] ? x[k].split(",").length : 0);
      return `<details class="noms"><summary>${gtag(g)} <span class="muted small">${nb("p")} pour · ${nb("c")} contre · ${nb("a")} abst.</span></summary><div class="names">
        ${["p", "c", "a", "n"].map((k) => (x[k] ? `<p><span class="chip ${k === "n" ? "x" : k}">${LIB[k]}</span> ${names(x[k])}</p>` : "")).join("")}</div></details>`; }).join("")}</div>
      <p class="small muted">Les députés qui n'apparaissent pas n'ont pas pris part au vote. « Non-votant » désigne notamment le président de séance.</p>` : '<p class="empty">Pas de détail nominatif pour ce scrutin.</p>';
  }

  // Statistiques par groupe (calculées une fois)
  let gstats = null;
  function groupStats() {
    if (gstats) return gstats;
    const n = G.length;
    const coh = new Array(n).fill(0), cohN = new Array(n).fill(0), pres = new Array(n).fill(0);
    const acc = G.map(() => new Array(n).fill(0)), accN = G.map(() => new Array(n).fill(0));
    for (const s of S) {
      const ps = s.g.map(pos);
      for (let i = 0; i < n; i++) {
        if (!ps[i]) continue;
        const [p, c, a] = s.g[i];
        coh[i] += Math.max(p, c, a) / (p + c + a); cohN[i]++;
        for (let j = 0; j < n; j++) if (j !== i && ps[j]) { accN[i][j]++; if (ps[i] === ps[j]) acc[i][j]++; }
      }
    }
    return (gstats = { coh: coh.map((x, i) => x / cohN[i]), cohN, acc, accN });
  }

  function groupes() {
    const st = groupStats();
    app.innerHTML = `<h1>Groupes politiques</h1>
      <p class="muted">Les députés se rassemblent en groupes selon leurs affinités politiques. Classement de la gauche vers la droite de l'hémicycle.</p>
      <div class="grid">${G.map((g, i) => (g.actif ? `<a class="card gcard" style="--g:${esc(g.couleur)}" href="#/groupe/${g.id}">
        <h3>${esc(g.abbr)}</h3><div class="small muted">${esc(g.nom)}</div>
        <div class="kv"><span>Députés</span><b>${g.membres}</b></div>
        <div class="kv"><span title="Part moyenne du groupe qui vote comme sa majorité">Cohésion des votes</span><b>${pct(st.coh[i])}</b></div></a>` : "")).join("")}</div>
      <p class="small muted" style="margin-top:14px"><b>Cohésion</b> : en moyenne, part des députés du groupe présents qui votent dans le même sens que la majorité de leur groupe.</p>`;
  }

  function groupe(id) {
    const i = G.findIndex((g) => g.id === id), g = G[i];
    if (!g) return notFound();
    const st = groupStats();
    const membres = D.filter((d) => d.g === i && d.actif);
    const autres = G.map((o, j) => ({ o, r: st.acc[i][j] / st.accN[i][j], n: st.accN[i][j] })).filter((x) => x.o !== g && x.o.actif && x.n > 20).sort((a, b) => b.r - a.r);
    const imp = S.filter((s) => s.imp && pos(s.g[i])).reverse();
    app.innerHTML = `<a class="back" href="#/groupes">← Tous les groupes</a>
      <h1><span class="gtag"><i style="background:${esc(g.couleur)};width:16px;height:16px"></i></span> ${esc(g.nom)}</h1>
      <div class="stats"><div class="stat"><b>${g.membres}</b><span>députés</span></div><div class="stat"><b>${pct(st.coh[i])}</b><span>cohésion des votes</span></div><div class="stat"><b>${st.cohN[i].toLocaleString("fr-FR")}</b><span>scrutins avec participation</span></div></div>
      <h2>Vote le plus souvent comme…</h2>
      <p class="muted small">Part des scrutins où la position majoritaire du groupe est la même que celle de l'autre groupe.</p>
      <div class="card"><div class="agree">${autres.map((x) => `${gtag(x.o)}<div class="track"><i style="width:${x.r * 100}%"></i></div><b>${pct(x.r)}</b>`).join("")}</div></div>
      <h2>Ses positions sur l'ensemble des textes</h2><div id="l"></div>
      <h2>Membres (${membres.length})</h2>
      <div class="card names">${membres.map((d) => `<a href="#/depute/${d.id}">${esc(d.prenom)} ${esc(d.nom)}</a>`).join(", ") || "Ce groupe n'a plus de membres."}</div>`;
    paged(document.getElementById("l"), imp, (s) => { const k = pos(s.g[i]); const [p, c, a] = s.g[i];
      return `<a class="card" href="#/scrutin/${s.num}"><div class="meta"><span class="chip ${k}">${esc(g.abbr)} : ${LIB[k]}</span><span>${p} pour · ${c} contre · ${a} abst.</span><span>· ${fdate(s.date)}</span>${badge(s)}</div><h3>${esc(s.titre)}</h3></a>`; }, 10);
  }

  const circo = (d) => (d.dep ? `${esc(d.dep)} (${esc(d.numDep)}), ${d.circo}${d.circo === "1" ? "re" : "e"} circ.` : "Ancien député");
  const deputeCard = (d) => `<a class="card" href="#/depute/${d.id}"><div class="meta">${G[d.g] ? `<span class="gtag"><i style="background:${esc(G[d.g].couleur)}"></i>${esc(G[d.g].abbr)}</span>` : ""}<span>${circo(d)}</span></div><h3 style="margin-bottom:0">${esc(d.prenom)} ${esc(d.nom)}</h3></a>`;

  function deputes() {
    app.innerHTML = `<h1>Députés</h1>
      <div class="filters"><input type="search" id="q" placeholder="Nom, département ou numéro de département…">
        <select id="gr" aria-label="Groupe"><option value="">Tous les groupes</option>${G.map((g, i) => (g.actif ? `<option value="${i}">${esc(g.abbr)} – ${esc(g.nom)}</option>` : "")).join("")}</select>
        <select id="ac" aria-label="Statut"><option value="1">En exercice</option><option value="0">Anciens députés</option></select></div>
      <div id="l"></div>`;
    const q_ = document.getElementById("q"), gr_ = document.getElementById("gr"), ac_ = document.getElementById("ac");
    const upd = () => {
      const q = norm(q_.value.trim()), gr = gr_.value, ac = +ac_.value;
      paged(document.getElementById("l"), D.filter((d) => d.actif === ac && (!q || d.rech.includes(q)) && (gr === "" || d.g === +gr)), deputeCard, 30);
    };
    q_.oninput = gr_.onchange = ac_.onchange = upd; upd();
  }

  async function depute(id) {
    const d = Did.get(id);
    if (!d) return notFound();
    const g = G[d.g];
    app.innerHTML = `<a class="back" href="#/deputes">← Tous les députés</a>
      <h1>${esc(d.prenom)} ${esc(d.nom)}</h1>
      <div class="meta">${gtag(g)}${g ? `<span>${esc(g.nom)}</span>` : ""}<span>· ${circo(d)}</span><a href="${AN}/deputes/PA${d.id}" target="_blank" rel="noopener">Fiche officielle ↗</a></div>
      <div id="body"><p class="loading">Chargement des votes…</p></div>`;
    let v;
    try { v = (await json(`data/deputes/${id}.json`)).v; } catch { document.getElementById("body").innerHTML = '<p class="empty">Aucun vote enregistré pour ce député.</p>'; return; }
    const body = document.getElementById("body");
    if (!body) return;
    // Période de présence : depuis le début du mandat (ou entre le premier et le dernier vote pour un ancien député)
    let first = 0, last = S.length - 1;
    if (d.actif && d.debut) first = Math.max(0, S.findIndex((s) => s.date >= d.debut));
    else { first = v.search(/[pcan]/); last = Math.max(v.lastIndexOf("p"), v.lastIndexOf("c"), v.lastIndexOf("a"), v.lastIndexOf("n")); }
    let nb = { p: 0, c: 0, a: 0, n: 0, ".": 0 }, fid = 0, fidN = 0, impTot = 0, impVote = 0;
    const rows = [];
    for (let i = first; i <= last; i++) {
      const k = v[i] || ".", s = S[i];
      nb[k]++;
      if (s.imp) { impTot++; if (k !== ".") impVote++; }
      if ("pca".includes(k)) { const gp = pos(s.g[d.g]); if (gp) { fidN++; if (gp === k) fid++; } }
      rows.push({ s, k });
    }
    rows.reverse();
    const tot = last - first + 1, exprimes = nb.p + nb.c + nb.a;
    body.innerHTML = `
      <div class="stats">
        <div class="stat"><b>${pct(impVote / impTot)}</b><span>participation aux votes sur l'ensemble d'un texte (${impVote}/${impTot})</span></div>
        <div class="stat"><b>${pct((exprimes + nb.n) / tot)}</b><span>participation à tous les scrutins (${exprimes + nb.n}/${tot})</span></div>
        <div class="stat"><b>${pct(fid / fidN)}</b><span>votes identiques à la majorité de son groupe</span></div>
      </div>
      <div class="card">${bar(nb.p, nb.c, nb.a)}${counts(nb.p, nb.c, nb.a)}</div>
      <p class="small muted">Une absence à un scrutin ne signifie pas une absence de travail : commissions, circonscription et délégations de vote ne sont pas visibles ici, et beaucoup de scrutins sur des amendements ont lieu avec peu de députés en séance.</p>
      <h2>Ses votes</h2>
      <div class="filters"><input type="search" id="q" placeholder="Filtrer par mot-clé…">
        <select id="ty" aria-label="Type"><option value="imp">Votes sur l'ensemble d'un texte</option><option value="">Tous les scrutins</option></select>
        <select id="po" aria-label="Position"><option value="">Toutes les positions</option><option value="p">Pour</option><option value="c">Contre</option><option value="a">Abstention</option><option value=".">Absent</option></select></div>
      <div id="l"></div>`;
    const q_ = document.getElementById("q"), ty_ = document.getElementById("ty"), po_ = document.getElementById("po");
    const upd = () => {
      const q = norm(q_.value.trim()), ty = ty_.value, po = po_.value;
      paged(document.getElementById("l"), rows.filter((r) => (!q || r.s.rech.includes(q)) && (!ty || r.s.imp) && (!po || r.k === po)),
        ({ s, k }) => `<a class="card" href="#/scrutin/${s.num}"><div class="meta"><span class="chip ${k === "." || k === "n" ? "x" : k}">${LIB[k]}</span><span>${fdate(s.date)}</span>${badge(s)}</div><h3 style="margin-bottom:0">${esc(s.titre)}</h3></a>`, 20, "Aucun vote ne correspond.");
    };
    q_.oninput = ty_.onchange = po_.onchange = upd; upd();
  }

  const notFound = () => { app.innerHTML = '<p class="empty">Page introuvable. <a href="#/">Retour à l\'accueil</a></p>'; };

  // ---------- routeur ----------
  const routes = { "": home, textes, texte, scrutins, scrutin, groupes, groupe, deputes, depute };
  function route() {
    const [, page = "", arg] = location.hash.replace(/^#/, "").split("/");
    document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("on", page !== "" && a.getAttribute("href").startsWith("#/" + page.slice(0, 5))));
    window.scrollTo(0, 0);
    (routes[page] || notFound)(arg ? decodeURIComponent(arg) : undefined);
  }

  // ---------- chargement ----------
  Promise.all([json("data/index.json"), json("data/scrutins.json")]).then(([idx, sc]) => {
    INFO = idx;
    G = idx.groupes.map(([id, abbr, nom, couleur, membres, actif]) => ({ id, abbr, nom, couleur, membres, actif }));
    D = idx.deputes.map(([id, civ, prenom, nom, g, dep, numDep, circo, actif, debut]) => ({ id, civ, prenom, nom, g, dep, numDep, circo, actif, debut, rech: norm(`${prenom} ${nom} ${dep} ${numDep}`) }));
    T = idx.textes.map(([id, titre, type, url, n, date, sort, final]) => ({ id, titre, type, url, n, date, sort, final, rech: norm(titre + " " + type) }));
    S = sc.map(([num, date, type, ok, titre, p, c, a, t, imp, g]) => ({ num, date, type, ok, titre, p, c, a, t, imp, rech: norm(titre), g: g.split("|").map((x) => (x ? x.split(",").map(Number) : null)) }));
    S.forEach((s) => Snum.set(s.num, s));
    D.forEach((d) => Did.set(d.id, d));
    document.getElementById("maj").textContent = `Dernière mise à jour : ${new Date(idx.maj).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}.`;
    window.addEventListener("hashchange", route);
    route();
  }).catch((e) => { console.error(e); app.innerHTML = '<p class="empty">Impossible de charger les données. Réessayez dans un instant.</p>'; });
})();
