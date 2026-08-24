/* Administration en ligne de commande.

   Deux raisons d'exister :
   1. LA POULE ET L'ŒUF — le portail /admin/ demande un compte administrateur, or
      il faut bien en créer un premier.
   2. LE SECOURS — si plus personne ne connaît son code, on le remplace ici. Un
      code ne se relit pas (scrypt), il ne peut que se remplacer.

   Usage :
     node outils/admin.js                      liste les membres et leur état
     node outils/admin.js code <nom> <code>    définit le code (4 à 8 chiffres)
     node outils/admin.js code <nom>           RETIRE le code
     node outils/admin.js admin <nom> on|off   donne / retire les droits
     node outils/admin.js appareils            liste les appareils enrôlés         */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const donnees = require(path.join(__dirname, '..', 'donnees'));

const [, , commande, ...args] = process.argv;

const trouver = (nom) => {
  const m = donnees.listeMembres().find((x) => x.nom.toLowerCase() === String(nom || '').toLowerCase());
  if (!m) {
    console.error(`✗ Personne « ${nom} » inconnue. Membres : `
      + donnees.listeMembres().map((x) => x.nom).join(', '));
    process.exit(1);
  }
  return m;
};

function lister() {
  const membres = donnees.listeMembres();
  console.log('\n  ' + 'Prénom'.padEnd(18) + 'Rôle'.padEnd(11) + 'Code'.padEnd(8) + 'Admin'.padEnd(7) + 'Actif');
  console.log('  ' + '─'.repeat(52));
  for (const m of membres) {
    console.log('  ' + m.nom.padEnd(18) + String(m.role || '—').padEnd(11)
      + (m.collectif ? '—' : m.a_code ? 'oui' : 'NON').padEnd(8)
      + (m.admin ? 'oui' : '—').padEnd(7) + (m.actif ? 'oui' : 'non'));
  }
  const sans = membres.filter((m) => !m.collectif && m.actif && !m.a_code);
  if (sans.length) {
    console.log(`\n  ⚠️  Sans code : ${sans.map((m) => m.nom).join(', ')}.`);
    console.log('     Tant qu\'une personne n\'a pas de code, n\'importe qui sur le réseau');
    console.log('     peut entrer sous son nom.  →  node outils/admin.js code <nom> <code>');
  }
  if (!membres.some((m) => m.admin && m.actif))
    console.log('\n  ⚠️  Aucun administrateur actif : /admin/ est inaccessible.');
  console.log('');
}

function main() {
  if (!commande || commande === 'liste') return lister();

  if (commande === 'code') {
    const m = trouver(args[0]);
    const code = args[1];
    if (code && !/^\d{4,8}$/.test(code)) {
      console.error('✗ Le code doit faire 4 à 8 chiffres.');
      process.exit(1);
    }
    donnees.definirCode(m.nom, code || null);
    console.log(code ? `✓ Code défini pour ${m.nom}.` : `✓ Code retiré pour ${m.nom}.`);
    return;
  }

  if (commande === 'admin') {
    const m = trouver(args[0]);
    const on = String(args[1] || 'on').toLowerCase() !== 'off';
    donnees.enregistrerMembre({ ...m, admin: on });
    console.log(`✓ ${m.nom} ${on ? 'est administrateur.' : "n'est plus administrateur."}`);
    return;
  }

  if (commande === 'appareils') {
    const liste = donnees.listeAppareils();
    if (!liste.length) return console.log('\n  Aucun appareil enrôlé. Ouvre /app/ sur un iPhone.\n');
    console.log('');
    for (const a of liste)
      console.log(`  ${String(a.id).padStart(3)}  ${a.personne.padEnd(12)} ${(a.nom || '—').padEnd(24)} `
        + `vu ${a.vu_le || '—'}${a.revoque ? '   [révoqué]' : ''}`);
    console.log('');
    return;
  }

  console.error(`✗ Commande inconnue : ${commande}`);
  console.error('  Essaie : liste | code <nom> [code] | admin <nom> on|off | appareils');
  process.exit(1);
}

try { main(); }
catch (e) { console.error('✗', e.message); process.exit(1); }
