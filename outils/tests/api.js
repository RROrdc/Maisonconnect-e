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

  const jourAvecPlat = (S.menu || []).find((m) => m.soirId);
  t.dire(!!jourAvecPlat, 'un jour de menu porte un plat',
    jourAvecPlat && `${jourAvecPlat.jour} → ${jourAvecPlat.soir}`);

  t.titre('Menu glissant');
  const suivante = await A.api('/api/menu?semaine=' + A.ymd(new Date(Date.now() + 7 * 864e5)));
  t.dire(suivante.statut === 200 && suivante.j.menu.length === 7, 'GET /api/menu?semaine=',
    suivante.j.menu.map((m) => m.jour).join(' '));

  if (jourAvecPlat) {
    t.titre('Fiche recette et couverts');
    const p4 = await A.api('/api/plat/' + jourAvecPlat.soirId);
    const p6 = await A.api('/api/plat/' + jourAvecPlat.soirId + '?couverts=6');
    t.dire(p4.statut === 200 && !!p4.j.plat, 'GET /api/plat/:id', p4.j.plat && p4.j.plat.nom);
    t.dire(p6.j.plat.misAEchelle === true, 'mise à l’échelle signalée');
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

  t.titre('Corbeille');
  t.dire((await A.api('/api/course/' + ajout.j.id, 'DELETE')).statut === 200, 'DELETE /api/course/:id');
  t.dire((await A.api('/api/notif/' + notif.j.notif.id, 'DELETE')).statut === 200,
    'DELETE /api/notif/:id (pas capté par /api/:kind/:id)');
  const apres = await A.api('/api/data');
  t.dire(!apres.j.courses.some((c) => c.article === nom), 'ligne d’essai bien retirée');

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
