'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   Photos de la veille — depuis un DOSSIER, sans rien publier.

   ── POURQUOI CETTE VOIE ──────────────────────────────────────────────────
   Trois chemins ont été essayés pour atteindre les albums partagés :
     1. les fichiers en local → ils n'y sont pas (`cloudsharing` pèse 24 Ko) ;
     2. Photos.app en AppleScript → `osascript` sort VIDE, sans erreur :
        l'autorisation d'automatisation pour Photos n'est pas accordée, et
        macOS ne peut pas la demander à quelqu'un qui n'est pas devant l'écran.
        Même si elle l'était, AppleScript n'expose pas les albums partagés ;
     3. le « site web public » d'un album → il fonctionne, mais rend l'album
        accessible à quiconque a le lien. **Refusé par Rémi, et il a raison :**
        ce sont des photos de ses enfants, et le lien est une simple obscurité.

   ⇒ On lit un DOSSIER que Rémi remplit lui-même depuis Photos (Fichier →
   Exporter). Rien ne sort de la maison, aucun jeton, aucune autorisation,
   aucune dépendance à une session ouverte — donc ça survit à une coupure de
   courant, contrairement aux deux autres voies.

   💡 Et ce n'est pas un pis-aller : sur un écran de cuisine, on ne regarde pas
   2 700 photos. Deux ou trois cents bien choisies valent mieux, et le choix
   lui appartient — c'est le même principe que partout ici : la machine
   propose, l'humain décide.
   ═══════════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');

/* HEIC compris : c'est le format par défaut de l'iPhone, et un export « photos
   d'origine » en contiendra. sharp le lit si libvips a été compilé avec — on
   vérifie à l'usage plutôt que de le promettre. */
const EXTENSIONS = /\.(jpe?g|png|heic|heif|webp|tiff?)$/i;

/* Dossiers qu'un export d'iPhone ou de Photos sème et qui ne contiennent rien
   d'affichable — les parcourir ne ferait que ralentir et remonter du bruit. */
const IGNORES = new Set(['.DS_Store', '__MACOSX', '.photoslibrary', 'AAE']);

/* Parcours en profondeur : un export par album donne un sous-dossier par
   album, et c'est justement ce qu'on veut conserver — le nom du dossier
   devient la légende (« Rhodes 2026 »), sans rien avoir à saisir. */
function parcourir(racine, base = racine, sortie = []) {
  let entrees;
  try { entrees = fs.readdirSync(racine, { withFileTypes: true }); }
  catch (_) { return sortie; }

  for (const e of entrees) {
    if (e.name.startsWith('.') || IGNORES.has(e.name)) continue;
    const complet = path.join(racine, e.name);
    if (e.isDirectory()) { parcourir(complet, base, sortie); continue; }
    if (!EXTENSIONS.test(e.name)) continue;

    let taille = 0;
    try { taille = fs.statSync(complet).size; } catch (_) { continue; }
    /* Une image de moins de 20 Ko est presque sûrement une vignette ou une
       icône ramassée au passage, pas une photo de vacances. */
    if (taille < 20 * 1024) continue;

    const relatif = path.relative(base, complet);
    const dossier = path.dirname(relatif);
    sortie.push({
      chemin: complet,
      octets: taille,
      /* Le premier niveau de sous-dossier nomme l'album. À la racine, pas de
         légende plutôt qu'une inventée. */
      album: dossier === '.' ? '' : dossier.split(path.sep)[0],
    });
  }
  return sortie;
}

function lister(racine) {
  if (!racine) throw new Error('Aucun dossier indiqué.');
  if (!fs.existsSync(racine)) throw new Error(`Dossier introuvable : ${racine}`);
  const photos = parcourir(racine);
  const albums = new Map();
  for (const p of photos) {
    const k = p.album || '(à la racine)';
    albums.set(k, (albums.get(k) || 0) + 1);
  }
  return { photos, albums };
}

module.exports = { lister, EXTENSIONS };
