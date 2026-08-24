/* Génère un fichier .ics pour les périodes de présence des enfants qui MANQUENT
   dans le calendrier.

   ⚠️ On n'écrit JAMAIS dans le calendrier — décision du 19/08 : « garde-le en
   lecture, si on doit modifier c'est dans le calendrier ». Ce script produit un
   FICHIER que l'on importe soi-même. Le calendrier reste la source de vérité, et
   rien n'y entre sans un geste humain.

   ⚠️ Et il n'INVENTE aucune date. Une première version coupait chaque vacance en
   deux moitiés : elle proposait juillet 2027 alors que les enfants arrivent le
   1er août, et le 26 février au lieu du 27. Une date de garde fausse envoie un
   enfant au mauvais endroit — les dates se donnent, elles ne se devinent pas.

   Usage :
     node outils/marqueurs-vacances.js
         liste les vacances scolaires et dit lesquelles ont un marqueur

     node outils/marqueurs-vacances.js --ecrire 2027-02-19→2027-02-27 2027-08-01→2027-08-31
         produit le .ics pour ces périodes (bornes INCLUSES)                     */
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const donnees = require(path.join(__dirname, '..', 'donnees'));
const { creerPresence } = require(path.join(__dirname, '..', 'presence'));

const args = process.argv.slice(2);
const ECRIRE = args.includes('--ecrire');
const config = (cle) => donnees.reglage(cle, '');
const presence = creerPresence({ donnees, config });

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const compact = (iso) => iso.replace(/-/g, '');
const jourApres = (iso) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + 1); return ymd(d); };
const nbJours = (du, au) => Math.round((new Date(au + 'T12:00:00') - new Date(du + 'T12:00:00')) / 86400000) + 1;

/* « 2027-02-19→2027-02-27 », avec les séparateurs qu'on tape naturellement. */
function lirePeriode(txt) {
  const m = /^(\d{4}-\d{2}-\d{2})\s*(?:→|->|\.\.|au?)\s*(\d{4}-\d{2}-\d{2})$/.exec(String(txt).trim());
  if (!m) return null;
  if (m[2] < m[1]) return null;
  return { du: m[1], au: m[2] };
}

/* RFC 5545 : une ligne ne dépasse pas 75 OCTETS (pas caractères — « é » en
   compte deux). Au-delà, on replie avec CRLF + une espace. node-ical est
   tolérant, l'importateur d'Apple beaucoup moins : sans ça, un titre un peu long
   ferait échouer l'import sans dire pourquoi. */
function plier(ligne) {
  const o = Buffer.from(ligne, 'utf8');
  if (o.length <= 75) return ligne;
  const bouts = [];
  let i = 0, max = 75;
  while (i < o.length) {
    /* Ne jamais couper au milieu d'un caractère multi-octet : on recule tant
       qu'on est sur un octet de continuation (10xxxxxx). */
    let fin = Math.min(i + max, o.length);
    while (fin > i && fin < o.length && (o[fin] & 0xc0) === 0x80) fin--;
    bouts.push(o.subarray(i, fin).toString('utf8'));
    i = fin; max = 74; // les suivantes portent une espace en tête
  }
  return bouts.join('\r\n ');
}

/* ⚠️ DTEND est EXCLUSIF pour une journée entière : couvrir jusqu'au 27 inclus
   demande d'écrire le 28. C'est l'erreur numéro un de ce format, et elle est
   silencieuse — le projet l'a déjà payée deux fois (§ 2 sexdecies). */
function evenement(titre, du, au, i) {
  return ['BEGIN:VEVENT',
    `UID:maison-presence-${compact(du)}-${i}@ecran-maison`,
    `DTSTAMP:${compact(ymd(new Date()))}T120000Z`,
    `DTSTART;VALUE=DATE:${compact(du)}`,
    `DTEND;VALUE=DATE:${compact(jourApres(au))}`,
    `SUMMARY:${titre}`,
    'DESCRIPTION:Enfants à la maison (proposé, à relire).',
    'TRANSP:TRANSPARENT', 'END:VEVENT'].map(plier).join('\r\n');
}

async function main() {
  const agenda = await lireAgenda();
  const etat = presence.vacancesSansMarqueur(agenda);
  const aujourdhui = ymd(new Date());
  const titre = config('garde_marqueur_vacances') || 'vacances enfant';
  const nom = titre.charAt(0).toUpperCase() + titre.slice(1);

  if (!ECRIRE) {
    console.log('\nVacances scolaires à venir et marqueurs trouvés dans le calendrier :\n');
    for (const v of etat) {
      const encours = v.du <= aujourdhui && v.au >= aujourdhui;
      console.log(`  ${v.du} → ${v.au}  ${v.libelle || ''}`);
      if (v.marque) console.log(`     ✓ marqueur : ${v.marque.du} → ${v.marque.au}  « ${v.marque.titre} »`);
      else if (encours) console.log('     · aucun marqueur — période EN COURS : c\'est sans doute voulu (enfants absents)');
      else console.log('     ✗ aucun marqueur — à compléter si les enfants sont là');
    }
    console.log('\nPour produire le fichier, donne les dates exactes (bornes incluses) :');
    console.log('  node outils/marqueurs-vacances.js --ecrire 2027-02-19→2027-02-27 2027-08-01→2027-08-31\n');
    return;
  }

  const periodes = [];
  for (const a of args) {
    if (a === '--ecrire') continue;
    const p = lirePeriode(a);
    if (!p) { console.error(`\n✗ Période illisible : « ${a} »  (attendu : 2027-02-19→2027-02-27)\n`); process.exit(1); }
    periodes.push(p);
  }
  if (!periodes.length) { console.error('\n✗ Aucune période donnée. Relance sans --ecrire pour voir la liste.\n'); process.exit(1); }

  console.log('');
  const evts = periodes.map((p, i) => {
    /* Un repère utile : est-ce que ça tombe bien dans des vacances scolaires ?
       On n'interdit rien — un week-end prolongé est légitime — mais une faute de
       frappe sur l'année se voit tout de suite ici. */
    const dans = presence.vacancesScolaires().find((v) => p.du <= v.au && p.au >= v.du);
    console.log(`  ${p.du} → ${p.au}  (${nbJours(p.du, p.au)} jours)`
      + (dans ? `  ↳ ${dans.libelle || 'vacances scolaires'}` : '  ⚠️ hors vacances scolaires connues'));
    return evenement(nom, p.du, p.au, i);
  });

  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Ecran Maison//FR',
    'CALSCALE:GREGORIAN', ...evts, 'END:VCALENDAR'].join('\r\n') + '\r\n';

  const cible = path.join(__dirname, '..', 'presence-a-importer.ics');
  fs.writeFileSync(cible, ics, 'utf8');
  console.log(`\n✓ ${cible}\n`);
  console.log('  1. Double-clique dessus — le Calendrier proposera d\'ajouter ces événements.');
  console.log('  2. Choisis bien le calendrier PERSO (celui que lit l\'écran), pas le pro.');
  console.log('  3. Puis /admin/ → Présence → « ↻ Relire le calendrier ».\n');
}

/* Lecture directe du flux : ce script ne démarre pas le serveur. */
async function lireAgenda() {
  const url = config('agenda_ics');
  if (!url) { console.error('\n✗ Aucun calendrier configuré (/admin/ → Réglages).\n'); process.exit(1); }
  const ical = require(path.join(__dirname, '..', 'node_modules', 'node-ical'));
  const brut = await ical.async.fromURL(url);
  const out = [];
  for (const e of Object.values(brut)) {
    if (!e || e.type !== 'VEVENT' || !e.start) continue;
    const d = new Date(e.start);
    out.push({ start: d.toISOString(), fin: e.end ? new Date(e.end).toISOString() : '',
      jour: ymd(d), jourFin: e.end ? ymd(new Date(e.end)) : '',
      summary: String(e.summary || ''), journee: e.datetype === 'date' });
  }
  return out;
}

main().catch((e) => { console.error('\n✗ ' + e.message + '\n'); process.exit(1); });
