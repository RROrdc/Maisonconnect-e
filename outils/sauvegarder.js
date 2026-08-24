/* Sauvegarde de la base.
   Usage :  node outils/sauvegarder.js  [--vers <dossier>]

   🔴 `maison.db` est la SEULE copie des données de la famille depuis la bascule
   hors Notion. Avant, Notion tenait lieu de filet ; ce n'est plus le cas.

   `VACUUM INTO` plutôt qu'une copie de fichier : la sauvegarde est COHÉRENTE même
   serveur allumé (une copie brute pendant une écriture WAL donnerait une base
   tronquée, et on ne s'en apercevrait qu'au moment de s'en servir).

   Les 30 dernières sont conservées. À automatiser sur le Mac mini : une par jour,
   plus une copie hors machine. */
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { DatabaseSync } = require('node:sqlite');

const RACINE = path.join(__dirname, '..');
const SOURCE = process.env.DB_FICHIER || path.join(RACINE, 'maison.db');
const A_GARDER = 30;

const horodatage = () => {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

function sauvegarder(dossier) {
  if (!fs.existsSync(SOURCE)) throw new Error(`Base introuvable : ${SOURCE}`);
  if (!fs.existsSync(dossier)) fs.mkdirSync(dossier, { recursive: true });

  const cible = path.join(dossier, `maison-${horodatage()}.db`);
  const db = new DatabaseSync(SOURCE, { readOnly: true });
  try {
    /* Le chemin passe en paramètre lié : pas de guillemet à échapper à la main. */
    db.prepare('VACUUM INTO ?').run(cible);
  } finally {
    db.close();
  }
  return cible;
}

/* On ne supprime QUE nos propres fichiers, reconnus au motif de nom. Un dossier
   de sauvegarde partagé avec autre chose ne doit pas être vidé par erreur. */
function elaguer(dossier) {
  const fichiers = fs.readdirSync(dossier)
    .filter((f) => /^maison-\d{8}-\d{4,6}\.db$/.test(f))
    .sort();
  const trop = fichiers.slice(0, Math.max(0, fichiers.length - A_GARDER));
  for (const f of trop) fs.unlinkSync(path.join(dossier, f));
  return trop.length;
}

function main() {
  const i = process.argv.indexOf('--vers');
  const dossier = i > -1 && process.argv[i + 1] ? process.argv[i + 1] : path.join(RACINE, 'sauvegardes');
  const cible = sauvegarder(dossier);
  const retires = elaguer(dossier);
  const ko = Math.round(fs.statSync(cible).size / 1024);
  console.log(`✓ Sauvegarde : ${cible}  (${ko} Ko)`);
  if (retires) console.log(`  ${retires} ancienne(s) sauvegarde(s) retirée(s) — on en garde ${A_GARDER}.`);
}

if (require.main === module) {
  try { main(); }
  catch (e) { console.error('✗ Sauvegarde impossible :', e.message); process.exit(1); }
}

module.exports = { sauvegarder, elaguer, SOURCE };
