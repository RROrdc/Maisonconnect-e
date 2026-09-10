'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   Température — lue par HomeKit, via un Raccourci macOS.

   POURQUOI CETTE VOIE plutôt que l'API Netatmo :
   • **Aucun identifiant à stocker.** L'API Netatmo demande de créer une
     application développeur, de garder un `client_secret` et de gérer un jeton
     OAuth qui expire. Ici, rien : c'est l'app Maison qui détient déjà l'accès.
   • **Rien ne sort de la maison.** Le thermostat est déjà exposé en HomeKit sur
     le réseau local (vu le 06/09 en `_hap._tcp`). Le projet tient ce principe
     partout — c'est la même raison qui fait chercher le mot d'éveil de Jarvis
     sur l'appareil, et télécharger les photos de plats au lieu de les pointer.
   • **Ça ne casse pas quand Netatmo change d'API.** Le jour où le thermostat est
     remplacé par une autre marque compatible HomeKit, il n'y a rien à réécrire.

   ⚠️ Le prix à payer : macOS n'offre AUCUNE commande pour lire HomeKit. Le seul
   pont officiel est un Raccourci, que Rémi crée une fois — deux actions.
   ⚠️ Et comme pour la musique, ça n'aboutit que depuis une session graphique :
   `shortcuts` hérite des mêmes règles d'autorisation. D'où le passage par
   l'agent (voir maison/agent.js).

   Le nom du raccourci est un RÉGLAGE, jamais codé en dur : aucun foyer dans le
   code (§ 5 quater).
   ═══════════════════════════════════════════════════════════════════════════ */

const { execFile } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

const MAC = process.platform === 'darwin';

/* Le thermostat ne bouge pas à la seconde : une minute de cache suffit, et ça
   évite de lancer un Raccourci à chaque rafraîchissement de l'écran mural. */
const CACHE_MS = 60_000;
/* Un échec par blocage coûte huit secondes. On le retient plus longtemps qu'un
   succès : rejouer toutes les minutes un raccourci qui ne répond pas, c'est
   ralentir l'écran mural pour rien. */
const CACHE_ECHEC_MS = 5 * 60_000;
let cache = { le: 0, valeur: null };

/* On lit la sortie dans un FICHIER plutôt que sur stdout : `shortcuts run` écrit
   aussi ses propres messages sur la sortie standard, et on mélangerait la valeur
   avec eux. Le fichier ne contient que le résultat. */
/* 🐞 Un raccourci peut ne JAMAIS rendre la main — constaté le 07/09 : l'action
   « Obtenir l'état » attend indéfiniment quand l'accessoire n'est plus joignable
   dans l'app Maison. Sans borne, `/api/maison` traînerait autant, et l'écran
   mural attendrait un thermostat pour afficher la musique.
   ⚠️ SIGKILL et non le SIGTERM par défaut : `shortcuts` bloqué sur une attente
   ne se termine pas proprement. */
function lancerRaccourci(nom, delai = 8000) {
  return new Promise((resolve, reject) => {
    const sortie = path.join(os.tmpdir(), `maison-temp-${process.pid}-${Date.now()}.txt`);
    execFile('/usr/bin/shortcuts', ['run', nom, '-o', sortie],
      { timeout: delai, killSignal: 'SIGKILL' }, (err, _o, stderr) => {
      let contenu = '';
      try { contenu = fs.readFileSync(sortie, 'utf8'); } catch { /* le raccourci n'a rien renvoyé */ }
      fs.unlink(sortie, () => {});
      if (err) {
        const bloque = err.killed || /ETIMEDOUT|SIGKILL/.test(String(err.signal || err.code));
        return reject(Object.assign(
          new Error(bloque
            ? 'le raccourci n’a pas répondu — l’accessoire est-il toujours dans l’app Maison ?'
            : String(stderr || err.message).trim().slice(0, 200)),
          { bloque }));
      }
      resolve(contenu.trim());
    });
  });
}

/* Un Raccourci rend du texte libre : « 20 » comme « 20,5 °C » ou
   « Salon : 20.5 degrés ». On extrait le premier nombre, virgule ou point, et on
   REFUSE plutôt que de deviner si on n'en trouve pas — une température fausse
   sur un mur est pire qu'une absence (même règle que pour les photos de plats). */
function nombreDe(texte) {
  const m = String(texte).replace(',', '.').match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/* ── 🔴 On ne lance JAMAIS un raccourci qui ÉCRIT ───────────────────────────
   Le 10/09, le raccourci « Température maison » contenait huit actions, dont
   QUATRE « Activer/désactiver l'accessoire ou la scène ». Un écran mural qui le
   déclenche toutes les minutes aurait allumé et éteint des appareils de la
   maison en boucle. Il a échoué avant d'y arriver — mais compter là-dessus
   n'est pas une protection.

   On inspecte donc la description des actions AVANT de lancer. C'est la même
   règle que partout ailleurs dans ce projet : la machine propose, le code
   décide, et rien de destructeur ne part tout seul (§ 2 septies).

   ⚠️ Si la base est illisible, on laisse passer plutôt que de bloquer une
   fonction qui marche — mais on le DIT dans la réponse (`verifie: false`), pour
   qu'une absence de contrôle ne se confonde pas avec un contrôle réussi. */
const ECRITURE = /activer|désactiver|desactiver|régler|regler|définir|definir|contrôler|controler|supprimer|envoyer|lancer|ouvrir|fermer|verrouiller|turn |set |toggle|open |close |lock/i;

function inspecter(nom) {
  try {
    const { DatabaseSync } = require('node:sqlite');
    const chemin = path.join(os.homedir(), 'Library', 'Shortcuts', 'Shortcuts.sqlite');
    if (!fs.existsSync(chemin)) return { verifie: false };
    /* Copie cohérente : sans le WAL, un raccourci créé récemment n'apparaît pas
       — piège déjà payé en migrant maison.db le 06/09. */
    const copie = path.join(os.tmpdir(), `maison-sc-${process.pid}.db`);
    try { fs.unlinkSync(copie); } catch { /* absent, tant mieux */ }
    const src = new DatabaseSync(`file:${chemin}?mode=ro`, { readOnly: true });
    src.exec(`VACUUM INTO '${copie.replace(/'/g, "''")}'`);
    src.close();
    const db = new DatabaseSync(copie, { readOnly: true });
    const r = db.prepare('SELECT ZACTIONSDESCRIPTION d, ZHASOUTPUTACTION o FROM ZSHORTCUT WHERE ZNAME = ?').get(nom);
    db.close();
    try { fs.unlinkSync(copie); } catch { /* peu importe */ }
    if (!r) return { verifie: true, existe: false };
    return {
      verifie: true, existe: true,
      ecrit: ECRITURE.test(String(r.d || '')),
      rendResultat: !!r.o,
      actions: String(r.d || '').slice(0, 160),
    };
  } catch { return { verifie: false }; }
}

async function etat(nomRaccourci) {
  const nom = String(nomRaccourci || '').trim();
  if (!MAC) return { disponible: false, raison: 'se lit depuis le Mac' };
  if (!nom) return { disponible: false, raison: 'raccourci non configuré (/admin/ → Réglages)' };
  /* Le contrôle passe AVANT le cache : un raccourci modifié pour écrire ne doit
     pas continuer à tourner parce qu'une lecture saine est encore en mémoire. */
  const insp = inspecter(nom);
  if (insp.verifie && insp.existe === false) {
    return { disponible: false, nom, raison: `raccourci « ${nom} » introuvable sur le Mac` };
  }
  if (insp.ecrit) {
    return { disponible: false, nom, verifie: true, raison:
      `refusé : « ${nom} » contient des actions qui MODIFIENT la maison (${insp.actions}). `
      + 'Un raccourci de lecture ne doit contenir que « Obtenir le statut » puis « Arrêter et générer le résultat ».' };
  }
  if (insp.verifie && insp.existe && !insp.rendResultat) {
    return { disponible: false, nom, verifie: true, raison:
      `« ${nom} » ne renvoie rien : il lui manque l’action « Arrêter et générer le résultat ».` };
  }

  const age = Date.now() - cache.le;
  const seuil = cache.valeur && cache.valeur.bloque ? CACHE_ECHEC_MS : CACHE_MS;
  if (age < seuil && cache.valeur && cache.valeur.nom === nom) return cache.valeur;

  let v;
  try {
    const brut = await lancerRaccourci(nom);
    const n = nombreDe(brut);
    v = n === null
      /* On dit ce qu'on a reçu : sans ça, on cherche un bug là où le raccourci
         ne renvoie simplement rien. */
      ? { disponible: true, valeur: null, nom, raison: 'le raccourci n’a rien renvoyé de chiffré', brut: brut.slice(0, 80) }
      : { disponible: true, valeur: n, brut: brut.slice(0, 80), nom };
  } catch (e) {
    v = { disponible: false, nom, bloque: !!e.bloque,
      raison: /not found|introuvable/i.test(e.message)
        ? `raccourci « ${nom} » introuvable sur le Mac`
        : e.message };
  }
  cache = { le: Date.now(), valeur: v };
  return v;
}

/* ── Repli par l'agent, pour la même raison que la musique ────────────────── */
const AGENT = `http://127.0.0.1:${Number(process.env.MUSIQUE_AGENT_PORT) || 8091}`;

async function etatOuAgent(nom) {
  const e = await etat(nom);
  if (e.disponible !== false || !MAC) return e;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 25000);
    const r = await fetch(`${AGENT}/temperature?nom=${encodeURIComponent(nom || '')}`, { signal: ctrl.signal });
    clearTimeout(t);
    const a = await r.json();
    return a && a.disponible !== false ? a : e;
  } catch { return e; }
}

const viderCache = () => { cache = { le: 0, valeur: null }; };

module.exports = { etat: etatOuAgent, etatDirect: etat, viderCache, nombreDe };
