/* Recettes — point d'entrée unique.

   Même principe que `donnees/` : le serveur ignore laquelle des trois sources a
   répondu, et si l'une tombe les autres continuent.

   ⚠️ AUCUNE fonction de ce module n'écrit en base. Elles renvoient une
   PROPOSITION que l'humain valide — même règle que les courses depuis le menu,
   posée par Rémi : « faut pas que ça s'ajoute automatiquement, j'ai peut-être
   l'ingrédient dans les placards ». */
const lien = require('./lien');
const ia = require('./ia');
const images = require('./images');
const quantites = require('./quantites');
const commun = require('./commun');
const recherche = require('./recherche');
const rayons = require('./rayons');

/* Ce que le serveur sait faire ici et maintenant. Le back-office grise les
   boutons impossibles et AFFICHE LA RAISON — un bouton mort sans explication
   passe pour une panne. */
function sources() {
  const avecIA = ia.disponible();
  return {
    lien: true,
    /* La recherche ne dépend PAS de la clé : elle lit un site public. C'est donc
       la seule source qui ramène une photo même sans IA. */
    recherche: true,
    nom: avecIA,
    photo: avecIA,
    modele: avecIA ? ia.MODELE : '',
    pourquoi: avecIA ? ''
      : "Sans clé ANTHROPIC_API_KEY dans le .env, il reste « depuis un lien » et « trouver en ligne » "
        + '— elles couvrent déjà 750g et la plupart des blogs, et ce sont les seules à ramener une photo.',
  };
}

/* La photo est téléchargée et rangée en local dans la foulée : c'est le seul
   moment où l'on connaît la page d'origine, dont les hébergeurs d'images ont
   besoin (Referer anti-hotlink). Un échec de photo n'annule PAS la recette. */
async function depuisLien(url) {
  const r = await lien.depuisLien(url);
  r.photo = '';
  if (r.photoUrl) {
    try { r.photo = await images.telecharger(r.photoUrl, r.url); }
    catch (e) { r.photoErreur = e.message; }
  }
  return r;
}

/* Depuis le NOM, mais en passant par la RECHERCHE du site plutôt que par l'IA.
   C'est la seule façon d'obtenir une vraie photo à partir d'un simple nom de
   plat : l'IA écrit de mémoire, elle ne navigue pas.
   Renvoie `null` — franchement — quand rien ne correspond assez. */
async function depuisRecherche(nom, { seuil } = {}) {
  const trouve = await recherche.meilleur(nom, seuil !== undefined ? { seuil } : {});
  if (!trouve) return null;
  const r = await depuisLien(trouve.url);
  /* On garde de quoi juger sur pièces dans l'interface : quel titre a été
     retenu, et à quel point il colle. Un import silencieux est un import qu'on
     ne peut pas contester. */
  return { ...r, correspondance: { titre: trouve.titre, score: Math.round(trouve.score * 100), site: trouve.site } };
}

/* La PHOTO seule, à partir du nom du plat.

   Volontairement plus indulgent que `depuisRecherche` : on ne cherche qu'une
   image, donc l'absence de recette lisible n'est pas un motif d'abandon. Le
   premier jet exigeait le JSON-LD complet et repartait les mains vides sur des
   pages qui affichaient pourtant une belle photo — refuser le peu qu'on peut
   avoir à cause de ce qu'on ne peut pas avoir.

   Renvoie `null` quand aucune page ne correspond assez nettement : c'est une
   réponse valable, et de loin préférable à une vignette fausse sur un mur. */
async function photoPour(nom) {
  const trouve = await recherche.meilleur(nom);
  if (!trouve) return null;

  let distante = '';
  try {
    /* On tente d'abord la fiche complète : quand elle existe, son image est
       celle du plat, pas la bannière de la page. */
    const r = await lien.depuisLien(trouve.url);
    distante = r.photoUrl || '';
  } catch (_) { distante = ''; }
  if (!distante) {
    try { distante = await lien.photoDeLaPage(trouve.url); } catch (_) { distante = ''; }
  }
  if (!distante) return null;

  const photo = await images.telecharger(distante, trouve.url);
  return photo ? { photo, url: trouve.url, titre: trouve.titre, score: Math.round(trouve.score * 100) } : null;
}

const depuisNom = (nom, options) => ia.depuisNom(nom, options).then((r) => ({ ...r, photo: '' }));
const depuisPhoto = (b64, type, options) => ia.depuisPhoto(b64, type, options).then((r) => ({ ...r, photo: '' }));

/* ------------------------------------------------------------------ fiche servie à l'écran */
/* Construit la fiche affichable d'un plat, éventuellement recalculée pour N
   couverts. Le calcul est fait ICI, côté serveur, pour que l'écran mural, l'app
   et les courses affichent EXACTEMENT les mêmes nombres. */
function fiche(plat, couverts) {
  if (!plat) return null;
  const base = plat.portions_nb || null;
  const vise = Number(couverts) || null;
  /* Sans base connue, on ne met RIEN à l'échelle : diviser au hasard donnerait des
     courses fausses, ce qui est pire que rien. */
  const echelle = base && vise && vise !== base ? vise / base : 1;

  const ingredients = commun.nettoyerListe(
    String(plat.ingredients || '').split(/[\n,]/).map((x) => x.trim()).filter(Boolean));

  return {
    id: String(plat.id),
    nom: plat.nom,
    emoji: plat.emoji || '',
    photo: plat.photo || '',
    duree: plat.duree || '',
    portions: plat.portions || '',
    portionsBase: base,
    couverts: vise || base,
    misAEchelle: echelle !== 1,
    echelleImpossible: !!(vise && !base),
    ingredients: echelle === 1 ? ingredients : ingredients.map((x) => quantites.mettreAEchelle(x, echelle)),
    etapes: commun.nettoyerListe(String(plat.etapes || '').split('\n'), 40),
    appareils: commun.nettoyerListe(String(plat.appareils || '').split(','), 8),
    source_url: plat.source_url || '',
    recette: !!(plat.etapes && String(plat.etapes).trim()),
  };
}

/* Regroupe les ingrédients de plusieurs plats en une liste de courses.
   Les entrées portent déjà leurs quantités mises à l'échelle du repas concerné ;
   ici on DÉDOUBLONNE (sans casse ni accents) et on ADDITIONNE quand c'est
   possible. Sinon on garde la première ligne : incomplet vaut mieux que faux. */
function agregerIngredients(entrees) {
  const par = new Map();
  for (const { article, plat } of entrees || []) {
    const propre = String(article || '').trim();
    if (!propre) continue;
    /* La clé ignore la quantité : « 200 g de lardons » et « 150 g de lardons »
       sont le même article de courses. */
    const cle = normaliserArticle(propre);
    if (!cle) continue;
    const vu = par.get(cle);
    if (!vu) { par.set(cle, { article: propre, plats: [plat].filter(Boolean) }); continue; }
    vu.article = quantites.additionner(vu.article, propre);
    if (plat && !vu.plats.includes(plat)) vu.plats.push(plat);
  }
  return [...par.values()];
}

/* Retire la quantité de tête pour ne garder que « de quoi il s'agit ». */
function normaliserArticle(ligne) {
  const a = quantites.analyser(ligne);
  const reste = a ? a.reste : ligne;
  return String(reste || ligne)
    .replace(/^(?:de\s+la\s+|de\s+l['’]|d['’]|du\s+|des\s+|de\s+)/i, '')
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

module.exports = {
  sources, depuisLien, depuisNom, depuisPhoto, depuisRecherche, photoPour,
  idees: (existants, options) => ia.idees(existants, options),
  definirModele: ia.definirModele,
  fiche, agregerIngredients, normaliserArticle,
  devinerRayon: rayons.deviner,
  images, quantites, commun, ia, recherche, rayons,
};
