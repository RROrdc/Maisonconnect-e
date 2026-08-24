/* Constantes partagées par les deux implémentations de la couche données.
   Elles finiront en base (table `personnes` / `reglages`) quand le back-office existera :
   d'ici là, elles restent au même endroit pour n'avoir qu'un seul fichier à corriger. */

const JOURS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

/* Couleurs des plannings enfants. L'ORDRE de cet objet fixe l'ordre d'affichage
   des pastilles sur l'écran — ne pas y ajouter les adultes, ils n'ont pas de planning. */
const COULEURS = { 'Enora': '#ff7ab8', 'Martial': '#4fd1c5', 'Garçons': '#f6b23c' };

/* Couleur de chaque membre du foyer : sert aux avatars de l'app et à l'auteur d'un post-it.
   Table distincte de COULEURS, qui ne concerne que l'ordre des plannings. */
const COULEURS_FAMILLE = {
  'Rémi': '#5b9bff', 'Amandine': '#c08cff', 'Enora': '#ff7ab8',
  'Martial': '#4fd1c5', 'Garçons': '#f6b23c', 'Toute la famille': '#33c48d',
};
const PALETTE = ['#c08cff', '#5b9bff', '#33c48d', '#ff7a59'];
const couleurDe = (nom, i) => COULEURS[nom] || PALETTE[i % PALETTE.length];

/* Ordonne les personnes : celles de COULEURS d'abord (dans leur ordre), le reste par nom. */
function trierPersonnes(personnes) {
  const ordre = Object.keys(COULEURS);
  return personnes.sort((a, b) => {
    const ia = ordre.indexOf(a.nom), ib = ordre.indexOf(b.nom);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.nom.localeCompare(b.nom);
  });
}

module.exports = { JOURS, COULEURS, COULEURS_FAMILLE, PALETTE, couleurDe, trierPersonnes };
