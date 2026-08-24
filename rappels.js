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

function creerRappels({ donnees, diffuser, config }) {
  const aujourdhui = () => donnees.ymd(new Date());

  /* Notification : écrite en base PUIS diffusée. Un téléphone éteint retrouvera
     l'historique ; un téléphone ouvert la voit tout de suite. */
  function prevenir({ titre, message, pour, niveau }) {
    const n = donnees.ajouterNotif({ titre, message: message || '', pour: pour || null,
      de: 'Maison', niveau: niveau || 'info' });
    diffuser('notif', n);
    return n;
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

  /* Vérifié au démarrage puis toutes les 15 min : c'est l'heure qui décide, pas
     le minuteur. Un intervalle plus court ne changerait rien, un plus long
     raterait la fenêtre sur un poste éteint tôt. */
  function planifier(options) {
    const tenter = () => { try { passer(options); } catch (_) { /* déjà journalisé */ } };
    setTimeout(tenter, 20000).unref?.();
    const t = setInterval(tenter, 15 * 60 * 1000);
    t.unref?.();
    return t;
  }

  return { passer, planifier, anniversaires, echeances };
}

module.exports = { creerRappels };
