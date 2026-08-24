/* Toute la batterie de tests, d'un seul coup.

   Usage :
     node outils/tester-tout.js              tout, en détail
     node outils/tester-tout.js --court      seulement le résumé par série
     node outils/tester-tout.js calculs      une série précise

   Séries : calculs · pages · api · vocal · rappels · quinzaine

   ⚠️ Ces tests s'exécutent sur les VRAIES données de la famille, faute de base
   de test. Tout ce qu'ils créent porte le préfixe `ZZ-essai` et est retiré à la
   fin ; aucune opération de MASSE n'est jamais tentée. Sauvegarde d'abord
   (`sauvegarder-tout.cmd`) si tu as un doute — c'est trente secondes.

   ⚠️ Le serveur doit tourner : la plupart des séries passent par l'API, comme un
   navigateur. Tester le serveur sans le lancer testerait autre chose. */
const path = require('path');
const A = require(path.join(__dirname, 'tests', 'aide'));

const SERIES = [
  ['calculs', 'Calculs purs — fériés, rayons, quantités', false],
  ['pages', 'Pages — scripts, identifiants, cache', true],
  ['api', 'API — lecture, écritures, temps réel, sécurité', true],
  ['vocal', 'Assistant vocal', true],
  ['rappels', 'Anniversaires, rappels, rangement', true],
  ['quinzaine', 'Semaine A / B', true],
  ['presence', 'Garde alternée — qui est à la maison', true],
];

async function main() {
  const args = process.argv.slice(2);
  const court = args.includes('--court');
  const demandees = args.filter((a) => !a.startsWith('--'));
  const aFaire = SERIES.filter(([nom]) => !demandees.length || demandees.includes(nom));

  if (!aFaire.length) {
    console.error(`✗ Série inconnue. Disponibles : ${SERIES.map((s) => s[0]).join(', ')}`);
    process.exit(1);
  }

  const besoinServeur = aFaire.some(([, , serveur]) => serveur);
  if (besoinServeur && !(await A.serveurPret())) {
    console.error(`\n✗ Serveur injoignable sur ${A.BASE}.`);
    console.error('  Lance demarrer-maison.cmd, puis relance ce test.\n');
    process.exit(1);
  }

  console.log(`\n🧪 Écran Maison — ${aFaire.length} série(s)\n`);
  const bilan = [];
  let total = 0, echecs = 0;

  for (const [nom, titre] of aFaire) {
    if (!court) console.log(`\n──────── ${titre} ────────`);
    const t0 = Date.now();
    try {
      const t = await require(path.join(__dirname, 'tests', nom))(court);
      total += t.ok + t.ko; echecs += t.ko;
      bilan.push({ nom, ok: t.ok, ko: t.ko, ms: Date.now() - t0 });
    } catch (e) {
      echecs++;
      bilan.push({ nom, ok: 0, ko: 1, ms: Date.now() - t0, erreur: e.message });
      console.error(`  ✗✗ série interrompue : ${e.message}`);
    }
  }

  console.log('\n──────── Bilan ────────');
  for (const b of bilan) {
    const etat = b.ko ? `✗ ${b.ko} échec(s)` : '✓';
    console.log(`  ${etat.padEnd(14)} ${b.nom.padEnd(11)} ${String(b.ok).padStart(3)} vérifications  ${String(b.ms).padStart(6)} ms`
      + (b.erreur ? `  — ${b.erreur}` : ''));
  }
  console.log(`\n  ${total - echecs}/${total} réussis${echecs ? `  —  ⚠️ ${echecs} ÉCHEC(S)` : ''}\n`);
  process.exit(echecs ? 1 : 0);
}

main().catch((e) => { console.error('\n✗ ' + e.message + '\n'); process.exit(1); });
