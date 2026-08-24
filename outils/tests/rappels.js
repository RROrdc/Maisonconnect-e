/* Anniversaires, rappels d'échéance, rangement automatique des rayons.

   Le point à ne jamais casser : une tâche ASSIGNÉE part sur le téléphone de la
   personne, une tâche SANS destinataire part à tout le monde. C'est la règle
   posée par Rémi, et elle ne se vérifie qu'en regardant le champ `pour`. */
const A = require('./aide');

module.exports = async function (muet) {
  const t = A.compteur(); t.muet = muet;
  const s = await A.session('Rémi');

  const auj = new Date();
  const dans7 = new Date(); dans7.setDate(dans7.getDate() + 7);
  const naiss = (d, an) =>
    `${an}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  t.titre('Journal technique');
  const j0 = await s.api('/api/admin/journal');
  t.dire(j0.statut === 200 && Array.isArray(j0.j.journal), 'GET /api/admin/journal',
    `${j0.j.journal.length} ligne(s)`);

  t.titre('Rayon deviné à l’ajout');
  const a1 = await A.api('/api/course', 'POST', { article: `${A.MARQUE} 2 courgettes` });
  t.dire(a1.j.rayon === 'Fruits & légumes', 'rayon deviné quand il est vide', a1.j.rayon);
  const a2 = await A.api('/api/course', 'POST', { article: `${A.MARQUE} lardons`, rayon: 'Boissons' });
  t.dire(a2.j.rayon === 'Boissons', 'choix humain JAMAIS écrasé', a2.j.rayon);
  await A.api('/api/course/' + a1.j.id, 'DELETE');
  await A.api('/api/course/' + a2.j.id, 'DELETE');

  t.titre('Anniversaires');
  const t1 = await s.api('/api/admin/anniversaires', 'POST',
    { nom: `${A.MARQUE} Mamie`, naissance: naiss(auj, 1950), relation: 'grand-mère' });
  const t2 = await s.api('/api/admin/anniversaires', 'POST',
    { nom: `${A.MARQUE} Cousin`, naissance: naiss(dans7, 2010), relation: 'cousin' });
  t.dire(t1.statut === 200 && t2.statut === 200, 'création de deux anniversaires d’essai');

  const ap = await s.api('/api/admin/anniversaires');
  const dujour = (ap.j.aujourdhui || []).find((a) => a.nom === `${A.MARQUE} Mamie`);
  t.dire(!!dujour, 'anniversaire du jour détecté');
  t.dire(dujour && dujour.age === auj.getFullYear() - 1950, 'âge calculé', dujour && String(dujour.age));

  const data = await A.api('/api/data');
  t.dire((data.j.anniversaires.aujourdhui || []).some((a) => a.nom === `${A.MARQUE} Mamie`),
    '/api/data expose l’anniversaire du jour');
  t.dire((data.j.anniversaires.prochains || []).some((a) => a.nom === `${A.MARQUE} Cousin`),
    '/api/data expose les prochains');

  t.titre('Rappels quotidiens (envoi réel)');
  const tache = await A.api('/api/todo', 'POST',
    { tache: `${A.MARQUE} sortir la poubelle`, who: 'Martial', due: A.ymd() });
  t.dire(!!tache.j.id, 'tâche d’essai à échéance du jour');

  const run = await s.api('/api/admin/rappels/tester', 'POST');
  const b = run.j.bilan || {};
  t.dire(run.statut === 200, 'POST /api/admin/rappels/tester',
    `${b.anniversaires} anniversaire(s), ${b.echeances} échéance(s), ${b.ranges} rangé(s)`);
  t.dire(b.anniversaires >= 2, 'anniversaire du jour ET rappel anticipé envoyés');
  t.dire(b.echeances >= 1, 'échéance envoyée');

  const notifs = (await s.api('/api/notif')).j.notifs || [];
  const pourMartial = notifs.find((n) => n.pour === 'Martial');
  t.dire(!!pourMartial, 'notification ADRESSÉE à Martial', pourMartial && pourMartial.titre);
  const anniv = notifs.find((n) => /anniversaire/i.test(n.titre));
  t.dire(!!anniv && !anniv.pour, 'anniversaire adressé à TOUT LE MONDE (pour vide)');

  t.titre('Ménage');
  await s.api('/api/admin/anniversaires/' + t1.j.id, 'DELETE');
  await s.api('/api/admin/anniversaires/' + t2.j.id, 'DELETE');
  await A.api('/api/todo/' + tache.j.id, 'DELETE');
  for (const n of notifs.filter((n) => new RegExp(`${A.MARQUE}|poubelle|Mamie|Cousin`, 'i')
    .test(n.titre + ' ' + n.message))) await A.api('/api/notif/' + n.id, 'DELETE');

  const fin = await s.api('/api/admin/anniversaires');
  t.dire(!fin.j.anniversaires.some((a) => a.nom.startsWith(A.MARQUE)), 'anniversaires d’essai retirés');
  const c = await A.api('/api/data');
  t.dire(!c.j.courses.some((x) => x.article.startsWith(A.MARQUE)), 'courses d’essai retirées');
  t.dire(!c.j.todos.some((x) => x.tache.startsWith(A.MARQUE)), 'tâche d’essai retirée');

  await s.fermer();
  return t;
};
