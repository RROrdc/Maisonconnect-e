'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   Album partagé → photos de l'écran de veille.

   Usage :
     node outils/photos-veille.js <lien ou jeton>      essaie un album, n'écrit rien
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
  console.log(`    après redimensionnement (estimé) : ~${Math.round(a.photos.length * 0.2)} Mo`);
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

async function principal() {
  if (!lien && !tous) {
    console.log('');
    console.log('  Donne un lien d’album partagé, ou --tous pour ceux déjà configurés.');
    console.log('');
    console.log('  Pour obtenir le lien, dans Photos sur le Mac ou l’iPhone :');
    console.log('    l’album partagé → Personnes → activer « Site web public » → copier le lien');
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
