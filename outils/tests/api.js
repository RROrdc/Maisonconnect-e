/* Contrat de l'API — la lecture principale, les écritures, le temps réel, la
   corbeille, la barrière d'administration et la sécurité du planning.

   C'est ce jeu qui a permis d'affirmer, après la reconstruction du serveur le
   19/08, qu'il se comportait comme celui qui avait été mis en quarantaine. */
const A = require('./aide');

module.exports = async function (muet) {
  const t = A.compteur(); t.muet = muet;

  t.titre('Santé');
  const h = await A.api('/api/health');
  t.dire(h.statut === 200 && h.j.ok, 'GET /api/health', h.j.source);
  t.dire(Array.isArray(h.j.adresses), 'adresses[] exposées', (h.j.adresses || [])[0]);
  t.dire(!!h.j.nom, 'adresse par nom de machine (kiosque)', h.j.nom);

  t.titre('Lecture principale');
  const d = await A.api('/api/data');
  const S = d.j || {};
  t.dire(d.statut === 200, 'GET /api/data');
  for (const k of ['personnes', 'dishes', 'plats', 'menu', 'courses', 'todos', 'postits',
    'plannings', 'agenda', 'news', 'rayons', 'feries', 'anniversaires', 'reglages'])
    t.dire(S[k] !== undefined, `champ ${k}`, Array.isArray(S[k]) ? S[k].length + ' éléments' : typeof S[k]);
  t.dire((S.menu || []).length === 7, 'menu = 7 jours', (S.menu || []).map((m) => m.jour).join(' '));
  t.dire(typeof (S.courses[0] || {}).id === 'string',
    'ids en TEXTE (sinon les coches du front sont inertes)');
  t.dire(JSON.stringify(S).includes('é'), 'UTF-8 intact sur tout le trajet');
  t.dire(!!S.meteo && S.meteo.temp != null, 'météo',
    S.meteo ? `${S.meteo.temp}° · ${(S.meteo.heures || []).length} h · ${(S.meteo.jours || []).length} j` : 'absente');
  t.dire((S.rayons || []).length >= 3, 'rayons servis par le serveur (source unique)', (S.rayons || []).join(' | '));

  /* 🐞 Ce contrôle exigeait qu'un soir de LA SEMAINE EN COURS porte un plat —
     donc il tombait le lundi matin d'une semaine que personne n'a encore
     remplie. C'est arrivé le 07/09. Une semaine vide est un état parfaitement
     légitime : le test accusait le code pour une donnée manquante.
     On vérifie donc ce que le CODE garantit — sept jours, datés, qui glissent —
     et on se contente de signaler l'état du menu. */
  const jourAvecPlat = (S.menu || []).find((m) => m.soirId);
  t.dire((S.menu || []).length === 7 && (S.menu || []).every((m) => /^\d{4}-\d{2}-\d{2}$/.test(m.date || '')),
    'la semaine servie fait sept jours datés',
    jourAvecPlat ? `dont ${jourAvecPlat.jour} → ${jourAvecPlat.soir}` : 'aucun plat saisi cette semaine');

  t.titre('Menu glissant');
  const suivante = await A.api('/api/menu?semaine=' + A.ymd(new Date(Date.now() + 7 * 864e5)));
  t.dire(suivante.statut === 200 && suivante.j.menu.length === 7, 'GET /api/menu?semaine=',
    suivante.j.menu.map((m) => m.jour).join(' '));

  /* La fiche recette se testait UNIQUEMENT à partir d'un plat du menu : semaine
     vide, et trois contrôles disparaissaient sans que rien ne le dise. On se
     rabat sur la bibliothèque, qui elle est toujours garnie. */
  const platEssai = (jourAvecPlat && jourAvecPlat.soirId)
    || ((S.plats || []).find((p) => p.recette) || (S.plats || [])[0] || {}).id;
  if (platEssai) {
    t.titre('Fiche recette et couverts');
    const p4 = await A.api('/api/plat/' + platEssai);
    const p6 = await A.api('/api/plat/' + platEssai + '?couverts=6');
    t.dire(p4.statut === 200 && !!p4.j.plat, 'GET /api/plat/:id', p4.j.plat && p4.j.plat.nom);
    /* 🐞 Test trop strict, corrige le 11/09 : il exigeait `misAEchelle`, alors
       qu'un plat SANS portions renseignees ne doit justement PAS etre mis a
       l'echelle — « pates sauce tomate », saisi a la main, n'en a aucune.
       Le code promet l'un OU l'autre, jamais le silence : soit il recalcule,
       soit il dit pourquoi il ne peut pas. C'est CA qu'on verifie.
       Meme confusion qu'au § 2 untricies entre ce que le code garantit et ce
       que la famille a saisi. */
    const ech = p6.j.plat.misAEchelle === true || p6.j.plat.echelleImpossible === true;
    t.dire(ech, 'l’échelle est recalculée OU refusée explicitement',
      p6.j.plat.misAEchelle ? 'recalculée' : 'refusée — aucune base de portions');
  }

  /* ── Accompagnement (20/09) ────────────────────────────────────────────────
     Demandé par Rémi : « sélectionner la recette ET ajouter un complément, genre
     gnocchi et ajouter jambon ». Ce n'était pas cosmétique : `*_plat` et
     `*_libre` sont exclusifs, donc choisir un plat de la bibliothèque ne laissait
     AUCUN champ pour l'à-côté.
     Le piège à garder fermé est la pollution de la bibliothèque : un
     accompagnement passé par `platId()` deviendrait une fiche « jambon », que
     `menu.js` proposerait ensuite comme plat du soir. */
  t.titre('Accompagnement du repas');
  const jourAcc = (S.menu || [])[0];
  if (!jourAcc) {
    t.dire(false, 'un jour de menu pour l’essai');
  } else {
    const platsAvant = (S.dishes || []).length;
    const accAvant = jourAcc.soirGarniture || '';
    const w = await A.api('/api/menu/' + jourAcc.id, 'PATCH', { soirGarniture: 'ZZ-essai jambon' });
    t.dire(w.statut === 200 && w.j.menu.soirGarniture === 'ZZ-essai jambon',
      'l’accompagnement s’écrit et se relit', w.j.menu && w.j.menu.soirGarniture);
    /* Il s'AJOUTE : le plat ne doit pas avoir bougé d'un caractère. */
    t.dire(w.j.menu.soir === (jourAcc.soir || ''),
      'le plat est intact — l’accompagnement ne le remplace pas', w.j.menu.soir || '(vide)');

    const apres = await A.api('/api/data');
    t.dire((apres.j.dishes || []).length === platsAvant
      && !(apres.j.dishes || []).some((d) => /ZZ-essai/.test(d)),
      'AUCUNE fiche créée dans la bibliothèque', `${platsAvant} plats avant et après`);

    /* Et il remonte dans les courses proposées : sans ça, personne n'achèterait
       le jambon. Proposé, jamais ajouté — comme tout le reste ici. */
    const sugAcc = await A.api('/api/course/suggestions');
    t.dire((sugAcc.j.suggestions || []).some((s) => /ZZ-essai jambon/.test(s.article)),
      'proposé aux courses (sans rien y ajouter)');

    /* Remis à l'état d'avant : ces tests tournent sur les vraies données. */
    await A.api('/api/menu/' + jourAcc.id, 'PATCH', { soirGarniture: accAvant });
    const remis = await A.api('/api/menu/' + jourAcc.id, 'PATCH', { soirGarniture: accAvant });
    t.dire((remis.j.menu.soirGarniture || '') === accAvant, 'remis à l’état d’origine',
      accAvant || '(vide)');
  }

  t.titre('Courses depuis le menu (ne crée rien)');
  const sug = await A.api('/api/course/suggestions');
  t.dire(sug.statut === 200, 'GET /api/course/suggestions',
    `${(sug.j.suggestions || []).length} propositions, ${(sug.j.sansIngredients || []).length} plat(s) sans recette`);

  t.titre('Articles habituels');
  const hab = await A.api('/api/course/habituels');
  t.dire(hab.statut === 200 && Array.isArray(hab.j.habituels), 'GET /api/course/habituels',
    (hab.j.habituels || []).map((x) => `${x.article}×${x.fois}`).join(', ') || '(historique encore mince)');

  t.titre('Temps réel et écritures');
  const flux = await A.ecouterFlux();
  const nom = `${A.MARQUE} course ${Date.now()}`;
  const ajout = await A.api('/api/course', 'POST', { article: nom, who: 'Rémi' });
  t.dire(ajout.statut === 200 && ajout.j.article === nom, 'POST /api/course (accents)', ajout.j.article);
  const coche = await A.api('/api/course/' + ajout.j.id, 'PATCH', { pris: true });
  t.dire(coche.j.pris === true, 'PATCH /api/course/:id');
  const notif = await A.api('/api/notif', 'POST', { titre: `${A.MARQUE} notif`, niveau: 'info' });
  t.dire(notif.statut === 200, 'POST /api/notif');
  await A.attendre(500);
  t.dire(flux.recus.some((e) => e.type === 'maj'), 'événement « maj » reçu');
  t.dire(flux.recus.some((e) => e.type === 'notif'), 'événement « notif » reçu');

  /* ── Corriger une tâche ─────────────────────────────────────────────────
     🔴 Jusqu'au 16/09, `PATCH /api/todo/:id` ne lisait QUE `done` : une date
     posée de travers ne se rattrapait qu'en supprimant la tâche et en la
     ressaisissant — donc on ne la rattrapait pas (« lancer lessive foncé »
     plantée au 15 chez Amandine). */
  t.titre('Une tâche se corrige');
  const tache = await A.api('/api/todo', 'POST',
    { tache: `${A.MARQUE} tâche`, who: 'Rémi', due: '2026-09-15' });
  t.dire(tache.statut === 200 && tache.j.due === '2026-09-15', 'POST /api/todo', tache.j.due);

  const decale = await A.api('/api/todo/' + tache.j.id, 'PATCH', { due: '2026-09-22' });
  t.dire(decale.statut === 200 && decale.j.due === '2026-09-22',
    'l’échéance se déplace', `${tache.j.due} → ${decale.j.due}`);
  t.dire(decale.j.who === 'Rémi' && decale.j.tache === `${A.MARQUE} tâche`,
    '🔑 et le reste n’a PAS bougé',
    'une feuille qui ne montre que la date ne doit pas effacer le destinataire');
  t.dire(decale.j.avant === undefined, 'l’état d’avant ne sort pas de l’API',
    'il sert au serveur à décider s’il faut prévenir, pas au front');

  const renvoi = await A.api('/api/todo/' + tache.j.id, 'PATCH', { who: 'Amandine' });
  t.dire(renvoi.j.who === 'Amandine' && renvoi.j.due === '2026-09-22',
    'la tâche se confie à quelqu’un d’autre sans perdre son échéance');

  const cochee = await A.api('/api/todo/' + tache.j.id, 'PATCH', { done: true });
  t.dire(cochee.j.done === true && cochee.j.due === '2026-09-22',
    '🔑 cocher n’efface pas l’échéance',
    'les champs absents ne sont pas touchés — sinon une coche remettrait tout à zéro');

  const vide = await A.api('/api/todo/' + tache.j.id, 'PATCH', { tache: '   ' });
  t.dire(vide.statut === 400, 'un intitulé vide est refusé', 'une tâche sans nom ne se retrouve plus');

  t.dire((await A.api('/api/todo/' + tache.j.id, 'DELETE')).statut === 200, 'DELETE /api/todo/:id');

  t.titre('Corbeille');
  t.dire((await A.api('/api/course/' + ajout.j.id, 'DELETE')).statut === 200, 'DELETE /api/course/:id');
  t.dire((await A.api('/api/notif/' + notif.j.notif.id, 'DELETE')).statut === 200,
    'DELETE /api/notif/:id (pas capté par /api/:kind/:id)');
  const apres = await A.api('/api/data');
  t.dire(!apres.j.courses.some((c) => c.article === nom), 'ligne d’essai bien retirée');

  /* ── La barrière de l'extérieur ─────────────────────────────────────────
     🔴 Posée le 13/09, après avoir constaté que /api/data répondait 200 à
     quiconque connaît le domaine du tunnel — courses, agenda, et les devoirs
     des enfants par /api/ecole. Le code d'accès protégeait l'écran de l'app,
     pas l'API en dessous.

     On simule une requête venue d'Internet : Cloudflare pose CF-Connecting-IP
     sur toute requête qu'il relaie, et ÉCRASE ce que le client aurait pu
     envoyer — on ne peut donc pas se faire passer pour le réseau local.
     ⚠️ Ce contrôle vaut surtout pour l'avenir : la barrière est invisible à
     l'usage, et rien d'autre ne signalerait qu'elle a été défaite. */
  t.titre('Barrière de l’extérieur');
  const DEHORS = { 'CF-Connecting-IP': '203.0.113.9' };
  for (const chemin of ['/api/data', '/api/ecole', '/api/maison', '/api/health']) {
    const r = await A.api(chemin, 'GET', null, DEHORS);
    t.dire(r.statut === 401, `${chemin} est fermé sans identité depuis Internet`, 'statut ' + r.statut);
  }
  /* Et ce qui doit RESTER ouvert : sans ça, personne ne pourrait jamais se
     connecter de l'extérieur — ni par code, ni par Face ID. */
  for (const chemin of ['/api/personnes', '/api/passkey/etat']) {
    const r = await A.api(chemin, 'GET', null, DEHORS);
    t.dire(r.statut === 200, `${chemin} reste ouvert — il sert à s’identifier`, 'statut ' + r.statut);
  }
  /* La liste des prénoms ne doit rien porter de plus : elle est ouverte. */
  const gens = await A.api('/api/personnes', 'GET', null, DEHORS);
  const champs = new Set(Object.keys((gens.j.personnes || [])[0] || {}));
  t.dire([...champs].every((c) => ['nom', 'couleur', 'collectif'].includes(c)),
    '🔑 /api/personnes ne rend que le prénom et sa couleur', [...champs].join(', ') || 'vide');
  /* À la maison, rien ne change : l'écran mural n'a pas de jeton. */
  const chezNous = await A.api('/api/data');
  t.dire(chezNous.statut === 200, 'à la maison, l’écran mural accède sans jeton', 'statut ' + chezNous.statut);

  t.titre('Session et back-office');
  const s = await A.session('Rémi');
  t.dire(!!s.moi && s.moi.admin === true, 'Rémi est administrateur');
  for (const [chemin, champ] of [['/api/admin/etat', 'etat'], ['/api/admin/membres', 'membres'],
    ['/api/admin/planning', 'creneaux'], ['/api/admin/plats', 'plats'],
    ['/api/admin/reglages', 'reglages'], ['/api/admin/appareils', 'appareils'],
    ['/api/admin/anniversaires', 'anniversaires'], ['/api/admin/journal', 'journal']]) {
    const r = await s.api(chemin);
    const v = r.j && r.j[champ];
    t.dire(r.statut === 200 && v !== undefined, 'GET ' + chemin,
      Array.isArray(v) ? v.length + ' éléments' : '');
  }
  t.dire((await A.api('/api/admin/membres')).statut === 401, 'barrière admin : 401 sans session');

  t.titre('Emploi du temps « mien » — la personne vient du JETON');
  t.dire((await A.api('/api/planning/mien')).statut === 401, '401 sans appareil enrôlé');
  /* Jeton FIXE, et non horodaté : l'enrôlement se fait en `ON CONFLICT(jeton)`,
     donc un jeton stable réutilise toujours la même ligne. Avec un jeton
     différent à chaque exécution, la liste des appareils enrôlés se remplissait
     d'appareils d'essai — et la révocation ne les efface pas, elle les marque. */
  const jeton = `${A.MARQUE}-jeton-fixe`;
  t.dire((await A.api('/api/appareil', 'POST',
    { jeton, personne: 'Enora', nom: A.MARQUE })).statut === 200, 'POST /api/appareil');
  const H = { 'x-jeton': jeton };
  const mien = await A.api('/api/planning/mien', 'GET', null, H);
  t.dire(mien.statut === 200, 'GET /api/planning/mien', (mien.j.creneaux || []).length + ' créneaux');
  t.dire((mien.j.creneaux || []).every((c) => c.personne === 'Enora'), 'ne renvoie que SES créneaux');
  await A.api('/api/planning/mien', 'POST', {
    personne: 'Martial', jour: 'Lun', activite: `${A.MARQUE} usurpation`,
    debut: '08:00', fin: '09:00', categorie: 'cours',
  }, H);
  const apresU = await A.api('/api/planning/mien', 'GET', null, H);
  const cree = (apresU.j.creneaux || []).find((c) => c.activite === `${A.MARQUE} usurpation`);
  t.dire(!!cree && cree.personne === 'Enora',
    '🔒 personne imposée par le jeton, jamais par le corps', cree && cree.personne);

  /* Ménage. L'appareil d'essai est RÉVOQUÉ, pas effacé — c'est le comportement
     voulu de l'API (on garde la trace d'un appareil qui a existé). Comme le
     jeton est fixe, la prochaine exécution réutilisera la même ligne au lieu
     d'en accumuler une par passage. */
  if (cree) await A.api('/api/planning/mien/' + cree.id, 'DELETE', null, H);
  const app = (await s.api('/api/admin/appareils')).j.appareils.find((a) => a.nom === A.MARQUE);
  if (app) await s.api('/api/admin/appareils/' + app.id, 'DELETE');
  const apresRevoc = (await s.api('/api/admin/appareils')).j.appareils.filter((a) => a.nom === A.MARQUE);
  t.dire(apresRevoc.length === 1 && apresRevoc[0].revoque,
    'appareil d’essai révoqué, et un seul (jeton fixe)', `${apresRevoc.length} ligne(s)`);
  await s.fermer();
  flux.fermer();
  return t;
};
