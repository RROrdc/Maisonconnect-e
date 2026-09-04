#!/usr/bin/env node
'use strict';
/* Banc d'essai des comptes scolaires — à lancer AVANT de brancher quoi que ce soit.
 *
 *   node outils/ecole.js                    → diagnostic pas à pas, tous comptes
 *   node outils/ecole.js qcm                → montre les questions de sécurité en attente
 *   node outils/ecole.js qcm 2              → retient la 2e proposition comme LA réponse
 *   node outils/ecole.js edt [prénom] [jours]
 *   node outils/ecole.js devoirs [prénom]
 *   node outils/ecole.js notes [prénom]
 *   node outils/ecole.js messages [prénom]
 *
 * ── Pourquoi un outil séparé, et d'abord ──────────────────────────────────
 * La panne du vocal (§ 2 octies) a coûté trois diagnostics au jugé avant qu'un
 * journal ne tranche en une lecture. Sur une chaîne aussi longue — .env →
 * connexion → QCM → jeton → élèves → données — instrumenter coûte moins cher
 * que deviner. Cet outil affiche CHAQUE maillon, compte par compte.
 *
 * ⚠️ LECTURE SEULE : rien n'est écrit chez EcoleDirecte, rien dans maison.db.
 *    À ce stade on regarde la forme réelle des données avant de décider quoi
 *    en stocker — en particulier, l'emploi du temps réel ne doit pas écraser
 *    la grille A/B saisie à la main.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Ecole, comptesConfigures, ErreurED, QcmRequis } = require('../ecole');
const { VERSION_API } = require('../ecole/ecoledirecte');
const { texteDeHtml, deBase64, jour, dansNJours } = require('../ecole/commun');

const args = process.argv.slice(2);
const commande = (args[0] || 'diagnostic').toLowerCase();
const ecole = new Ecole();

const titre = (t) => console.log('\n═══ ' + t);
const ok = (t) => console.log('  ✓ ' + t);
const ko = (t) => console.log('  ✗ ' + t);

function exigerConfiguration() {
  const comptes = comptesConfigures();
  titre('Comptes configurés');
  console.log("  version d'API : " + VERSION_API + (process.env.ED_VERSION ? '  (imposée par ED_VERSION)' : ''));
  if (!comptes.length) {
    ko('Aucun compte complet dans le .env.');
    console.log('\n  Il faut un identifiant ET un mot de passe pour chaque compte.');
    console.log('  Dans C:\\temp\\maison\\.env :');
    console.log('    ED_IDENTIFIANT=…      ED_MOTDEPASSE=…        ← Martial (lycée)');
    console.log('    ED_IDENTIFIANT_2=…    ED_MOTDEPASSE_2=…      ← Enora (collège)');
    const partiel = ['', '_2', '_3'].filter((s) => process.env['ED_IDENTIFIANT' + s] && !process.env['ED_MOTDEPASSE' + s]);
    if (partiel.length) {
      console.log('\n  ⚠️ Repéré : ED_IDENTIFIANT' + partiel[0] + ' est rempli mais ED_MOTDEPASSE' + partiel[0] + ' est VIDE.');
    }
    process.exit(1);
  }
  for (const c of comptes) ok(`${c.etiquette} — identifiant « ${c.identifiant} », mot de passe présent`);
  return comptes;
}

/* Le QCM est le seul point où un humain est indispensable : on l'expose aussi
   clairement que possible — la question, les propositions numérotées, et la
   commande exacte à taper. */
function afficherQcm(question, propositions, prefixe = '') {
  console.log('\n──────── QCM de sécurité ' + prefixe + '────────');
  console.log('  Question : ' + question);
  propositions.forEach((p, i) => console.log(`    ${i + 1}. ${p}`));
  console.log('\n  Réponds avec :  node outils/ecole.js qcm <numéro>');
  console.log('  (la réponse est gardée : ce QCM ne sera plus redemandé sur cette machine)');
}

/* Cherche les questions en attente sur TOUS les comptes. « En attente » veut
   dire : plus d'une réponse possible retenue — tant qu'on n'a pas tranché, le
   client refuse de répondre au hasard, ce qui épuiserait les essais. */
function questionsEnAttente() {
  const liste = [];
  for (const { etiquette, client } of ecole.clients) {
    for (const [question, reponses] of Object.entries(client.etat.qcm || {})) {
      if (reponses.length !== 1) liste.push({ etiquette, client, question, propositions: reponses });
    }
  }
  return liste;
}

async function apercu(e) {
  titre(`${e.prenom} (${e.compte}) — ce que le compte rend`);
  const du = jour(new Date()), au = jour(dansNJours(7));
  for (const [nom, appel] of [
    ['emploi du temps (7 j)', () => e._client.emploiDuTemps(e.id, du, au)],
    ['cahier de textes', () => e._client.devoirs(e.id)],
    ['notes', () => e._client.notes(e.id)],
    ['vie scolaire', () => e._client.vieScolaire(e.id)],
    ['messages', () => e._client.messages(e.via === 'famille' ? { familleId: e.familleId } : { eleveId: e.id })],
  ]) {
    try {
      const d = await appel();
      const n = Array.isArray(d) ? d.length : Object.keys(d || {}).length;
      /* On compte plutôt qu'on ne coche : un module vide n'est pas une panne,
         l'établissement peut simplement ne pas s'en servir. */
      console.log(`  ✓ ${nom.padEnd(24)} ${n} entrée(s)`);
    } catch (err) {
      console.log(`  ✗ ${nom.padEnd(24)} ${err.message}`);
    }
  }
}

(async () => {
  /* ── qcm : seule commande qui n'exige pas une connexion réussie ────────── */
  if (commande === 'qcm') {
    const attente = questionsEnAttente();
    if (!attente.length) {
      console.log("Aucune question en attente. Lance d'abord : node outils/ecole.js");
      return;
    }
    const choix = args[1];
    if (!choix) {
      for (const a of attente) afficherQcm(a.question, a.propositions, `(${a.etiquette}) `);
      if (attente.length > 1) console.log('\n  ⚠️ Plusieurs comptes en attente : réponds à la première, relance, puis recommence.');
      return;
    }
    const a = attente[0];
    const i = Number(choix);
    if (!Number.isInteger(i) || i < 1 || i > a.propositions.length) {
      ko(`Numéro invalide — attendu entre 1 et ${a.propositions.length}.`);
      afficherQcm(a.question, a.propositions, `(${a.etiquette}) `);
      process.exitCode = 1;
      return;
    }
    a.client.etat.qcm[a.question] = [a.propositions[i - 1]];
    a.client.ecrireEtat();
    ok(`Réponse retenue pour ${a.etiquette} : « ${a.propositions[i - 1]} »`);
    console.log('  Relance maintenant : node outils/ecole.js');
    return;
  }

  exigerConfiguration();

  titre('Connexion');
  const debut = Date.now();
  const eleves = await ecole.eleves();
  for (const s of ecole.soucis) {
    if (s.qcm) { ko(`${s.compte} : QCM de sécurité à passer`); afficherQcm(s.qcm.question, s.qcm.propositions, `(${s.compte}) `); }
    else ko(`${s.compte} : ${s.message}`);
  }
  if (!eleves.length) {
    /* Un compte en échec ne doit pas masquer les autres : on l'a dit compte par
       compte au-dessus, et on s'arrête seulement si RIEN n'a répondu. */
    console.log('\nAucun élève accessible pour le moment.');
    process.exitCode = 2;
    return;
  }
  ok(`${eleves.length} élève(s) en ${Date.now() - debut} ms`);

  titre('Élèves accessibles');
  for (const e of eleves) {
    console.log(`  · ${e.prenom} ${e.nom} — ${e.classe || 'classe inconnue'} · ${e.etablissement || '?'}`);
    console.log(`      id ${e.id} · compte ${e.via} · ${e.compte}`);
  }

  const cible = args[1] ? await ecole.trouver(args[1]).catch(() => null) : eleves[0];
  if (args[1] && !cible) { ko(`Aucun élève ne correspond à « ${args[1]} ».`); return; }

  if (commande === 'diagnostic') {
    for (const e of eleves) await apercu(e);
    console.log("\nRien n'a été écrit — ni chez EcoleDirecte, ni dans maison.db.");
    return;
  }

  if (commande === 'edt') {
    const n = Number(args[2] || 7);
    const cours = await ecole.emploiDuTemps(cible.prenom, { jours: n });
    titre(`${cible.prenom} — ${cours.length} cours sur ${n} jours`);
    let j = '';
    for (const c of cours) {
      if (c.jour !== j) { j = c.jour; console.log('  ── ' + j); }
      console.log(`     ${c.debut}–${c.fin}  ${String(c.matiere).padEnd(26)} ${String(c.salle).padEnd(8)} ${c.prof || ''}${c.annule ? '   ⛔ ANNULÉ' : ''}`);
    }
    return;
  }

  if (commande === 'devoirs') {
    const devoirs = await ecole.devoirs(cible.prenom);
    titre(`${cible.prenom} — ${devoirs.length} devoir(s) à venir`);
    let d = '';
    for (const t of devoirs) {
      if (t.pour !== d) { d = t.pour; console.log('  ── pour le ' + d); }
      console.log(`     ${t.matiere}${t.interrogation ? '  ⚠️ interrogation' : ''}${t.fait ? '  (fait)' : ''}`);
      for (const l of t.contenu.split('\n').slice(0, 4)) if (l) console.log('        ' + l);
    }
    return;
  }

  if (commande === 'notes') {
    const notes = await ecole.notes(cible.prenom);
    titre(`${cible.prenom} — ${notes.length} note(s)`);
    for (const n of notes.slice(-15)) {
      console.log(`  ${n.date}  ${String(n.matiere).padEnd(24)} ${String(n.valeur).padStart(5)}/${n.sur}${n.significative ? '' : '  (non significative)'}   ${n.devoir}`);
    }
    return;
  }

  if (commande === 'messages') {
    const messages = await ecole.messages(cible.prenom);
    titre(`${messages.length} message(s) reçu(s)`);
    for (const m of messages.slice(0, 12)) console.log(`  ${m.date}  ${m.lu ? ' ' : '●'} ${m.de} — ${m.sujet}`);
    return;
  }

  ko(`Commande inconnue : ${commande}`);
})().catch((e) => {
  if (e instanceof QcmRequis) { afficherQcm(e.question, e.propositions); process.exitCode = 2; return; }
  console.error('\n✗ ' + (e instanceof ErreurED ? e.message : (e && e.stack) || e));
  process.exitCode = 1;
});
