#!/usr/bin/env node
'use strict';
/* ============================================================================
 *  Aucun secret ne part sur GitHub — vérifié, pas espéré.
 *
 *  ⚠️ Pourquoi cet outil existe : au push du 24/08 (§ 2 sexdecies) la
 *  vérification a été faite À LA MAIN. Le 04/09 elle a rattrapé de justesse
 *  une vraie fuite — le VRAI identifiant EcoleDirecte figurait dans un fichier
 *  de tests, dans un contrôle écrit pour protéger la vie privée. Une
 *  vérification qu'on refait de mémoire finit par sauter le jour où l'on est
 *  pressé, et sur Git l'erreur est définitive : l'historique garde tout, même
 *  après suppression du fichier.
 *
 *  🔑 On lit ce que GIT S'APPRÊTE À ENVOYER (`git show :fichier`), pas ce qui
 *  est sur le disque. La nuance compte : un fichier peut être propre
 *  aujourd'hui et avoir été indexé sale.
 *
 *  Usage :
 *      node outils/verifier-secrets.js          → ce qui est indexé (avant commit)
 *      node outils/verifier-secrets.js --tout   → tout ce que le dépôt suit déjà
 *
 *  Sort en code 1 si quelque chose est trouvé — utilisable dans un hook.
 * ========================================================================== */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.join(__dirname, '..');
const git = (...a) =>
  execFileSync('git', a, { cwd: RACINE, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });

/* ── 1. Les VRAIES valeurs à protéger, lues dans le .env ────────────────────
   Chercher les valeurs exactes vaut mieux que deviner des motifs : c'est ce
   qui a attrapé l'identifiant EcoleDirecte, qu'aucune expression générique
   n'aurait reconnu (c'est une adresse e-mail ordinaire).
   ⚠️ On ignore les valeurs courtes et les constantes de configuration : « 8090 »
   ou « sqlite » apparaissent partout et noieraient le résultat. */
function valeursDuEnv() {
  const f = path.join(RACINE, '.env');
  if (!fs.existsSync(f)) return [];
  const sortie = [];
  for (const ligne of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = ligne.match(/^\s*([A-Z_0-9]+)\s*=\s*(.*)$/);
    if (!m) continue;
    const cle = m[1];
    const v = m[2].trim().replace(/^["']|["']$/g, '');
    if (v.length < 12) continue;
    if (/^(sqlite|notion|true|false)$/i.test(v)) continue;
    sortie.push([cle, v]);
  }
  return sortie;
}

/* ── 2. Les motifs, pour ce qui viendrait d'ailleurs que du .env ─────────── */
const MOTIFS = [
  ['clé API Anthropic', /sk-ant-api\d{2}-[\w-]{20,}/],
  ['token Notion', /\bntn_[A-Za-z0-9]{20,}/],
  ['token Notion (ancienne forme)', /\bsecret_[A-Za-z0-9]{40,}/],
  /* ⚠️ Un hôte est EXIGÉ. Sans ça, le motif se déclenchait sur la
     documentation qui cite « webcal:// » en toutes lettres — et un outil qui
     crie au loup sur sa propre notice finit par être ignoré. Une vraie URL
     fuitée porte toujours un domaine. */
  ['calendrier iCloud publié', /webcal:\/\/[\w.-]+\.[a-z]{2,}|p\d{2,3}-caldav\.icloud\.com/i],
  ['jeton d’appareil EcoleDirecte', /"c[nv]"\s*:\s*"[^"]{20,}"/],
  ['identifiants Pronote', /"(?:password|token_login)"\s*:\s*"[^"]{12,}"/],
  ['clé privée', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['mot de passe d’application Apple', /\b[a-z]{4}-[a-z]{4}-[a-z]{4}-[a-z]{4}\b/],
];

/* Faux positifs connus, nommés un par un plutôt que par une règle vague :
   une exception qu'on ne peut pas justifier est une exception qu'on ne devrait
   pas faire. */
const TOLERES = [
  {
    fichier: '.env.example',
    cles: ['DB_TODO', 'DB_COURSE', 'DB_POSTIT', 'DB_MENU', 'DB_PLATS', 'DB_PLANNING'],
    pourquoi: 'identifiants de bases Notion — inutilisables sans le token, et Notion est une archive figée depuis le 18/08/2026',
  },
];
const tolere = (fichier, cle) =>
  TOLERES.some((t) => t.fichier === fichier && t.cles.includes(cle));

/* ── 3. Balayage ───────────────────────────────────────────────────────────── */
function main() {
  const tout = process.argv.includes('--tout');
  const fichiers = (tout ? git('ls-files') : git('diff', '--cached', '--name-only'))
    .split(/\r?\n/).filter(Boolean);

  if (!fichiers.length) {
    console.log(tout ? 'Le dépôt ne suit aucun fichier.' : 'Rien d’indexé — fais `git add` d’abord.');
    return 0;
  }

  const valeurs = valeursDuEnv();
  console.log(`Balayage de ${fichiers.length} fichier(s) — ${tout ? 'tout le dépôt' : 'index (avant commit)'}`);
  console.log(`Valeurs du .env recherchées : ${valeurs.map((v) => v[0]).join(', ') || '(aucune — .env absent)'}\n`);

  const alertes = [];
  for (const f of fichiers) {
    let contenu;
    /* Un binaire ou un fichier supprimé n'a rien à dire : on passe sans bruit. */
    try { contenu = tout ? fs.readFileSync(path.join(RACINE, f), 'utf8') : git('show', ':' + f); }
    catch (_) { continue; }
    if (contenu.includes('\0')) continue;

    for (const [nom, re] of MOTIFS) {
      if (re.test(contenu)) alertes.push({ f, quoi: nom });
    }
    for (const [cle, v] of valeurs) {
      if (contenu.includes(v) && !tolere(f, cle)) alertes.push({ f, quoi: `valeur de ${cle} en clair` });
    }
  }

  if (!alertes.length) {
    console.log('✅ AUCUN SECRET. Publication sûre.');
    return 0;
  }
  console.log('🔴 NE PAS POUSSER — trouvé :\n');
  for (const a of alertes) console.log(`   ${a.f}\n      → ${a.quoi}`);
  console.log('\n⚠️ Corrige le FICHIER, pas cet outil. Et si c’est déjà commité :');
  console.log('   l’historique Git garde tout — il faut réécrire l’historique ET');
  console.log('   révoquer le secret. Le révoquer suffit rarement à lui seul.');
  return 1;
}

process.exit(main());
