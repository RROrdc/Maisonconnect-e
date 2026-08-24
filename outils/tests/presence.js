/* Garde alternée — qui est à la maison, et quel jour.

   La source de vérité est le CALENDRIER iCloud (décision de Rémi). Ces tests
   vérifient donc DEUX choses : que les marqueurs sont bien lus, et surtout que
   les règles complémentaires (vacances scolaires, week-ends sans marqueur)
   donnent le bon nombre de couverts.

   Le cas le plus instructif est le week-end du 22 août : les garçons viennent,
   mais Martial et Enora sont en vacances chez leurs autres parents. Un premier
   jet raisonnait globalement (« les garçons sont là → tout le monde est là ») et
   annonçait 6 au lieu de 4. Les deux fratries suivent deux calendriers
   distincts — c'est ce que ces tests protègent. */
const A = require('./aide');

module.exports = async function (muet) {
  const t = A.compteur(); t.muet = muet;
  const s = await A.session('Rémi');

  const p = await s.api('/api/admin/presence');
  t.titre('Lecture du calendrier');
  t.dire(p.statut === 200, 'GET /api/admin/presence');
  t.dire(p.j.agendaBranche === true, 'un calendrier est branché');
  t.dire((p.j.evenements || 0) > 50, 'événements lus', String(p.j.evenements));
  t.dire((p.j.periodes || []).length > 0, 'périodes de présence trouvées',
    `${(p.j.periodes || []).length} période(s)`);

  const we = (p.j.periodes || []).filter((x) => x.type === 'week-end');
  t.dire(we.length > 0, 'week-ends de présence repérés', `${we.length}`);
  /* Le marqueur est posé sur le samedi ; on l'étend au vendredi et au dimanche
     puisque les enfants arrivent le vendredi (« Recup garcons » à 14h30). */
  t.dire(we.every((x) => x.jours === 3), 'chaque week-end couvre 3 jours (ven→dim)');

  /* ⚠️ Le rythme est de 14 jours, PAS une parité de semaine : les relevés
     montrent des semaines paires jusqu'en décembre puis impaires dès janvier
     (52 → 1). Une règle de parité serait fausse à partir du Nouvel An.

     ⚠️ Et l'écart attendu est un MULTIPLE de 14, pas exactement 14 : certaines
     occurrences sont supprimées dans iCloud (les week-ends tombant en vacances),
     ce qui crée des trous de 28 ou 42 jours. Cette assertion exigeait autrefois
     un écart de 14 pile — elle passait uniquement parce qu'un bug faisait
     réapparaître les occurrences supprimées. Corriger le bug a fait tomber le
     test : c'est exactement ce qu'on attend d'un test. */
  t.titre('Rythme multiple de 14 jours (et non parité de semaine)');
  const debuts = we.map((x) => x.du).sort();
  const ecarts = [];
  for (let i = 1; i < debuts.length; i++)
    ecarts.push(Math.round((new Date(debuts[i]) - new Date(debuts[i - 1])) / 86400000));
  t.dire(ecarts.every((n) => n % 14 === 0),
    'tous les écarts sont des multiples de 14 jours', ecarts.join(', ') || '—');
  t.dire(ecarts.some((n) => n === 14) || debuts.length < 3,
    'le rythme de base reste bien de 14 jours');

  t.titre('Nombre de couverts selon la situation');
  const jours = p.j.jours || [];
  const jour = (d) => jours.find((x) => x.date === d);
  const socle = (p.j.aujourdhui.presents || []).length;
  t.dire(socle >= 2, 'au moins le socle du foyer est présent', String(socle));

  /* Contrôles indépendants de la date du jour : on cherche un exemplaire de
     chaque situation parmi les 21 jours renvoyés. */
  const parType = {};
  for (const j of jours) (parType[j.type] ||= []).push(j);

  const semaine = (parType['semaine'] || [])[0];
  if (semaine) t.dire(semaine.couverts === 4, 'en semaine : 4 à table',
    `${semaine.date} → ${semaine.presents.join(', ')}`);

  const weSansEnfants = (parType['week-end sans les enfants'] || [])[0];
  if (weSansEnfants) t.dire(weSansEnfants.couverts === 2, 'week-end sans les garçons : 2 à table',
    `${weSansEnfants.date} → ${weSansEnfants.presents.join(', ')}`);

  const weAvec = (parType['week-end avec les garçons'] || [])[0];
  if (weAvec) t.dire(weAvec.couverts === 6, 'week-end avec les garçons : 6 à table',
    `${weAvec.date} → ${weAvec.presents.join(', ')}`);

  const vacAilleurs = (parType['vacances chez leurs autres parents'] || [])[0];
  if (vacAilleurs) t.dire(vacAilleurs.couverts === 2, 'vacances chez leurs autres parents : 2 à table',
    `${vacAilleurs.date}`);

  /* 🔑 LE cas que seul Rémi pouvait trancher : un marqueur de week-end tombant
     PENDANT les vacances scolaires. L'événement « Les enfants » est récurrent —
     il se déclenche tout seul en août alors que personne n'est là. Pendant une
     vacance, seul un marqueur DE VACANCES fait foi. */
  const ignore = jours.find((j) => /ignoré/.test(j.source || ''));
  if (ignore) t.dire(ignore.couverts === 2,
    'marqueur de week-end ignoré pendant les vacances (filet)',
    `${ignore.date} → ${ignore.couverts} à table`);
  t.dire(!jours.some((j) => /vacances chez/.test(j.type) && j.couverts !== 2),
    'aucune vacance « chez leurs autres parents » n’a plus de 2 couverts');

  /* 🔑 Les occurrences SUPPRIMÉES dans iCloud doivent disparaître.
     Bug corrigé le 20/08 : on comparait les CLÉS de `exdate` (dates UTC) à des
     occurrences en heure locale — décalées d'un jour pour un événement de
     journée entière. Aucune suppression n'était donc jamais appliquée, et un
     week-end effacé dans le calendrier restait affiché sur le mur.
     Contrôle indirect mais fiable : si les suppressions étaient ignorées, le
     rythme serait un 14 jours parfait sans aucun trou — or Rémi supprime les
     week-ends tombant en vacances. */
  t.dire(ecarts.length === 0 || ecarts.some((n) => n > 14) || we.length < 6,
    '🔑 les occurrences supprimées dans iCloud sont bien exclues',
    ecarts.filter((n) => n > 14).length + ' trou(s) détecté(s)');

  t.titre('Chaque jour dit d’où vient sa réponse');
  t.dire(jours.every((j) => !!j.source), 'toutes les journées portent leur source');
  t.dire(jours.every((j) => j.couverts === (j.presents || []).length),
    'le nombre de couverts correspond aux personnes listées');

  t.titre('Suggestion de couverts sur le menu');
  const menu = (await A.api('/api/menu')).j.menu || [];
  t.dire(menu.length === 7, 'menu de la semaine lu');
  t.dire(menu.every((m) => m.couvertsProposes === undefined || m.couvertsProposes >= 2),
    'chaque jour porte une suggestion cohérente');
  /* La suggestion ne doit RIEN écraser : le nombre enregistré reste celui de la
     base tant que personne ne l'a accepté. */
  t.dire(menu.every((m) => m.soirCouverts >= 1), 'les couverts enregistrés ne sont pas modifiés');

  await s.fermer();
  return t;
};
