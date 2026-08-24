/* Semaine A / semaine B des collèges et lycées.

   Ce qui est vérifié ici n'est pas le calcul — c'est le FILTRAGE. L'ossature
   (colonne, sélecteurs, réglage) existait depuis des semaines, mais l'écran
   mural affichait les deux emplois du temps SUPERPOSÉS, ce qui est pire que pas
   d'emploi du temps : on ne sait plus lequel croire. */
const A = require('./aide');

module.exports = async function (muet) {
  const t = A.compteur(); t.muet = muet;
  const s = await A.session('Rémi');

  const creneaux = (data, personne) => {
    const p = (data.plannings.personnes || []).find((x) => x.nom === personne);
    return p ? Object.values(p.semaine || {}).flat() : [];
  };
  const data = async () => (await A.api('/api/data')).j;

  const d0 = await data();
  const courante = d0.plannings.quinzaine;
  const autre = courante === 'A' ? 'B' : 'A';
  t.titre(`Quinzaine courante : ${courante} (semaine ISO ${d0.plannings.semaine})`);

  const base = { personne: 'Enora', jour: 'Mar', debut: '14:00', fin: '15:00', categorie: 'cours' };
  const a = await s.api('/api/admin/planning', 'POST', { ...base, activite: `${A.MARQUE} sem A`, quinzaine: 'A' });
  const b = await s.api('/api/admin/planning', 'POST', { ...base, activite: `${A.MARQUE} sem B`, quinzaine: 'B' });
  const u = await s.api('/api/admin/planning', 'POST',
    { ...base, debut: '15:30', fin: '16:30', activite: `${A.MARQUE} toutes`, quinzaine: '' });
  t.dire(a.statut === 200 && b.statut === 200 && u.statut === 200, 'trois créneaux d’essai (A, B, toutes)');

  const d1 = await data();
  const vus = creneaux(d1, 'Enora').map((c) => c.quoi);
  t.dire(vus.includes(`${A.MARQUE} sem ${courante}`), `le créneau de semaine ${courante} est AFFICHÉ`);
  t.dire(!vus.includes(`${A.MARQUE} sem ${autre}`), `le créneau de semaine ${autre} est MASQUÉ`);
  t.dire(vus.includes(`${A.MARQUE} toutes`), 'un créneau sans quinzaine vaut toutes les semaines');
  t.dire(d1.plannings.alterne === true, 'le repère A/B ne s’affiche que s’il y a alternance');

  t.titre('Bascule du réglage « semaine A = paire »');
  const avant = (await s.api('/api/admin/reglages')).j.reglages.quinzaine_paire;
  await s.api('/api/admin/reglages', 'POST', { quinzaine_paire: avant === '1' ? '0' : '1' });
  const d2 = await data();
  t.dire(d2.plannings.quinzaine === autre, `la quinzaine bascule en ${autre}`, d2.plannings.quinzaine);
  const vus2 = creneaux(d2, 'Enora').map((c) => c.quoi);
  t.dire(vus2.includes(`${A.MARQUE} sem ${autre}`) && !vus2.includes(`${A.MARQUE} sem ${courante}`),
    'l’affichage suit le réglage');
  await s.api('/api/admin/reglages', 'POST', { quinzaine_paire: avant });
  t.dire((await data()).plannings.quinzaine === courante, 'réglage remis comme avant', courante);

  t.titre('L’ÉDITION voit tout — on ne corrige pas ce qu’on ne voit pas');
  const tous = (await s.api('/api/admin/planning')).j.creneaux
    .filter((c) => String(c.activite).startsWith(A.MARQUE));
  t.dire(tous.length === 3, 'le back-office liste les 3 créneaux', String(tous.length));

  for (const c of tous) await s.api('/api/admin/planning/' + c.id, 'DELETE');
  const reste = (await s.api('/api/admin/planning')).j.creneaux
    .filter((c) => String(c.activite).startsWith(A.MARQUE));
  t.dire(!reste.length, 'créneaux d’essai retirés');

  await s.fermer();
  return t;
};
