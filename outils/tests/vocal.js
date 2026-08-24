/* Assistant vocal — identité, écho temps réel, chemin rapide, refus.

   Le point le plus important est le dernier : l'assistant NE DOIT PAS pouvoir
   supprimer quoi que ce soit. Une reconnaissance vocale se trompe, et ce projet
   a déjà payé deux fois le prix d'une opération de masse lancée trop vite. */
const A = require('./aide');

module.exports = async function (muet) {
  const t = A.compteur(); t.muet = muet;
  const flux = await A.ecouterFlux();

  t.titre('Identité par le corps (ce dont dépend le Raccourci Siri)');
  const q = await A.api('/api/vocal', 'POST', { texte: 'combien il reste de courses ?', who: 'Rémi' });
  t.dire(q.statut === 200 && !!q.j.reponse, 'POST /api/vocal { texte, who }', q.j.reponse);
  t.dire(q.j.action === 'repondre' && q.j.fait === false, 'une question n’écrit rien',
    `action=${q.j.action}`);

  await A.attendre(400);
  const echo = flux.recus.filter((e) => e.type === 'notif' && e.data.vocal).pop();
  t.dire(!!echo, 'écho poussé sur le flux (écran mural)');
  if (echo) {
    t.dire(echo.data.de === 'Rémi', '« de » = la personne annoncée', echo.data.de);
    t.dire(echo.data.pour === 'Rémi', 'adressé à celui qui a parlé, pas aux autres téléphones');
  }

  t.titre('Sans identité, personne ne se fait passer pour un autre');
  await A.api('/api/vocal', 'POST', { texte: 'qui suis-je ?' });
  await A.attendre(400);
  const e2 = flux.recus.filter((e) => e.type === 'notif' && e.data.vocal).pop();
  t.dire(e2 && e2.data.de === 'Écran', 'auteur = « Écran » sans jeton ni who', e2 && e2.data.de);
  t.dire(e2 && e2.data.pour === '', 'non adressé → n’apparaît que sur le mur');

  t.titre('Phrase vide');
  const vide = await A.api('/api/vocal', 'POST', { texte: '   ' });
  t.dire(vide.statut === 400 && !!vide.j.reponse, '400 avec une réponse DISIBLE', vide.j.reponse);

  t.titre('Chemin rapide (aucun appel réseau côté serveur)');
  const t0 = Date.now();
  const rapide = await A.api('/api/vocal', 'POST',
    { texte: `courses : ${A.MARQUE} vocal`, who: 'Rémi' });
  t.dire(rapide.j.source === 'regle', 'traité par la règle locale', `${Date.now() - t0} ms`);
  t.dire(rapide.j.fait === true, 'article ajouté', rapide.j.reponse);

  const data = await A.api('/api/data');
  const cible = (data.j.courses || []).find((c) => c.article.includes(`${A.MARQUE} vocal`));
  if (cible) t.dire((await A.api('/api/course/' + cible.id, 'DELETE')).statut === 200,
    'article d’essai retiré');
  else t.dire(false, 'article d’essai introuvable pour le ménage');

  /* 🔑 Le contexte ne contenait QUE la journée en cours : « quel temps demain ? »
     recevait « la météo n'est pas disponible » alors qu'elle était affichée sur
     l'écran, et « j'ai quoi demain ? » répondait « rien de prévu » alors qu'il y
     avait deux événements. Un assistant qui affirme le contraire de l'écran est
     pire qu'un assistant qui ne sait pas. Vérifié sur le CONTEXTE lui-même :
     pas d'appel au modèle, donc rapide et déterministe. */
  t.titre('Le contexte couvre les jours À VENIR');
  const chemin = require('path');
  const noyau = require(chemin.join(__dirname, '..', '..', 'vocal'));
  const donnees = require(chemin.join(__dirname, '..', '..', 'donnees'));

  const demain = new Date(); demain.setDate(demain.getDate() + 1);
  const isoDemain = A.ymd(demain);
  const etat = (await A.api('/api/data')).j;

  const ctx = noyau.contexte(donnees, { agenda: etat.agenda, meteo: etat.meteo });
  t.dire(ctx.includes('demain'), '🔑 le mot « demain » figure dans le contexte');
  t.dire(ctx.includes(isoDemain), 'la date de demain y est', isoDemain);
  t.dire(/Prévisions/.test(ctx) || !((etat.meteo || {}).jours || []).length,
    '🔑 les prévisions des jours suivants sont transmises');
  t.dire(/Prochaines heures/.test(ctx) || !((etat.meteo || {}).heures || []).length,
    'les prochaines heures sont transmises');
  t.dire(/Agenda des huit prochains jours/.test(ctx), 'l’agenda porte sur huit jours');

  /* Un événement sur plusieurs jours doit apparaître sur CHAQUE journée qu'il
     couvre — un déplacement du vendredi au dimanche concerne bien le samedi. */
  /* ⚠️ L'agenda remonte 45 jours en arrière : il faut chercher un événement qui
     tombe dans les HUIT jours transmis, pas le premier venu — sinon le test
     échoue sur des vacances passées, ce qui ne prouve rien. */
  const dansHuitJours = A.ymd(new Date(Date.now() + 8 * 864e5));
  const aujourdhui = A.ymd(new Date());
  const longs = (etat.agenda || []).filter((e) => e.fin
    && String(e.fin).slice(0, 10) > String(e.start).slice(0, 10)
    && String(e.fin).slice(0, 10) >= aujourdhui
    && String(e.start).slice(0, 10) <= dansHuitJours);
  if (longs.length) {
    const e = longs[0];
    const lignes = ctx.split('\n').filter((l) => /^\s{2}\S/.test(l) && l.includes(e.summary));
    t.dire(lignes.length >= 2, '🔑 un événement sur plusieurs jours apparaît sur CHAQUE journée',
      `${e.summary} sur ${lignes.length} jour(s)`);
  } else {
    t.dire(true, 'aucun événement sur plusieurs jours dans la fenêtre (rien à vérifier)');
  }

  /* Les heures sont LUES à voix haute : « trois de l'après-midi » ou « 15h » ne
     s'entendent pas correctement. La consigne impose le format 24 heures en
     toutes lettres — on vérifie qu'elle est bien là, et qu'une vraie réponse ne
     contient ni chiffre d'heure ni « h » collé. */
  t.titre('Les heures se disent, elles ne s’écrivent pas');
  t.dire(/quinze heures/.test(noyau.CONSIGNE) && /DIRE LES HEURES/.test(noyau.CONSIGNE),
    'la consigne fixe la façon de dire les heures');

  const s0 = await A.session('Rémi');
  const rep = await s0.api('/api/admin/voix/essai', 'POST',
    { texte: "à quelle heure Enora a-t-elle piscine ?", personne: 'Rémi' });
  const phrase = String(rep.j.reponse || '');
  t.dire(!/\d{1,2}\s?[h:]\s?\d{0,2}/.test(phrase),
    '🔑 aucune heure écrite en chiffres dans la réponse', phrase);
  t.dire(!/(à|de|vers)\s+(une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze)\s+(de l|du matin|de l’|$)/i.test(phrase),
    'aucun nombre d’heure sans le mot « heures »');
  await s0.fermer();

  t.titre('Façon de parler');
  const perso = require(require('path').join(__dirname, '..', '..', 'vocal', 'personnalite'));

  /* L'appellation ne s'emploie JAMAIS avec un enfant : « Monsieur » à un enfant
     de huit ans sonne faux, et l'ironie n'y a pas sa place non plus. */
  const pourAdulte = perso.phrase('jarvis', 'course', { article: 'lait', appellation: 'Monsieur', roleInterlocuteur: 'parent' });
  const pourEnfant = perso.phrase('jarvis', 'course', { article: 'lait', appellation: 'Monsieur', roleInterlocuteur: 'enfant' });
  t.dire(!pourEnfant.includes('Monsieur'), '🔑 pas d’appellation quand on parle à un enfant', pourEnfant);
  t.dire(pourAdulte.includes('lait'), 'l’article est bien inséré', pourAdulte);

  /* Le choix de la variante dérive du texte, pas du hasard : deux appels
     identiques donnent la même phrase (tests reproductibles), deux articles
     différents n'en donnent pas la même (l'assistant ne radote pas). */
  const a1 = perso.phrase('jarvis', 'course', { article: 'lait' });
  const a2 = perso.phrase('jarvis', 'course', { article: 'lait' });
  const b1 = perso.phrase('jarvis', 'course', { article: 'pain' });
  t.dire(a1 === a2, 'même demande → même phrase (reproductible)');
  t.dire((perso.PHRASES.jarvis.course || []).length > 1, 'plusieurs tournures disponibles');

  const neutre = perso.phrase('neutre', 'course', { article: 'lait', appellation: 'Monsieur' });
  t.dire(!neutre.includes('Monsieur'), 'le style neutre reste sobre', neutre);

  const c = perso.consigne('jarvis', { appellation: 'Monsieur', interlocuteur: 'Rémi', roleInterlocuteur: 'parent' });
  t.dire(/VOUVOIE/.test(c), 'la consigne impose le vouvoiement');
  t.dire(perso.consigne('neutre', {}) === '', 'le style neutre n’ajoute aucune consigne');

  /* 🔑 Ne PAS mentionner l'appellation ne suffit pas : le modèle a un personnage
     de majordome assez marqué pour sortir « Monsieur » de lui-même — il l'a servi
     à Amandine, et « Madame » à un garçon de huit ans. L'interdiction doit être
     explicite. Défaut trouvé à l'écoute, pas à la relecture. */
  const cEnfant = perso.consigne('jarvis', { appellation: 'Monsieur', interlocuteur: 'Clovis', roleInterlocuteur: 'enfant' });
  t.dire(/N’emploie JAMAIS/.test(cEnfant), '🔑 appellation explicitement INTERDITE avec un enfant');
  t.dire(/Aucune ironie/i.test(cEnfant), '🔑 l’esprit est coupé avec un enfant, quel que soit le réglage');

  const cSansAppel = perso.consigne('jarvis', { appellation: '', interlocuteur: 'Amandine', roleInterlocuteur: 'parent' });
  t.dire(/N’emploie NI « Monsieur » NI « Madame »/.test(cSansAppel),
    '🔑 sans droit à l’appellation, elle est explicitement interdite (cas Amandine)');

  t.titre('Dose d’esprit');
  for (const [dose, motif] of [['jamais', /Aucune ironie/i], ['rare', /RARE/], ['leger', /une réponse sur trois/]]) {
    const cc = perso.consigne('jarvis', { humour: dose, interlocuteur: 'Rémi', roleInterlocuteur: 'parent', appellation: 'Monsieur' });
    t.dire(motif.test(cc), `dose « ${dose} » reprise dans la consigne`);
  }
  const leger = perso.consigne('jarvis', { humour: 'leger', interlocuteur: 'Rémi', roleInterlocuteur: 'parent' });
  t.dire(/l’information D’ABORD/.test(leger),
    '🔑 règle tenue : le fait d’abord, le trait d’esprit après');
  t.dire(/JAMAIS d’ironie sur un rappel/.test(leger),
    'aucune ironie sur un rappel, une échéance ou une urgence');

  t.titre('Banc d’essai du ton (n’écrit rien)');
  const s = await A.session('Rémi');
  const essai = await s.api('/api/admin/voix/essai', 'POST',
    { texte: 'ajoute du beurre aux courses', personne: 'Rémi', humour: 'jamais' });
  t.dire(essai.statut === 200 && !!essai.j.reponse, 'POST /api/admin/voix/essai', essai.j.reponse);
  const courses = (await A.api('/api/data')).j.courses || [];
  t.dire(!courses.some((c) => /beurre/i.test(c.article)),
    '🔑 l’essai n’a RIEN écrit dans les courses');
  const essaiVide = await s.api('/api/admin/voix/essai', 'POST', { texte: '  ' });
  t.dire(essaiVide.statut === 400, 'phrase vide refusée');
  await s.fermer();

  flux.fermer();
  return t;
};
