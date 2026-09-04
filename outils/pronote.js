#!/usr/bin/env node
'use strict';
/* Pronote (Augustin) — banc d'essai et échange du QR code.
 *
 *   node outils/pronote.js qr <image-du-qr.png> <pin>   → première mise en service
 *   node outils/pronote.js                              → diagnostic
 *   node outils/pronote.js edt [jours]
 *   node outils/pronote.js devoirs [jours]
 *   node outils/pronote.js notes
 *
 * ── Un seul chemin, et c'est délibéré ─────────────────────────────────────
 * Le 03/09, quatre scripts d'essai se sont connectés chacun de leur côté avec
 * le même jeton : la session a fini invalidée côté Pronote et il a fallu
 * regénérer un QR. Pronote rend un NOUVEAU jeton à chaque connexion et
 * invalide le précédent — deux processus qui se connectent en parallèle, ou
 * qui écrivent dans deux fichiers différents, cassent la session.
 * ⇒ Tout passe désormais par `ecole/pronote/pont.py`, qui écrit au seul et
 *   même endroit, immédiatement.
 *
 * ── Le QR ne quitte JAMAIS la machine ─────────────────────────────────────
 * Il contient les accès au compte : le décodage est local (jsQR), jamais sur
 * un service en ligne de lecture de QR code.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const jsQR = require('jsqr');
const { PNG } = require('pngjs');

const RACINE = path.join(__dirname, '..');
const PONT = path.join(RACINE, 'ecole', 'pronote', 'pont.py');
const PYTHON = process.env.PYTHON_BIN || 'python';

const args = process.argv.slice(2);
const commande = (args[0] || 'diagnostic').toLowerCase();
const ok = (t) => console.log('  ✓ ' + t);
const ko = (t) => console.log('  ✗ ' + t);
const titre = (t) => console.log('\n═══ ' + t);

/* Le pont rend du JSON sur sa sortie standard, et RIEN d'autre : une trace
   Python en clair ferait échouer l'analyse sur « réponse illisible », message
   qui n'aide personne. Le pont attrape donc tout de son côté. */
function appelerPont(...parametres) {
  const r = spawnSync(PYTHON, [PONT, ...parametres], {
    cwd: RACINE,
    encoding: 'utf8',
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    maxBuffer: 32 * 1024 * 1024,
  });
  if (r.error && r.error.code === 'ENOENT') {
    throw new Error(`Python introuvable (« ${PYTHON} »). Renseigne PYTHON_BIN dans le .env si l'exécutable porte un autre nom.`);
  }
  const brut = (r.stdout || '').trim();
  if (!brut) throw new Error('Le pont Pronote n\'a rien renvoyé.' + (r.stderr ? '\n' + r.stderr.trim().split('\n').slice(-4).join('\n') : ''));
  let json;
  try { json = JSON.parse(brut); }
  catch { throw new Error('Réponse illisible du pont Pronote :\n' + brut.slice(0, 400)); }
  if (!json.ok) throw new Error(json.erreur + (json.detail ? '\n   détail : ' + json.detail : ''));
  return json;
}

/* Décodage local du QR. jsQR travaille sur des pixels : il faut donc convertir
   le PNG. Deux passes — l'image entière, puis un recadrage du centre : une
   capture d'écran porte beaucoup de décor autour du code, et le décodeur y
   perd son latin sur les petits modules. */
function lireQr(fichier) {
  const img = PNG.sync.read(fs.readFileSync(fichier));
  let r = jsQR(new Uint8ClampedArray(img.data), img.width, img.height);
  if (!r) {
    const x0 = Math.floor(img.width * 0.2), y0 = Math.floor(img.height * 0.25);
    const w = Math.floor(img.width * 0.6), h = Math.floor(img.height * 0.55);
    const sub = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const s = ((y0 + y) * img.width + (x0 + x)) * 4, d = (y * w + x) * 4;
        sub[d] = img.data[s]; sub[d + 1] = img.data[s + 1]; sub[d + 2] = img.data[s + 2]; sub[d + 3] = 255;
      }
    }
    r = jsQR(sub, w, h);
  }
  if (!r) throw new Error("QR code non décodé. Vérifie que la capture montre le code en entier et sans reflet.");
  let json;
  try { json = JSON.parse(r.data); }
  catch { throw new Error("Le QR a été lu mais ne contient pas un JSON Pronote."); }
  for (const cle of ['jeton', 'login', 'url']) {
    if (!json[cle]) throw new Error(`Le QR ne contient pas « ${cle} » — ce n'est pas un QR d'ajout de compte Pronote.`);
  }
  return json;
}

try {
  if (commande === 'qr') {
    const image = args[1], pin = args[2];
    if (!image || !pin) { ko('Usage : node outils/pronote.js qr <image-du-qr.png> <pin à 4 chiffres>'); process.exit(1); }

    titre('Lecture du QR code (en local, rien n\'est envoyé)');
    const qr = lireQr(image);
    ok(`QR décodé — url ${String(qr.url).length} car., jeton ${String(qr.jeton).length} car.`);

    /* Le JSON du QR transite par un fichier temporaire plutôt que par la ligne
       de commande : un argument de processus est visible de toute la machine
       dans la liste des processus, et celui-ci vaut le compte. */
    const tmp = path.join(os.tmpdir(), 'qr-pronote-' + process.pid + '.json');
    fs.writeFileSync(tmp, JSON.stringify(qr), 'utf8');
    try {
      titre('Échange contre des identifiants permanents');
      const r = appelerPont('qr', tmp, String(pin));
      ok(`connecté — compte ${r.compte}${r.titulaire ? ' (' + r.titulaire + ')' : ''}`);
      for (const e of r.enfants || []) {
        const retenu = (r.retenus || []).includes(e.prenom);
        console.log(`     ${retenu ? '→' : '·'} ${e.nom} ${e.classe ? '| ' + e.classe : '| (pas de classe — ancien établissement)'}${retenu ? '' : '   ignoré'}`);
      }
      ok('identifiants enregistrés — plus jamais de QR code');
    } finally {
      fs.rmSync(tmp, { force: true });
    }
    process.exit(0);
  }

  const jours = Number(args[1] || 7);

  if (commande === 'diagnostic') {
    titre('Élèves suivis');
    for (const e of appelerPont('eleves').eleves) console.log(`  · ${e.prenom} — ${e.classe || 'classe inconnue'}`);
    for (const [nom, params, cle] of [
      ['emploi du temps (7 j)', ['edt', '7'], 'cours'],
      ['devoirs (14 j)', ['devoirs', '14'], 'devoirs'],
      ['notes', ['notes'], 'notes'],
    ]) {
      try { console.log(`  ✓ ${nom.padEnd(24)} ${appelerPont(...params)[cle].length} entrée(s)`); }
      catch (e) { console.log(`  ✗ ${nom.padEnd(24)} ${e.message.split('\n')[0]}`); }
    }
    console.log('\nRien n\'a été écrit — ni chez Pronote, ni dans maison.db.');
  } else if (commande === 'edt') {
    const cours = appelerPont('edt', String(jours)).cours;
    titre(`${cours.length} cours sur ${jours} jours`);
    let j = '';
    for (const c of cours) {
      if (c.jour !== j) { j = c.jour; console.log('  ── ' + j); }
      console.log(`     ${c.debut}–${c.fin}  ${String(c.matiere).padEnd(24)} ${String(c.salle).padEnd(7)} ${c.prof}${c.annule ? '   ⛔ ANNULÉ' : ''}`);
    }
  } else if (commande === 'devoirs') {
    const devoirs = appelerPont('devoirs', String(args[1] || 14)).devoirs;
    titre(`${devoirs.length} devoir(s)`);
    let d = '';
    for (const t of devoirs) {
      if (t.pour !== d) { d = t.pour; console.log('  ── pour le ' + d); }
      console.log(`     ${t.matiere}${t.fait ? '  (fait)' : ''}`);
      for (const l of String(t.contenu).split('\n').slice(0, 3)) if (l.trim()) console.log('        ' + l.trim());
    }
  } else if (commande === 'notes') {
    const notes = appelerPont('notes').notes;
    titre(`${notes.length} note(s)`);
    for (const n of notes) console.log(`  ${n.date}  ${String(n.matiere).padEnd(22)} ${n.valeur}/${n.sur}   ${n.devoir}`);
  } else {
    ko(`Commande inconnue : ${commande}`);
    process.exit(1);
  }
} catch (e) {
  console.error('\n✗ ' + e.message);
  process.exit(1);
}
