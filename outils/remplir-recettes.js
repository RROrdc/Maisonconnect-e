/* Remplir les fiches de plats depuis la ligne de commande.

   ⚠️ N'ÉCRASE JAMAIS un champ déjà rempli sans `--force`. Une recette corrigée à
   la main est plus juste que tout ce qu'un import peut ramener — c'est la règle
   qui gouverne aussi le bouton « Compléter les fiches vides » du back-office.

   Usage :
     node outils/remplir-recettes.js --etat                    ce qui manque
     node outils/remplir-recettes.js --lien "pizza maison" https://…
     node outils/remplir-recettes.js --ia "tartiflette"        un plat par l'IA
     node outils/remplir-recettes.js --ia                      TOUS les plats sans recette
     …  ajouter --force pour remplacer ce qui est déjà rempli                      */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const donnees = require(path.join(__dirname, '..', 'donnees'));
const recettes = require(path.join(__dirname, '..', 'recettes'));

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const valeur = (d) => { const i = args.indexOf(d); return i > -1 ? args[i + 1] : null; };

const platParNom = (nom) => {
  const p = donnees.listePlatsAdmin().find((x) => donnees.clef(x.nom) === donnees.clef(nom));
  if (!p) {
    console.error(`✗ Plat « ${nom} » introuvable. Plats : `
      + donnees.listePlatsAdmin().map((x) => x.nom).join(', '));
    process.exit(1);
  }
  return p;
};

/* Ne remplit que les cases vides, sauf --force. Renvoie ce qui a bougé, pour que
   la sortie dise exactement ce qui a été touché. */
function fusionner(plat, r) {
  const change = [];
  const poser = (champ, val) => {
    if (!val) return;
    const actuel = String(plat[champ] || '').trim();
    if (actuel && !FORCE) return;
    if (actuel === String(val)) return;
    plat[champ] = val;
    change.push(champ);
  };
  poser('ingredients', (r.ingredients || []).join(', '));
  poser('etapes', (r.etapes || []).join('\n'));
  poser('portions', r.portions);
  poser('duree', r.duree);
  poser('source_url', r.url);
  poser('appareils', (r.appareils || []).join(', '));
  poser('photo', r.photo);
  return change;
}

function enregistrer(plat, change, r) {
  if (!change.length) {
    console.log(`  · ${plat.nom} : rien à compléter${FORCE ? '' : ' (ajoute --force pour remplacer)'}`);
    return false;
  }
  donnees.enregistrerPlat(plat);
  console.log(`  ✓ ${plat.nom} : ${change.join(', ')}`
    + `  [${r.confiance === 'sure' ? 'publiée par le site' : 'estimée — à relire'}]`);
  return true;
}

function etat() {
  const plats = donnees.listePlatsAdmin();
  console.log('\n  ' + 'Plat'.padEnd(30) + 'Recette'.padEnd(12) + 'Photo'.padEnd(8) + 'Portions');
  console.log('  ' + '─'.repeat(62));
  for (const p of plats) {
    const et = String(p.etapes || '').split('\n').filter((l) => l.trim()).length;
    console.log('  ' + p.nom.padEnd(30) + (et ? `${et} étapes` : '—').padEnd(12)
      + (p.photo ? 'oui' : '—').padEnd(8) + (p.portions_nb ? p.portions_nb : '—'));
  }
  const vides = plats.filter((p) => !String(p.etapes || '').trim());
  console.log(`\n  ${plats.length} plats · ${plats.length - vides.length} avec recette · `
    + `${plats.filter((p) => p.photo).length} avec photo`);
  if (vides.length) console.log(`  À compléter : ${vides.map((p) => p.nom).join(', ')}`);
  console.log('');
}

async function main() {
  if (!args.length || args.includes('--etat')) return etat();

  const equipements = donnees.reglage('equipements', '');

  const lien = valeur('--lien');
  if (lien) {
    const url = args.find((a) => /^https?:\/\//i.test(a));
    if (!url) throw new Error('Il faut aussi l\'URL de la recette.');
    const plat = platParNom(lien);
    /* ⚠️ Ma faute passée : j'ai donné une URL de pâtes au pesto pour « pates carbo ».
       Photo fausse, fiche fausse. Vérifier que le lien correspond VRAIMENT au plat. */
    console.log(`\n⏳ ${plat.nom} ← ${url}`);
    const r = await recettes.depuisLien(url);
    if (r.nom) console.log(`   la page annonce : « ${r.nom} »  ← vérifie que c'est bien le même plat`);
    return void enregistrer(plat, fusionner(plat, r), r);
  }

  if (args.includes('--ia')) {
    const cible = valeur('--ia');
    const plats = cible && !cible.startsWith('--')
      ? [platParNom(cible)]
      : donnees.listePlatsAdmin().filter((p) => FORCE || !String(p.etapes || '').trim());

    if (!plats.length) return console.log('\n  Toutes les fiches ont déjà une recette.\n');
    if (!recettes.sources().nom) throw new Error(recettes.sources().pourquoi);

    console.log(`\n⏳ ${plats.length} fiche(s) — ${recettes.sources().modele}\n`);
    let n = 0;
    for (const plat of plats) {
      try {
        const r = await recettes.depuisNom(plat.nom, { equipements });
        if (enregistrer(plat, fusionner(plat, r), r)) n++;
      } catch (e) { console.log(`  ✗ ${plat.nom} : ${e.message}`); }
    }
    console.log(`\n  ${n} fiche(s) complétée(s).\n`);
    return;
  }

  console.error('✗ Précise --etat, --lien "<plat>" <url>, ou --ia ["<plat>"].');
  process.exit(1);
}

main().catch((e) => { console.error('\n✗ ' + e.message + '\n'); process.exit(1); });
