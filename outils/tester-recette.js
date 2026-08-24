/* Essayer une source de recette AVANT de s'énerver devant l'interface.

   Le back-office ne montre que le résultat ; ici on voit ce que la source a
   réellement renvoyé, et le message d'erreur exact quand ça ne marche pas.
   Rien n'est écrit en base.

   Usage :
     node outils/tester-recette.js https://www.750g.com/...     depuis un lien
     node outils/tester-recette.js --nom "tartiflette"          depuis l'IA
     node outils/tester-recette.js --photo photo.jpg            depuis une photo
     node outils/tester-recette.js --quantites                  auto-test du calcul
     node outils/tester-recette.js --nom "gratin" --couverts 6  avec mise à l'échelle */
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const recettes = require(path.join(__dirname, '..', 'recettes'));

const args = process.argv.slice(2);
const valeur = (drapeau) => {
  const i = args.indexOf(drapeau);
  return i > -1 ? args[i + 1] : null;
};

function afficher(r, couverts) {
  const sur = r.confiance === 'sure';
  console.log(`\n  ${r.nom || '(sans nom)'}`);
  console.log(`  ${sur ? '✓ publiée par le site — fiable' : '~ estimée par l\'IA — à relire'}`);
  if (r.portions || r.duree) console.log(`  ${[r.portions, r.duree].filter(Boolean).join(' · ')}`);
  if ((r.appareils || []).length) console.log(`  appareils : ${r.appareils.join(', ')}`);
  if (r.photo) console.log(`  photo rangée en local : ${r.photo}`);
  else if (r.photoUrl) console.log(`  photo NON récupérée : ${r.photoErreur || 'inconnue'}`);
  if (r.url) console.log(`  source : ${r.url}`);

  let ingredients = r.ingredients || [];
  if (couverts) {
    const base = Number(/(\d+)/.exec(r.portions || '')?.[1]) || null;
    if (!base) console.log('\n  ⚠️  Portions de départ inconnues : aucune mise à l\'échelle (mieux vaut rien que faux).');
    else {
      console.log(`\n  Quantités recalculées pour ${couverts} (recette écrite pour ${base}) :`);
      ingredients = ingredients.map((x) => recettes.quantites.mettreAEchelle(x, couverts / base));
    }
  }

  console.log(`\n  Ingrédients (${ingredients.length})`);
  for (const i of ingredients) console.log('    · ' + i);
  console.log(`\n  Préparation (${(r.etapes || []).length} étapes)`);
  (r.etapes || []).forEach((e, i) => console.log(`    ${String(i + 1).padStart(2)}. ${e}`));
  console.log('');
}

async function main() {
  if (args.includes('--quantites')) {
    const r = recettes.quantites.verifier();
    console.log(`\n  ${r.total - r.echecs.length}/${r.total} cas de mise à l'échelle passent`);
    for (const e of r.echecs)
      console.log(`    ✗ « ${e.entree} » ×${e.facteur} → attendu « ${e.attendu} », obtenu « ${e.obtenu} »`);
    console.log('');
    process.exit(r.echecs.length ? 1 : 0);
  }

  const couverts = Number(valeur('--couverts')) || null;
  const equipements = process.env.EQUIPEMENTS || '';

  const nom = valeur('--nom');
  if (nom) {
    console.log(`\n⏳ Recherche de « ${nom} » (${recettes.sources().modele || 'IA indisponible'})…`);
    return afficher(await recettes.depuisNom(nom, { equipements }), couverts);
  }

  const photo = valeur('--photo');
  if (photo) {
    if (!fs.existsSync(photo)) throw new Error(`Fichier introuvable : ${photo}`);
    const ext = path.extname(photo).toLowerCase();
    const type = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    console.log(`\n⏳ Lecture de ${photo}…`);
    return afficher(await recettes.depuisPhoto(fs.readFileSync(photo).toString('base64'), type, { equipements }), couverts);
  }

  const url = args.find((a) => /^https?:\/\//i.test(a));
  if (!url) {
    console.log('\n  Usage :');
    console.log('    node outils/tester-recette.js <url>');
    console.log('    node outils/tester-recette.js --nom "tartiflette" [--couverts 6]');
    console.log('    node outils/tester-recette.js --photo photo.jpg');
    console.log('    node outils/tester-recette.js --quantites');
    const s = recettes.sources();
    console.log(`\n  Sources disponibles : lien=${s.lien}  nom=${s.nom}  photo=${s.photo}`);
    if (s.pourquoi) console.log('  ' + s.pourquoi);
    console.log('');
    process.exit(1);
  }

  console.log(`\n⏳ Lecture de ${url}…`);
  afficher(await recettes.depuisLien(url), couverts);
}

main().catch((e) => { console.error('\n✗ ' + e.message + '\n'); process.exit(1); });
