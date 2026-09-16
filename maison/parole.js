'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   Faire parler l'écran mural — le Mac synthétise, le Pi ne fait que jouer.

   POURQUOI CE PARTAGE
   Vérifié le 11/09 sur le Raspberry : il n'a AUCUNE synthèse vocale installée —
   ni speech-dispatcher, ni espeak. `speechSynthesis` du navigateur n'y a donc
   aucune voix, et le bento ne peut pas parler tout seul.
   Même si on installait espeak, le résultat serait la voix robotique que
   `VOCAL.md` cherche justement à éviter. Le Mac, lui, a huit voix françaises
   posées et `say` répond en quelques centaines de millisecondes.
   C'est la conclusion déjà écrite au § 2 sexvicies pour un Pi 4, appliquée.

   COMMENT
   On produit un WAV nommé par l'EMPREINTE DU TEXTE ET DE LA VOIX, servi en
   cache long — même patron que les photos de plats et les pochettes. Une phrase
   déjà dite ne se resynthétise jamais, et « Bonjour Monsieur » est justement la
   phrase qu'on répétera le plus.

   ⚠️ `say` n'est PAS de l'automatisation : il ne passe pas par AppleEvents, donc
   il fonctionne depuis le démon sans autorisation TCC — contrairement à Music.
   Aucun agent nécessaire ici.
   ═══════════════════════════════════════════════════════════════════════════ */

const { execFile } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MAC = process.platform === 'darwin';
const DOSSIER = path.join(__dirname, '..', 'public', 'paroles');

/* ── DEUX MOTEURS, ET POURQUOI ────────────────────────────────────────────
   Rémi, 16/09 : « la voix ressemble trop à un GPS ». Il a raison, et ce n'est
   pas un réglage à trouver : `say` n'a sur cette machine que les voix
   COMPACTES de macOS — Thomas et Jacques sont les plus anciennes du lot, et
   elles sonnent comme un navigateur de 2010. Vérifié plutôt que supposé :
   aucune voix « Enhanced » ni « Premium » n'est téléchargée, et elles ne
   s'installent que depuis Réglages système, à la main.

   PIPER est la réponse déjà écrite au § 2 quaterdecies, avant même l'arrivée du
   Mac : synthèse NEURONALE, locale, gratuite, avec de vraies voix masculines
   françaises. Mesuré ici sur le M4 : 3,5 s d'audio produites en 1,3 s, modèle
   chargé compris — largement plus rapide que le temps réel.

   ⚠️ LICENCE : Piper est passé en GPL-3.0 en octobre 2025. On l'invoque comme
   un PROGRAMME, jamais comme une bibliothèque liée — exactement le montage du
   pont Python de Pronote (§ 2 duovicies). On paie un lancement de processus
   pour ne rien contaminer.

   `say` reste le repli : si Piper n'est pas installé, ou si son modèle manque,
   l'écran parle quand même. Une voix moins belle vaut mieux qu'un silence
   qu'on ne s'explique pas. */
const PIPER = {
  binaire: process.env.PIPER_BIN || path.join(process.env.HOME || '', 'Library/Python/3.13/bin/piper'),
  dossier: process.env.PIPER_VOIX || path.join(process.env.HOME || '', 'piper-voix'),
};

/* Le nom d'un modèle Piper, ramené à un fichier existant. On n'accepte QUE ce
   qui est dans le dossier des voix : le nom vient d'un réglage, et un réglage
   ne doit jamais pouvoir désigner un fichier arbitraire de la machine. */
function modelePiper(nom) {
  const propre = String(nom || '').replace(/[^A-Za-z0-9_-]/g, '');
  if (!propre) return null;
  const f = path.join(PIPER.dossier, propre + '.onnx');
  try { return fs.existsSync(f) && fs.existsSync(f + '.json') ? f : null; } catch { return null; }
}

function piperDisponible() {
  try { return fs.existsSync(PIPER.binaire); } catch { return false; }
}

/* Les modèles posés dans le dossier — c'est la liste que /admin/ propose. */
function voixPiper() {
  try {
    return fs.readdirSync(PIPER.dossier)
      .filter((f) => f.endsWith('.onnx'))
      .map((f) => f.slice(0, -5))
      .sort();
  } catch { return []; }
}

/* Bornes. Le texte vient d'un appel interne, mais une phrase de dix mille
   caractères bloquerait `say` plusieurs minutes et remplirait le disque. */
const MAX_CAR = 400;
/* Au-delà, on efface les plus anciennes : un écran qui parle tous les jours
   accumulerait sinon des milliers de fichiers sur la carte du Mac. */
const MAX_FICHIERS = 300;

const VOIX_DEFAUT = 'Thomas';

function nettoyer(nom) {
  /* La voix est passée à un programme : on n'accepte que des lettres, chiffres
     et espaces. Pas d'échappement à inventer, pas de surprise. */
  return String(nom || '').replace(/[^A-Za-zÀ-ÿ0-9 _-]/g, '').trim().slice(0, 40);
}

function menage() {
  try {
    const fichiers = fs.readdirSync(DOSSIER)
      .filter((f) => f.endsWith('.wav'))
      .map((f) => ({ f, t: fs.statSync(path.join(DOSSIER, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const { f } of fichiers.slice(MAX_FICHIERS)) {
      try { fs.unlinkSync(path.join(DOSSIER, f)); } catch { /* déjà parti */ }
    }
  } catch { /* dossier absent : rien à nettoyer */ }
}

/* Rend une URL servie par le serveur, ou `null` avec une raison. On ne lève
   jamais : une salutation qui échoue ne doit pas faire tomber ce qui l'entoure. */
async function dire(texte, options = {}) {
  const phrase = String(texte || '').trim().slice(0, MAX_CAR);
  if (!phrase) return { ok: false, raison: 'phrase vide' };
  if (!MAC) return { ok: false, raison: 'la synthèse se fait depuis le Mac' };

  const voix = nettoyer(options.voix) || VOIX_DEFAUT;
  /* Le débit de `say` est en mots par minute. 180 est le débit naturel ; on
     descend un peu pour le ton posé du majordome (§ 2 quaterdecies). */
  const debit = Math.min(300, Math.max(100, Number(options.debit) || 170));

  const nom = crypto.createHash('sha1')
    .update(`${voix}|${debit}|${phrase}`).digest('hex').slice(0, 16) + '.wav';
  const dest = path.join(DOSSIER, nom);
  const url = '/paroles/' + nom;

  if (fs.existsSync(dest)) return { ok: true, url, texte: phrase, voix, cache: true };

  fs.mkdirSync(DOSSIER, { recursive: true });

  /* Piper si la voix demandée est un de ses modèles. Sinon `say`, et c'est la
     même fonction pour l'appelant : le serveur ignore lequel a répondu — même
     principe que `donnees/` et `recettes/`. */
  const modele = piperDisponible() ? modelePiper(voix) : null;
  if (modele) {
    try {
      await new Promise((resolve, reject) => {
        /* Le texte passe par un FICHIER, jamais par la ligne de commande : les
           arguments d'un processus sont visibles de toute la machine, et une
           salutation contient un prénom. Même précaution que pour `say` et que
           pour le QR code Pronote (§ 2 duovicies). */
        const tmpTxt = dest + '.txt';
        fs.writeFileSync(tmpTxt, phrase, 'utf8');
        /* `length-scale` > 1 ralentit. Le débit de `say` est en mots/minute :
           170 est le ton posé du majordome, 180 le débit naturel. On convertit
           pour que le MÊME réglage gouverne les deux moteurs — sinon changer de
           voix changerait aussi la vitesse, sans que personne comprenne. */
        const echelle = Math.min(1.6, Math.max(0.7, 180 / debit)).toFixed(2);
        execFile(PIPER.binaire,
          ['-m', modele, '-i', tmpTxt, '-f', dest,
           '--length-scale', echelle, '--sentence-silence', '0.15'],
          { timeout: 30000 },
          (err, _o, stderr) => {
            try { fs.unlinkSync(tmpTxt); } catch { /* peu importe */ }
            if (err) return reject(new Error(String(stderr || err.message).trim().slice(0, 160)));
            resolve();
          });
      });
      menage();
      return { ok: true, url, texte: phrase, voix, moteur: 'piper', cache: false };
    } catch (e) {
      /* Piper a échoué : on ne reste pas muet, on redescend sur `say`. Le
         journal du serveur le dira, l'écran parlera quand même. */
      try { fs.unlinkSync(dest); } catch { /* rien à retirer */ }
    }
  }

  await new Promise((resolve, reject) => {
    /* Le texte passe par `--input-file` et non par la ligne de commande : les
       arguments d'un processus sont visibles de toute la machine, et une phrase
       peut contenir un prénom ou un rendez-vous. Même précaution que pour le QR
       code Pronote (§ 2 duovicies). */
    const tmpTxt = dest + '.txt';
    fs.writeFileSync(tmpTxt, phrase, 'utf8');
    execFile('/usr/bin/say',
      ['-v', voix, '-r', String(debit), '-o', dest, '--data-format=LEI16@22050', '-f', tmpTxt],
      { timeout: 20000 }, (err, _o, stderr) => {
        try { fs.unlinkSync(tmpTxt); } catch { /* peu importe */ }
        if (err) return reject(new Error(String(stderr || err.message).trim().slice(0, 160)));
        resolve();
      });
  });
  menage();
  return { ok: true, url, texte: phrase, voix, cache: false };
}

/* Ce qui est disponible ici et maintenant — l'interface grise ce qui ne peut
   pas marcher en disant pourquoi, plutôt que d'offrir un bouton inerte. */
function voix() {
  if (!MAC) return Promise.resolve([]);
  return new Promise((resolve) => {
    execFile('/usr/bin/say', ['-v', '?'], { timeout: 8000 }, (err, out) => {
      const systeme = err ? [] : String(out).split('\n')
        .filter((l) => /\bfr_FR\b/.test(l))
        .map((l) => l.split(/\s{2,}|\s+fr_FR/)[0].trim())
        .filter(Boolean);
      /* Les voix Piper D'ABORD : ce sont les belles, et une liste se lit du
         haut. Marquées, sinon on ne sait pas laquelle on choisit. */
      resolve([...voixPiper(), ...systeme]);
    });
  });
}

module.exports = { dire, voix, voixPiper, piperDisponible, VOIX_DEFAUT, MAX_CAR };
