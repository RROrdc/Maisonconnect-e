'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   maison/ — ce que la maison sait faire d'elle-même : la musique, la
   température, et demain le reste.

   Même forme que `donnees/` et `recettes/` : plusieurs sources derrière UNE
   interface, et le serveur ignore laquelle a répondu. C'est ce qui a permis de
   remplacer Notion par SQLite sans toucher au front (§ 2 ter), et ce qui a
   sauvé le projet après la quarantaine — l'interface était documentée deux fois.

   Deux règles héritées du reste du projet :
   • **Une source en panne n'emporte jamais les autres.** Le thermostat
     injoignable ne doit pas faire disparaître la musique de l'écran.
   • **On dit ce qu'on ne sait pas.** Un module absent renvoie sa RAISON, que
     l'écran affiche. « à brancher sur le Mac » se comprend ; une carte vide
     ressemble à une panne (§ 2 nonies — une panne qui n'existe que dans la
     console n'existe pour personne).
   ═══════════════════════════════════════════════════════════════════════════ */

/* 🔴 CE QUI MANQUE POUR QUE LA MUSIQUE MARCHE VRAIMENT — trouvé le 06/09.
   Piloter Music.app depuis un autre programme relève de l'« Automatisation »
   au sens de macOS, et le système avait déjà enregistré un REFUS :

     sqlite3 ~/Library/Application\ Support/com.apple.TCC/TCC.db        'select client,service,auth_value from access where service like "%AppleEvents%"'
     → /usr/libexec/sshd-keygen-wrapper | kTCCServiceAppleEvents | 0     (0 = refusé)

   ⚠️ Le symptôme ne ressemble pas à un refus : `osascript` sort **vide, sans la
   moindre erreur**. On cherche un bug de script là où il faut un clic.
   ⇒ Réglages système → Confidentialité et sécurité → **Automatisation**, et
   autoriser le contrôle de Musique.

   ⚠️ Et un LaunchDaemon n'y aura pas droit non plus : TCC ne peut pas demander
   l'autorisation à quelqu'un qui n'est pas devant l'écran. Si le serveur doit
   piloter la musique, il faudra un **LaunchAgent** dans la session graphique de
   Rémi — la demande s'y affiche une fois, et elle est retenue. Non écrit tant
   que l'autorisation n'est pas accordée : ce serait deviner. */
const musique = require('./musique');
const temperature = require('./temperature');

/* Ce qui est réellement disponible ICI ET MAINTENANT — la même idée que
   `recettes.sources()` : l'interface grise ce qui ne peut pas marcher, en
   disant pourquoi, plutôt que d'offrir un bouton inerte. */
function sources(reglages = {}) {
  const raccourci = String(reglages.temperature_raccourci || '').trim();
  return {
    musique: musique.disponible()
      ? { pret: true }
      : { pret: false, raison: 'se pilote depuis le Mac' },
    temperature: !musique.disponible()
      ? { pret: false, raison: 'se lit depuis le Mac' }
      : raccourci
        ? { pret: true, raccourci }
        : { pret: false, raison: 'raccourci HomeKit non configuré (/admin/ → Réglages)' },
  };
}

/* Un seul point d'entrée pour l'écran : une lecture, jamais deux. */
async function tout(reglages = {}) {
  const out = { sources: sources(reglages) };
  /* En parallèle : la musique et la température n'ont rien à voir l'une avec
     l'autre, et un thermostat lent ne doit pas retarder l'affichage du morceau
     en cours. Chacune capture SON erreur — une source en panne n'emporte pas
     l'autre, c'est la règle de la maison depuis `donnees/`. */
  const [m, t] = await Promise.all([
    musique.etat().catch((e) => ({ disponible: false, erreur: e.message })),
    temperature.etat(reglages.temperature_raccourci).catch((e) => ({ disponible: false, erreur: e.message })),
  ]);
  out.musique = m;
  out.temperature = t;
  return out;
}

module.exports = { sources, tout, musique, temperature };
