'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   Musique — pilotage de Music.app et des enceintes AirPlay, sur le Mac mini.

   Pourquoi AppleScript et pas une API : la musique de la maison passe par
   Music.app, qui est le seul à connaître la bibliothèque, les abonnements et les
   enceintes AirPlay appairées. Aucune API réseau ne donne ça. AppleScript est le
   canal officiel d'Apple pour le piloter, il ne demande aucune clé et il ne sort
   pas de la machine.

   ⚠️ Ce fichier ne fonctionne QUE sur macOS. C'est la règle du projet
   (§ 2 septies) : « un adaptateur qu'on ne peut pas exécuter, ce sont des bugs
   qu'on découvre au pire moment ». Il n'a donc pas été écrit tant que le serveur
   tournait sous Windows — il l'est le jour où le Mac sert.
   Sur toute autre plateforme, `disponible()` répond faux et le reste ne fait
   rien : l'écran affiche « à brancher », comme avant.
   ═══════════════════════════════════════════════════════════════════════════ */

const { execFile } = require('child_process');

const MAC = process.platform === 'darwin';

/* Un appel AppleScript coûte ~100 ms. La carte Maison de l'écran mural est
   redessinée à chaque rafraîchissement : sans garde-fou on interrogerait
   Music.app en boucle. Trois secondes suffisent à absorber les rafales sans
   qu'un changement paraisse en retard. */
const CACHE_MS = 3000;
let cache = { le: 0, valeur: null };

/* Une commande AppleScript ne doit JAMAIS être construite par concaténation avec
   une valeur venue de l'extérieur : un nom d'enceinte contenant un guillemet
   suffirait à faire exécuter autre chose. On échappe, systématiquement. */
const echapper = (s) => String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

function osascript(script, delai = 6000) {
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/osascript', ['-e', script], { timeout: delai },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(String(stderr || err.message).trim()));
        resolve(String(stdout).trim());
      });
  });
}

/* Music.app n'est pas forcément lancé, et il ne FAUT PAS le lancer pour lire son
   état : `tell application "Music"` démarre l'application. Sur un serveur sans
   écran, ouvrir Music tout seul serait une surprise désagréable — et ça
   mettrait plusieurs secondes. On regarde donc d'abord s'il tourne. */
/* 🐞 Vérifier « Music est-il lancé ? » via System Events paraissait naturel — et
   ça ne marche pas depuis une session SSH : System Events relève de
   l'automatisation, qui demande une autorisation TCC que personne ne peut
   accorder à distance. La commande sort alors VIDE, sans erreur, et le module
   croyait Music fermé alors qu'il jouait.
   `pgrep` répond à la même question sans aucune permission, et plus vite. */
const enMarche = () => new Promise((resolve) => {
  if (!MAC) return resolve(false);
  execFile('/usr/bin/pgrep', ['-x', 'Music'], (err, out) => resolve(!err && Boolean(String(out).trim())));
});

/* Le séparateur est une chaîne improbable plutôt qu'une virgule ou un `|` : un
   titre de morceau contient très souvent l'un et l'autre. */
const SEP = '<%|%>';

const LIRE = `
tell application "Music"
  set etat to (player state as text)
  set t to ""
  set a to ""
  set al to ""
  set duree to 0
  set pos to 0
  try
    set t to name of current track
    set a to artist of current track
    set al to album of current track
    set duree to duration of current track
    set pos to player position
  end try
  set v to sound volume
  return etat & "${SEP}" & t & "${SEP}" & a & "${SEP}" & al & "${SEP}" & (duree as text) & "${SEP}" & (pos as text) & "${SEP}" & (v as text)
end tell`;

/* Les enceintes : « current AirPlay devices » donne celles qui jouent, « AirPlay
   devices » toutes celles qui sont connues. On rend les deux, sinon on ne peut
   pas afficher où le son sort ACTUELLEMENT. */
const ENCEINTES = `
tell application "Music"
  set toutes to {}
  set actives to {}
  try
    repeat with d in AirPlay devices
      set fin to (name of d)
      set toutes to toutes & fin
      if selected of d then set actives to actives & fin
    end repeat
  end try
  set AppleScript's text item delimiters to "${SEP}"
  return (toutes as text) & "<%%>" & (actives as text)
end tell`;

async function etat() {
  if (!MAC) return { disponible: false, raison: 'la musique se pilote depuis le Mac' };
  if (Date.now() - cache.le < CACHE_MS && cache.valeur) return cache.valeur;

  let v;
  if (!(await enMarche())) {
    v = { disponible: true, ouvert: false, lecture: false };
  } else {
    try {
      const [etatL, titre, artiste, album, duree, position, volume] =
        (await osascript(LIRE)).split(SEP);
      let enceintes = [], actives = [];
      try {
        const [t, a] = (await osascript(ENCEINTES)).split('<%%>');
        enceintes = t ? t.split(SEP).filter(Boolean) : [];
        actives = a ? a.split(SEP).filter(Boolean) : [];
      } catch { /* les enceintes AirPlay ne sont pas toujours lisibles ; le reste vaut quand même */ }

      v = {
        disponible: true,
        ouvert: true,
        lecture: etatL === 'playing',
        etat: etatL,
        titre: titre || null,
        artiste: artiste || null,
        album: album || null,
        duree: Number(duree) || 0,
        position: Number(position) || 0,
        volume: Number(volume),
        enceintes,
        actives,
      };
    } catch (e) {
      v = { disponible: true, ouvert: true, erreur: e.message };
    }
  }
  cache = { le: Date.now(), valeur: v };
  return v;
}

/* Liste FERMÉE, comme pour les actions vocales (§ 2 septies) : le serveur
   n'exécute que ce qu'il connaît. Une commande arrivant de l'écran mural ou d'un
   téléphone ne peut donc pas devenir une instruction AppleScript arbitraire. */
const COMMANDES = {
  lecture: 'play',
  pause: 'pause',
  bascule: 'playpause',
  suivant: 'next track',
  precedent: 'previous track',
};

async function commander(quoi, options = {}) {
  if (!MAC) throw new Error('la musique se pilote depuis le Mac');
  cache = { le: 0, valeur: null };      // l'état change : on ne sert plus le cache

  if (quoi === 'volume') {
    const n = Math.max(0, Math.min(100, Math.round(Number(options.valeur))));
    if (!Number.isFinite(n)) throw new Error('volume invalide');
    await osascript(`tell application "Music" to set sound volume to ${n}`);
    return { ok: true, volume: n };
  }

  if (quoi === 'enceinte') {
    /* Une enceinte se choisit par son NOM, et le nom vient de la liste que Music
       a donnée — jamais d'une chaîne libre. On vérifie donc qu'elle existe avant
       de l'employer : sinon AppleScript lève une erreur illisible. */
    const nom = String(options.nom || '');
    const e = await etat();
    if (!(e.enceintes || []).includes(nom)) throw new Error(`enceinte inconnue : ${nom}`);
    await osascript(
      `tell application "Music" to set current AirPlay devices to (get some AirPlay device whose name is "${echapper(nom)}")`);
    cache = { le: 0, valeur: null };
    return { ok: true, enceinte: nom };
  }

  const ordre = COMMANDES[quoi];
  if (!ordre) throw new Error(`commande inconnue : ${quoi}`);
  /* On ne démarre pas Music.app pour une pause ou un « suivant » : s'il est
     fermé, il n'y a rien à mettre en pause. Seule la lecture peut l'ouvrir. */
  if (!(await enMarche()) && quoi !== 'lecture' && quoi !== 'bascule') {
    return { ok: false, raison: 'Music n’est pas ouvert' };
  }
  await osascript(`tell application "Music" to ${ordre}`);
  return { ok: true, commande: quoi };
}

const disponible = () => MAC;

module.exports = { disponible, etat, commander, COMMANDES };
