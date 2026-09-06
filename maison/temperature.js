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
let cache = { le: 0, valeur: null };

/* On lit la sortie dans un FICHIER plutôt que sur stdout : `shortcuts run` écrit
   aussi ses propres messages sur la sortie standard, et on mélangerait la valeur
   avec eux. Le fichier ne contient que le résultat. */
function lancerRaccourci(nom, delai = 20000) {
  return new Promise((resolve, reject) => {
    const sortie = path.join(os.tmpdir(), `maison-temp-${process.pid}-${Date.now()}.txt`);
    execFile('/usr/bin/shortcuts', ['run', nom, '-o', sortie], { timeout: delai }, (err, _o, stderr) => {
      let contenu = '';
      try { contenu = fs.readFileSync(sortie, 'utf8'); } catch { /* le raccourci n'a rien renvoyé */ }
      fs.unlink(sortie, () => {});
      if (err) return reject(new Error(String(stderr || err.message).trim().slice(0, 200)));
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

async function etat(nomRaccourci) {
  const nom = String(nomRaccourci || '').trim();
  if (!MAC) return { disponible: false, raison: 'se lit depuis le Mac' };
  if (!nom) return { disponible: false, raison: 'raccourci non configuré (/admin/ → Réglages)' };
  if (Date.now() - cache.le < CACHE_MS && cache.valeur && cache.valeur.nom === nom) return cache.valeur;

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
    v = { disponible: false, nom, raison: /not found|introuvable/i.test(e.message)
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

module.exports = { etat: etatOuAgent, etatDirect: etat, nombreDe };
