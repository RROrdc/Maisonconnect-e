/* Ranger toute la bibliothèque en trois catégories : Entrée · Plat · Dessert.

   Demandé par Rémi le 20/09 : « fais une repasse sur tous les plats et place
   dans des catégories simples ». Sans ça, le champ « dessert » du menu proposait
   les 125 plats, et 52 d'entre eux n'avaient aucune catégorie.

   Mêmes conventions que `photos-plats.js` et `importer-edt.js`, pour ne pas
   avoir à les réapprendre :
     node outils/categories-plats.js              → SIMULATION (n'écrit rien)
     node outils/categories-plats.js --vraiment   → applique
     node outils/categories-plats.js --sans-ia    → règles seules

   🔑 Deux étages, et le partage n'est pas arbitraire :
   • les RÈGLES tranchent ce qui est mécanique (« crumble », « sorbet »,
     « taboulé »). Gratuit, instantané, explicable, reproductible.
   • l'IA ne voit QUE ce qu'elles n'ont pas su classer. Reconnaître qu'un
     « mafé de bœuf » ou un « butter chicken » est un plat demande une
     connaissance culinaire, pas une table de mots — c'est le même raisonnement
     qu'au § 2 nonies, où `menu.js` se passe d'IA parce qu'il ne fait que de la
     rotation, tandis que `idees()` en a besoin parce qu'il crée.

   ⚠️ Rien n'est écrit sans `--vraiment`, et la simulation affiche CHAQUE
   changement avec sa provenance : une classification qu'on ne peut pas relire
   est une classification qu'on ne peut pas corriger (§ 2 terdecies). */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const donnees = require('../donnees');
const cat = require('../recettes/categories');
const ia = require('../recettes/ia');

const VRAIMENT = process.argv.includes('--vraiment');
const SANS_IA = process.argv.includes('--sans-ia');

/* Le modèle ne choisit pas librement : il RANGE dans une liste fermée. Même
   principe que les actions du vocal — la machine propose, le code vérifie. */
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['plats'],
  properties: {
    plats: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['nom', 'categorie'],
        properties: {
          nom: { type: 'string' },
          categorie: { type: 'string', enum: cat.CATEGORIES },
        },
      },
    },
  },
};

const CONSIGNE = [
  'Tu ranges des plats d\'une famille française dans exactement trois catégories :',
  'Entrée, Plat, Dessert.',
  'Contexte : ce sont les repas du soir et du midi d\'un foyer de six personnes.',
  'Règles :',
  '- « Plat » = le plat principal du repas. En cas de doute, choisis Plat.',
  '- « Entrée » = ce qui ouvre le repas, ou une salade légère.',
  '- « Dessert » = uniquement le sucré.',
  '- Une soupe consistante (viande, lardons, féculents) est un Plat ;',
  '  un gaspacho ou un velouté léger est une Entrée.',
  '- Les noms peuvent comporter des fautes de frappe : « bruchetta », « baggels ».',
  '- Un intitulé qui ne désigne pas un plat précis (« barbecue ») est un Plat.',
  'Réponds pour CHAQUE nom reçu, sans en inventer ni en omettre.',
].join('\n');

/* L'IA par paquets : un seul appel pour 60 noms tiendrait, mais une réponse
   tronquée ne donne pas une liste courte — elle donne un JSON invalide
   (§ 2 sexies). */
const PAQUET = 40;

async function classerParIA(noms) {
  const out = new Map();
  for (let i = 0; i < noms.length; i += PAQUET) {
    const lot = noms.slice(i, i + PAQUET);
    const rep = await ia.appelStructure({
      systeme: CONSIGNE,
      messages: [{ role: 'user', content: 'Range ces plats :\n' + lot.map((n) => '- ' + n).join('\n') }],
      schema: SCHEMA,
      effort: 'low',
      maxTokens: 8000,
    });
    /* `stop_reason` testé AVANT le contenu : sur un refus, `content` peut être
       vide et on planterait sur un accès à `[0]` (§ 2 quinquies). */
    const r = ia.lireReponse(rep);
    for (const p of (r && r.plats) || []) {
      /* On ne fait confiance ni au nom rendu ni à la catégorie : le nom doit
         être l'un de ceux qu'on a envoyés, la catégorie l'une des trois. */
      const vrai = lot.find((n) => cat.clef(n) === cat.clef(p.nom));
      if (vrai && cat.CATEGORIES.includes(p.categorie)) out.set(vrai, p.categorie);
    }
  }
  return out;
}

(async () => {
  const plats = await donnees.listePlatsAdmin();
  console.log(`${plats.length} plats dans la bibliothèque.\n`);

  const parRegle = new Map();
  const aDemander = [];
  for (const p of plats) {
    const d = cat.deviner(p.nom);
    if (d) parRegle.set(p.nom, d);
    else aDemander.push(p.nom);
  }
  console.log(`Règles : ${parRegle.size} rangés · ${aDemander.length} à demander.`);

  let parIA = new Map();
  if (aDemander.length && !SANS_IA) {
    if (!ia.disponible()) {
      console.log('⚠️  Pas de clé IA : les indécis resteront tels quels.');
    } else {
      process.stdout.write('IA en cours… ');
      try { parIA = await classerParIA(aDemander); console.log(`${parIA.size} rangés.`); }
      catch (e) { console.log('échec : ' + e.message); }
    }
  }
  console.log('');

  const lignes = [];
  for (const p of plats) {
    const avant = String(p.categorie || '').trim();
    const apres = parRegle.get(p.nom) || parIA.get(p.nom) || null;
    if (!apres) { lignes.push({ p, avant, apres: null, dou: '—' }); continue; }
    lignes.push({ p, avant, apres, dou: parRegle.has(p.nom) ? 'règle' : 'IA' });
  }

  const change = lignes.filter((l) => l.apres && cat.clef(l.apres) !== cat.clef(l.avant));
  const intacts = lignes.filter((l) => l.apres && cat.clef(l.apres) === cat.clef(l.avant));
  const sans = lignes.filter((l) => !l.apres);

  for (const c of cat.CATEGORIES) {
    const dedans = lignes.filter((l) => l.apres === c);
    console.log(`── ${c} (${dedans.length})`);
    for (const l of dedans) {
      const marque = cat.clef(l.avant) === cat.clef(c) ? ' ' : (l.avant ? '~' : '+');
      console.log(`  ${marque} ${l.p.nom}${l.avant && cat.clef(l.avant) !== cat.clef(c) ? `   (était « ${l.avant} »)` : ''}`);
    }
    console.log('');
  }
  if (sans.length) {
    console.log(`── NON RANGÉS (${sans.length}) — laissés tels quels`);
    for (const l of sans) console.log(`    ${l.p.nom}${l.avant ? `   (reste « ${l.avant} »)` : ''}`);
    console.log('');
  }

  console.log(`${change.length} à modifier · ${intacts.length} déjà bons · ${sans.length} non rangés`);

  if (!VRAIMENT) {
    console.log('\nSimulation. Relance avec --vraiment pour appliquer.');
    return;
  }
  let n = 0;
  for (const l of change) { await donnees.definirCategoriePlat(l.p.id, l.apres); n++; }
  console.log(`\n✓ ${n} plat(s) rangé(s).`);
})().catch((e) => { console.error('Échec :', e.message); process.exit(1); });
