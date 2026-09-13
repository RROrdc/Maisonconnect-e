'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   Album partagé → photos de l'écran de veille.

   Usage :
     node outils/photos-veille.js --dossier <chemin>            regarde, n'écrit rien
     node outils/photos-veille.js --dossier <chemin> --vraiment  range les photos
     node outils/photos-veille.js <lien iCloud>                  (album publié — voir photos/dossier.js)
     node outils/photos-veille.js --tous               relit les albums configurés
     node outils/photos-veille.js --tous --vraiment    télécharge et range

   Conventions du projet : simulation par défaut, `--vraiment` pour écrire.

   🔑 On télécharge EN LOCAL, comme les photos de plats. Pointer les adresses
   iCloud aurait été plus court et faux : elles expirent en une heure, et
   l'écran mural doit garder ses images quand Internet tombe.
   ═══════════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const partage = require('../photos/partage');

const DOSSIER = path.join(__dirname, '..', 'public', 'veille');
/* La dalle est en 1080×1920. Au-delà on paierait des pixels que personne ne
   voit ; en deçà ça se verrait tout de suite sur une photo plein écran. */
const LARGEUR = 1080;
const HAUTEUR = 1920;
const QUALITE = 78;

const args = process.argv.slice(2);
const iDossier = args.indexOf('--dossier');
const dossierSource = iDossier >= 0 ? args[iDossier + 1] : '';
const vraiment = args.includes('--vraiment');
const tous = args.includes('--tous');
const lien = args.find((a) => !a.startsWith('--'));

const ko = (n) => Math.round(n / 1024) + ' Ko';

async function essayer(unLien) {
  console.log('');
  const a = await partage.lister(unLien);
  console.log(`  ✓ « ${a.titre || '(sans titre)'} » — ${a.photos.length} photo(s)`);
  if (!a.photos.length) return a;

  const poids = a.photos.reduce((t, p) => t + p.octets, 0);
  const g = a.photos[0];
  console.log(`    la plus grande dérivée : ${g.largeur}×${g.hauteur}, ${ko(g.octets)}`);
  console.log(`    poids total à la source : ${Math.round(poids / 1024 / 1024)} Mo`);
  console.log(`    après redimensionnement (estimé) : ~${Math.min(Math.round(poids/1024/1024), Math.round(a.photos.length * 0.2))} Mo`);
  return a;
}

async function telecharger(album, sharp) {
  fs.mkdirSync(DOSSIER, { recursive: true });
  const dejaLa = new Set(fs.readdirSync(DOSSIER));

  /* On ne retélécharge pas ce qu'on a déjà : le nom vient de la somme de
     contrôle fournie par iCloud, stable d'un passage à l'autre. */
  const manquantes = album.photos.filter((p) => !dejaLa.has(p.checksum + '.jpg'));
  console.log(`    ${album.photos.length - manquantes.length} déjà là · ${manquantes.length} à prendre`);
  if (!manquantes.length) return 0;

  const urls = await partage.adresses(album.jeton, manquantes.map((p) => p.guid));
  let pris = 0; let octets = 0;

  for (const p of manquantes) {
    const url = urls.get(p.checksum);
    if (!url) continue;
    try {
      const r = await fetch(url);
      if (!r.ok) continue;
      const brut = Buffer.from(await r.arrayBuffer());
      /* `inside` et non `cover` : on ne RECADRE pas. Couper la tête de
         quelqu'un pour remplir un cadre serait pire que des bandes noires. */
      const img = await sharp(brut)
        .rotate()                                   // respecte l'orientation EXIF
        .resize({ width: LARGEUR, height: HAUTEUR, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: QUALITE, mozjpeg: true })
        .toBuffer();
      fs.writeFileSync(path.join(DOSSIER, p.checksum + '.jpg'), img);
      pris++; octets += img.length;
    } catch (_) { /* une photo qui résiste ne doit pas arrêter l'album */ }
  }
  console.log(`    ✅ ${pris} photo(s) rangée(s), ${ko(octets)}`);
  return pris;
}

/* ── Import depuis un dossier ──────────────────────────────────────────────
   Même traitement que pour un album publié : on redimensionne à la dalle et
   on range sous une empreinte du CONTENU. Deux exports successifs du même
   fichier ne le stockent donc qu'une fois — on peut relancer sans compter. */
async function depuisDossier(racine, sharp) {
  const { lister } = require('../photos/dossier');
  const { photos, albums } = lister(racine);

  console.log('');
  console.log(`  ${photos.length} photo(s) trouvée(s) dans ${racine}`);
  for (const [nom, n] of [...albums].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`    ${String(n).padStart(5)}  ${nom}`);
  }
  const poids = photos.reduce((t, p) => t + p.octets, 0);
  console.log(`    poids à la source : ${Math.round(poids / 1024 / 1024)} Mo`);
  console.log(`    après redimensionnement (estimé) : ~${Math.min(Math.round(poids/1024/1024), Math.round(photos.length * 0.2))} Mo`);

  if (!vraiment) return 0;

  fs.mkdirSync(DOSSIER, { recursive: true });
  const dejaLa = new Set(fs.readdirSync(DOSSIER));
  const index = [];
  let pris = 0; let octets = 0; let refuses = 0;

  for (const p of photos) {
    try {
      const brut = fs.readFileSync(p.chemin);
      const nom = crypto.createHash('sha1').update(brut).digest('hex').slice(0, 16) + '.jpg';
      if (dejaLa.has(nom)) { index.push({ f: nom, album: p.album }); continue; }
      const img = await sharp(brut)
        .rotate()
        .resize({ width: LARGEUR, height: HAUTEUR, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: QUALITE, mozjpeg: true })
        .toBuffer();
      fs.writeFileSync(path.join(DOSSIER, nom), img);
      index.push({ f: nom, album: p.album });
      pris++; octets += img.length;
    } catch (_) { refuses++; /* un HEIC illisible ne doit pas arrêter l'import */ }
  }

  /* L'index porte la légende de chaque photo. Sans lui, l'écran ne saurait pas
     dire « Rhodes 2026 » sous l'image — et une photo sans contexte perd la
     moitié de ce qu'elle raconte. */
  fs.writeFileSync(path.join(DOSSIER, 'index.json'),
    JSON.stringify({ maj: new Date().toISOString(), photos: index }, null, 1));

  console.log('');
  console.log(`    ✅ ${pris} nouvelle(s) · ${index.length} au total · ${ko(octets)} ajoutés`);
  if (refuses) console.log(`    ⚠️  ${refuses} fichier(s) illisible(s) (HEIC non pris en charge ?)`);
  return pris;
}

async function principal() {
  if (dossierSource) {
    let sharp = null;
    if (vraiment) {
      try { sharp = require('sharp'); }
      catch (_) { console.log('sharp est absent (npm install sharp).'); process.exit(1); }
    }
    const n = await depuisDossier(dossierSource, sharp);
    console.log('');
    if (!vraiment) console.log('  Simulation. Ajoute --vraiment pour ranger les photos.');
    else console.log(`  ${n} photo(s) ajoutée(s) à l'écran de veille.`);
    console.log('');
    return;
  }

  if (!lien && !tous) {
    console.log('');
    console.log('  Donne un dossier de photos :');
    console.log('    node outils/photos-veille.js --dossier ~/Photos-veille');
    console.log('');
    console.log('  Pour le remplir, dans Photos sur le Mac :');
    console.log('    sélectionne les photos → Fichier → Exporter → Exporter les photos…');
    console.log('    → dans un dossier par album. Rien ne sort de la maison.');
    console.log('');
    return;
  }

  let sharp = null;
  if (vraiment) {
    try { sharp = require('sharp'); }
    catch (_) { console.log('sharp est absent (npm install sharp).'); process.exit(1); }
  }

  const liens = [];
  if (lien) liens.push(lien);
  if (tous) {
    const donnees = require('../donnees');
    const brut = await donnees.config('veille_albums');
    for (const l of String(brut || '').split(/[\s,;]+/).filter(Boolean)) liens.push(l);
    if (!liens.length) console.log('  Aucun album configuré (/admin/ → Réglages → veille_albums).');
  }

  let total = 0;
  for (const l of liens) {
    try {
      const album = await essayer(l);
      if (vraiment && sharp) total += await telecharger(album, sharp);
    } catch (e) {
      console.log(`  ✗ ${partage.jetonDe(l).slice(0, 12)}… — ${e.message}`);
    }
  }

  console.log('');
  if (!vraiment) console.log('  Simulation. Ajoute --vraiment pour télécharger.');
  else console.log(`  ${total} nouvelle(s) photo(s) dans public/veille.`);
  console.log('');
}

principal().catch((e) => { console.error('Échec : ' + e.message); process.exit(1); });
