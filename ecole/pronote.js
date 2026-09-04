'use strict';
/* Source Pronote — côté Node. Elle ne parle jamais à Pronote elle-même :
 * elle délègue à `ecole/pronote/pont.py`.
 *
 * ── Pourquoi un pont, et un SEUL ──────────────────────────────────────────
 * Le protocole Pronote (AES/RSA, session négociée) n'est pas réécrivable à la
 * main : il faut une bibliothèque. `pronotepy` est en MIT, `Pawnote` en
 * GPL-3.0 — et la GPL obligerait à publier tout le projet sous GPL le jour
 * d'une distribution (§ 5 quater). On paie un aller-retour de processus pour
 * garder la main sur la licence.
 * ⚠️ Et le pont est UNIQUE parce que Pronote invalide le jeton précédent à
 * chaque connexion : deux chemins qui se connectent chacun de leur côté
 * cassent la session — c'est arrivé le 03/09, il a fallu un nouveau QR.
 */
const path = require('path');
const { spawnSync } = require('child_process');

const RACINE = path.join(__dirname, '..');
const PONT = path.join(__dirname, 'pronote', 'pont.py');

/* `python` plutôt que `python3` : c'est le nom présent sur les deux plateformes
   visées. Surchargeable par PYTHON_BIN — sur le Mac mini, Homebrew installe
   parfois seulement `python3`. */
const pythonBin = () => process.env.PYTHON_BIN || 'python';

class ErreurPronote extends Error {
  constructor(message, detail = '') { super(message); this.name = 'ErreurPronote'; this.detail = detail; }
}

/* Le pont rend du JSON sur stdout, et RIEN d'autre : il attrape ses propres
   exceptions, parce qu'une trace Python en clair ferait échouer l'analyse sur
   « réponse illisible », message qui n'aide personne à 22 h. */
function appelerPont(...parametres) {
  const r = spawnSync(pythonBin(), [PONT, ...parametres], {
    cwd: RACINE,
    encoding: 'utf8',
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    maxBuffer: 32 * 1024 * 1024,
    timeout: 60000,
  });
  if (r.error && r.error.code === 'ENOENT') {
    throw new ErreurPronote(`Python introuvable (« ${pythonBin()} »). Renseigne PYTHON_BIN dans le .env.`);
  }
  const brut = (r.stdout || '').trim();
  if (!brut) {
    const fin = (r.stderr || '').trim().split('\n').slice(-4).join('\n');
    throw new ErreurPronote("Le pont Pronote n'a rien renvoyé.", fin);
  }
  let json;
  try { json = JSON.parse(brut); }
  catch { throw new ErreurPronote('Réponse illisible du pont Pronote.', brut.slice(0, 300)); }
  if (!json.ok) throw new ErreurPronote(json.erreur, json.detail);
  return json;
}

const configure = () => require('fs').existsSync(path.join(__dirname, 'pronote-identifiants.json'));

/* Une seule commande, une seule connexion : voir le commentaire du pont. */
function tout({ jours = 7 } = {}) {
  return appelerPont('tout', String(jours));
}

module.exports = { appelerPont, tout, configure, ErreurPronote, PONT };
