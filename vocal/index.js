/* Assistant vocal du foyer.

   Une phrase entre, une phrase sort. C'est tout ce que Siri — ou plus tard un
   micro branché sur le Mac mini — a besoin de savoir :
       POST /api/vocal  { "texte": "ajoute du lait aux courses" }
    →  { "reponse": "C'est noté, lait est sur la liste." }

   ── Trois règles de conception, dans l'ordre d'importance ──────────────────

   1. LE MODÈLE N'ÉCRIT JAMAIS EN BASE. Il renvoie une ACTION structurée, choisie
      dans une liste fermée ; c'est le serveur qui l'exécute, après validation.
      Même principe que les recettes et les courses depuis le menu : la machine
      propose, le code décide. Une action inconnue ne fait rien.

   2. AUCUNE DESTRUCTION PAR LA VOIX. Pas de « vide la liste », pas de
      « supprime ». Une reconnaissance vocale se trompe, et ce projet a déjà payé
      deux fois le prix d'une opération de masse (`/api/course/vider` sur les
      vraies courses, une journée de planning recopiée en double). Cocher un
      article est réversible d'un doigt : c'est autorisé. Effacer ne l'est pas.

   3. LA PERSONNE VIENT DU JETON, pas de la phrase. « Dis à Martial de sortir la
      poubelle » assigne bien la tâche à Martial, mais l'AUTEUR reste le
      téléphone qui a parlé. On ne se fait pas passer pour quelqu'un d'autre en
      le disant à voix haute. */
const regles = require('./regles');
const perso = require('./personnalite');

const ACTIONS = [
  'ajouter_course', 'cocher_course', 'ajouter_tache', 'ajouter_postit',
  'definir_menu', 'notifier', 'repondre', 'incompris',
];

/* Structured outputs : `additionalProperties:false` et un `required` COMPLET
   sont obligatoires. D'où les champs inutilisés renvoyés à vide plutôt
   qu'absents — c'est la forme imposée, pas une maladresse. */
const SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ACTIONS, description: "L'action à exécuter, ou « repondre » pour une simple question, ou « incompris »" },
    article: { type: 'string', description: 'Article de courses, sans article partitif : « lait », pas « du lait »' },
    rayon: { type: 'string', description: 'Rayon du magasin, ou vide' },
    tache: { type: 'string', description: 'Intitulé de la tâche' },
    pour: { type: 'string', description: 'Prénom du destinataire, pris dans la liste du foyer, ou vide' },
    echeance: { type: 'string', description: 'Date au format AAAA-MM-JJ, ou vide' },
    message: { type: 'string', description: 'Texte du post-it' },
    titre: { type: 'string', description: 'Titre de la notification' },
    jour: { type: 'string', description: 'Lun, Mar, Mer, Jeu, Ven, Sam ou Dim' },
    moment: { type: 'string', enum: ['midi', 'soir', ''], description: 'Moment du repas' },
    plat: { type: 'string', description: 'Nom du plat' },
    reponse: { type: 'string', description: 'La phrase à DIRE à voix haute. Une seule phrase, courte, sans emoji ni mise en forme.' },
  },
  required: ['action', 'article', 'rayon', 'tache', 'pour', 'echeance', 'message', 'titre', 'jour', 'moment', 'plat', 'reponse'],
  additionalProperties: false,
};

const JOURS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const JOURS_LONGS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const jourCourt = () => JOURS[(new Date().getDay() + 6) % 7];

/* Météo : aujourd'hui, les prochaines heures, et les jours suivants — exactement
   ce que l'écran affiche. Sans les jours suivants, une question sur demain
   recevait « la météo n'est pas disponible », ce qui est faux et déroutant
   quand la prévision est visible à l'écran. */
function meteoLignes(m, maintenant) {
  if (!m || m.temp == null) return ['Météo indisponible.'];
  const out = [`Météo à ${m.ville} aujourd'hui : ${m.temp} degrés, ${m.texte}, de ${m.min} à ${m.max}.`];
  if ((m.heures || []).length)
    out.push(`Prochaines heures : ${m.heures.map((h) => `${h.h} ${h.t} degrés`).join(', ')}.`);
  if ((m.jours || []).length) {
    const nom = (iso, i) => {
      const x = new Date(iso + 'T12:00:00');
      return i === 0 ? 'demain' : JOURS_LONGS[x.getDay()];
    };
    out.push('Prévisions : ' + m.jours.map((j, i) =>
      `${nom(j.date, i)} ${j.date} de ${j.min} à ${j.max} degrés`).join(' ; ') + '.');
  } else {
    out.push('Pas de prévision au-delà d’aujourd’hui.');
  }
  return out;
}

/* ------------------------------------------------------------------ contexte
   Un instantané COMPACT de la maison. Il tient en quelques centaines de mots
   exprès : c'est ce qui permet de répondre à « qu'est-ce qu'on mange ce soir »
   en un seul appel, sans aller-retour, donc sans silence au milieu. */
function contexte(donnees, extras = {}) {
  const menu = donnees.lireMenu();
  const aujourdhui = menu.find((m) => (m.jour || '').startsWith(jourCourt())) || {};
  const courses = donnees.lireCourses().filter((c) => !c.pris);
  const taches = donnees.lireTaches().filter((t) => !t.done);
  const postits = donnees.lirePostits();
  const gens = donnees.lirePersonnes();
  const plannings = donnees.lirePlannings();

  const d = new Date();
  const jourISO = d.toISOString().slice(0, 10);
  /* ⚠️ L'agenda ne contenait QUE la journée en cours. « J'ai quoi demain ? »
     restait donc sans réponse alors que l'information était là — et l'assistant
     répondait « rien de prévu », ce qui est pire qu'un aveu d'ignorance.
     On donne maintenant HUIT jours, groupés par date, en incluant les
     événements sur plusieurs jours qui couvrent la journée (un déplacement au
     Touquet du vendredi au dimanche concerne bien le samedi). */
  const jourDe = (iso) => {
    const x = new Date(iso + 'T12:00:00');
    return `${JOURS_LONGS[x.getDay()]} ${x.getDate()} ${MOIS[x.getMonth()]}`;
  };
  /* ⚠️ On utilise `jour` / `heure`, publiés par le serveur en heure LOCALE.
     Découper la chaîne ISO (`slice(0,10)` ou `slice(11,16)`) lit l'UTC : un
     rendez-vous à 17 h Paris ressortait à 15 h, et un événement de fin de soirée
     changeait de jour. `jour` n'existe pas sur les vieux enregistrements en
     cache, d'où le repli. */
  const jourLocal = (iso) => {
    const x = new Date(iso);
    return isNaN(x) ? String(iso).slice(0, 10)
      : `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  };
  const debutDe = (e) => e.jour || jourLocal(e.start);
  const finDe = (e) => e.jourFin || (e.fin ? jourLocal(e.fin) : '');

  const couvre = (e, iso) => {
    const debut = debutDe(e);
    if (!e.fin) return debut === iso;
    let fin = finDe(e);
    /* DTEND d'une journée entière est exclusif : le dernier jour est la veille. */
    if (e.journee && fin > debut) {
      const f = new Date(fin + 'T12:00:00'); f.setDate(f.getDate() - 1);
      fin = `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`;
    }
    return iso >= debut && iso <= fin;
  };

  const agendaJours = [];
  for (let i = 0; i < 8; i++) {
    const x = new Date(d); x.setDate(x.getDate() + i);
    const iso = `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    const evs = (extras.agenda || []).filter((e) => couvre(e, iso)).slice(0, 8)
      .map((e) => {
        const h = e.journee ? 'journée'
          : (e.heure || '') + (e.heureFin && e.heureFin !== e.heure ? `-${e.heureFin}` : '');
        return `${h || 'journée'} ${e.summary}${e.lieu ? ' à ' + e.lieu : ''}`;
      });
    const quand = i === 0 ? "aujourd'hui" : i === 1 ? 'demain' : jourDe(iso);
    agendaJours.push(`${quand} (${iso}) : ${evs.join(' ; ') || 'rien'}`);
  }

  /* Emploi du temps des enfants sur toute la semaine, pas seulement aujourd'hui. */
  const creneaux = [];
  for (const p of plannings.personnes || [])
    for (const j of ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'])
      for (const c of (p.semaine && p.semaine[j]) || [])
        creneaux.push(`${j} ${p.nom} ${c.h || ''}-${c.fin || ''} ${c.quoi}${c.ou ? ' (' + c.ou + ')' : ''}`);

  return [
    `Date : ${d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}, il est ${String(d.getHours()).padStart(2, '0')}h${String(d.getMinutes()).padStart(2, '0')}.`,
    `Foyer : ${gens.map((p) => p.nom).join(', ')}.`,
    `Repas d'aujourd'hui — midi : ${aujourdhui.midi || 'non défini'} ; soir : ${aujourdhui.soir || 'non défini'}.`,
    `Menu de la semaine : ${menu.map((m) => `${m.jour} soir ${m.soir || '—'}`).join(' | ')}.`,
    `Courses restantes (${courses.length}) : ${courses.map((c) => c.article).join(', ') || 'aucune'}.`,
    `Tâches en cours (${taches.length}) : ${taches.map((t) => `${t.tache}${t.who ? ' pour ' + t.who : ''}${t.due ? ' avant le ' + t.due : ''}`).join(' ; ') || 'aucune'}.`,
    `Post-it : ${postits.map((p) => `${p.message} (${p.who})`).join(' ; ') || 'aucun'}.`,
    `Agenda des huit prochains jours :\n  ${agendaJours.join('\n  ')}`,
    `Emploi du temps des enfants (semaine type) : ${creneaux.join(' ; ') || 'rien'}.`,
    /* ⚠️ Seule la météo du JOUR était transmise : « quel temps fera-t-il demain ? »
       recevait « la météo n'est pas disponible » alors que la prévision était
       affichée sur l'écran juste à côté. On donne maintenant les prochaines
       heures et les jours suivants, tels que l'écran les reçoit. */
    ...meteoLignes(extras.meteo, d),
    /* Qui est à la maison — sans ça, « on sera combien à table samedi ? » restait
       sans réponse alors que l'information existe. */
    ...(extras.presence ? [
      `Qui est à la maison aujourd'hui : ${extras.presence.jour.presents.join(', ')} `
      + `(${extras.presence.jour.couverts} à table, ${extras.presence.jour.type}).`,
      `Les jours qui viennent : ${extras.presence.jours.map((p) =>
        `${p.date} ${p.jourNom} ${p.couverts} à table (${p.presents.join('/')})`).join(' | ')}.`,
    ] : []),
    `Rayons possibles : Frais, Épicerie, Fruits & légumes, Boissons, Surgelés, Maison / hygiène, Autre.`,
  ].join('\n');
}

const CONSIGNE = `Tu es l'assistant vocal d'une maison familiale française. Tu réponds À VOIX HAUTE : une seule phrase, courte, naturelle, sans emoji, sans liste, sans mise en forme.

Tu reçois l'état de la maison, puis une phrase dictée (la transcription peut contenir des fautes : interprète l'intention).

Choisis UNE action :
- ajouter_course : ajouter un article à la liste de courses.
- cocher_course : marquer un article comme pris (« j'ai pris le lait »).
- ajouter_tache : une chose à faire, éventuellement pour quelqu'un et avec une échéance.
- ajouter_postit : un mot laissé à la famille.
- definir_menu : fixer le plat d'un midi ou d'un soir.
- notifier : prévenir la famille tout de suite (« préviens tout le monde que… »).
- repondre : la phrase est une QUESTION. Réponds avec l'état de la maison fourni. N'invente rien : si l'information n'y est pas, dis-le simplement.
- incompris : tu n'as pas compris, ou on te demande d'effacer/vider quelque chose.

DIRE LES HEURES
Tu es lu à voix haute : les heures doivent s'énoncer comme on les dit, en toutes lettres, au format 24 heures.
- 08:00 → « huit heures » · 12:00 → « midi » · 00:00 → « minuit »
- 15:00 → « quinze heures » · 17:15 → « dix-sept heures quinze »
- 14:30 → « quatorze heures trente » · 18:45 → « dix-huit heures quarante-cinq »
- Une plage : « de huit heures à midi », « de quatorze heures à quinze heures trente ».
- N'écris JAMAIS un nombre seul sans « heures » : « trois de l'après-midi » ou « à trois » sont fautifs.
  Si tu emploies la forme familière, elle doit être complète : « trois heures de l'après-midi ».
- Pas de « h » ni de chiffres : ni « 15h », ni « 15 h 00 », ni « 15:00 ».
- Même règle pour les températures et les quantités : en toutes lettres, avec l'unité.

Règles fermes :
- Tu ne peux RIEN supprimer ni vider. Si on te le demande, action « incompris » et invite à le faire sur l'écran.
- Une seule action par phrase. Si on en demande plusieurs, traite la première et signale-le dans la réponse.
- « pour » doit être un prénom du foyer, sinon laisse vide.
- Les champs inutilisés restent des chaînes vides.
- La réponse confirme ce qui a été fait, brièvement et au passé : « C'est noté, le lait est sur la liste. »`;

/* ------------------------------------------------------------------ compréhension */
async function comprendre(texte, { donnees, recettes, extras, modele, style, appellation, interlocuteur, roleInterlocuteur, humour }) {
  /* Chemin rapide d'abord : les tournures sans ambiguïté n'ont pas besoin d'un
     appel réseau. Voir vocal/regles.js. */
  const vite = regles.comprendre(texte);
  if (vite) return vite;

  if (!recettes.ia.disponible()) {
    return {
      action: 'incompris', source: 'sans-ia',
      reponse: "Je n'ai pas compris. Sans clé d'intelligence artificielle je ne "
        + 'reconnais que « ajoute quelque chose aux courses » et « laisse un mot ».',
    };
  }

  /* Même appel structuré que les recettes (`recettes/ia.js`) : mêmes replis, y
     compris celui qui saute `effort` pour les modèles qui le refusent — Haiku
     4.5 le rejette avec un 400, et c'est justement le modèle qu'on veut pouvoir
     choisir ici pour la vitesse. Mutualisé plutôt que recopié : deux copies de
     cette mécanique auraient divergé au premier correctif. */
  const modeleUtilise = modele || recettes.ia.MODELE;
  const rep = await recettes.ia.appelStructure({
    modele: modeleUtilise,
    /* La personnalité s'AJOUTE à la consigne métier, elle ne la remplace pas :
       la liste fermée d'actions et l'interdiction de détruire restent en tête. */
    systeme: CONSIGNE + perso.consigne(style, { appellation, interlocuteur, roleInterlocuteur, humour }),
    messages: [{ role: 'user', content: `État de la maison :\n${contexte(donnees, extras)}\n\nPhrase dictée : « ${texte} »` }],
    schema: SCHEMA,
    /* effort bas : à l'oral la latence compte plus que la finesse, la tâche est
       un simple aiguillage. On garde la pensée adaptative plutôt que de la
       couper — la couper sur Opus 5 amène d'autres ennuis. */
    effort: 'low',
    /* Marge large : la pensée adaptative compte dans max_tokens. Une réponse
       tronquée ne donne pas une phrase courte, elle donne un JSON invalide. */
    maxTokens: 4000,
  });

  /* Testé AVANT de lire le contenu : sur un refus, `content` peut être vide. */
  if (rep.stop_reason === 'refusal')
    return { action: 'incompris', source: 'refus', reponse: "Je préfère ne pas répondre à ça." };
  if (rep.stop_reason === 'max_tokens')
    return { action: 'incompris', source: 'tronque', reponse: "Je n'ai pas réussi à formuler ma réponse. Redis-le plus simplement." };

  const bloc = (rep.content || []).find((b) => b.type === 'text');
  if (!bloc || !bloc.text) return { action: 'incompris', source: 'vide', reponse: "Je n'ai rien compris." };

  let brut;
  try { brut = JSON.parse(bloc.text); }
  catch (_) { return { action: 'incompris', source: 'illisible', reponse: "Je n'ai pas compris." }; }

  if (!ACTIONS.includes(brut.action)) brut.action = 'incompris';
  return { ...brut, source: 'ia', modele: modeleUtilise };
}

/* ------------------------------------------------------------------ exécution
   Ce que le serveur fait VRAIMENT. Chaque branche valide ses entrées : le
   modèle a beau être contraint par un schéma, il reste une entrée non fiable. */
function executer(intention, { donnees, personne, style, appellation, roleInterlocuteur }) {
  const dire = (t) => ({ reponse: t, fait: true });
  const rate = (t) => ({ reponse: t, fait: false });
  /* Les phrases du chemin rapide passent par la même personnalité que celles du
     modèle : sinon l'assistant change de voix selon la tournure employée, et ça
     s'entend tout de suite. */
  const dit = (cle, article) => perso.phrase(style, cle, { article, appellation, roleInterlocuteur });

  switch (intention.action) {
    case 'ajouter_course': {
      const article = String(intention.article || '').trim();
      if (!article) return rate("Je n'ai pas saisi quoi ajouter.");
      const deja = donnees.lireCourses().find((c) => donnees.clef(c.article) === donnees.clef(article));
      if (deja) return dire(dit('courseDeja', article));
      donnees.ajouterCourse({ article, rayon: intention.rayon || null, who: personne });
      return dire(intention.reponse || dit('course', article));
    }

    case 'cocher_course': {
      const cible = String(intention.article || '').trim();
      if (!cible) return rate("Je n'ai pas saisi quel article.");
      const k = donnees.clef(cible);
      const trouve = donnees.lireCourses().find((c) => donnees.clef(c.article) === k)
        || donnees.lireCourses().find((c) => donnees.clef(c.article).includes(k));
      if (!trouve) return rate(`Je ne trouve pas ${cible} sur la liste.`);
      if (trouve.pris) return dire(`${trouve.article} était déjà coché.`);
      donnees.cocherCourse(trouve.id, true);
      return dire(intention.reponse || `${trouve.article} est coché.`);
    }

    case 'ajouter_tache': {
      const tache = String(intention.tache || '').trim();
      if (!tache) return rate("Je n'ai pas saisi la tâche.");
      /* Le destinataire doit exister : une tâche assignée à un prénom inventé
         n'apparaîtrait sur le filtre de personne. */
      const gens = donnees.lirePersonnes().map((p) => p.nom);
      const pour = gens.find((n) => donnees.clef(n) === donnees.clef(intention.pour)) || null;
      const echeance = /^\d{4}-\d{2}-\d{2}$/.test(intention.echeance || '') ? intention.echeance : null;
      donnees.ajouterTache({ tache, who: pour, due: echeance });
      return dire(intention.reponse || `C'est noté${pour ? ' pour ' + pour : ''}.`);
    }

    case 'ajouter_postit': {
      const message = String(intention.message || '').trim();
      if (!message) return rate("Je n'ai pas saisi le message.");
      donnees.ajouterPostit({ message, who: personne });
      return dire(intention.reponse || dit('postit'));
    }

    case 'definir_menu': {
      const jour = JOURS.find((j) => donnees.clef(j) === donnees.clef(String(intention.jour || '').slice(0, 3)));
      const moment = intention.moment === 'midi' ? 'midi' : 'soir';
      const plat = String(intention.plat || '').trim();
      if (!jour || !plat) return rate("Je n'ai pas saisi quel jour ni quel plat.");
      const ligne = donnees.lireMenu().find((m) => (m.jour || '').startsWith(jour));
      if (!ligne) return rate('Je ne trouve pas ce jour dans la semaine.');
      donnees.definirMenu(ligne.id, { [moment]: plat });
      return dire(intention.reponse || `${jour} ${moment}, ce sera ${plat}.`);
    }

    case 'notifier': {
      const titre = String(intention.titre || intention.message || '').trim();
      if (!titre) return rate("Je n'ai pas saisi quoi annoncer.");
      const gens = donnees.lirePersonnes().map((p) => p.nom);
      const pour = gens.find((n) => donnees.clef(n) === donnees.clef(intention.pour)) || null;
      donnees.ajouterNotif({ titre, message: intention.message || '', pour, de: personne, niveau: 'info' });
      return dire(intention.reponse || 'Tout le monde est prévenu.');
    }

    case 'repondre':
      return { reponse: intention.reponse || "Je n'ai pas trouvé l'information.", fait: false };

    default:
      return rate(intention.reponse || dit('incompris'));
  }
}

module.exports = { comprendre, executer, contexte, ACTIONS, SCHEMA, CONSIGNE };
