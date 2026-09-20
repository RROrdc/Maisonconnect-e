/* Rappels quotidiens.

   Ce qui manquait : une tâche porte une échéance depuis le début du projet, et
   RIEN n'a jamais prévenu personne. Une échéance qui n'alerte pas est une
   décoration.

   Trois principes :

   1. **UNE FOIS PAR JOUR, PAS PLUS.** Le passage est enregistré dans `reglages`
      (`dernier_rappel`). Un serveur relancé cinq fois dans la matinée ne doit pas
      envoyer cinq fois la même chose — c'est le meilleur moyen de faire ignorer
      les notifications.

   2. **RATTRAPAGE.** Si le serveur était éteint à l'heure dite, le rappel part au
      démarrage suivant. Sur un PC de bureau allumé à des heures variables, un
      rappel qui ne se déclenche qu'à 8 h pile ne se déclencherait jamais.

   3. **ADRESSÉ À LA BONNE PERSONNE.** Une tâche assignée part vers SON téléphone
      (`pour`), une tâche sans destinataire part à tout le monde. L'écran mural,
      lui, affiche tout : c'est le tableau commun. */

const JOURS_LONGS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

/* Comparer deux emplois du temps est un CALCUL, pas une source : ce module ne
   lit rien et ne connaît ni EcoleDirecte ni Pronote. C'est pourquoi il est
   requis directement là où les devoirs, eux, sont injectés — un espace scolaire
   fâché ne doit pas empêcher les anniversaires de partir. */
const mouvements = require('./ecole/mouvements');

function creerRappels({ donnees, config, annoncer }) {
  const aujourdhui = () => donnees.ymd(new Date());

  /* 🔑 `annoncer` est OBLIGATOIRE, et on le vérifie ici plutôt que de se replier
     en silence sur l'écriture seule. C'est exactement le défaut qu'on répare :
     une notification qui s'écrit sans être poussée ne se remarque pas — elle
     ressemble à un téléphone qui n'a rien reçu, et on cherche la panne du côté
     du téléphone. Mieux vaut un serveur qui refuse de démarrer qu'un rappel
     muet pendant une semaine. */
  if (typeof annoncer !== 'function') {
    throw new Error('creerRappels : `annoncer` manquant — les rappels ne seraient ni diffusés ni poussés.');
  }

  /* LA SEULE porte de sortie des notifications de ce module. Écrit, diffuse et
     pousse (voir `annoncer` dans server.js). Tous les rappels passent par ici :
     avant le 20/09, six d'entre eux appelaient `ajouterNotif` directement et
     n'étaient donc NI diffusés en direct NI poussés sur les téléphones — un
     message de l'établissement ou un cours annulé n'existait que pour qui
     pensait à ouvrir l'onglet Notifications. */
  function prevenir({ titre, message, pour, niveau, de }) {
    return annoncer({ titre, message: message || '', pour: pour || null,
      de: de || 'Maison', niveau: niveau || 'info' });
  }

  /* ---------------------------------------------------------------- anniversaires */
  function anniversaires() {
    const envoyes = [];
    const jours = Math.max(0, Number(config('rappels_anniversaire_jours')) || 7);

    for (const a of donnees.anniversairesDans(0)) {
      const age = a.age != null ? ` — ${a.age} ans` : '';
      envoyes.push(prevenir({
        titre: `🎂 Aujourd'hui, anniversaire de ${a.nom}${age}`,
        message: a.foyer ? '' : (a.relation || ''),
        niveau: 'important',
      }));
    }

    /* Le rappel anticipé n'a d'intérêt que s'il laisse le temps d'agir : c'est
       tout le sujet du cadeau. */
    if (jours > 0) {
      for (const a of donnees.anniversairesDans(jours)) {
        const age = a.age != null ? ` (${a.age} ans)` : '';
        envoyes.push(prevenir({
          titre: `🎁 Dans ${jours} jours : anniversaire de ${a.nom}${age}`,
          message: 'De quoi prévoir le cadeau.',
          niveau: 'info',
        }));
      }
    }
    return envoyes;
  }

  /* ---------------------------------------------------------------- échéances */
  function echeances() {
    const taches = donnees.tachesAEcheance();
    if (!taches.length) return [];

    /* Groupées par personne : trois notifications pour trois tâches d'une même
       personne, c'est trois fois plus de chances d'être ignoré. */
    const par = new Map();
    for (const t of taches) {
      const cle = t.who || '';
      if (!par.has(cle)) par.set(cle, []);
      par.get(cle).push(t);
    }

    const envoyes = [];
    for (const [personne, liste] of par) {
      const retard = liste.filter((t) => t.retard).length;
      const titre = liste.length === 1
        ? `⏰ ${liste[0].tache}`
        : `⏰ ${liste.length} choses à faire${personne ? ' pour ' + personne : ''}`;
      const detail = liste.map((t) => t.tache + (t.retard ? ' (en retard)' : '')).join(' · ');
      envoyes.push(prevenir({
        titre,
        message: liste.length === 1 ? (liste[0].retard ? 'En retard.' : "Pour aujourd'hui.") : detail,
        /* Sans destinataire, la tâche concerne le foyer : `pour = null` fait que
           l'app de CHACUN l'affiche, et l'écran mural aussi. */
        pour: personne || null,
        niveau: retard ? 'important' : 'info',
      }));
    }
    return envoyes;
  }

  /* ---------------------------------------------------------------- devoirs
     🕐 SA PROPRE HEURE, et c'est tout l'intérêt. Les rappels de tâches partent
     à 8 h ; un rappel de devoirs à 8 h ne sert à rien, l'enfant part au collège.
     On veut le SOIR, quand il peut encore s'y mettre — d'où une passe séparée,
     avec son heure (`ecole_rappel_heure`, 18 h) et sa propre trace du dernier
     passage. Les deux passes partagent le même minuteur de 15 min : c'est
     l'heure qui décide, jamais le minuteur (§ 2 nonies).

     ⚠️ La source des devoirs est INJECTÉE (`lireDevoirs`), comme `devinerRayon` :
     ce fichier n'a pas à connaître EcoleDirecte ni Pronote, et un espace
     scolaire fâché ne doit pas empêcher les anniversaires de partir. */
  async function devoirs(lireDevoirs) {
    if (typeof lireDevoirs !== 'function') return [];
    let liste = [];
    try { liste = (await lireDevoirs()) || []; }
    catch (e) { donnees.journaliser('alerte', 'rappels', 'Devoirs non lus : ' + e.message); return []; }

    /* Groupés PAR ENFANT : c'est lui qu'on prévient, sur SON téléphone. Trois
       notifications pour trois devoirs, c'est trois fois plus de chances d'être
       ignoré — même raisonnement que pour les échéances de tâches. */
    const par = new Map();
    for (const d of liste) {
      if (d.fait) continue;                    // déjà fait : rien à rappeler
      if (!par.has(d.eleve)) par.set(d.eleve, []);
      par.get(d.eleve).push(d);
    }

    const envoyes = [];
    for (const [eleve, siens] of par) {
      const matieres = [...new Set(siens.map((d) => d.matiere).filter((m) => m && m !== 'Matière non désignée'))];
      const titre = siens.length === 1
        ? '📚 ' + (matieres[0] ? matieres[0] + ' — ' : '') + 'un devoir pour demain'
        : '📚 ' + siens.length + ' devoirs pour demain';
      envoyes.push(prevenir({
        titre,
        message: siens.map((d) => (d.matiere && d.matiere !== 'Matière non désignée' ? d.matiere + ' : ' : '')
          /* 🐞 La classe d'espaces avait perdu son antislash — un heredoc l'avait
             mangé (piège déjà payé quatre fois). La regex restait VALIDE et
             remplaçait chaque « s » du devoir par une espace : « Faire les
             exercices » devenait « Faire le exercice ». Trouvé le 17/09 en
             relisant ce fichier pour autre chose ; un contrôle le cherche
             désormais dans tout le projet (série `pages`). */
          + String(d.contenu || '').replace(/\s+/g, ' ').slice(0, 90)).join(' · '),
        /* 🔒 Adressé à L'ENFANT, jamais au foyer : ses devoirs ne sont pas une
           information de famille, et `pour = null` les afficherait chez tout le
           monde — écran mural compris, devant les invités (§ 2 vicies). */
        pour: eleve,
        niveau: 'info',
      }));
    }
    return envoyes;
  }

  /* ---------------------------------------------------------------- rangement
     Les articles arrivés d'une recette n'ont pas de rayon, et une liste non
     rangée se parcourt mal en magasin. On ne touche QUE les rayons vides —
     jamais un choix fait à la main. */
  function rangerCourses(devinerRayon, rayonsConnus) {
    if (typeof devinerRayon !== 'function') return 0;
    let ranges = 0;
    for (const c of donnees.lireCourses()) {
      if (String(c.rayon || '').trim()) continue;
      const devine = devinerRayon(c.article, rayonsConnus);
      if (!devine) continue;
      donnees.definirRayon(c.id, devine);
      ranges++;
    }
    return ranges;
  }

  /* ---------------------------------------------------------------- passage */
  function passer({ force = false, devinerRayon = null, rayonsConnus = null } = {}) {
    const jour = aujourdhui();
    if (!force && donnees.reglage('dernier_rappel', '') === jour) return { saute: 'déjà passé aujourd’hui' };

    const heure = Number(config('rappels_heure'));
    if (!force && Number.isFinite(heure) && new Date().getHours() < heure)
      return { saute: `avant ${heure} h` };

    const bilan = { jour, anniversaires: 0, echeances: 0, ranges: 0 };
    try {
      bilan.anniversaires = anniversaires().length;
      bilan.echeances = echeances().length;
      bilan.ranges = rangerCourses(devinerRayon, rayonsConnus);
      donnees.ecrireReglages({ dernier_rappel: jour });

      const quoi = [
        bilan.anniversaires ? `${bilan.anniversaires} anniversaire(s)` : '',
        bilan.echeances ? `${bilan.echeances} rappel(s) d'échéance` : '',
        bilan.ranges ? `${bilan.ranges} article(s) rangé(s)` : '',
      ].filter(Boolean).join(', ') || 'rien à signaler';
      donnees.journaliser('info', 'rappels', `Passage du ${JOURS_LONGS[new Date().getDay()]} : ${quoi}`);
    } catch (e) {
      donnees.journaliser('erreur', 'rappels', 'Passage interrompu : ' + e.message, e.stack);
      bilan.erreur = e.message;
    }
    return bilan;
  }

  /* ------------------------------------------------------- passage des devoirs */
  async function passerDevoirs({ force = false, lireDevoirs = null } = {}) {
    if (typeof lireDevoirs !== 'function') return { saute: 'aucune source de devoirs' };
    const jour = aujourdhui();
    if (!force && donnees.reglage('dernier_rappel_devoirs', '') === jour) return { saute: 'déjà passé aujourd’hui' };
    const heure = Number(config('ecole_rappel_heure'));
    if (!force && Number.isFinite(heure) && new Date().getHours() < heure) return { saute: 'avant ' + heure + ' h' };

    const bilan = { jour, devoirs: 0 };
    try {
      bilan.devoirs = (await devoirs(lireDevoirs)).length;
      /* La trace est écrite MÊME si rien n'est parti : sinon on réinterrogerait
         les espaces scolaires toutes les 15 min jusqu'à minuit. */
      donnees.ecrireReglages({ dernier_rappel_devoirs: jour });
      donnees.journaliser('info', 'rappels',
        'Devoirs du soir : ' + (bilan.devoirs ? bilan.devoirs + ' enfant(s) prévenu(s)' : 'rien à rappeler'));
    } catch (e) {
      donnees.journaliser('erreur', 'rappels', 'Rappel des devoirs interrompu : ' + e.message, e.stack);
      bilan.erreur = e.message;
    }
    return bilan;
  }

  /* ── Vie scolaire : absence, retard, dispense ──────────────────────────────
     Contrairement aux devoirs, ce n'est PAS lié à une heure : une absence non
     justifiée doit se savoir tout de suite, pas à dix-huit heures. On regarde
     donc à chaque passage, et on ne signale que ce qui est NOUVEAU.

     On garde la trace des entrées déjà annoncées, sinon la même absence
     repartirait toutes les quinze minutes — le meilleur moyen de faire ignorer
     les notifications (§ 2 nonies).

     `pour: null` : ça part sur l'écran mural ET sur tous les téléphones. C'est
     le choix de Rémi (« les deux »), et il se défend — une absence concerne les
     parents au moins autant que l'enfant. */
  const MAX_VUES = 200;

  async function passerVie({ force = false, lireVie = null } = {}) {
    if (typeof lireVie !== 'function') return { saute: 'aucune source' };
    let entrees;
    try { entrees = (await lireVie()) || []; }
    catch (e) {
      donnees.journaliser('erreur', 'rappels', 'Vie scolaire illisible : ' + e.message);
      return { erreur: e.message };
    }

    let vues;
    try { vues = JSON.parse(donnees.reglage('vie_scolaire_vues', '[]')); }
    catch { vues = []; }
    const dejaVu = new Set(Array.isArray(vues) ? vues : []);

    const neuves = entrees.filter((v) => v.cle && !dejaVu.has(v.cle));
    if (!neuves.length) return { neuves: 0 };

    /* Au TOUT PREMIER passage, tout est « nouveau » : annoncer d'un coup
       l'historique entier de l'année serait une avalanche inutile. On mémorise
       sans rien envoyer, et on n'annonce qu'à partir de la fois suivante. */
    const amorcage = !dejaVu.size;

    for (const v of neuves) {
      dejaVu.add(v.cle);
      if (amorcage || force === 'muet') continue;
      /* Même libellé que l'écran mural, et il vient du même endroit : deux
         formulations auraient fini par se contredire — la notification disant
         « absence » là où le mur dit « retard ». */
      const quoi = v.quoi || 'Vie scolaire';
      prevenir({
        titre: `🏫 ${v.eleve} — ${quoi}`,
        message: [v.date, v.motif].filter(Boolean).join(' · ') || 'Voir l’espace scolaire.',
        pour: null,
        de: 'École',
        niveau: !v.justifie && /absence|retard/i.test(v.type || '') ? 'alerte' : 'info',
      });
    }

    donnees.ecrireReglages({
      vie_scolaire_vues: JSON.stringify([...dejaVu].slice(-MAX_VUES)),
    });
    if (amorcage) {
      donnees.journaliser('info', 'rappels',
        `Vie scolaire : ${neuves.length} entrée(s) existantes mémorisées sans alerter (premier passage).`);
      return { neuves: 0, amorcage: neuves.length };
    }
    donnees.journaliser('info', 'rappels', `Vie scolaire : ${neuves.length} nouveauté(s) signalée(s).`);
    return { neuves: neuves.length };
  }

  /* ── Changements d'emploi du temps et messages de l'établissement ─────────
     Demandé par Rémi le 13/09, et c'est LA valeur des espaces scolaires :
     afficher un emploi du temps, on sait faire ; dire qu'un cours saute, non.
     Un cours annulé appris la veille au soir, c'est une matinée récupérée.

     Même patron que la vie scolaire, et pour les mêmes raisons : on ne signale
     que le NOUVEAU, et le tout premier passage mémorise sans alerter — sinon
     l'historique entier partirait d'un coup.

     ⚠️ On ne signale QUE les annulations. Un changement de salle ou de
     professeur fait du bruit pour rien : l'enfant le verra sur place, et une
     notification par modification mineure ferait ignorer les vraies. */
  async function passerEcoleNouveautes({ force = false, lireCours = null, lireMessages = null } = {}) {
    const bilan = { annules: 0, mouvements: 0, messages: 0 };

    if (typeof lireCours === 'function') {
      try {
        const cours = (await lireCours()) || [];
        let vus;
        try { vus = JSON.parse(donnees.reglage('cours_annules_vus', '[]')); } catch { vus = []; }
        const deja = new Set(Array.isArray(vus) ? vus : []);
        const amorcage = !deja.size;

        const annules = cours.filter((c) => c.annule && c.jour >= aujourdhui());
        for (const c of annules) {
          const cle = [c.eleve, c.jour, c.debut, c.matiere].join('|');
          if (deja.has(cle)) continue;
          deja.add(cle);
          if (amorcage || force === 'muet') continue;
          bilan.annules++;
          prevenir({
            titre: `🚫 ${c.eleve} — cours annulé`,
            message: [c.matiere, c.jour, c.debut && ('à ' + c.debut)].filter(Boolean).join(' · '),
            /* Tout le monde : c'est souvent un parent qui doit s'organiser. */
            pour: null, de: 'École', niveau: 'alerte',
          });
        }
        donnees.ecrireReglages({ cours_annules_vus: JSON.stringify([...deja].slice(-MAX_VUES)) });
        if (amorcage && annules.length) {
          donnees.journaliser('info', 'rappels',
            `Cours annulés : ${annules.length} mémorisé(s) sans alerter (premier passage).`);
        }

        /* ── LES MOUVEMENTS ────────────────────────────────────────────────
           Un cours DÉPLACÉ ne se voit pas venir : l'enfant arrive à l'heure
           d'hier. On compare donc la photographie de la lecture précédente à
           celle-ci (`ecole/mouvements.js`, pur et testable sans rien monter).

           Le premier passage est muet SANS avoir besoin d'un drapeau : aucune
           photographie, donc aucun jour observé en commun, donc aucune
           comparaison possible. Le garde-fou de la fenêtre glissante fait le
           travail de l'amorçage — une règle plutôt que deux.

           ⚠️ La photographie est écrite MÊME quand on n'alerte pas : sinon un
           passage muet ferait tout re-signaler au suivant. */
        let photo = null;
        try { photo = JSON.parse(donnees.reglage('cours_horaires_vus', 'null')); } catch { photo = null; }
        const bouges = mouvements.comparer(photo, cours.filter((c) => c.jour >= aujourdhui()));
        donnees.ecrireReglages({
          cours_horaires_vus: JSON.stringify(mouvements.photographier(cours.filter((c) => c.jour >= aujourdhui()))),
        });
        /* Un remaniement complet d'emploi du temps existe (rentrée, changement
           de groupe) : dix notifications à la file feraient couper les
           notifications, ce qu'on ne récupère jamais. Au-delà, un seul message
           qui renvoie à l'écran — c'est là que la grille est lisible. */
        const PLAFOND = 4;
        if (force !== 'muet' && bouges.length) {
          if (bouges.length > PLAFOND) {
            bilan.mouvements = 1;
            prevenir({
              titre: '🔄 Emploi du temps remanié',
              message: `${bouges.length} changements d’horaire. Voir les emplois du temps sur l’écran.`,
              pour: null, de: 'École', niveau: 'alerte',
            });
          } else for (const m of bouges) {
            bilan.mouvements = (bilan.mouvements || 0) + 1;
            prevenir({
              titre: `🔄 ${m.eleve} — emploi du temps modifié`,
              message: [mouvements.direMouvement(m), m.jour].filter(Boolean).join(' · '),
              /* Tout le monde : c'est souvent un parent qui doit s'organiser —
                 même raison que pour les annulations. */
              pour: null, de: 'École', niveau: 'alerte',
            });
          }
        }
      } catch (e) {
        donnees.journaliser('avert', 'rappels', 'Cours illisibles : ' + e.message);
      }
    }

    if (typeof lireMessages === 'function') {
      try {
        const messages = (await lireMessages()) || [];
        let vus;
        try { vus = JSON.parse(donnees.reglage('messages_ecole_vus', '[]')); } catch { vus = []; }
        const deja = new Set(Array.isArray(vus) ? vus : []);
        const amorcage = !deja.size;

        for (const m of messages) {
          const cle = String(m.id || (m.date + '|' + m.sujet));
          if (deja.has(cle)) continue;
          deja.add(cle);
          if (amorcage || force === 'muet') continue;
          bilan.messages++;
          prevenir({
            titre: `✉️ ${m.eleve ? m.eleve + ' — ' : ''}message de l’établissement`,
            /* Le sujet suffit : le corps peut faire deux pages, et une
               notification qu'on ne peut pas lire d'un coup d'œil est ratée. */
            message: String(m.sujet || '').slice(0, 120) || 'Voir l’espace scolaire.',
            pour: null, de: 'École', niveau: 'info',
          });
        }
        donnees.ecrireReglages({ messages_ecole_vus: JSON.stringify([...deja].slice(-MAX_VUES)) });
        if (amorcage && messages.length) {
          donnees.journaliser('info', 'rappels',
            `Messages : ${messages.length} mémorisé(s) sans alerter (premier passage).`);
        }
      } catch (e) {
        donnees.journaliser('avert', 'rappels', 'Messages illisibles : ' + e.message);
      }
    }
    return bilan;
  }

  /* ── Le repas du soir n'est pas décidé ────────────────────────────────────
     Une seule fois, en fin d'après-midi. Le but n'est pas de faire la morale :
     c'est le dernier moment où l'on peut encore passer prendre quelque chose. */
  async function passerMenu({ force = false } = {}) {
    const jour = aujourdhui();
    if (!force && donnees.reglage('dernier_rappel_menu', '') === jour) return { saute: 'déjà passé' };
    const heure = Number(config('menu_rappel_heure'));
    if (!force && Number.isFinite(heure) && new Date().getHours() < heure) return { saute: 'trop tôt' };

    donnees.ecrireReglages({ dernier_rappel_menu: jour });
    const m = (donnees.lireMenu() || []).find((x) => x.date === jour);
    /* Rien à dire si c'est déjà décidé — y compris « restaurant » ou « restes »,
       qui sont des décisions. */
    if (!m || (m.soir && String(m.soir).trim())) return { rien: true };

    prevenir({
      titre: '🍽️ Ce soir, rien n’est prévu',
      message: 'Le repas du soir n’est pas renseigné. Encore temps d’y penser.',
      pour: null, de: 'Écran', niveau: 'info',
    });
    return { envoye: true };
  }

  /* Vérifié au démarrage puis toutes les 15 min : c'est l'heure qui décide, pas
     le minuteur. Un intervalle plus court ne changerait rien, un plus long
     raterait la fenêtre sur un poste éteint tôt. */
  function planifier(options) {
    const tenter = () => {
      try { passer(options); } catch (_) { /* déjà journalisé */ }
      /* Deux passes, deux heures, un seul minuteur. */
      passerDevoirs(options).catch(() => { /* déjà journalisé */ });
      passerVie(options).catch(() => { /* déjà journalisé */ });
      passerEcoleNouveautes(options).catch(() => { /* déjà journalisé */ });
      passerMenu(options).catch(() => { /* déjà journalisé */ });
    };
    setTimeout(tenter, 20000).unref?.();
    const t = setInterval(tenter, 15 * 60 * 1000);
    t.unref?.();
    return t;
  }

  return { passer, passerDevoirs, passerVie, passerEcoleNouveautes, passerMenu,
           planifier, anniversaires, echeances, devoirs };
}

module.exports = { creerRappels };
