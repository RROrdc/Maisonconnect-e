'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   Le clavier tactile, EXÉCUTÉ — pas seulement relu.

   POURQUOI CE BANC : `clavier.js` a déjà coûté trois défauts, tous invisibles
   aux autres contrôles.
     11/09 — un backtick dans un commentaire refermait le template literal : le
             fichier ne se chargeait plus du tout, sans un mot dans la page.
     11/09 — `pointer: coarse` ne détecte pas une dalle sous Chromium/Linux.
     13/09 — une valeur posée PAR SCRIPT ne fait jamais émettre `change` au
             navigateur : toucher ailleurs après avoir tapé perdait la saisie.
             Rémi l'a vu sur le menu, et la donnée disparaissait en silence.

   Vérifier la syntaxe ne prouve rien de tout cela. On EXÉCUTE donc le fichier
   dans un DOM minimal et on regarde ce qu'il fait vraiment.
   ═══════════════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const A = require('./aide');

/* Un DOM juste assez complet pour ce fichier — et pas davantage : un faux DOM
   qui en ferait trop finirait par masquer ce qu'on veut observer. */
function fauxDom() {
  const docEv = {};
  const faits = [];

  const faireEl = (tag) => ({
    tagName: String(tag).toUpperCase(),
    type: 'text', value: '', textContent: '', id: '', className: '',
    children: [], style: {}, _ev: {},
    selectionStart: 0, selectionEnd: 0,
    classList: {
      _s: new Set(),
      add(x) { this._s.add(x); }, remove(x) { this._s.delete(x); },
      contains(x) { return this._s.has(x); }, toggle() {},
    },
    addEventListener(n, f) { (this._ev[n] = this._ev[n] || []).push(f); },
    dispatchEvent(e) {
      faits.push({ type: e.type, cible: this, valeur: this.value });
      (this._ev[e.type] || []).forEach((f) => f(e));
      return true;
    },
    appendChild(c) { this.children.push(c); return c; },
    remove() {},
    setAttribute() {}, removeAttribute() {}, focus() {}, blur() {},
    scrollIntoView() {},
    set innerHTML(_v) { this.children = []; },
    get innerHTML() { return ''; },
  });

  const head = faireEl('head');
  const body = faireEl('body');
  const document = {
    head, body, activeElement: null,
    createElement: faireEl,
    getElementById: (id) => [...head.children, ...body.children].find((e) => e.id === id) || null,
    addEventListener(n, f) { (docEv[n] = docEv[n] || []).push(f); },
    querySelectorAll: () => [],
  };
  const declencher = (n, ev) => (docEv[n] || []).forEach((f) => f(ev));

  const memoire = { 'maison-clavier': '1' };
  const contexte = {
    document, console,
    window: { matchMedia: () => ({ matches: true }) },
    navigator: { userAgent: 'Mozilla/5.0 (X11; Linux aarch64) Chrome', maxTouchPoints: 1 },
    location: { search: '?clavier=1' },
    localStorage: { getItem: (k) => memoire[k] ?? null, setItem: (k, v) => { memoire[k] = v; } },
    URLSearchParams,
    Event: class { constructor(t, o) { this.type = t; Object.assign(this, o || {}); } },
    KeyboardEvent: class { constructor(t, o) { this.type = t; Object.assign(this, o || {}); } },
    setTimeout, clearTimeout,
  };
  contexte.window.document = document;
  vm.createContext(contexte);
  return { contexte, document, body, declencher, faits, faireEl };
}

module.exports = async function (muet) {
  const t = A.compteur(); t.muet = muet;
  t.titre('Clavier tactile — exécuté');

  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'public', 'clavier.js'), 'utf8');

  const b = fauxDom();
  let demarre = true, souci = '';
  try { new vm.Script(source).runInContext(b.contexte); }
  catch (e) { demarre = false; souci = e.message; }
  t.dire(demarre, 'le fichier s’exécute sans erreur', souci || 'chargé');
  if (!demarre) return t;

  /* Le kiosque annonce `?clavier=1` : le clavier DOIT apparaître, même si le
     navigateur se déclare « souris » — c'est tout le correctif du 11/09. */
  const champ = b.faireEl('input');
  b.document.activeElement = champ;
  b.declencher('focusin', { type: 'focusin', target: champ });
  const clavierAffiche = b.body.children.some((e) => e.className === 'clv');
  t.dire(clavierAffiche, 'le clavier s’ouvre sur un champ texte',
    clavierAffiche ? 'panneau ajouté' : 'aucun panneau');

  /* 🔴 LE contrôle qui manquait le 13/09. On tape (comme le fait le clavier :
     par script), puis on quitte le champ SANS valider. `change` doit partir. */
  champ.value = 'Tartiflette';
  b.document.activeElement = null;
  b.declencher('focusout', { type: 'focusout', target: champ });
  await new Promise((r) => setTimeout(r, 260));

  const change = b.faits.filter((f) => f.type === 'change' && f.cible === champ);
  t.dire(change.length >= 1,
    '🔑 quitter le champ sans valider émet quand même « change »',
    change.length ? `valeur transmise : ${change[0].valeur}` : 'AUCUN change — la saisie serait perdue');
  t.dire(!change.length || change[0].valeur === 'Tartiflette',
    'la valeur transmise est bien celle qui a été tapée',
    change.length ? change[0].valeur : '—');

  /* Et l'inverse : sans modification, on ne déclenche rien. Un `change` gratuit
     à chaque passage sur un champ enverrait des écritures inutiles au serveur,
     donc une diffusion temps réel et un rechargement de l'écran mural. */
  const b2 = fauxDom();
  new vm.Script(source).runInContext(b2.contexte);
  const vide = b2.faireEl('input');
  vide.value = 'inchangé';
  b2.document.activeElement = vide;
  b2.declencher('focusin', { type: 'focusin', target: vide });
  b2.document.activeElement = null;
  b2.declencher('focusout', { type: 'focusout', target: vide });
  await new Promise((r) => setTimeout(r, 260));
  const inutiles = b2.faits.filter((f) => f.type === 'change');
  t.dire(inutiles.length === 0, 'un champ non modifié ne déclenche aucune écriture',
    inutiles.length ? `${inutiles.length} change inutile(s)` : 'aucun');

  return t;
};
