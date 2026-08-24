/* Proposer un menu de la semaine.

   Le besoin : 25 plats en bibliothèque, et pourtant on tourne toujours sur les
   mêmes cinq — parce que remplir sept soirs devant un écran est fastidieux, et
   qu'on ne se souvient pas de ce qu'on a mangé il y a trois semaines.

   ⚠️ **Pas d'IA ici, et c'est un choix.** Composer une semaine à partir d'une
   bibliothèque connue est un problème de ROTATION, pas de créativité : le
   résultat doit être instantané, gratuit, reproductible et explicable — « on ne
   l'a pas mangé depuis six semaines » se comprend, « le modèle l'a choisi » non.
   L'IA sert à l'autre besoin, trouver des plats qu'on n'a PAS (`recettes/ia.js`).

   ⚠️ Et ça ne remplit RIEN tout seul : ça propose, l'humain applique. Règle
   posée par Rémi pour les courses, valable ici encore davantage — personne ne
   veut découvrir sur le mur un menu qu'il n'a pas choisi. */

const JOURS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

function creerMenu({ donnees }) {

  /* Dernière fois qu'on a mangé chaque plat, tous repas confondus. */
  function derniereFois() {
    const vu = new Map();
    for (const m of donnees.lignesMenuBrutes()) {
      for (const id of [m.midi_plat, m.soir_plat]) {
        if (!id || !m.date) continue;
        const precedent = vu.get(id);
        if (!precedent || m.date > precedent) vu.set(id, m.date);
      }
    }
    return vu;
  }

  /* Combien de jours depuis la dernière fois — `Infinity` si jamais mangé,
     ce qui le fait naturellement passer en tête.
     Une valeur NÉGATIVE est normale et voulue : le plat est déjà PRÉVU plus tard
     dans la semaine. C'est une raison encore plus forte de ne pas le reproposer,
     et le tri décroissant l'envoie tout au fond. */
  const anciennete = (vu, id, aujourdhui) => {
    const d = vu.get(Number(id));
    if (!d) return Infinity;
    return Math.round((new Date(aujourdhui) - new Date(d)) / 86400000);
  };

  /* Départage stable mais NON alphabétique.
     Sans lui, quand tous les plats sont à égalité — le cas au démarrage, où rien
     n'a encore été mangé — la proposition suivait l'ordre du dictionnaire :
     « baggels, barbecue, burger, butter… ». Exact, et pourtant ça ressemble à
     une liste non réfléchie.
     Le mélange dérive de la SEMAINE : la même semaine redonne toujours la même
     proposition (on peut la relancer sans surprise), deux semaines différentes
     n'en donnent pas la même. */
  const melange = (graine, id) => {
    let h = 2166136261;
    const s = String(graine) + ':' + id;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  };

  /* Compose une proposition pour les repas VIDES de la semaine.
     `moment` : 'soir' (défaut) ou 'midi'. */
  /* ⚠️ `Infinity - Infinity` vaut `NaN`, et un comparateur qui renvoie NaN rend
     le tri imprévisible — c'est ce qui donnait une proposition par ordre
     alphabétique. Comparer, ne pas soustraire. */
  const cmp = (a, b) => (a === b ? 0 : a > b ? 1 : -1);

  function proposer({ semaine, moment = 'soir', repos = 21, maxNouveautes = 3, variante = 0 } = {}) {
    const lignes = donnees.lireMenu(semaine);
    if (!lignes.length) return { proposition: [], raison: 'Semaine introuvable.' };

    const plats = donnees.listePlatsAdmin();
    if (plats.length < 3) return { proposition: [], raison: 'Trop peu de plats en bibliothèque.' };

    const vu = derniereFois();
    const aujourdhui = new Date();

    /* Ordre de préférence, et chaque critère répond à une objection concrète :
       1. avoir une RECETTE — un plat sans étapes ni ingrédients ne donne rien à
          cuisiner ni à mettre sur la liste de courses ;
       2. le moins récemment mangé — c'est le cœur du sujet ;
       3. avoir des ingrédients, puis une photo — la liste de courses fonctionne
          et la vignette est jolie sur le mur ;
       4. un mélange stable propre à la semaine, plutôt que l'ordre alphabétique. */
    /* `variante` permet de redemander « une autre idée » sans rendre la fonction
       imprévisible : chaque variante est elle-même reproductible. */
    const graine = `${(lignes[0] && lignes[0].date) || 'defaut'}#${Number(variante) || 0}`;
    const candidats = plats
      .map((p) => ({
        id: p.id, nom: p.nom, categorie: p.categorie || '',
        aIngredients: !!String(p.ingredients || '').trim(),
        aRecette: !!String(p.etapes || '').trim(),
        aPhoto: !!String(p.photo || '').trim(),
        jours: anciennete(vu, p.id, aujourdhui),
        rang: melange(graine, p.id),
      }))
      .sort((a, b) => cmp(b.aRecette, a.aRecette)
        || cmp(b.jours, a.jours)
        || cmp(b.aIngredients, a.aIngredients)
        || cmp(b.aPhoto, a.aPhoto)
        || cmp(a.rang, b.rang));

    const proposition = [];
    const utilises = new Set();
    let categoriePrecedente = '';
    let nouveautes = 0;

    for (const ligne of lignes) {
      /* On ne touche JAMAIS à un repas déjà décidé. */
      if (String(ligne[moment] || '').trim()) continue;

      const libre = (c) => !utilises.has(c.id);
      /* ⚠️ Une semaine de sept plats jamais essayés n'est pas un menu, c'est un
         défi. On plafonne la découverte : quelques nouveautés, le reste sur des
         valeurs sûres qu'on a simplement laissé reposer. */
      const dispo = (c) => libre(c) && (c.jours !== Infinity || nouveautes < maxNouveautes);

      const choix = candidats.find((c) => dispo(c)
        && c.jours >= repos                                   // laissé reposer assez longtemps
        && !(c.categorie && c.categorie === categoriePrecedente))
        || candidats.find((c) => dispo(c) && c.jours >= repos)
        /* Repli : si les contraintes ne laissent plus rien, on relâche plutôt que
           de rendre une semaine à trous. Une proposition perfectible vaut mieux
           qu'une proposition incomplète. */
        || candidats.find(libre);

      if (!choix) break;
      utilises.add(choix.id);
      if (choix.jours === Infinity) nouveautes++;
      categoriePrecedente = choix.categorie;
      proposition.push({
        id: ligne.id, jour: ligne.jour, date: ligne.date,
        platId: choix.id, plat: choix.nom,
        raison: choix.jours === Infinity ? 'jamais essayé'
          : choix.jours > 400 ? 'pas mangé depuis longtemps'
            : `pas mangé depuis ${choix.jours} jours`,
      });
    }

    return {
      proposition,
      moment,
      vides: lignes.filter((l) => !String(l[moment] || '').trim()).length,
      bibliotheque: plats.length,
    };
  }

  /* Applique une proposition. UNE écriture par jour, mais une seule diffusion —
     l'appelant s'en charge, sinon l'écran mural se rechargerait sept fois. */
  function appliquer(choix) {
    let poses = 0;
    for (const c of choix || []) {
      if (!c || !c.id || !c.plat) continue;
      donnees.definirMenu(c.id, { [c.moment || 'soir']: c.plat });
      poses++;
    }
    return { poses };
  }

  return { proposer, appliquer, JOURS };
}

module.exports = { creerMenu };
