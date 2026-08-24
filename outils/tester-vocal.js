/* Essayer l'assistant vocal SANS téléphone et SANS Siri.

   Usage :
     node outils/tester-vocal.js "ajoute du lait aux courses"
     node outils/tester-vocal.js --sec "qu'est-ce qu'on mange ce soir ?"   (n'écrit rien)
     node outils/tester-vocal.js --regles                                  (chemin rapide seul)
     node outils/tester-vocal.js --lot                                     (jeu de phrases types)
     node outils/tester-vocal.js --serveur "quel temps il fait ?"          (vrai trajet HTTP)

   ⚠️ En direct (sans `--serveur`), l'outil n'a NI météo NI agenda : ces deux-là
   sont chargés par le serveur. Une question sur le temps qu'il fait répondra
   donc « je n'ai pas la météo » alors que tout va bien. Pour juger la vraie
   qualité des réponses, utiliser `--serveur`.

   ⚠️ Sans `--sec`, les phrases d'action ÉCRIVENT vraiment dans la base de la
   famille. C'est la même leçon que partout ailleurs dans ce projet : ne pas
   essayer une commande sur les vraies données par curiosité. Le mode `--sec`
   montre ce qui SERAIT fait, sans le faire. */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const donnees = require(path.join(__dirname, '..', 'donnees'));
const recettes = require(path.join(__dirname, '..', 'recettes'));
const vocal = require(path.join(__dirname, '..', 'vocal'));
const regles = require(path.join(__dirname, '..', 'vocal', 'regles'));

const args = process.argv.slice(2);
const SEC = args.includes('--sec');
const SERVEUR = args.includes('--serveur');
/* `--modele` permet de COMPARER avant de trancher : à l'oral, la latence est la
   première qualité, et elle ne se devine pas — elle se mesure.
   Ex. : node outils/tester-vocal.js --sec --modele claude-haiku-4-5 --lot */
const MODELE = (() => { const i = args.indexOf('--modele'); return i > -1 ? args[i + 1] : null; })();
const PORT = Number(process.env.PORT) || 8090;
const personne = 'Rémi';

const PHRASES = [
  'ajoute du lait aux courses',
  'courses : papier toilette',
  "qu'est-ce qu'on mange ce soir ?",
  'combien il reste de courses ?',
  "laisse un mot : le facteur est passé",
  'rappelle à Martial de sortir la poubelle demain',
  "quel temps il fait ?",
  "qu'est-ce qu'Enora a aujourd'hui ?",
  'vide la liste de courses',                    // doit être REFUSÉ
  'supprime toutes les tâches',                  // doit être REFUSÉ
];

/* Vrai trajet : exactement ce que fera le Raccourci Siri, écho sur l'écran
   mural compris. Écrit donc pour de bon — `--sec` n'a pas de sens ici. */
async function viaServeur(texte) {
  const t0 = Date.now();
  const r = await fetch(`http://localhost:${PORT}/api/vocal`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ texte }),
  });
  const d = await r.json().catch(() => ({}));
  console.log(`\n  « ${texte} »`);
  console.log(`    HTTP ${r.status}  ${Date.now() - t0} ms  →  action: ${d.action || '?'} (${d.source || '?'})`);
  console.log(`    🔊 ${d.reponse || d.error || '(rien)'}${d.fait ? '   [écrit en base]' : ''}`);
}

async function une(texte) {
  if (SERVEUR) return viaServeur(texte);
  const t0 = Date.now();
  const extras = {};
  const intention = await vocal.comprendre(texte, { donnees, recettes, extras, modele: MODELE });
  const ms = Date.now() - t0;

  const marque = { regle: '⚡ règle', ia: '🤖 IA' }[intention.source] || '· ' + (intention.source || '');
  console.log(`\n  « ${texte} »`);
  console.log(`    ${marque}  ${ms} ms  →  action: ${intention.action}`);

  const utiles = ['article', 'rayon', 'tache', 'pour', 'echeance', 'message', 'titre', 'jour', 'moment', 'plat']
    .filter((k) => intention[k]).map((k) => `${k}=${intention[k]}`);
  if (utiles.length) console.log('    ' + utiles.join('  '));

  if (SEC) {
    console.log(`    (--sec : rien n'a été écrit)`);
    if (intention.reponse) console.log(`    🔊 ${intention.reponse}`);
    return;
  }
  const r = vocal.executer(intention, { donnees, personne });
  console.log(`    🔊 ${r.reponse}${r.fait ? '   [écrit en base]' : ''}`);
}

async function main() {
  if (args.includes('--regles')) {
    console.log('\n  Chemin rapide (aucun appel réseau) :');
    for (const p of PHRASES) {
      const r = regles.comprendre(p);
      console.log(`    ${(r ? '⚡ ' + r.action : '→ IA').padEnd(22)} « ${p} »`);
    }
    console.log('');
    return;
  }

  /* ⚠️ Un simple `filter(a => !a.startsWith('--'))` prenait la VALEUR d'un
     drapeau pour une phrase à dire : « claude-haiku-4-5 » partait au modèle
     comme une commande vocale. On saute donc le drapeau ET son argument. */
  const AVEC_VALEUR = new Set(['--modele']);
  const libres = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) { if (AVEC_VALEUR.has(args[i])) i++; continue; }
    libres.push(args[i]);
  }
  const phrases = args.includes('--lot') ? PHRASES : libres;
  if (!phrases.length) {
    console.log('\n  Donne une phrase, ou --lot pour le jeu d\'essai, ou --regles.');
    console.log('  Ajoute --sec pour ne rien écrire en base.\n');
    process.exit(1);
  }
  const s = recettes.sources();
  console.log(`\n  Modèle : ${s.nom ? recettes.ia.MODELE : 'aucun (règles seules)'}`);
  for (const p of phrases) await une(p);
  console.log('');
}

main().catch((e) => { console.error('\n✗ ' + e.message + '\n'); process.exit(1); });
