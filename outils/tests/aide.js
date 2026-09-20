/* Outils communs aux tests.

   Pourquoi ces tests vivent DANS le projet : ils ont été écrits pendant la
   reconstruction du 19/08 et ils sont ce qui a permis d'affirmer que le serveur
   refait se comportait comme l'ancien. Les laisser dans un dossier temporaire,
   c'était les perdre au prochain redémarrage — la même erreur que d'avoir
   sauvegardé la base sans sauvegarder le code.

   Deux règles tenues partout ici :
   1. **On teste sur les VRAIES données**, faute de base de test — donc tout ce
      qui est créé porte le préfixe `ZZ-essai` et est retiré à la fin. Aucune
      opération de MASSE n'est jamais essayée (le projet a déjà payé une liste de
      courses vidée et une journée de planning dupliquée).
   2. **Jamais de `curl`** : sous Git Bash il abîme les accents dans le corps
      JSON, ce qui a déjà fait croire à un bug d'encodage inexistant. */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const PORT = Number(process.env.PORT) || 8090;
/* Depuis le 06/09 le serveur ne tourne plus sur le poste de développement mais
   sur le Mac mini. `MAISON_HOTE` permet de lancer les séries qui ont besoin du
   serveur depuis n'importe où :
     MAISON_HOTE=maison.local npm test
   Par défaut on reste sur localhost — c'est le cas quand on teste SUR le Mac. */
const HOTE = process.env.MAISON_HOTE || 'localhost';
const BASE = `http://${HOTE}:${PORT}`;
const MARQUE = 'ZZ-essai';

function compteur() {
  const etat = { ok: 0, ko: 0, muet: false };
  etat.dire = (bon, quoi, detail = '') => {
    bon ? etat.ok++ : etat.ko++;
    if (!etat.muet) console.log(`${bon ? '  ok ' : '  ✗✗ '} ${quoi}${detail ? ' — ' + detail : ''}`);
    return bon;
  };
  etat.titre = (t) => { if (!etat.muet) console.log(`\n=== ${t} ===`); };
  etat.info = (t) => { if (!etat.muet) console.log(`     ${t}`); };
  return etat;
}

async function api(chemin, methode = 'GET', corps, entetes = {}) {
  const r = await fetch(BASE + chemin, {
    method: methode,
    headers: { 'content-type': 'application/json', ...entetes },
    body: corps ? JSON.stringify(corps) : undefined,
  });
  return { statut: r.status, j: await r.json().catch(() => ({})) };
}

/* Session d'administration.
   ⚠️ Jusqu'au 12/09 ces tests entraient SANS code : l'amorçage le permettait
   tant que personne n'en avait. Depuis que chacun a le sien, il faut le donner.
   Le code passe par l'environnement et jamais par un fichier du dépôt — un
   secret qui traîne dans le code finit publié (§ 2 sexdecies). */
async function session(personne = 'Rémi') {
  const code = process.env.MAISON_CODE || '';
  const r = await api('/api/session', 'POST', { personne, code });
  if (r.statut === 429) throw new Error(`Trop d'essais : ${r.j.error || ''}`.trim());
  if (r.statut !== 200 || !r.j.jeton) {
    throw new Error(`Session refusée pour ${personne}. `
      + 'Pose MAISON_CODE=<son code> avant de lancer les tests '
      + '(les codes sont dans ~/codes-maison.txt sur le serveur).');
  }
  const entetes = { 'x-session': r.j.jeton };
  return {
    entetes, moi: r.j.moi,
    api: (chemin, methode, corps) => api(chemin, methode, corps, entetes),
    fermer: () => api('/api/session', 'DELETE', null, entetes),
  };
}

/* Le serveur est-il là ? Un test qui échoue parce que rien n'écoute est un test
   qui ment sur la cause. */
async function serveurPret() {
  try {
    const r = await api('/api/health');
    return r.statut === 200 && r.j.ok;
  } catch (_) { return false; }
}

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
const ymd = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/* Écoute le flux temps réel pendant un test. Renvoie de quoi lire ce qui est
   arrivé, et surtout de quoi refermer proprement — une connexion SSE oubliée
   empêche le processus de se terminer. */
async function ecouterFlux() {
  const ctrl = new AbortController();
  const recus = [];
  const flux = await fetch(BASE + '/api/flux', { signal: ctrl.signal });
  const lecteur = flux.body.getReader();
  (async () => {
    const dec = new TextDecoder();
    let tampon = '';
    try {
      while (true) {
        const { done, value } = await lecteur.read();
        if (done) break;
        tampon += dec.decode(value);
        for (const bloc of tampon.split('\n\n')) {
          const ev = /event: (\w+)/.exec(bloc), da = /data: (.+)/.exec(bloc);
          if (ev && da) { try { recus.push({ type: ev[1], data: JSON.parse(da[1]) }); } catch (_) {} }
        }
        tampon = tampon.slice(tampon.lastIndexOf('\n\n') + 2);
      }
    } catch (_) { /* abandon volontaire */ }
  })();
  await attendre(300);
  return { recus, fermer: () => ctrl.abort() };
}

/* ── Banc de rendu ────────────────────────────────────────────────────────
   Vit ICI et non dans une série : ce n'est pas un outil d'école, c'est le
   seul moyen de vérifier qu'une donnée arrive VRAIMENT à l'écran. Il a été
   écrit pour les devoirs (03/09), il sert depuis à la suppression et au menu ;
   le laisser dans ecole.js aurait fini par en faire une seconde copie, ce que
   ce projet paie chaque fois (rayons de courses, pictogrammes). */
/* Exécute TOUS les <script> d'une page dans un DOM factice, avec une fausse
   API. Ce n'est pas un navigateur — la mise en page n'est pas vérifiée (aucune
   capture d'écran sur ce poste, § 2 sexies) — mais le CHEMIN des données l'est,
   et c'est précisément là que se logent les défauts qu'aucun test d'API ne voit. */
async function executerPage(chemin, cibleId, donnees, ecole) {
  const vm2 = require('vm');
  const page = fs.readFileSync(path.join(__dirname, '..', '..', 'public', chemin), 'utf8');
  const els = {};
  const faux = (id) => (els[id] = els[id] || {
    id, innerHTML: '', textContent: '', value: '', content: '', style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    appendChild() {}, addEventListener() {}, setAttribute() {}, removeAttribute() {},
    insertAdjacentHTML() {}, remove() {}, focus() {}, blur() {}, scrollIntoView() {},
    closest: () => null, getBoundingClientRect: () => ({ width: 100, height: 100 }),
    getContext: () => new Proxy({}, { get: () => () => {} }),
    querySelector: () => faux(id + '>q'), querySelectorAll: () => [],
  });
  const doc = {
    getElementById: faux, createElement: () => faux('neuf'), addEventListener() {},
    documentElement: Object.assign(faux('html'), { dataset: {}, style: {} }),
    body: faux('body'), head: faux('head'),
    /* ⚠️ L'app passe par $('#ecran') — querySelector — là où le bento appelle
       getElementById. Sans cette équivalence les deux pages n'écrivent pas dans
       le même élément factice, et le test échoue pour une raison de banc. */
    querySelector: (q) => faux(/^#[\w-]+$/.test(q) ? q.slice(1) : 'sel:' + q),
    querySelectorAll: () => [],
  };
  const ctx2 = {
    console: { log() {}, warn() {}, error() {} }, document: doc, JSON, Math, Date,
    isNaN, parseInt, parseFloat, String, Number, Object, Array, RegExp, Error, Promise,
    Set, Map, encodeURIComponent, decodeURIComponent, setImmediate,
    window: {
      addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }),
      location: { protocol: 'http:', reload() {} }, innerWidth: 1080, innerHeight: 1920,
    },
    navigator: { userAgent: 'test', language: 'fr-FR' },
    localStorage: {
      /* L'app ouvre le dernier onglet consulté : on la place sur « Devoirs »,
         sinon on juge l'accueil, qui ne montre volontairement que l'échéance
         courte — et le test échouerait pour la mauvaise raison. */
      _d: { 'maison-jeton': 'J', 'maison-personne': (donnees.moi && donnees.moi.nom) || 'Martial',
        'maison-onglet': donnees.__onglet || 'devoirs' },
      getItem(k) { return this._d[k] === undefined ? null : this._d[k]; },
      setItem(k, v) { this._d[k] = v; }, removeItem(k) { delete this._d[k]; },
    },
    setInterval: () => 0, setTimeout: (fn) => { if (typeof fn === 'function') fn(); return 0; },
    clearInterval() {}, clearTimeout() {}, requestAnimationFrame: () => 0,
    EventSource: function () { this.addEventListener = () => {}; this.close = () => {}; },
    SpeechSynthesisUtterance: function () {},
    speechSynthesis: { getVoices: () => [], speak() {}, cancel() {} },
    /* ⚠️ /api/ecole répond APRÈS /api/data, exprès : c'est cet ordre-là qui a
       révélé la course du 03/09. Un banc où l'école répond en premier passe au
       vert alors que l'écran reste vide — le test aurait menti. */
    fetch: async (url) => {
      const u = String(url);
      if (u.indexOf('/api/ecole') >= 0) {
        await new Promise((r) => setImmediate(r));
        await new Promise((r) => setImmediate(r));
      }
      return { ok: true, json: async () => {
        if (u.indexOf('/api/ecole') >= 0) return ecole;
        if (u.indexOf('/api/data') >= 0) return donnees;
        if (u.indexOf('/api/notif') >= 0) return { notifs: [] };
        if (u.indexOf('/api/planning/mien') >= 0) return { creneaux: [] };
        return {};
      } };
    },
  };
  ctx2.globalThis = ctx2; ctx2.self = ctx2; ctx2.location = ctx2.window.location;
  vm2.createContext(ctx2);
  const erreurs = [];
  const scripts = page.match(/<script(?![^>]*\ssrc=)[^>]*>[\s\S]*?<\/script>/g) || [];
  for (const bloc of scripts) {
    const code = bloc.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
    try { vm2.runInContext(code, ctx2, { timeout: 8000 }); }
    catch (e) { erreurs.push(e.message); }
  }
  /* ⚠️ Les scripts lancent des fetch : on rend la main assez de fois pour que
     les promesses se dénouent, sinon on lit l'écran AVANT le chargement et le
     test échoue pour une raison qui n'a rien à voir avec le produit. */
  for (let i = 0; i < 40; i++) await new Promise((r) => setImmediate(r));
  /* `let` en tête de script crée une liaison lexicale, PAS une propriété du
     contexte : on ne peut pas lire ctx.S depuis l'extérieur. On rend donc une
     fonction qui évalue DANS le contexte — seule façon d'interroger la page. */
  const dedans = (expr) => vm2.runInContext(expr, ctx2);
  return { erreurs, html: (els[cibleId] && els[cibleId].innerHTML) || '', ctx: ctx2, dedans };
}

module.exports = { BASE, PORT, MARQUE, api, session, serveurPret, compteur, attendre, ymd, ecouterFlux, executerPage };
