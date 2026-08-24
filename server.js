/* Écran Maison — serveur.

   Sert `public/` (écran mural `/bento.html`, app famille `/app/`, back-office
   `/admin/`) et expose l'API REST + un flux temps réel.

   ⚠️ Le `.env` est lu depuis le DOSSIER DU PROJET, jamais le répertoire courant :
   lancé d'ailleurs, le serveur ignorait PORT=8090, tentait le 8080 (pris par
   whatsapp-bridge) et mourait sur EADDRINUSE. Le piège est supprimé, pas contourné.

   ⚠️ ORDRE DES ROUTES EXPRESS — piège rencontré trois fois sur ce projet :
   `DELETE /api/:kind/:id` capte tout chemin à trois segments. Il est donc déclaré
   EN DERNIER, après toutes les routes nommées. Les routes « mien » du planning
   comptent volontairement trois et quatre segments pour la même raison. */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const fs = require('fs');
const os = require('os');
const express = require('express');
const ical = require('node-ical');

const donnees = require('./donnees');
const recettes = require('./recettes');
const vocal = require('./vocal');
const { creerRappels } = require('./rappels');
const { creerMenu } = require('./menu');
const { creerPresence } = require('./presence');
const feries = require('./feries');

/* Une panne réseau ne doit pas rester dans la console : sur un mur, un agenda
   injoignable ressemble à un agenda vide. Tout passe par le journal, consultable
   dans /admin/. */
const noter = (source, e, niveau = 'erreur') => {
  const message = (e && e.message) || String(e);
  console.error(`[${source}]`, message);
  try { donnees.journaliser(niveau, source, message, e && e.stack); } catch (_) { /* base occupée */ }
};

const app = express();
const PORT = Number(process.env.PORT) || 8090;

/* ------------------------------------------------------------------ réglages
   Fin de la migration `.env` → table `reglages` (§ 5 ter).

   Ce qui vit en BASE : tout ce qui se règle en marchant — agenda, actus, météo,
   veille, modèle d'IA. Modifiable depuis /admin/ sans éditer un fichier ni
   relancer le serveur, ce qui est le seul mode d'emploi tenable pour Rémi une
   fois la boîte posée sur un mur.

   Ce qui RESTE dans `.env` :
   - les SECRETS (`ANTHROPIC_API_KEY`, `NOTION_TOKEN`) — un secret n'a rien à
     faire dans une base qu'on sauvegarde et qu'on recopie ;
   - ce qu'il faut connaître AVANT d'ouvrir la base (`SOURCE`, `DB_FICHIER`,
     `PORT`) — sinon c'est la poule et l'œuf.

   Le `.env` reste une valeur d'AMORÇAGE : au premier démarrage, une clé absente
   de la table y est recopiée. Ensuite la base fait foi — vider un champ dans
   /admin/ le laisse vide, il n'est jamais réécrit depuis `.env`. */
const REGLAGES = {
  agenda_ics:       { env: 'CAL_ICS_URL', defaut: '' },
  news_rss:         { env: 'NEWS_RSS_URL', defaut: '' },
  meteo_lat:        { env: 'METEO_LAT', defaut: '50.6942' },   // Roubaix
  meteo_lon:        { env: 'METEO_LON', defaut: '3.1746' },
  ville:            { env: 'METEO_VILLE', defaut: 'Roubaix' },
  veille_minutes:   { env: 'VEILLE_MINUTES', defaut: '25' },
  /* Rayons du magasin, source UNIQUE. Ils étaient codés en dur DEUX fois, avec
     des listes différentes : un article rangé dans « Surgelés » depuis l'app
     n'apparaissait nulle part sur l'écran mural. Rangés dans l'ordre d'un
     parcours de magasin, ce qui est aussi l'ordre utile en faisant les courses. */
  rayons: { env: 'RAYONS', defaut: 'Fruits & légumes, Frais, Surgelés, Épicerie, Boissons, Maison / hygiène, Autre' },
  /* Noms de repas qui désignent un GENRE et non un plat : « barbecue » n'a pas
     de recette, mais l'image du genre existe. Une ligne « generique = terme
     cherché ». Vide = la table par défaut de `recettes/generiques.js` s'applique
     seule ; ce champ ne fait que l'étendre ou la corriger. */
  photos_generiques: { env: '', defaut: '' },
  /* Garde alternée. La source de vérité est le CALENDRIER (décision de Rémi :
     « garde-le en lecture, si on doit modifier c'est dans le calendrier ») ;
     ces réglages ne servent qu'à dire COMMENT le lire.
     ⚠️ `garde_reference` est une date, pas une parité de semaine : les 16
     occurrences relevées prouvent que la parité bascule au 1er janvier. */
  garde_actif:              { env: '', defaut: '1' },
  garde_socle:              { env: '', defaut: 'Rémi, Amandine' },
  garde_semaine:            { env: '', defaut: 'Enora, Martial' },
  garde_alternes:           { env: '', defaut: 'Augustin, Clovis' },
  garde_marqueur_we:        { env: '', defaut: 'les enfants' },
  garde_marqueur_vacances:  { env: '', defaut: 'vacances enfant' },
  /* Le marqueur « Les enfants » couvre déjà samedi ET dimanche.
     ⚠️ J'avais d'abord conclu qu'il ne couvrait qu'un jour, et compensé avec
     `apres = 1`. C'était faux : le décalage UTC (corrigé le 20/08) faisait
     apparaître la fin un jour trop tôt. Avec la lecture corrigée, `apres = 1`
     ajoutait le LUNDI. Il ne reste à ajouter que le vendredi, jour où les
     enfants arrivent (« Recup garcons » en fin d'après-midi). */
  garde_we_avant:           { env: '', defaut: '1' },
  garde_we_apres:           { env: '', defaut: '0' },
  garde_reference:          { env: '', defaut: '2026-09-05' },
  /* Filet : pendant une vacance scolaire, ignorer un marqueur de WEEK-END non
     accompagné d'un marqueur de vacances.
     ⚠️ Cette règle a été écrite pour compenser un bug (les occurrences
     supprimées dans iCloud n'étaient pas exclues — corrigé le 20/08). Elle n'est
     plus nécessaire : le calendrier est désormais lu correctement. On la garde
     par défaut comme garde-fou contre une récurrence oubliée, mais elle se
     décoche — et il FAUT la décocher si les enfants viennent parfois un week-end
     isolé pendant des vacances où ils sont sinon absents. */
  garde_ignorer_we_en_vacances: { env: '', defaut: '1' },
  /* Vacances scolaires — dates OFFICIELLES zone B (académie de Lille) 2026-2027,
     vérifiées sur le calendrier du ministère.

     ⚠️ Les périodes commencent le VENDREDI SOIR, pas le samedi matin : les
     vacances officielles courent du samedi au lundi de rentrée, mais les enfants
     partent dès la sortie des classes le vendredi. Rémi l'avait vu — il a donné
     « du 16 avril » et « du 19 février », qui sont précisément ces vendredis.

     Les dates de fin sont le DERNIER jour de vacances (la veille de la rentrée),
     pas le lundi de reprise.

     À remettre à jour chaque année : elles sont publiées par le ministère et se
     décalent, notamment pour l'hiver et le printemps qui tournent par zone. */
  garde_vacances_scolaires: { env: '', defaut: [
    '2026-07-04 → 2026-08-30  # grandes vacances 2026 (rentrée lundi 31/08)',
    '2026-10-16 → 2026-11-01  # Toussaint (rentrée lundi 02/11)',
    '2026-12-18 → 2027-01-03  # Noël (rentrée lundi 04/01)',
    '2027-02-19 → 2027-03-07  # hiver, zone B (rentrée lundi 08/03)',
    '2027-04-16 → 2027-05-02  # printemps, zone B (rentrée lundi 03/05)',
    '2027-07-02 → 2027-08-31  # grandes vacances 2027',
  ].join('\n') },
  /* Voix de l'assistant. Réglé une fois dans /admin/, appliqué partout —
     l'écran mural n'a pas d'interface de configuration, et ne doit pas en avoir.
     ⚠️ `voix_nom` est un NOM, pas un identifiant technique : la liste des voix
     dépend de la machine qui parle (Windows, macOS, Raspberry n'ont pas les
     mêmes). On rapproche par le nom, avec repli sur la meilleure voix française
     disponible — un identifiant serait introuvable ailleurs. */
  voix_nom:          { env: '', defaut: '' },
  voix_debit:        { env: '', defaut: '1' },
  voix_ton:          { env: '', defaut: '1' },
  voix_eveil:        { env: '', defaut: 'jarvis' },
  voix_exiger_eveil: { env: '', defaut: '1' },
  /* Façon de parler. « jarvis » = courtois, vouvoiement, litote, trait d'esprit
     rare. « neutre » = sobre. Le style ne change RIEN aux règles de sécurité :
     liste fermée d'actions et aucune destruction restent en tête de consigne. */
  voix_personnalite: { env: '', defaut: 'jarvis' },
  voix_appellation:  { env: '', defaut: 'Monsieur' },
  /* ⚠️ À QUI l'appellation s'adresse. Sans cette liste, « Monsieur » était servi
     à tout le monde — y compris à Amandine. Les autres sont appelés par leur
     prénom, ce qui est le comportement sûr par défaut. */
  voix_appellation_pour: { env: '', defaut: 'Rémi' },
  /* Dosage de l'esprit : jamais | rare | leger. Coupé d'office face à un enfant,
     et sur tout rappel ou urgence, quel que soit le réglage. */
  voix_humour:       { env: '', defaut: 'leger' },
  ia_modele:        { env: 'IA_MODELE', defaut: 'claude-opus-5' },
  /* Modèle SÉPARÉ pour la voix, et ce n'est pas un détail : une fiche de recette
     se lit posément, une réponse orale doit arriver tout de suite. Mesuré sur ce
     poste, la même question passe de ~10 s à ~1 s selon le modèle. Vide = on
     reprend `ia_modele`, pour ne rien changer sans que Rémi l'ait décidé. */
  ia_modele_vocal:  { env: 'IA_MODELE_VOCAL', defaut: '' },
  planning_exemple: { env: 'PLANNING_EXEMPLE', defaut: '0' },
};

const config = (cle) => {
  const d = REGLAGES[cle] || {};
  return donnees.reglage(cle, d.defaut !== undefined ? d.defaut : '');
};

/* Recopie unique du `.env` vers la base : uniquement les clés ABSENTES de la
   table (pas les clés vides — vider un réglage est une décision, pas un oubli). */
function amorcerReglages() {
  const depuisEnv = {};
  for (const [cle, d] of Object.entries(REGLAGES)) {
    const v = process.env[d.env];
    if (v !== undefined && String(v).trim() !== '') depuisEnv[cle] = String(v).trim();
  }
  const poses = donnees.poserReglagesSiAbsents(depuisEnv);
  if (poses.length) console.log('↗ Réglages repris du .env : ' + poses.join(', '));

  /* Puis les valeurs par défaut, pour les clés que personne n'a jamais fixées.
     Sans ça, /admin/ afficherait des champs VIDES qui veulent dire en secret
     « la valeur par défaut s'applique » — on ne peut pas régler ce qu'on ne voit
     pas, et on croit le réglage inopérant. */
  const defauts = {};
  for (const [cle, d] of Object.entries(REGLAGES)) defauts[cle] = d.defaut;
  donnees.poserReglagesSiAbsents(defauts);
}

/* Limite de corps élargie sur les SEULES routes photo. L'élargir globalement
   exposerait toute l'API à des envois énormes.
   ⚠️ Le choix se fait ICI, dans un aiguillage : un `express.json()` global suivi
   d'un `express.json({limit})` posé sur la route arriverait trop tard — le global
   a déjà lu le corps et renvoyé 413. */
const jsonNormal = express.json({ limit: '1mb' });
const jsonPhoto = express.json({ limit: '12mb' });
const ROUTES_PHOTO = new Set(['/api/plat/photo', '/api/recette/photo']);
app.use((req, res, suite) => (ROUTES_PHOTO.has(req.path) ? jsonPhoto : jsonNormal)(req, res, suite));

/* ⚠️ Un `maxAge` global d'une heure sur `public/` était un vrai piège : le
   navigateur gardait le HTML en cache, si bien qu'une correction n'apparaissait
   qu'une heure plus tard — et entre-temps on croit le correctif inopérant. Sur
   l'écran mural, en kiosque et jamais rechargé à la main, c'est pire encore.

   Donc : les PAGES sont revalidées à chaque fois (`no-cache` + ETag → un 304 de
   quelques octets, pas un téléchargement), tandis que les PHOTOS de plats, dont
   le nom est l'empreinte du contenu, se gardent longtemps sans risque : un
   contenu différent porte forcément un autre nom. */
/* La racine mène à l'écran mural.
   `public/index.html` (l'ancienne mise en page paysage, abandonnée le 18/08 au
   profit du bento) a été supprimé le 19/08 : sans cette redirection, ouvrir
   http://<serveur>:8090/ renverrait un 404. Elle sert aussi de raccourci — on
   tape l'adresse sans se souvenir du nom de la page. */
app.get('/', (_req, res) => res.redirect(302, '/bento.html'));

app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  setHeaders: (res, chemin) => {
    /* Cache long UNIQUEMENT pour ce qui ne peut pas changer sous le même nom :
       les photos de plats sont nommées par l'empreinte de leur contenu, les
       icônes ne bougent jamais. Tout le reste — pages ET scripts — est du code
       applicatif : le figer une semaine, c'est se retrouver à déboguer une
       version qui n'est plus celle du disque (une heure perdue le 19/08). */
    const fige = /[\\/]plats[\\/]/i.test(chemin) || /[\\/]icones[\\/]/i.test(chemin);
    res.setHeader('Cache-Control', fige ? 'public, max-age=604800, immutable' : 'no-cache');
  },
}));

/* ------------------------------------------------------------------ identité
   Deux jetons distincts, volontairement :
   - `x-jeton`   : l'APPAREIL enrôlé une fois (iPhone de la famille) ;
   - `x-session` : la SESSION du back-office, ouverte par code, valable 12 h. */
app.use((req, _res, suite) => {
  try {
    const j = req.get('x-jeton');
    if (j) req.appareil = donnees.appareil(j);
    const s = req.get('x-session');
    if (s) req.moi = donnees.lireSession(s);
  } catch (_) { /* une base momentanément verrouillée ne doit pas tuer la requête */ }
  suite();
});

/* Qui agit ? Le jeton d'abord — il ne se falsifie pas depuis le corps de la requête. */
const qui = (req) =>
  (req.appareil && req.appareil.personne)
  || (req.moi && req.moi.nom)
  || (req.body && req.body.who)
  || 'Écran';

/* ------------------------------------------------------------------ temps réel
   Une écriture aboutit -> on pousse `maj` à tous les abonnés (écran + téléphones),
   qui rechargent. SSE plutôt que WebSocket : natif au navigateur, RECONNEXION
   AUTOMATIQUE, aucune dépendance. Mesuré ~30 ms entre le téléphone et l'écran. */
const abonnes = new Set();

function diffuser(type, charge) {
  const data = JSON.stringify(charge || {});
  for (const res of [...abonnes]) {
    try { res.write(`event: ${type}\ndata: ${data}\n\n`); }
    catch (_) { abonnes.delete(res); }
  }
}
const majFaite = (quoi, req) => diffuser('maj', { quoi, par: req ? qui(req) : '' });

app.get('/api/flux', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  res.write('retry: 3000\n\n');
  abonnes.add(res);
  /* Battement régulier : sans trafic, un proxy ou le Wi-Fi finit par couper. */
  const battement = setInterval(() => { try { res.write(': ping\n\n'); } catch (_) {} }, 25000);
  req.on('close', () => { clearInterval(battement); abonnes.delete(res); });
});

/* ------------------------------------------------------------------ agenda (.ics)
   Fenêtre −45 j / +180 j, récurrences dépliées.
   ⚠️ MISE EN CACHE 10 MIN, indispensable depuis le temps réel : sans elle, une
   simple coche de course déclencherait un retéléchargement complet du calendrier
   iCloud pour chaque abonné. */
const CACHE_AGENDA = 10 * 60 * 1000;
let agendaCache = { quand: 0, valeur: [], signature: '' };

/* Fenêtre de lecture du calendrier.
   Le PASSÉ sert à comprendre le rythme de garde, l'AVENIR à le projeter — les
   vacances de février 2027 tombaient hors des 180 jours d'origine, et la
   présence des enfants y était donc invisible. On lit un an, on n'en AFFICHE
   que six mois : une seule requête, deux usages, et le front ne transporte pas
   une année d'événements pour rien. */
const JOURS_PASSE = 45;
const JOURS_AVENIR = 365;
const JOURS_AFFICHES = 180;

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

async function lireAgenda() {
  const url = config('agenda_ics');
  if (!url) return [];
  /* La signature invalide le cache dès que l'URL change dans /admin/ : sans elle,
     on continuerait dix minutes à servir l'ANCIEN calendrier, et on croirait le
     réglage cassé. */
  if (agendaCache.signature === url && Date.now() - agendaCache.quand < CACHE_AGENDA)
    return agendaCache.valeur;

  try {
    const brut = await ical.async.fromURL(url);
    const debut = new Date(); debut.setDate(debut.getDate() - JOURS_PASSE); debut.setHours(0, 0, 0, 0);
    const fin = new Date(); fin.setDate(fin.getDate() + JOURS_AVENIR); fin.setHours(23, 59, 59, 999);
    const out = [];

    /* ⚠️ `start` reste en ISO UTC — les fronts font `new Date(start)`, qui rend
       l'heure LOCALE, donc leur affichage est juste. Mais tout code qui DÉCOUPE
       la chaîne (`slice(11,16)`) lit l'heure UTC : un rendez-vous à 17 h Paris
       ressortait à 15 h. On publie donc en plus `jour` et `heure` déjà convertis,
       pour que personne n'ait à refaire la conversion — ni à la rater. */
    const localJour = (d) => {
      const x = new Date(d);
      return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    };
    const localHeure = (d) => {
      const x = new Date(d);
      return `${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`;
    };

    const poser = (start, finEvt, ev, journee) => {
      if (!start || start > fin || (finEvt || start) < debut) return;
      out.push({
        start: new Date(start).toISOString(),
        fin: finEvt ? new Date(finEvt).toISOString() : '',
        /* Dates et heures LOCALES, prêtes à l'emploi. */
        jour: localJour(start),
        jourFin: finEvt ? localJour(finEvt) : '',
        heure: journee ? '' : localHeure(start),
        heureFin: (!journee && finEvt) ? localHeure(finEvt) : '',
        summary: String(ev.summary || '(sans titre)'),
        lieu: String(ev.location || ''),
        journee: !!journee,
      });
    };

    for (const cle of Object.keys(brut)) {
      const ev = brut[cle];
      if (!ev || ev.type !== 'VEVENT' || !ev.start) continue;
      const journee = ev.datetype === 'date';
      const duree = ev.end ? new Date(ev.end) - new Date(ev.start) : 0;

      if (!ev.rrule) { poser(ev.start, ev.end, ev, journee); continue; }

      /* Occurrences modifiées et supprimées : elles ne doivent pas être
         régénérées par la règle de récurrence.

         🐞 BUG CORRIGÉ le 20/08 : on ne comparait que les CLÉS de `exdate`, qui
         sont des dates UTC. Or pour un événement « journée entière » à minuit,
         la valeur vaut `2026-08-21T22:00:00Z` — soit le 22 août en heure locale.
         La clé disait donc « 21 » là où l'occurrence tombait le « 22 », et
         AUCUNE suppression n'était jamais appliquée : Rémi supprimait un
         week-end dans iCloud, l'écran continuait de l'afficher.
         On construit désormais l'ensemble à partir des VALEURS ramenées à la
         date locale, en gardant les clés en plus — certains flux emploient
         l'autre convention, et accepter les deux ne coûte rien. */
      const exclus = new Set(Object.keys(ev.exdate || {}));
      for (const v of Object.values(ev.exdate || {})) {
        const dv = new Date(v);
        if (!isNaN(dv)) exclus.add(ymd(dv));
      }
      const modifiees = ev.recurrences || {};

      let dates = [];
      try { dates = ev.rrule.between(debut, fin, true); } catch (_) { dates = []; }

      for (const d of dates) {
        const jour = ymd(d);
        if (exclus.has(jour)) continue;
        if (modifiees[jour]) continue;                 // traitée juste après, avec ses vraies valeurs
        /* ⚠️ `rrule` rend les occurrences à MINUIT UTC. Pour un événement de
           journée entière, l'intention est minuit LOCAL : on recale, sinon le
           jour glisse d'une case dans les fuseaux en retard sur UTC.
           Et la durée se compte en JOURS, pas en millisecondes — 24 h d'écart ne
           font pas un jour lors d'un changement d'heure. */
        let debutOcc;
        if (journee) {
          debutOcc = new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
        } else {
          /* Limite connue : l'occurrence reprend l'heure locale de l'occurrence
             d'origine. Correct pour « même heure chaque semaine » ; un récurrent
             qui changerait d'heure au passage à l'heure d'hiver serait décalé. */
          debutOcc = new Date(d);
          debutOcc.setHours(ev.start.getHours(), ev.start.getMinutes(), ev.start.getSeconds(), 0);
        }

        let finOcc = null;
        if (duree) {
          if (journee) {
            const nbJours = Math.max(1, Math.round(duree / 86400000));
            finOcc = new Date(debutOcc);
            finOcc.setDate(finOcc.getDate() + nbJours);
          } else {
            finOcc = new Date(debutOcc.getTime() + duree);
          }
        }
        poser(debutOcc, finOcc, ev, journee);
      }
      for (const r of Object.values(modifiees)) {
        if (!r || !r.start) continue;
        poser(r.start, r.end, { summary: r.summary || ev.summary, location: r.location || ev.location },
          r.datetype === 'date');
      }
    }

    out.sort((a, b) => a.start.localeCompare(b.start));
    agendaCache = { quand: Date.now(), valeur: out, signature: url };
    return out;
  } catch (e) {
    noter('agenda', e);
    return agendaCache.valeur;            // on garde la dernière bonne lecture
  }
}

/* ------------------------------------------------------------------ météo
   Open-Meteo : gratuit, sans compte ni clé. Cache 15 min, dernière valeur
   conservée si le réseau tombe — l'écran ne doit jamais afficher un trou. */
const CACHE_METEO = 15 * 60 * 1000;
let meteoCache = { quand: 0, valeur: null, signature: '' };

const CODES = {
  0: ['Ciel dégagé', '☀️'], 1: ['Peu nuageux', '🌤️'], 2: ['Partiellement nuageux', '⛅'],
  3: ['Couvert', '☁️'], 45: ['Brouillard', '🌫️'], 48: ['Brouillard givrant', '🌫️'],
  51: ['Bruine légère', '🌦️'], 53: ['Bruine', '🌦️'], 55: ['Bruine forte', '🌧️'],
  61: ['Pluie faible', '🌦️'], 63: ['Pluie', '🌧️'], 65: ['Forte pluie', '🌧️'],
  66: ['Pluie verglaçante', '🌨️'], 67: ['Pluie verglaçante', '🌨️'],
  71: ['Neige faible', '🌨️'], 73: ['Neige', '❄️'], 75: ['Forte neige', '❄️'], 77: ['Grains de neige', '❄️'],
  80: ['Averses', '🌦️'], 81: ['Averses', '🌧️'], 82: ['Fortes averses', '⛈️'],
  85: ['Averses de neige', '🌨️'], 86: ['Averses de neige', '🌨️'],
  95: ['Orage', '⛈️'], 96: ['Orage et grêle', '⛈️'], 99: ['Orage et grêle', '⛈️'],
};
const decrire = (c) => CODES[c] || ['—', ''];

async function lireMeteo() {
  const lat = Number(config('meteo_lat')) || 50.6942;
  const lon = Number(config('meteo_lon')) || 3.1746;
  const signature = `${lat},${lon}`;
  if (meteoCache.signature === signature && Date.now() - meteoCache.quand < CACHE_METEO)
    return meteoCache.valeur;
  const url = 'https://api.open-meteo.com/v1/forecast'
    + `?latitude=${lat}&longitude=${lon}`
    + '&current=temperature_2m,weather_code'
    + '&hourly=temperature_2m,weather_code'
    + '&daily=weather_code,temperature_2m_max,temperature_2m_min'
    + '&forecast_days=3&timezone=Europe%2FParis';
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    const [texte, icone] = decrire(d.current?.weather_code);

    /* Prochaines heures : 5 points, un sur deux, à partir de l'heure suivante. */
    const heures = [];
    const maintenant = Date.now();
    const H = d.hourly || {};
    let depart = (H.time || []).findIndex((t) => new Date(t).getTime() > maintenant);
    if (depart < 0) depart = 0;
    for (let i = depart; i < (H.time || []).length && heures.length < 5; i += 2) {
      heures.push({
        h: String(new Date(H.time[i]).getHours()).padStart(2, '0') + 'h',
        t: Math.round(H.temperature_2m[i]),
        icone: decrire(H.weather_code[i])[1],
      });
    }

    const D = d.daily || {};
    const jours = (D.time || []).slice(1, 3).map((date, i) => ({
      date,
      icone: decrire(D.weather_code[i + 1])[1],
      max: Math.round(D.temperature_2m_max[i + 1]),
      min: Math.round(D.temperature_2m_min[i + 1]),
    }));

    const valeur = {
      ville: config('ville'),
      temp: Math.round(d.current?.temperature_2m),
      texte, icone,
      max: Math.round(D.temperature_2m_max?.[0]),
      min: Math.round(D.temperature_2m_min?.[0]),
      heures, jours,
    };
    meteoCache = { quand: Date.now(), valeur, signature };
    return valeur;
  } catch (e) {
    noter('meteo', e);
    return meteoCache.valeur;
  }
}

/* ------------------------------------------------------------------ actus (RSS) */
const CACHE_NEWS = 15 * 60 * 1000;
let newsCache = { quand: 0, valeur: [], signature: '' };

async function lireNews() {
  const brut = String(config('news_rss') || '').trim();
  if (!brut) return [];
  if (newsCache.signature === brut && Date.now() - newsCache.quand < CACHE_NEWS)
    return newsCache.valeur;

  const flux = brut.split(',').map((x) => x.trim()).filter(Boolean);
  const out = [];
  for (const url of flux) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      const xml = await r.text();
      const source = recettes.commun.nettoyerTexte(
        (/<channel>[\s\S]*?<title>([\s\S]*?)<\/title>/i.exec(xml) || [])[1] || '');
      const titres = [...xml.matchAll(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>/gi)]
        .map((m) => recettes.commun.nettoyerTexte(m[1].replace(/^<!\[CDATA\[|\]\]>$/g, '')))
        .filter(Boolean);
      for (const titre of titres.slice(0, 12)) out.push({ titre, source });
    } catch (e) { noter('actus', e); }
  }
  if (out.length) newsCache = { quand: Date.now(), valeur: out, signature: brut };
  return out.length ? out : newsCache.valeur;
}

/* Réglages exposés au FRONT. Uniquement ce qui sert à l'affichage : rien de
   secret, rien qui donne prise. `veille_minutes` en particulier n'avait aucun
   effet jusqu'ici — l'écran mural avait 25 min codés en dur. */
const reglagesPublics = () => ({
  veille_minutes: Number(config('veille_minutes')) || 25,
  ville: config('ville'),
  /* Réglages de la voix : lus par l'écran mural, qui n'a volontairement aucune
     interface de configuration — tout se règle dans /admin/. */
  voix: {
    nom: config('voix_nom'),
    debit: Number(config('voix_debit')) || 1,
    ton: Number(config('voix_ton')) || 1,
    eveil: (config('voix_eveil') || 'jarvis').trim().toLowerCase(),
    exigerEveil: config('voix_exiger_eveil') !== '0',
  },
});

const listeRayons = () => String(config('rayons')).split(',').map((r) => r.trim()).filter(Boolean);
const enListe = (cle, nom) => String(config(cle) || '').split(',')
  .map((x) => x.trim().toLowerCase()).filter(Boolean).includes(String(nom || '').trim().toLowerCase());

/* Comment l'assistant s'adresse à celui qui parle.
   Deux garde-fous appris à l'écoute :
   - l'appellation ne vaut QUE pour les personnes désignées (« Monsieur » servi à
     Amandine n'allait pas) ;
   - un enfant n'a droit ni à l'appellation ni à l'ironie. Augustin et Clovis ne
     figurent pas dans la table des membres — ils ne sont dans la maison qu'un
     week-end sur deux — donc leur rôle est introuvable. On les reconnaît via le
     réglage `garde_alternes`, à défaut ils seraient traités comme des adultes. */
function styleVocal(personne) {
  const membre = donnees.listeMembres().find((m) => m.nom === personne);
  const role = (membre && membre.role)
    || (enListe('garde_alternes', personne) ? 'enfant' : '');
  return {
    style: config('voix_personnalite'),
    humour: config('voix_humour'),
    appellation: enListe('voix_appellation_pour', personne) ? config('voix_appellation') : '',
    interlocuteur: personne,
    roleInterlocuteur: role,
  };
}

/* Présence pour l'écran : aujourd'hui, et la prochaine arrivée des enfants.
   Pas toute l'année — l'écran n'en montrerait rien de plus. */
function presencePourEcran(agenda) {
  try {
    const auj = presence.pour(new Date(), agenda);
    const suite = presence.prochaines(agenda, 3);
    const aujourdhuiISO = presence.ymd(new Date());
    return {
      ...auj,
      /* La PROCHAINE période qui n'a pas encore commencé : « les garçons
         arrivent vendredi » est une information utile, « ils sont là » l'est
         déjà par `presents`. */
      prochaine: suite.find((p) => p.du > aujourdhuiISO) || null,
    };
  } catch (e) { noter('presence', e); return null; }
}

/* Anniversaires pour l'écran : celui du jour, et les suivants dans le mois à
   venir. On n'envoie pas toute la liste — l'écran n'en montrerait rien de plus,
   et une date de naissance est une donnée qu'on ne diffuse pas sans raison. */
function anniversairesPourEcran() {
  try {
    const tous = donnees.lireAnniversaires();
    const prochains = [];
    for (let d = 1; d <= 31 && prochains.length < 3; d++)
      for (const a of donnees.anniversairesDans(d, tous)) prochains.push({ ...a, dans: d });
    return { aujourdhui: donnees.anniversairesDans(0, tous), prochains };
  } catch (e) { noter('anniversaires', e); return { aujourdhui: [], prochains: [] }; }
}

/* ------------------------------------------------------------------ fête du jour
   Fichier LOCAL, aucun réseau. Relu à chaque appel : corriger une entrée ne
   demande pas de redémarrer le serveur. */
function saintDuJour() {
  try {
    const j = new Date();
    const cle = `${String(j.getMonth() + 1).padStart(2, '0')}-${String(j.getDate()).padStart(2, '0')}`;
    const table = JSON.parse(fs.readFileSync(path.join(__dirname, 'saints.json'), 'utf8'));
    return table[cle] || '';
  } catch (_) { return ''; }
}

/* ------------------------------------------------------------------ santé */
function adresses() {
  const out = [];
  for (const cartes of Object.values(os.networkInterfaces()))
    for (const c of cartes || [])
      if (c.family === 'IPv4' && !c.internal) out.push(`http://${c.address}:${PORT}`);
  return out;
}

/* Adresse par NOM de machine (mDNS / Bonjour).
   L'IP de ce serveur a déjà changé trois fois (10.31.95.95 → 192.168.10.108 →
   .111), et chaque fois elle casse le favori de la tablette. Un nom, lui, ne
   bouge pas : c'est l'adresse à mettre dans le kiosque du Raspberry.
   macOS publie son nom nativement (Bonjour) ; côté Linux, `avahi-daemon` le
   résout. Sous Windows, il faut Bonjour installé — d'où le « probable ». */
const adresseNom = () => `http://${os.hostname().replace(/\.local$/i, '')}.local:${PORT}`;

app.get('/api/health', (_req, res) => res.json({
  ok: true,
  source: donnees.nom,
  token: !!process.env.NOTION_TOKEN,
  ia: recettes.sources().nom,
  abonnes: abonnes.size,
  adresses: adresses(),
  nom: adresseNom(),
}));

/* ------------------------------------------------------------------ lecture principale */
app.get('/api/data', async (req, res) => {
  try {
    const base = await donnees.tout();
    base.menu = await avecPresence(base.menu);
    const [complet, meteo, news] = await Promise.all([lireAgenda(), lireMeteo(), lireNews()]);
    /* On lit un an pour la garde, on n'en envoie que six mois pour l'affichage :
       le Raspberry n'a pas à transporter une année d'événements. */
    const limite = new Date(); limite.setDate(limite.getDate() + JOURS_AFFICHES);
    const agenda = complet.filter((e) => e.start <= limite.toISOString());
    res.json({ ...base, agenda, meteo, news, saint: saintDuJour(),
      presence: presencePourEcran(complet),
      reglages: reglagesPublics(), rayons: listeRayons(),
      anniversaires: anniversairesPourEcran(),
      /* Calculés, jamais téléchargés : onze dates par an dont trois dérivées de
         Pâques. L'écran doit fonctionner quand Internet tombe. */
      feries: feries.fenetre() });
  } catch (e) {
    console.error('/api/data :', e);
    res.status(500).json({ error: messageClair(e) });
  }
});

/* Un message court et actionnable plutôt que l'erreur brute : c'est ce qui
   s'affiche en bandeau rouge sur un mur de cuisine. */
function messageClair(e) {
  const m = String((e && e.message) || e);
  if (/SQLITE_BUSY|database is locked/i.test(m)) return 'Base occupée un instant, réessaie.';
  if (/ENOENT/i.test(m)) return 'Fichier de données introuvable.';
  return m;
}

/* ------------------------------------------------------------------ menu */
app.get('/api/menu', async (req, res) => {
  try { res.json({ menu: await avecPresence(await donnees.lireMenu(req.query.semaine)) }); }
  catch (e) { res.status(500).json({ error: messageClair(e) }); }
});

/* Ajoute à chaque jour le nombre de couverts SUGGÉRÉ par la garde alternée.
   On n'écrase jamais un nombre choisi à la main : le front affiche la
   suggestion à côté, et c'est l'humain qui l'applique s'il veut. */
async function avecPresence(menu) {
  if (config('garde_actif') !== '1') return menu;
  try {
    const agenda = await lireAgenda();
    return menu.map((m) => {
      if (!m.date) return m;
      const p = presence.pour(m.date, agenda);
      return { ...m, couvertsProposes: p.couverts, presence: p.type, presents: p.presents };
    });
  } catch (e) { noter('presence', e); return menu; }
}

/* Proposer une semaine à partir de la bibliothèque. NE REMPLIT RIEN : renvoie
   une proposition, avec pour chaque jour la raison du choix (« pas mangé depuis
   47 jours »). Un menu qu'on n'a pas choisi n'a rien à faire sur le mur. */
app.post('/api/menu/proposer', (req, res) => {
  try {
    res.json(compositeur.proposer({
      semaine: req.body.semaine, moment: req.body.moment, variante: req.body.variante,
    }));
  }
  catch (e) { res.status(400).json({ error: messageClair(e) }); }
});

/* Applique la proposition retenue : plusieurs jours d'un coup, mais UNE seule
   diffusion — sinon l'écran mural se rechargerait sept fois de suite. */
app.post('/api/menu/appliquer', (req, res) => {
  try {
    const r = compositeur.appliquer(req.body.choix || []);
    if (r.poses) majFaite('menu', req);
    res.json(r);
  } catch (e) { res.status(400).json({ error: messageClair(e) }); }
});

app.patch('/api/menu/:id', async (req, res) => {
  try {
    const ligne = await donnees.definirMenu(req.params.id, req.body || {});
    majFaite('menu', req);
    res.json({ menu: ligne });
  } catch (e) { res.status(400).json({ error: messageClair(e) }); }
});

/* ------------------------------------------------------------------ plats & recettes
   `/api/plat/photo` AVANT `/api/plat/:id` : « photo » n'est pas un identifiant. */
app.post('/api/plat/photo', (req, res) => {
  try { res.json({ photo: recettes.images.enregistrerBase64(req.body.image, req.body.type) }); }
  catch (e) { res.status(400).json({ error: messageClair(e) }); }
});

app.get('/api/plat/:id', async (req, res) => {
  try {
    const plat = await donnees.platFiche(req.params.id);
    if (!plat) return res.status(404).json({ error: 'Plat introuvable.' });
    res.json({ plat: recettes.fiche(plat, req.query.couverts) });
  } catch (e) { res.status(500).json({ error: messageClair(e) }); }
});

app.get('/api/recette/sources', (_req, res) => res.json(recettes.sources()));

const equipements = () => donnees.reglage('equipements', '');

app.post('/api/recette/lien', async (req, res) => {
  try { res.json({ recette: await recettes.depuisLien(req.body.url) }); }
  catch (e) { res.status(400).json({ error: messageClair(e) }); }
});

/* Trouver la page d'une recette à partir du seul NOM du plat.
   Différence essentielle avec `/api/recette/nom` (qui interroge l'IA) : ici on
   lit une page réellement publiée, donc on ramène une VRAIE photo, et la fiche
   est vérifiable. Aucune URL n'est fabriquée — c'est la recherche du site qui
   les fournit. */
app.post('/api/recette/chercher', async (req, res) => {
  try {
    const nom = String((req.body && req.body.nom) || '').trim();
    if (!nom) return res.status(400).json({ error: 'Il faut un nom de plat.' });
    const r = await recettes.depuisRecherche(nom);
    if (!r) {
      /* On rend quand même les candidats écartés : c'est plus utile que « rien
         trouvé », et ça laisse la main à l'humain, qui reconnaîtra peut-être le
         bon titre. */
      const proches = await recettes.recherche.chercher(nom, { max: 5, photo: true });
      return res.status(404).json({
        error: `Aucune recette ne correspond assez nettement à « ${nom} ».`,
        /* On dit POURQUOI chacun a été écarté. « Rien trouvé » n'apprend rien et
           ne se conteste pas ; « ce n'est pas le même plat » et « il manque un
           mot » se jugent d'un coup d'œil — et orientent vers le vrai remède,
           qui est souvent de corriger l'orthographe du plat. */
        candidats: proches.map((c) => ({
          titre: c.titre, url: c.url, score: Math.round(c.score * 100),
          photoOk: recettes.recherche.convientPourPhoto(c),
          raison: !c.teteOk ? 'ce n\'est pas le même plat'
            : (!c.tousCouverts && c.extras ? 'il manque un mot du plat, et le titre en ajoute d\'autres'
              : (!c.tousCouverts ? 'il manque un mot du plat' : 'convient pour la photo')),
        })),
      });
    }
    res.json({ recette: r });
  } catch (e) { res.status(400).json({ error: messageClair(e) }); }
});

app.post('/api/recette/nom', async (req, res) => {
  try { res.json({ recette: await recettes.depuisNom(req.body.nom, { equipements: equipements() }) }); }
  catch (e) { res.status(400).json({ error: messageClair(e) }); }
});

app.post('/api/recette/photo', async (req, res) => {
  try {
    res.json({ recette: await recettes.depuisPhoto(req.body.image, req.body.type, { equipements: equipements() }) });
  } catch (e) { res.status(400).json({ error: messageClair(e) }); }
});

/* ------------------------------------------------------------------ courses
   « suggestions », « lot » et « vider » AVANT `/api/course/:id`. Troisième
   occurrence du piège d'ordre des routes sur ce projet. */

/* PROPOSE les ingrédients des plats de la semaine. Ne crée RIEN.
   Contrainte posée par Rémi, et c'est elle qui définit la fonction : avoir un
   plat au menu ne veut pas dire qu'il manque ses ingrédients. */
app.get('/api/course/suggestions', async (req, res) => {
  try {
    const [menu, courses] = await Promise.all([donnees.lireMenu(), donnees.lireCourses()]);
    const entrees = [];
    const sansIngredients = new Set();

    for (const jour of menu) {
      for (const moment of ['midi', 'soir']) {
        const id = jour[`${moment}Id`];
        if (!id) continue;
        const plat = await donnees.platFiche(id);
        if (!plat) continue;
        if (!String(plat.ingredients || '').trim()) { sansIngredients.add(plat.nom); continue; }
        /* Chaque plat est mis à l'échelle des couverts de SON repas. */
        const f = recettes.fiche(plat, jour[`${moment}Couverts`]);
        for (const article of f.ingredients) entrees.push({ article, plat: plat.nom });
      }
    }

    const dejaLa = new Set(courses.map((c) => recettes.normaliserArticle(c.article)));
    const suggestions = recettes.agregerIngredients(entrees).map((s) => ({
      ...s, deja: dejaLa.has(recettes.normaliserArticle(s.article)),
    }));

    res.json({ suggestions, sansIngredients: [...sansIngredients] });
  } catch (e) { res.status(500).json({ error: messageClair(e) }); }
});

/* Ce qu'on rachète toujours. La corbeille des courses conserve tout ce qui a été
   acheté puis retiré : c'est gratuitement un historique d'achats, il suffisait
   de le lire. Rien n'est ajouté — on propose, comme partout ailleurs ici. */
app.get('/api/course/habituels', (req, res) => {
  try { res.json({ habituels: donnees.articlesHabituels(Number(req.query.max) || 10) }); }
  catch (e) { res.status(500).json({ error: messageClair(e) }); }
});

/* Ajout groupé : UNE écriture, donc UNE diffusion — au lieu de quinze
   rafraîchissements en cascade sur l'écran mural. */
app.post('/api/course/lot', async (req, res) => {
  try {
    const r = await donnees.ajouterCoursesEnLot(req.body.articles || [], qui(req));
    /* Rangement dans la foulée : les ingrédients venus d'une recette arrivent
       sans rayon, et une liste non rangée se parcourt mal en magasin. */
    rangerSansRayon();
    if (r.ajoutes) majFaite('course', req);
    res.json(r);
  } catch (e) { res.status(400).json({ error: messageClair(e) }); }
});

/* Ne touche QUE les rayons vides : un choix fait à la main n'est jamais écrasé. */
function rangerSansRayon() {
  const rayons = listeRayons();
  let ranges = 0;
  for (const c of donnees.lireCourses()) {
    if (String(c.rayon || '').trim()) continue;
    const devine = recettes.devinerRayon(c.article, rayons);
    if (!devine) continue;                       // on ne devine pas à moitié
    donnees.definirRayon(c.id, devine);
    ranges++;
  }
  return ranges;
}

app.post('/api/course/vider', async (req, res) => {
  try {
    const r = await donnees.viderCoursesPrises();
    majFaite('course', req);
    res.json(r);
  } catch (e) { res.status(400).json({ error: messageClair(e) }); }
});

app.post('/api/course', async (req, res) => {
  try {
    /* Rayon deviné SEULEMENT s'il n'a pas été choisi : la saisie humaine prime
       toujours sur la déduction. */
    const rayon = String(req.body.rayon || '').trim()
      || recettes.devinerRayon(req.body.article, listeRayons()) || null;
    const c = await donnees.ajouterCourse({ ...req.body, rayon, who: req.body.who || qui(req) });
    majFaite('course', req);
    res.json(c);
  } catch (e) { res.status(400).json({ error: messageClair(e) }); }
});

app.patch('/api/course/:id', async (req, res) => {
  try {
    const c = await donnees.cocherCourse(req.params.id, req.body.pris);
    majFaite('course', req);
    res.json(c);
  } catch (e) { res.status(400).json({ error: messageClair(e) }); }
});

/* ------------------------------------------------------------------ tâches */
app.post('/api/todo', async (req, res) => {
  try {
    const t = await donnees.ajouterTache(req.body);
    majFaite('todo', req);
    res.json(t);
  } catch (e) { res.status(400).json({ error: messageClair(e) }); }
});

app.patch('/api/todo/:id', async (req, res) => {
  try {
    const t = await donnees.cocherTache(req.params.id, req.body.done);
    majFaite('todo', req);
    res.json(t);
  } catch (e) { res.status(400).json({ error: messageClair(e) }); }
});

/* ------------------------------------------------------------------ post-it */
app.post('/api/postit', async (req, res) => {
  try {
    const p = await donnees.ajouterPostit({ ...req.body, who: req.body.who || qui(req) });
    majFaite('postit', req);
    res.json(p);
  } catch (e) { res.status(400).json({ error: messageClair(e) }); }
});

/* ------------------------------------------------------------------ notifications */
app.get('/api/notif', (req, res) => {
  try {
    const admin = req.moi && req.moi.admin;
    const pour = admin ? null : (req.appareil && req.appareil.personne) || null;
    res.json({ notifs: donnees.listeNotifs(pour) });
  } catch (e) { res.status(500).json({ error: messageClair(e) }); }
});

app.post('/api/notif', (req, res) => {
  try {
    const n = donnees.ajouterNotif({ ...req.body, de: req.body.de || qui(req) });
    /* Écrit en base PUIS diffusé : un téléphone éteint retrouvera l'historique. */
    diffuser('notif', n);
    majFaite('notif', req);
    res.json({ notif: n });
  } catch (e) { res.status(400).json({ error: messageClair(e) }); }
});

/* ------------------------------------------------------------------ assistant vocal
   Un point d'entrée unique : une phrase entre, une phrase à dire sort.
   C'est tout ce qu'un Raccourci Siri a besoin de savoir — et demain un micro
   branché sur le Mac mini appellera exactement la même route.

   L'échange s'affiche sur l'écran mural en RÉUTILISANT le bandeau de
   notification existant : aucune modification du bento n'a été nécessaire, et
   le bandeau sait déjà réveiller l'écran en veille — ce qui est précisément le
   comportement voulu quand on parle à la cuisine.

   ⚠️ L'écho n'est PAS enregistré dans l'historique des notifications : diffusé
   seulement. Sinon chaque « ajoute du lait » polluerait l'onglet Notifications
   de toute la famille. C'est justement pour ça que `ajouterNotif` (qui écrit) et
   `diffuser` (qui pousse) sont deux gestes séparés. */
app.post('/api/vocal', async (req, res) => {
  const texte = String((req.body && req.body.texte) || '').trim();
  if (!texte) return res.status(400).json({ error: 'Phrase vide.', reponse: "Je n'ai rien entendu." });

  const personne = qui(req);
  try {
    const [agenda, meteo] = await Promise.all([lireAgenda(), lireMeteo()]);
    /* Le RÔLE de celui qui parle change le ton : l'ironie, même légère, n'a rien
       à faire dans une réponse adressée à un enfant. Le foyer en compte quatre. */
    const style = styleVocal(personne);

    /* Une semaine de présence suffit à répondre à « on sera combien samedi ? »
       sans alourdir la consigne d'une année entière. */
    let pres = null;
    if (config('garde_actif') === '1') {
      const jours = [];
      for (let i = 0; i < 8; i++) {
        const d = new Date(); d.setDate(d.getDate() + i);
        jours.push(presence.pour(d, agenda));
      }
      pres = { jour: jours[0], jours };
    }

    const intention = await vocal.comprendre(texte, {
      donnees, recettes, extras: { agenda, meteo, presence: pres },
      modele: config('ia_modele_vocal') || config('ia_modele'),
      ...style,
    });
    const r = vocal.executer(intention, { donnees, personne, ...style });

    if (r.fait) majFaite('vocal', req);
    diffuser('notif', {
      titre: texte,
      message: r.reponse,
      niveau: 'info',
      /* Adressé à celui qui a parlé : son téléphone affiche l'écho, pas ceux des
         autres. Une commande dictée devant l'écran mural (sans appareil enrôlé)
         n'est adressée à personne et ne s'affiche donc que sur le mur. */
      pour: personne !== 'Écran' ? personne : '',
      de: personne,
      vocal: true,
    });

    res.json({ reponse: r.reponse, action: intention.action, fait: !!r.fait,
      source: intention.source, modele: intention.modele || '' });
  } catch (e) {
    console.error('/api/vocal :', e.message);
    /* Une erreur doit rester DISIBLE : Siri lira `reponse`, pas une pile d'appels. */
    res.status(500).json({ error: messageClair(e), reponse: "Désolé, je n'ai pas pu traiter ça." });
  }
});

/* ------------------------------------------------------------------ appareils & sessions */
app.post('/api/appareil', (req, res) => {
  try {
    const { jeton, personne, nom } = req.body || {};
    const connue = donnees.lirePersonnes().some((p) => p.nom === personne);
    if (!connue) return res.status(400).json({ error: 'Personne inconnue.' });
    res.json(donnees.enrolerAppareil({ jeton, personne, nom }));
  } catch (e) { res.status(400).json({ error: messageClair(e) }); }
});

app.post('/api/session', (req, res) => {
  try {
    const { personne, code } = req.body || {};
    const p = donnees.verifierCode(personne, code);
    if (!p) return res.status(401).json({ error: 'Code incorrect.' });
    res.json({ jeton: donnees.creerSession(p.nom), moi: donnees.profil(p) });
  } catch (e) { res.status(400).json({ error: messageClair(e) }); }
});

app.get('/api/session', (req, res) => {
  if (!req.moi) return res.status(401).json({ error: 'Session expirée.' });
  res.json({ moi: donnees.profil(req.moi) });
});

app.delete('/api/session', (req, res) => {
  const s = req.get('x-session');
  if (s) donnees.supprimerSession(s);
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ « mon » emploi du temps
   🔒 La personne est IMPOSÉE par le jeton de l'appareil, jamais lue dans le corps
   de la requête : depuis le téléphone d'Enora, envoyer `personne:'Martial'` crée
   le créneau chez Enora.
   ⚠️ Chemins à 3 et 4 segments exprès, pour ne pas tomber sur `/api/:kind/:id`. */
const moiOu401 = (req, res) => {
  const p = req.appareil && req.appareil.personne;
  if (!p) { res.status(401).json({ error: 'Appareil non enrôlé. Ouvre /app/ et choisis ton prénom.' }); return null; }
  return p;
};

app.get('/api/planning/mien', (req, res) => {
  const p = moiOu401(req, res); if (!p) return;
  res.json({ creneaux: donnees.lignesPlanning({ personne: p }) });
});

app.post('/api/planning/mien', (req, res) => {
  const p = moiOu401(req, res); if (!p) return;
  try {
    if (req.body.id) {
      const sien = donnees.lignesPlanning({ personne: p }).some((c) => c.id === String(req.body.id));
      if (!sien) return res.status(403).json({ error: "Ce créneau n'est pas le tien." });
    }
    const id = donnees.enregistrerCreneau({ ...req.body, personne: p });
    majFaite('planning', req);
    res.json({ id });
  } catch (e) { res.status(400).json({ error: messageClair(e) }); }
});

app.delete('/api/planning/mien/:id', (req, res) => {
  const p = moiOu401(req, res); if (!p) return;
  const sien = donnees.lignesPlanning({ personne: p }).some((c) => c.id === String(req.params.id));
  if (!sien) return res.status(403).json({ error: "Ce créneau n'est pas le tien." });
  donnees.supprimerCreneau(req.params.id);
  majFaite('planning', req);
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ back-office
   BARRIÈRE POSÉE EN `app.use`, au-dessus de toutes les routes admin : une route
   ajoutée plus bas ne peut pas oublier de la mettre. */
app.use('/api/admin', (req, res, suite) => {
  if (!req.moi || !req.moi.admin)
    return res.status(401).json({ error: 'Session expirée ou droits insuffisants.' });
  suite();
});

const admin = (methode, chemin, faire) => app[methode](`/api/admin${chemin}`, (req, res) => {
  try {
    const r = faire(req);
    res.json(r === undefined ? { ok: true } : r);
  } catch (e) { res.status(400).json({ error: messageClair(e) }); }
});

admin('get', '/etat', () => ({ etat: donnees.etat() }));

admin('get', '/membres', () => ({ membres: donnees.listeMembres() }));
admin('post', '/membres', (req) => { const id = donnees.enregistrerMembre(req.body); majFaite('membre', req); return { id }; });
admin('post', '/membres/:nom/code', (req) => {
  const r = donnees.definirCode(decodeURIComponent(req.params.nom), req.body.code);
  majFaite('membre', req); return r;
});
admin('delete', '/membres/:id', (req) => { const r = donnees.desactiverMembre(req.params.id); majFaite('membre', req); return r; });

admin('get', '/planning', () => ({ creneaux: donnees.lignesPlanning() }));
admin('post', '/planning/copier', (req) => {
  const r = donnees.copierJournee(req.body.personne, req.body.de, req.body.vers);
  majFaite('planning', req); return r;
});
admin('post', '/planning', (req) => { const id = donnees.enregistrerCreneau(req.body); majFaite('planning', req); return { id }; });
admin('delete', '/planning/:id', (req) => { const r = donnees.supprimerCreneau(req.params.id); majFaite('planning', req); return r; });

admin('get', '/plats', () => ({ plats: donnees.listePlatsAdmin() }));
admin('post', '/plats/fusionner', (req) => {
  const r = donnees.fusionnerPlats(req.body.garde, req.body.absorbe);
  majFaite('plat', req); return r;
});
admin('post', '/plats', (req) => { const p = donnees.enregistrerPlat(req.body); majFaite('plat', req); return { plat: p }; });
admin('delete', '/plats/:id', (req) => { const r = donnees.supprimer('plat', req.params.id); majFaite('plat', req); return r; });

admin('get', '/reglages', () => ({ reglages: donnees.lireReglages() }));
admin('post', '/reglages', (req) => {
  const r = donnees.ecrireReglages(req.body);
  /* Les caches portent une signature : changer l'URL de l'agenda ou la ville
     reprend effet au prochain appel, sans attendre l'expiration ni redémarrer.
     Le modèle d'IA, lui, est relu explicitement — il vit dans un module. */
  recettes.definirModele(config('ia_modele'));
  majFaite('reglages', req);
  return { reglages: r };
});

/* Des idées de plats qu'on n'a PAS. Complémentaire du menu proposé, qui lui ne
   sait composer qu'avec la bibliothèque existante. Rien n'est ajouté : on
   propose, Rémi choisit. */
app.post('/api/admin/plats/idees', async (req, res) => {
  try {
    if (!recettes.sources().nom) return res.status(400).json({ error: recettes.sources().pourquoi });
    const existants = donnees.listePlatsAdmin().map((p) => p.nom);
    const liste = await recettes.idees(existants, {
      equipements: equipements(),
      combien: Number(req.body && req.body.combien) || 5,
      modele: config('ia_modele'),
    });
    res.json({ idees: liste });
  } catch (e) { noter('ia', e); res.status(400).json({ error: messageClair(e) }); }
});

/* Ajoute les idées retenues à la bibliothèque — sans recette : elles se
   compléteront ensuite par « 🔎 Trouver en ligne » ou l'IA, comme n'importe
   quel plat saisi à la main. */
admin('post', '/plats/ajouter-lot', (req) => {
  const connus = new Set(donnees.listePlatsAdmin().map((p) => donnees.clef(p.nom)));
  let ajoutes = 0;
  for (const p of req.body.plats || []) {
    const nom = String(p.nom || '').trim();
    if (!nom || connus.has(donnees.clef(nom))) continue;
    donnees.enregistrerPlat({ nom, emoji: p.emoji || null, categorie: p.categorie || null });
    connus.add(donnees.clef(nom));
    ajoutes++;
  }
  if (ajoutes) majFaite('plat', req);
  return { ajoutes };
});

/* Essayer le ton SANS rien écrire et SANS micro.
   Répondre à « comment on teste la voix ? » : on pose une phrase, on lit la
   réponse, on ajuste le réglage, on recommence. `sec: true` fait comprendre la
   demande mais n'exécute jamais l'action — on juge le style, pas les effets. */
app.post('/api/admin/voix/essai', async (req, res) => {
  try {
    const texte = String((req.body && req.body.texte) || '').trim();
    if (!texte) return res.status(400).json({ error: 'Donne une phrase à essayer.' });
    const commePersonne = String((req.body && req.body.personne) || 'Rémi');
    const base = styleVocal(commePersonne);

    const [agenda, meteo] = await Promise.all([lireAgenda(), lireMeteo()]);
    const intention = await vocal.comprendre(texte, {
      donnees, recettes, extras: { agenda, meteo },
      modele: config('ia_modele_vocal') || config('ia_modele'),
      /* Réglages proposés dans le formulaire, pas encore enregistrés : on essaie
         AVANT d'enregistrer, sinon on modifie l'assistant de toute la maison
         juste pour entendre une phrase. Mais on ne contourne PAS les garde-fous :
         l'appellation reste refusée à qui n'y a pas droit. */
      ...base,
      style: (req.body && req.body.personnalite) || base.style,
      humour: (req.body && req.body.humour) || base.humour,
      appellation: base.appellation
        ? ((req.body && req.body.appellation !== undefined) ? req.body.appellation : base.appellation)
        : '',
    });
    res.json({ reponse: intention.reponse || '(pas de phrase)', action: intention.action,
      source: intention.source, modele: intention.modele || '' });
  } catch (e) { res.status(400).json({ error: messageClair(e) }); }
});

/* ---- garde alternée (LECTURE SEULE) ----
   Le calendrier iCloud fait foi : on ne lui écrit jamais rien. Cet écran sert à
   VÉRIFIER ce que le serveur a compris — quelles périodes il a trouvées, d'où
   elles viennent, et qui sera là. Une déduction qu'on ne peut pas relire est une
   déduction qu'on ne peut pas corriger. */
app.get('/api/admin/presence', async (req, res) => {
  try {
    /* `?frais=1` force une relecture immédiate du calendrier. Sans ça, une
       modification faite dans iCloud met jusqu'à 10 minutes à apparaître (le
       cache), et l'on croit à un défaut de synchronisation.
       ⚠️ iCloud a EN PLUS son propre délai de publication : forcer ici ne le
       raccourcit pas. C'est dit dans l'interface. */
    if (req.query.frais === '1') agendaCache = { quand: 0, valeur: agendaCache.valeur, signature: '' };
    const agenda = await lireAgenda();
    const jours = [];
    for (let i = 0; i < 21; i++) {
      const d = new Date(); d.setDate(d.getDate() + i);
      jours.push(presence.pour(d, agenda));
    }
    res.json({
      aujourdhui: presence.pour(new Date(), agenda),
      jours,
      periodes: presence.prochaines(agenda, 15),
      vacances: presence.vacancesSansMarqueur(agenda),
      /* Diagnostic : si l'agenda n'est pas branché, rien ne peut fonctionner —
         mieux vaut le dire que d'afficher une liste vide. */
      agendaBranche: !!config('agenda_ics'),
      evenements: agenda.length,
    });
  } catch (e) { res.status(500).json({ error: messageClair(e) }); }
});

/* ---- journal technique ---- */
admin('get', '/journal', () => ({ journal: donnees.lireJournal(), nonVu: donnees.journalNonVu() }));
admin('post', '/journal/vu', () => { donnees.marquerJournalVu(); return { ok: true }; });
admin('delete', '/journal', () => donnees.viderJournal());

/* ---- anniversaires ----
   Ceux du foyer se saisissent dans la fiche du membre (`personnes.naissance`) ;
   cette table ne contient QUE les autres. Une personne n'est jamais décrite
   deux fois. */
admin('get', '/anniversaires', () => ({
  anniversaires: donnees.lireAnniversaires(),
  aujourdhui: donnees.anniversairesDans(0),
}));
admin('post', '/anniversaires', (req) => {
  const id = donnees.enregistrerAnniversaire(req.body);
  majFaite('anniversaire', req); return { id };
});
admin('delete', '/anniversaires/:id', (req) => {
  const r = donnees.supprimerAnniversaire(req.params.id);
  majFaite('anniversaire', req); return r;
});

/* Déclencher les rappels à la main, sans attendre l'heure : indispensable pour
   vérifier qu'ils partent, et pour rattraper une journée manquée. */
admin('post', '/rappels/tester', (req) => {
  const bilan = rappels.passer({ force: true, devinerRayon: recettes.devinerRayon, rayonsConnus: listeRayons() });
  majFaite('rappels', req);
  return { bilan };
});

admin('get', '/appareils', () => ({ appareils: donnees.listeAppareils() }));
admin('delete', '/appareils/:id', (req) => { const r = donnees.revoquerAppareil(req.params.id); majFaite('appareil', req); return r; });

/* Trouve les PHOTOS manquantes, à la demande d'un humain.

   Comble un manque réel, signalé par Rémi après avoir complété ses fiches :
   « ça fonctionne sauf pour les photos ». Et c'est normal — l'IA écrit une
   recette de mémoire, elle ne navigue pas, elle ne peut donc RIEN photographier.
   Seule une page réellement lue en ramène une.

   Ne touche QUE `photo` (et `source_url` s'il est vide) : les recettes déjà
   écrites, corrigées à la main ou non, ne bougent pas d'un mot. */
const LOT_PHOTOS = 10;

app.post('/api/admin/plats/photos', async (req, res) => {
  try {
    const sans = donnees.listePlatsAdmin().filter((p) => !String(p.photo || '').trim());
    /* ⚠️ `depuis` n'est pas un raffinement, c'est une correction.
       Sans lui, les plats introuvables restent en tête de liste et occupent les
       mêmes places à chaque passage : relancer le bouton retraitait sans fin les
       trois mêmes échecs, et les plats suivants n'étaient JAMAIS atteints. */
    const depuis = Math.max(0, Number(req.body && req.body.depuis) || 0);
    const lot = sans.slice(depuis, depuis + LOT_PHOTOS);
    const bilan = {
      candidats: sans.length, depuis, traites: lot.length, trouvees: 0,
      restants: Math.max(0, sans.length - (depuis + lot.length)),
      sansCorrespondance: [], echecs: [],
    };

    for (const plat of lot) {
      try {
        const r = await recettes.photoPour(plat.nom, { generiques: config('photos_generiques') });
        /* Pas de correspondance assez nette : on le DIT, on ne prend rien.
           Une vignette fausse sur un mur de cuisine se remarque tout de suite,
           et fait douter de tout le reste. */
        if (!r) { bilan.sansCorrespondance.push(plat.nom); continue; }
        donnees.enregistrerPlat({ ...plat, photo: r.photo, source_url: plat.source_url || r.url });
        bilan.trouvees++;
      } catch (e) { bilan.echecs.push(`${plat.nom} (${e.message})`); }
      /* On reste poli avec le site : une pause entre deux recherches. */
      await new Promise((r2) => setTimeout(r2, 600));
    }
    if (bilan.trouvees) majFaite('plat', req);
    res.json({ bilan });
  } catch (e) { res.status(400).json({ error: messageClair(e) }); }
});

/* Complète les fiches VIDES, à la demande d'un humain.
   Pas de tâche de fond, et c'est un choix : un travail qui réécrirait des recettes
   finirait par écraser une correction faite à la main sans que personne sache
   pourquoi. Plafonné à 8 plats par appel pour ne pas expirer. */
app.post('/api/admin/plats/completer', async (req, res) => {
  try {
    if (!recettes.sources().nom)
      return res.status(400).json({ error: recettes.sources().pourquoi });

    const vides = donnees.listePlatsAdmin().filter((p) => !String(p.etapes || '').trim());
    const lot = vides.slice(0, 8);
    const bilan = { candidats: vides.length, remplis: 0, restants: 0, echecs: [] };
    const eq = equipements();

    for (const plat of lot) {
      try {
        /* On tente D'ABORD une page réellement publiée : elle apporte une
           recette vérifiable ET une photo, là où l'IA ne peut apporter qu'une
           recette estimée. On ne retombe sur l'IA que si aucune page ne
           correspond assez nettement au nom du plat. */
        let r = null;
        try { r = await recettes.depuisRecherche(plat.nom); } catch (_) { r = null; }
        if (!r) r = await recettes.depuisNom(plat.nom, { equipements: eq });

        /* N'écrase AUCUN champ déjà rempli. */
        donnees.enregistrerPlat({
          ...plat,
          ingredients: plat.ingredients || r.ingredients.join(', '),
          etapes: plat.etapes || r.etapes.join('\n'),
          portions: plat.portions || r.portions,
          duree: plat.duree || r.duree,
          appareils: plat.appareils || (r.appareils || []).join(', '),
          photo: plat.photo || r.photo || null,
          source_url: plat.source_url || r.url || null,
        });
        bilan.remplis++;
      } catch (e) { bilan.echecs.push(`${plat.nom} (${e.message})`); }
    }
    bilan.restants = Math.max(0, vides.length - lot.length);
    if (bilan.remplis) majFaite('plat', req);
    res.json({ bilan });
  } catch (e) { res.status(400).json({ error: messageClair(e) }); }
});

/* ------------------------------------------------------------------ corbeille commune
   ⚠️ DÉCLARÉE EN DERNIER : `/api/:kind/:id` capte tout chemin à trois segments.
   Placée plus haut, elle avalerait `/api/notif/:id`, `/api/course/vider`, etc. */
app.delete('/api/:kind/:id', async (req, res) => {
  try {
    const r = await donnees.supprimer(req.params.kind, req.params.id);
    if (!r) return res.status(400).json({ error: 'Type inconnu : ' + req.params.kind });
    majFaite(req.params.kind, req);
    res.json(r);
  } catch (e) { res.status(400).json({ error: messageClair(e) }); }
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'Route inconnue.' }));

/* ------------------------------------------------------------------ démarrage */
donnees.purgerSessions?.();
amorcerReglages();
recettes.definirModele(config('ia_modele'));

const rappels = creerRappels({ donnees, diffuser, config });
const compositeur = creerMenu({ donnees });
const presence = creerPresence({ donnees, config });

const serveur = app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🏠 Écran Maison — source de données : ${donnees.nom}`);
  console.log(`   Base : ${donnees.fichier || '(Notion)'}`);
  const liste = adresses();
  console.log(`\n   Écran mural   : http://localhost:${PORT}/bento.html`);
  console.log(`   App famille   : http://localhost:${PORT}/app/`);
  console.log(`   Administration: http://localhost:${PORT}/admin/`);
  if (liste.length) {
    /* Rappels : vérifiés au démarrage puis toutes les 15 min. C'est l'heure et
       la date du dernier passage qui décident, pas le minuteur — un serveur
       relancé cinq fois dans la matinée n'envoie rien cinq fois. */
    rappels.planifier({ devinerRayon: recettes.devinerRayon, rayonsConnus: listeRayons() });
    console.log('\n   Depuis la tablette et les iPhone (l\'IP change avec le réseau Wi-Fi) :');
    for (const a of liste) console.log(`     ${a}/bento.html   ·   ${a}/app/`);
    /* À privilégier pour le kiosque : un nom ne change pas quand le DHCP
       redistribue les adresses. */
    console.log(`\n   Par nom de machine (à mettre dans le kiosque, ne change jamais) :`);
    console.log(`     ${adresseNom()}/bento.html`);
  }
  console.log('');
});

serveur.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n✗ Le port ${PORT} est déjà pris (whatsapp-bridge occupe le 8080 sur ce PC).`);
    console.error('  Change PORT dans le .env, ou arrête l\'autre programme.\n');
  } else console.error('\n✗ Démarrage impossible :', e.message, '\n');
  process.exit(1);
});

/* Fermer proprement : sinon les abonnés SSE gardent la main et le port reste pris. */
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    for (const res of abonnes) { try { res.end(); } catch (_) {} }
    serveur.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  });
}
