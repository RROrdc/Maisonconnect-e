'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   Alléger les photos de plats.

   Le besoin n'est pas visuel — à l'œil, rien ne change : les vignettes font
   36 px sur le mur. C'est de la CHARGE : 34 Mo pour 111 fichiers, tirés par un
   Raspberry en Wi-Fi 2,4 GHz au premier chargement. Le redimensionnement était
   noté « à faire sur le Mac » depuis le 18/08 : `sharp` est un module natif,
   impossible à poser sur le PC sans droits admin. Sur le Mac (arm64) il
   s'installe en trois secondes, binaire déjà compilé.

   🔑 LE POINT DE CONCEPTION À NE PAS RATER
   Une photo est nommée par l'EMPREINTE DE SON CONTENU — c'est ce qui justifie
   son cache d'une semaine en `immutable` (§ 2 septies) : un contenu différent
   porte forcément un autre nom. Réécrire le fichier en gardant son nom
   casserait cette promesse : l'écran mural, qu'on ne recharge jamais à la
   main, continuerait de servir l'ancienne image pendant sept jours.
   ⇒ On écrit sous un NOUVEAU nom, on met la fiche à jour, et l'ancien fichier
   ne part que s'il n'est plus référencé nulle part.

   Conventions du projet : simulation par défaut, `--vraiment` pour écrire.
   ═══════════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const donnees = require('../donnees');

const DOSSIER = path.join(__dirname, '..', 'public', 'plats');
const LARGEUR = 720;   // couvre le mode cuisine sur la dalle ET l'app sur iPhone
const QUALITE = 80;

const vraiment = process.argv.includes('--vraiment');
const ko = (n) => Math.round(n / 1024) + ' Ko';

async function principal() {
  let sharp;
  try { sharp = require('sharp'); }
  catch (_) {
    console.log('sharp est absent. Sur le Mac : npm install sharp');
    console.log('(module natif — il ne s’installe pas sur le PC sans droits admin)');
    process.exit(1);
  }

  if (!fs.existsSync(DOSSIER)) { console.log('Aucun dossier public/plats.'); return; }

  /* On lit d'abord QUI référence quoi : une même image peut servir à deux
     plats (elles sont dédoublonnées par empreinte depuis l'origine), et
     supprimer un fichier encore utilisé laisserait une vignette morte. */
  const plats = await donnees.listePlatsAdmin();
  const refs = new Map();                     // fichier → [ids de plats]
  for (const p of plats) {
    if (!p.photo) continue;
    const f = path.basename(String(p.photo));
    if (!refs.has(f)) refs.set(f, []);
    refs.get(f).push(p);
  }

  const fichiers = fs.readdirSync(DOSSIER).filter((f) => /\.(jpe?g|png|webp)$/i.test(f));
  let avant = 0; let apres = 0; let traites = 0; let ignores = 0;
  const aFaire = [];

  for (const f of fichiers) {
    const chemin = path.join(DOSSIER, f);
    const taille = fs.statSync(chemin).size;
    avant += taille;

    let meta;
    try { meta = await sharp(chemin).metadata(); }
    catch (e) { console.log(`  ⚠️  ${f} — illisible (${e.message})`); ignores++; apres += taille; continue; }

    /* Déjà à la bonne taille : on n'y touche pas. Recompresser une image déjà
       compressée ne gagne rien et abîme un peu plus à chaque passage. */
    if ((meta.width || 0) <= LARGEUR) { ignores++; apres += taille; continue; }

    const buf = await sharp(chemin)
      .resize({ width: LARGEUR, withoutEnlargement: true })
      .jpeg({ quality: QUALITE, mozjpeg: true })
      .toBuffer();

    /* Le nouveau nom vient du nouveau contenu — c'est la règle de la maison. */
    const nom = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16) + '.jpg';
    aFaire.push({ ancien: f, nouveau: nom, buf, taille, gagne: taille - buf.length });
    apres += buf.length;
    traites++;
  }

  aFaire.sort((a, b) => b.gagne - a.gagne);
  for (const x of aFaire.slice(0, 8)) {
    console.log(`  ${x.ancien.slice(0, 20)}…  ${ko(x.taille).padStart(8)} → ${ko(x.buf.length).padStart(8)}`);
  }
  if (aFaire.length > 8) console.log(`  … et ${aFaire.length - 8} autre(s)`);

  console.log('');
  console.log(`  ${fichiers.length} fichier(s) · ${traites} à alléger · ${ignores} déjà petits ou illisibles`);
  console.log(`  ${ko(avant)} → ${ko(apres)}  (${Math.round((1 - apres / avant) * 100)} % de moins)`);

  if (!vraiment) {
    console.log('');
    console.log('  Simulation. Relance avec --vraiment pour appliquer.');
    console.log('  ⚠️  Sauvegarde d’abord : outils/sauvegarder-tout.sh');
    return;
  }

  let ecrits = 0; let fiches = 0; let retires = 0;
  for (const x of aFaire) {
    fs.writeFileSync(path.join(DOSSIER, x.nouveau), x.buf);
    ecrits++;
    for (const p of (refs.get(x.ancien) || [])) {
      /* On repasse la fiche ENTIÈRE : enregistrerPlat attend l'objet complet,
         et n'envoyer que la photo effacerait la recette. Même patron que
         photos-plats.js — on ne réinvente pas une écriture à côté. */
      await donnees.enregistrerPlat({ ...p, photo: '/plats/' + x.nouveau });
      fiches++;
    }
    /* L'ancien ne part que si plus personne ne le vise — et jamais s'il n'a
       même pas de fiche : ce serait une image orpheline, que
       `nettoyerImages()` sait déjà traiter, pas notre affaire ici. */
    if ((refs.get(x.ancien) || []).length) {
      try { fs.unlinkSync(path.join(DOSSIER, x.ancien)); retires++; } catch (_) { /* déjà parti */ }
    }
  }
  console.log('');
  console.log(`  ✅ ${ecrits} image(s) écrite(s) · ${fiches} fiche(s) mise(s) à jour · ${retires} ancienne(s) retirée(s)`);
}

principal().catch((e) => { console.error('Échec : ' + e.message); process.exit(1); });
