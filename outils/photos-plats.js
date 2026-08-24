/* Cherche une photo pour les plats qui n'en ont pas.

   Le même travail que le bouton « Trouver les photos manquantes » du
   back-office, mais sans serveur ni session — pratique pour un lot un peu long,
   et lisible quand on veut comprendre POURQUOI un plat n'en trouve pas.

   Usage :
     node outils/photos-plats.js              simulation : montre les choix
     node outils/photos-plats.js --vraiment   enregistre
     node outils/photos-plats.js --tout       inclut les plats qui ONT une photo
                                              (n'écrase rien sans --vraiment)

   ⚠️ Ne remplit que les fiches VIDES et n'écrase jamais une photo existante :
   une image choisie à la main vaut mieux que tout ce qu'on trouvera. */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const donnees = require(path.join(__dirname, '..', 'donnees'));
const recettes = require(path.join(__dirname, '..', 'recettes'));
const recherche = require(path.join(__dirname, '..', 'recettes', 'recherche'));

const args = process.argv.slice(2);
const VRAIMENT = args.includes('--vraiment');
const TOUT = args.includes('--tout');

(async () => {
  const plats = donnees.listePlatsAdmin()
    .filter((p) => TOUT || !String(p.photo || '').trim());

  if (!plats.length) { console.log('\n✓ Tous les plats ont déjà une photo.\n'); return; }

  console.log(`\n${plats.length} plat(s) sans photo${VRAIMENT ? '' : '  —  SIMULATION, rien ne sera écrit'}\n`);
  let trouvees = 0; const refuses = [];

  for (const plat of plats) {
    if (String(plat.photo || '').trim()) { console.log(`  = ${plat.nom} — a déjà une photo, laissée telle quelle`); continue; }
    try {
      const t = await recherche.meilleurPourPhoto(plat.nom);
      if (!t) {
        /* Dire POURQUOI. « Rien trouvé » n'oriente vers aucune action ; « ce
           n'est pas le même plat » invite à vérifier l'orthographe du nom. */
        const c = (await recherche.chercher(plat.nom, { max: 1, photo: true }))[0];
        refuses.push(plat.nom);
        console.log(`  · ${plat.nom}\n       rien retenu` + (c
          ? ` — meilleur écarté « ${c.titre} » : ${!c.teteOk ? 'pas le même plat'
            : (!c.tousCouverts ? 'il manque un mot du plat' : 'trop de mots étrangers')}`
          : ' — aucun résultat'));
        continue;
      }

      /* Dire avec QUELS mots on a fini par trouver : quand le nom complet
         échoue et que le noyau réussit, c'est la première chose à savoir — et
         souvent le signe qu'il vaut mieux raccourcir le nom du plat. */
      const via = t.requete && t.requete !== plat.nom ? `  (cherché « ${t.requete} »)` : '';
      if (!VRAIMENT) {
        console.log(`  ✓ ${plat.nom}\n       → « ${t.titre} »  ${Math.round(t.score * 100)} %${via}`);
        trouvees++;
      } else {
        const r = await recettes.photoPour(plat.nom);
        if (!r) { refuses.push(plat.nom); console.log(`  · ${plat.nom} — page trouvée mais aucune image exploitable`); continue; }
        donnees.enregistrerPlat({ ...plat, photo: r.photo, source_url: plat.source_url || r.url });
        trouvees++;
        console.log(`  ✓ ${plat.nom}\n       → « ${r.titre} »  ${r.score} %${via}  ·  ${r.photo}`);
      }
    } catch (e) { console.log(`  ✗ ${plat.nom} — ${e.message}`); }
    /* On reste poli avec le site : une pause entre deux recherches. */
    await new Promise((r) => setTimeout(r, 600));
  }

  console.log(`\n${trouvees}/${plats.length} plat(s) ${VRAIMENT ? 'ont reçu' : 'recevraient'} une photo.`);
  if (refuses.length) {
    console.log(`\n${refuses.length} sans correspondance : ${refuses.join(', ')}`);
    console.log('  → souvent une faute de frappe dans le nom, ou un intitulé qui n\'est pas');
    console.log('    un plat (« barbecue », « Soupe & tartines »). Corriger le nom dans');
    console.log('    /admin/ → Repas suffit en général ; sinon un emoji fait très bien l\'affaire.');
  }
  if (!VRAIMENT && trouvees) console.log('\n(simulation — relance avec --vraiment pour enregistrer)');
  console.log('');
})().catch((e) => { console.error('\n✗ ' + e.message + '\n'); process.exit(1); });
