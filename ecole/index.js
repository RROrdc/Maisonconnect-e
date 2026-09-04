'use strict';
/* Module école — plusieurs comptes, plusieurs sources, une seule interface.
 *
 * ── Pourquoi cette couche existe ──────────────────────────────────────────
 * Même principe que `donnees/` (Notion puis SQLite) et `recettes/` (lien, IA,
 * recherche) : le reste du projet ne doit jamais savoir D'OÙ vient une
 * information scolaire. Ici il y en aura deux sources — EcoleDirecte pour
 * Martial et Enora, Pronote pour Augustin — et deux comptes distincts rien que
 * pour EcoleDirecte, parce que le collège et le lycée sont deux établissements.
 * Sans cette couche, `server.js` porterait ce détail dans chaque route.
 *
 * ── Ce qui SORT d'ici est normalisé ───────────────────────────────────────
 * Un cours, un devoir, une note ont la même forme quelle que soit la source.
 * C'est ce qui permettra de comparer, de fusionner et d'afficher sans un seul
 * `if (source === …)` dans les écrans.
 */
const path = require('path');
const crypto = require('crypto');
const { ClientED, ErreurED, QcmRequis } = require('./ecoledirecte');
const pronote = require('./pronote');
const { texteDeHtml, deBase64, texteEventuellementBase64, jour, dansNJours, anneeScolaire } = require('./commun');

/* ── Les comptes, lus dans le .env ────────────────────────────────────────
   ED_IDENTIFIANT / ED_MOTDEPASSE, puis _2, _3… Un secret reste dans le .env,
   jamais en base (§ 2 septies) — et une base qu'on recopie sur le Mac mini ne
   doit pas emporter les mots de passe scolaires avec elle. */
function comptesConfigures(env = process.env) {
  const liste = [];
  for (const suffixe of ['', '_2', '_3', '_4']) {
    const identifiant = (env['ED_IDENTIFIANT' + suffixe] || '').trim();
    const motdepasse = env['ED_MOTDEPASSE' + suffixe] || '';
    if (!identifiant || !motdepasse) continue;
    liste.push({ identifiant, motdepasse, etiquette: 'EcoleDirecte' + (suffixe ? ' ' + suffixe.slice(1) : '') });
  }
  return liste;
}

/* Le fichier d'état (cn/cv + QCM) est NOMMÉ PAR EMPREINTE de l'identifiant,
   jamais par l'identifiant lui-même : un nom de fichier se retrouve dans un
   listing, une sauvegarde, un message d'erreur. Même réflexe que les photos de
   plats nommées par empreinte (§ 2 quinquies), pour une autre raison. */
const fichierEtat = (identifiant) =>
  path.join(__dirname, 'etat-' + crypto.createHash('sha1').update(identifiant).digest('hex').slice(0, 12) + '.json');

/* ── Normalisation ───────────────────────────────────────────────────────── */

/* EcoleDirecte rend « 2026-09-08 08:00 ». On garde la date et l'heure séparées :
   tout le projet raisonne déjà ainsi (planning, presence, vocal), et découper
   une chaîne ISO a déjà coûté deux heures de décalage au § 2 quindecies. */
function coursNormalise(c, eleve) {
  const [debutJour, debutHeure] = String(c.start_date || '').split(' ');
  const [finJour, finHeure] = String(c.end_date || '').split(' ');
  return {
    eleve,
    jour: debutJour || '',
    debut: debutHeure || '',
    fin: finHeure || '',
    jourFin: finJour || debutJour || '',
    matiere: c.matiere || c.text || '',
    libelle: c.text || c.matiere || '',
    prof: c.prof || '',
    salle: c.salle || '',
    annule: Boolean(c.isAnnule),
    dispense: Boolean(c.dispense),
    /* `typeCours` distingue un cours d'une permanence ou d'un devoir surveillé. */
    type: c.typeCours || '',
    source: 'ecoledirecte',
  };
}

function devoirNormalise(matiere, pourLe, eleve) {
  const aFaire = matiere.aFaire || {};
  return {
    eleve,
    id: String(matiere.id != null ? matiere.id : ''),
    pour: pourLe,
    matiere: matiere.matiere || '',
    /* ⚠️ Un devoir SANS contenu existe vraiment : vu le 04/09 sur « SC. ECONO.&
       SOCIALES » — le professeur crée le travail à faire et met le détail en
       pièce jointe, ou le remplira plus tard. Deux mauvaises réponses :
       l'afficher vide (la ligne paraît cassée) ou le masquer (on cache un
       vrai travail). On dit donc ce qu'on sait, et où trouver le reste.
       Posé ICI, dans la normalisation, et pas dans les deux fronts : les
       rayons de courses et la table des pictogrammes ont déjà coûté cher au
       projet pour avoir été écrits des deux côtés (§ 2 octies, § 2 septdecies). */
    contenu: texteDeHtml(deBase64(aFaire.contenu)) || 'Travail à faire — détail dans EcoleDirecte',
    interrogation: Boolean(matiere.interrogation),
    fait: Boolean(aFaire.effectue),
    source: 'ecoledirecte',
  };
}

function noteNormalisee(n, eleve) {
  return {
    eleve,
    date: n.date || '',
    matiere: n.libelleMatiere || '',
    devoir: n.devoir || '',
    valeur: n.valeur,
    sur: n.noteSur,
    coefficient: n.coef,
    moyenneClasse: n.moyenneClasse,
    /* Une note « non significative » ne compte pas dans la moyenne : l'afficher
       comme les autres donnerait une lecture fausse. */
    significative: n.nonSignificatif !== true,
    source: 'ecoledirecte',
  };
}

function messageNormalise(m) {
  const de = (m.from && (m.from.nom || m.from.libelle || m.from.name)) || '';
  const prenom = (m.from && m.from.prenom) || '';
  return {
    id: String(m.id != null ? m.id : ''),
    date: m.date || '',
    de: [prenom, de].filter(Boolean).join(' ').trim() || 'Établissement',
    sujet: texteDeHtml(texteEventuellementBase64(m.subject)),
    lu: Boolean(m.read),
    source: 'ecoledirecte',
  };
}

/* ── Le module ───────────────────────────────────────────────────────────── */
class Ecole {
  constructor(env = process.env) {
    this.clients = comptesConfigures(env).map((c) => ({
      etiquette: c.etiquette,
      client: new ClientED({ identifiant: c.identifiant, motdepasse: c.motdepasse, fichierEtat: fichierEtat(c.identifiant) }),
    }));
  }

  get configure() { return this.clients.length > 0; }

  /* Se connecte à TOUS les comptes et rend la liste des élèves.
     ⚠️ Un compte en panne ne doit pas emporter les autres : le module est
     appelé depuis l'écran mural, et un QCM en attente sur le compte du collège
     ne doit pas faire disparaître le lycée. On collecte les échecs. */
  async eleves() {
    const trouves = [];
    const soucis = [];
    for (const c of this.clients) {
      try {
        await c.client.assurerConnexion();
        for (const e of c.client.eleves) trouves.push({ ...e, compte: c.etiquette, _client: c.client });
      } catch (err) {
        soucis.push({ compte: c.etiquette, message: err.message, qcm: err instanceof QcmRequis ? { question: err.question, propositions: err.propositions } : null });
      }
    }
    this.soucis = soucis;
    this._eleves = trouves;
    return trouves;
  }

  async trouver(prenom) {
    if (!this._eleves) await this.eleves();
    const p = String(prenom || '').toLowerCase();
    const e = this._eleves.find((x) => (x.prenom || '').toLowerCase().startsWith(p));
    if (!e) throw new ErreurED(`Aucun élève « ${prenom} » sur les comptes configurés.`);
    return e;
  }

  async emploiDuTemps(prenom, { jours = 7, du = null } = {}) {
    const e = await this.trouver(prenom);
    const debut = du || jour(new Date());
    const fin = jour(dansNJours(jours, du ? new Date(du) : new Date()));
    const brut = await e._client.emploiDuTemps(e.id, debut, fin);
    /* ⚠️ L'API ne rend PAS les cours dans l'ordre : sur une même journée ils
       arrivent mélangés. Un emploi du temps affiché dans le désordre est pire
       qu'illisible, on croit à un bug de données. On trie ici, une fois, plutôt
       que dans chaque écran. */
    return brut.map((c) => coursNormalise(c, e.prenom))
      .sort((a, b) => (a.jour + a.debut).localeCompare(b.jour + b.debut));
  }

  /* Le cahier de textes se lit en DEUX temps : une liste de dates, puis le
     détail de chaque date. On borne donc volontairement à l'horizon utile —
     sinon c'est une requête par jour d'année scolaire à chaque rafraîchissement. */
  async devoirs(prenom, { jours = 14 } = {}) {
    const e = await this.trouver(prenom);
    const parDate = await e._client.devoirs(e.id);
    const limite = jour(dansNJours(jours));
    const aujourdhui = jour(new Date());
    const dates = Object.keys(parDate).filter((d) => d >= aujourdhui && d <= limite).sort();

    const sortie = [];
    for (const d of dates) {
      const detail = await e._client.devoirsDuJour(e.id, d);
      for (const m of (detail.matieres || [])) if (m.aFaire) sortie.push(devoirNormalise(m, d, e.prenom));
    }
    return sortie;
  }

  async notes(prenom) {
    const e = await this.trouver(prenom);
    const d = await e._client.notes(e.id);
    return (d.notes || []).map((n) => noteNormalisee(n, e.prenom));
  }

  async messages(prenom) {
    const e = await this.trouver(prenom);
    const d = await e._client.messages(e.via === 'famille' ? { familleId: e.familleId } : { eleveId: e.id });
    const recus = (d.messages && d.messages.received) || [];
    return recus.map(messageNormalise);
  }

  /* ── Tout, de toutes les sources, en une fois ───────────────────────────
     ⚠️ MISE EN CACHE OBLIGATOIRE. Sans elle, chaque rafraîchissement de
     l'écran mural déclencherait une connexion EcoleDirecte par compte ET un
     lancement de Python de ~2 s — sur un Raspberry, toutes les 5 minutes.
     C'est la leçon déjà payée sur `readAgenda()` (§ 2 ter) : avec le temps
     réel, une simple coche relançait N téléchargements du calendrier.
     La signature du cache inclut la configuration : sans elle, ajouter le
     compte d'Enora resterait sans effet visible pendant un quart d'heure et
     on croirait le `.env` cassé (§ 2 septies). */
  async tout({ jours = 7, maxAgeMs = 15 * 60 * 1000 } = {}) {
    const signature = JSON.stringify([jours, this.clients.map((c) => c.etiquette), pronote.configure()]);
    const maintenant = Date.now();
    if (Ecole._cache && Ecole._cache.signature === signature && maintenant - Ecole._cache.le < maxAgeMs) {
      return { ...Ecole._cache.charge, cache: true, age: Math.round((maintenant - Ecole._cache.le) / 1000) };
    }

    const charge = {
      eleves: [], cours: [], devoirs: [], notes: [], messages: [],
      /* `modules` dit ce que CHAQUE établissement alimente réellement. Le
         collège d'Augustin ferme la messagerie, le lycée de Martial ne remplit
         pas le cahier de textes : sans cette carte, un écran vide passerait
         pour une panne la moitié du temps (§ 2 tervicies). */
      modules: {}, soucis: [], le: new Date().toISOString(),
    };

    /* — EcoleDirecte — */
    let eleves = [];
    try { eleves = await this.eleves(); } catch (e) { charge.soucis.push({ source: 'ecoledirecte', message: e.message }); }
    for (const s of this.soucis || []) charge.soucis.push({ source: 'ecoledirecte', compte: s.compte, message: s.message, qcm: Boolean(s.qcm) });

    for (const e of eleves) {
      charge.eleves.push({ prenom: e.prenom, nom: e.nom, classe: e.classe, etablissement: e.etablissement, source: 'ecoledirecte' });
      const alimente = { cours: false, devoirs: false, notes: false, messages: false };
      /* Une source en panne ne doit jamais emporter les autres : l'écran mural
         affiche plusieurs enfants, et un compte fâché ne doit pas tous les
         faire disparaître. Chaque lecture est isolée. */
      for (const [cle, lire] of [
        ['cours', () => this.emploiDuTemps(e.prenom, { jours })],
        ['devoirs', () => this.devoirs(e.prenom, { jours })],
        ['notes', () => this.notes(e.prenom)],
        ['messages', () => this.messages(e.prenom)],
      ]) {
        try {
          const r = await lire();
          alimente[cle] = r.length > 0;
          if (cle === 'messages') charge.messages.push(...r.map((m) => ({ ...m, eleve: e.prenom })));
          else charge[cle].push(...r);
        } catch (err) {
          charge.soucis.push({ source: 'ecoledirecte', eleve: e.prenom, module: cle, message: err.message });
        }
      }
      charge.modules[e.prenom] = alimente;
    }

    /* — Pronote — */
    if (pronote.configure()) {
      try {
        const p = pronote.tout({ jours });
        charge.eleves.push(...(p.eleves || []));
        charge.cours.push(...(p.cours || []));
        charge.devoirs.push(...(p.devoirs || []));
        charge.notes.push(...(p.notes || []));
        for (const e of p.eleves || []) {
          charge.modules[e.prenom] = {
            cours: (p.cours || []).some((c) => c.eleve === e.prenom),
            devoirs: (p.devoirs || []).some((d) => d.eleve === e.prenom),
            notes: (p.notes || []).some((n) => n.eleve === e.prenom),
            /* Refusé par l'établissement, pas vide : la nuance compte. */
            messages: false, messagesFermes: true,
          };
        }
      } catch (err) {
        charge.soucis.push({ source: 'pronote', message: err.message, detail: err.detail || '' });
      }
    }

    charge.cours.sort((a, b) => (a.jour + a.debut).localeCompare(b.jour + b.debut));
    charge.devoirs.sort((a, b) => (a.pour + a.eleve).localeCompare(b.pour + b.eleve));

    Ecole._cache = { signature, le: maintenant, charge };
    return { ...charge, cache: false, age: 0 };
  }

  static viderCache() { Ecole._cache = null; }
}

module.exports = { Ecole, pronote, comptesConfigures, fichierEtat, coursNormalise, devoirNormalise, noteNormalisee, messageNormalise, ErreurED, QcmRequis, anneeScolaire };
