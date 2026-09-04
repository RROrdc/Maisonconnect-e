/* École — les briques qui se testent SANS réseau ni compte.

   Les lectures EcoleDirecte et Pronote dépendent d'identifiants, d'un serveur
   distant et d'un QR déjà échangé : elles ne sont pas rejouables, donc elles ne
   sont pas ici. Ce qui l'est — encodage, décodage, normalisation — est
   précisément là où les trois bugs du 03/09 se sont logés, et chacun d'eux
   était invisible en relecture. D'où cette série. */
const fs = require('fs');
const path = require('path');
const A = require('./aide');

const commun = require(path.join(__dirname, '..', '..', 'ecole', 'commun'));
const ecole = require(path.join(__dirname, '..', '..', 'ecole'));

/* Exécute TOUS les <script> d'une page dans un DOM factice, avec une fausse
   API. Ce n'est pas un navigateur — la mise en page n'est pas vérifiée (aucune
   capture d'écran sur ce poste, § 2 sexies) — mais le CHEMIN des données l'est,
   et c'est précisément là que se logent les défauts qu'aucun test d'API ne voit. */
async function executerPage(chemin, cibleId, donnees, ecole) {
  const vm2 = require('vm');
  const page = fs.readFileSync(path.join(__dirname, '..', '..', 'public', chemin), 'utf8');
  const els = {};
  const faux = (id) => (els[id] = els[id] || {
    id, innerHTML: '', textContent: '', value: '', content: '', style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    appendChild() {}, addEventListener() {}, setAttribute() {}, removeAttribute() {},
    insertAdjacentHTML() {}, remove() {}, focus() {}, blur() {}, scrollIntoView() {},
    closest: () => null, getBoundingClientRect: () => ({ width: 100, height: 100 }),
    getContext: () => new Proxy({}, { get: () => () => {} }),
    querySelector: () => faux(id + '>q'), querySelectorAll: () => [],
  });
  const doc = {
    getElementById: faux, createElement: () => faux('neuf'), addEventListener() {},
    documentElement: Object.assign(faux('html'), { dataset: {}, style: {} }),
    body: faux('body'), head: faux('head'),
    /* ⚠️ L'app passe par $('#ecran') — querySelector — là où le bento appelle
       getElementById. Sans cette équivalence les deux pages n'écrivent pas dans
       le même élément factice, et le test échoue pour une raison de banc. */
    querySelector: (q) => faux(/^#[\w-]+$/.test(q) ? q.slice(1) : 'sel:' + q),
    querySelectorAll: () => [],
  };
  const ctx2 = {
    console: { log() {}, warn() {}, error() {} }, document: doc, JSON, Math, Date,
    isNaN, parseInt, parseFloat, String, Number, Object, Array, RegExp, Error, Promise,
    Set, Map, encodeURIComponent, decodeURIComponent, setImmediate,
    window: {
      addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }),
      location: { protocol: 'http:', reload() {} }, innerWidth: 1080, innerHeight: 1920,
    },
    navigator: { userAgent: 'test', language: 'fr-FR' },
    localStorage: {
      /* L'app ouvre le dernier onglet consulté : on la place sur « Devoirs »,
         sinon on juge l'accueil, qui ne montre volontairement que l'échéance
         courte — et le test échouerait pour la mauvaise raison. */
      _d: { 'maison-jeton': 'J', 'maison-personne': (donnees.moi && donnees.moi.nom) || 'Martial',
        'maison-onglet': donnees.__onglet || 'devoirs' },
      getItem(k) { return this._d[k] === undefined ? null : this._d[k]; },
      setItem(k, v) { this._d[k] = v; }, removeItem(k) { delete this._d[k]; },
    },
    setInterval: () => 0, setTimeout: (fn) => { if (typeof fn === 'function') fn(); return 0; },
    clearInterval() {}, clearTimeout() {}, requestAnimationFrame: () => 0,
    EventSource: function () { this.addEventListener = () => {}; this.close = () => {}; },
    SpeechSynthesisUtterance: function () {},
    speechSynthesis: { getVoices: () => [], speak() {}, cancel() {} },
    /* ⚠️ /api/ecole répond APRÈS /api/data, exprès : c'est cet ordre-là qui a
       révélé la course du 03/09. Un banc où l'école répond en premier passe au
       vert alors que l'écran reste vide — le test aurait menti. */
    fetch: async (url) => {
      const u = String(url);
      if (u.indexOf('/api/ecole') >= 0) {
        await new Promise((r) => setImmediate(r));
        await new Promise((r) => setImmediate(r));
      }
      return { ok: true, json: async () => {
        if (u.indexOf('/api/ecole') >= 0) return ecole;
        if (u.indexOf('/api/data') >= 0) return donnees;
        if (u.indexOf('/api/notif') >= 0) return { notifs: [] };
        if (u.indexOf('/api/planning/mien') >= 0) return { creneaux: [] };
        return {};
      } };
    },
  };
  ctx2.globalThis = ctx2; ctx2.self = ctx2; ctx2.location = ctx2.window.location;
  vm2.createContext(ctx2);
  const erreurs = [];
  const scripts = page.match(/<script(?![^>]*\ssrc=)[^>]*>[\s\S]*?<\/script>/g) || [];
  for (const bloc of scripts) {
    const code = bloc.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
    try { vm2.runInContext(code, ctx2, { timeout: 8000 }); }
    catch (e) { erreurs.push(e.message); }
  }
  /* ⚠️ Les scripts lancent des fetch : on rend la main assez de fois pour que
     les promesses se dénouent, sinon on lit l'écran AVANT le chargement et le
     test échoue pour une raison qui n'a rien à voir avec le produit. */
  for (let i = 0; i < 40; i++) await new Promise((r) => setImmediate(r));
  /* `let` en tête de script crée une liaison lexicale, PAS une propriété du
     contexte : on ne peut pas lire ctx.S depuis l'extérieur. On rend donc une
     fonction qui évalue DANS le contexte — seule façon d'interroger la page. */
  const dedans = (expr) => vm2.runInContext(expr, ctx2);
  return { erreurs, html: (els[cibleId] && els[cibleId].innerHTML) || '', ctx: ctx2, dedans };
}

module.exports = async function serie() {
  const t = A.compteur();

  /* ── Encodage des identifiants ────────────────────────────────────────
     `encodeURIComponent` laisse « $ » intact là où le serveur attend %24, et
     un « & » non encodé couperait le corps de la requête en deux. Le mot de
     passe réel du compte contient justement un « & ». */
  t.titre('Encodage attendu par EcoleDirecte');
  const CAS_ENCODAGE = [
    ['abc', 'abc', 'ce qui est sûr passe tel quel'],
    ['a$b', 'a%24b', 'le dollar est encodé (encodeURIComponent ne le ferait PAS)'],
    ['a&b', 'a%26b', 'l’esperluette, qui couperait le corps de la requête'],
    ['a@b.com', 'a%40b.com', 'l’arobase d’une adresse'],
    ['é', '%C3%A9', 'un accent, en UTF-8 sur deux octets'],
    ['a b', 'a%20b', 'l’espace'],
    ['a"b', 'a%22b', 'le guillemet, qui casserait le JSON'],
    ["a'b", "a'b", 'l’apostrophe est sûre, elle ne bouge pas'],
  ];
  for (const [entree, attendu, pourquoi] of CAS_ENCODAGE) {
    t.dire(commun.encoderED(entree) === attendu, `« ${entree} » → « ${attendu} »`, pourquoi);
  }

  /* ── Base64 conditionnel ──────────────────────────────────────────────
     EcoleDirecte encode la question du QCM et les devoirs en base64, mais PAS
     le sujet des messages. Décoder aveuglément a rendu les quatre messages du
     lycée en charabia binaire. Le piège : un sujet court et sans accent
     ressemble parfaitement à du base64 — le test doit donc porter sur le
     RÉSULTAT, jamais sur la forme de l'entrée. */
  t.titre('Base64 seulement quand le résultat est lisible');
  const CAS_B64 = [
    ['UsOpdW5pb24gcGFyZW50cw==', 'Réunion parents', 'du vrai base64 accentué'],
    ['Réunion parents', 'Réunion parents', 'du texte clair accentué reste intact'],
    ['Absence', 'Absence', 'LE PIÈGE : ressemble à du base64, n’en est pas'],
    ['Documents officiels', 'Documents officiels', 'texte clair avec espace'],
    ['', '', 'vide'],
  ];
  for (const [entree, attendu, pourquoi] of CAS_B64) {
    t.dire(commun.texteEventuellementBase64(entree) === attendu, `« ${String(entree).slice(0, 26)} »`, pourquoi);
  }
  t.dire(commun.deBase64(commun.enBase64('Élève à Roubaix — 8h05')) === 'Élève à Roubaix — 8h05',
    'aller-retour base64 en UTF-8', 'les accents survivent');

  /* ── HTML → texte ─────────────────────────────────────────────────────
     Les devoirs arrivent en HTML. Un pavé d'un seul tenant est illisible sur un
     mur — même défaut que les recettes du § 2 quinquies. */
  t.titre('Contenu HTML rendu lisible');
  const html = '<p>Exercices 3 et 4<br>p.&nbsp;42</p><ul><li>relire le cours</li></ul>';
  const texte = commun.texteDeHtml(html);
  t.dire(!/[<>]/.test(texte), 'plus aucune balise', JSON.stringify(texte));
  t.dire(texte.split('\n').length >= 3, 'les blocs deviennent des lignes');
  t.dire(commun.texteDeHtml('a &amp;lt; b') === 'a &lt; b', 'les entités ne se décodent pas deux fois');

  /* ── Année scolaire ───────────────────────────────────────────────────
     La bascule en août est la convention de l'API elle-même. */
  t.titre('Année scolaire');
  t.dire(commun.anneeScolaire(new Date(2026, 8, 3)) === '2026-2027', 'septembre 2026 → 2026-2027');
  t.dire(commun.anneeScolaire(new Date(2026, 7, 1)) === '2026-2027', '1er août bascule déjà');
  t.dire(commun.anneeScolaire(new Date(2026, 5, 15)) === '2025-2026', 'juin reste sur l’année précédente');

  /* ── Normalisation ────────────────────────────────────────────────────
     Date et heure séparées : découper une chaîne ISO a déjà coûté deux heures
     de décalage au § 2 quindecies. Et `annule` doit être un booléen — c'est ce
     qui portera l'affichage des cours supprimés. */
  t.titre('Un cours a la même forme quelle que soit la source');
  const c = ecole.coursNormalise({
    start_date: '2026-09-08 08:00', end_date: '2026-09-08 08:55',
    matiere: 'Mathématiques', text: 'MATHEMATIQUES', prof: 'SANDOR V.', salle: '17', isAnnule: true,
  }, 'Martial');
  t.dire(c.jour === '2026-09-08' && c.debut === '08:00' && c.fin === '08:55', 'date et heures séparées');
  t.dire(c.annule === true, 'un cours annulé est marqué', 'c’est ce qui alimentera l’affichage barré');
  t.dire(c.eleve === 'Martial' && c.source === 'ecoledirecte', 'élève et source portés');
  t.dire(c.matiere === 'Mathématiques' && c.libelle === 'MATHEMATIQUES',
    'le libellé brut est conservé à côté du nom propre');

  t.titre('Un message a la même forme');
  const m = ecole.messageNormalise({ id: 12, date: '2026-09-01 17:18:52', read: false, subject: 'Documents officiels', from: { nom: 'KRZESAJ', prenom: 'A.' } });
  t.dire(m.sujet === 'Documents officiels', 'sujet non-base64 laissé intact');
  t.dire(m.de === 'A. KRZESAJ' && m.lu === false, 'expéditeur et état de lecture');
  t.dire(m.id === '12', 'identifiant en TEXTE',
    'le front compare à des attributs data-…, toujours des chaînes (§ 2 sexies)');

  /* ── Comptes ──────────────────────────────────────────────────────────
     Un identifiant sans mot de passe ne fait pas un compte : c'est l'état
     exact du .env quand on prépare l'arrivée d'un enfant. */
  t.titre('Détection des comptes configurés');
  t.dire(ecole.comptesConfigures({ ED_IDENTIFIANT: 'a', ED_MOTDEPASSE: 'b' }).length === 1, 'un compte complet compte');
  t.dire(ecole.comptesConfigures({ ED_IDENTIFIANT: 'a' }).length === 0, 'un identifiant SANS mot de passe ne compte pas');
  t.dire(ecole.comptesConfigures({
    ED_IDENTIFIANT: 'a', ED_MOTDEPASSE: 'b', ED_IDENTIFIANT_2: 'c', ED_MOTDEPASSE_2: 'd',
  }).length === 2, 'deux établissements = deux comptes', 'Martial au lycée, Enora au collège');
  t.dire(ecole.comptesConfigures({}).length === 0, 'aucun compte quand rien n’est renseigné');

  /* Le fichier d'état ne doit JAMAIS porter l'identifiant en clair : un nom de
     fichier se retrouve dans un listing, une sauvegarde, un message d'erreur.
     🔴 Ce contrôle utilisait le VRAI identifiant EcoleDirecte — donc un test
     écrit pour protéger la vie privée publiait précisément ce qu'il protège,
     et serait parti sur GitHub (attrapé par `outils/verifier-secrets.js` juste
     avant le push du 04/09). Un identifiant inventé prouve exactement la même
     chose, et ne dépend plus du compte de personne. */
  const faux = 'essai.locataire@exemple.invalid';
  const nom = ecole.fichierEtat(faux);
  t.dire(!nom.includes('essai') && !nom.includes('exemple') && !nom.includes('@'),
    'le fichier d’état est nommé par empreinte', 'jamais l’identifiant en clair : ' + nom);
  t.dire(ecole.fichierEtat(faux) === nom && ecole.fichierEtat(faux + 'x') !== nom,
    'l’empreinte est stable et distingue deux comptes',
    'sinon deux établissements se marcheraient dessus');

  /* ── Quels devoirs vont sur le mur ────────────────────────────────────
     La règle vient de Rémi : « Augustin quand il est là le week-end doit
     afficher les devoirs du lundi, mardi et mercredi qui arrivent. »
     Le 2026-09-05 est un SAMEDI, le 2026-09-07 un lundi. */
  t.titre('Devoirs affichés : présence et horizon');
  const pertinence = require(path.join(__dirname, '..', '..', 'ecole', 'pertinence'));

  /* Emploi du temps : cours du lundi au vendredi, rien le week-end. */
  const COURS = [];
  for (const j of ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11']) {
    COURS.push({ eleve: 'Augustin', jour: j, debut: '08:30', matiere: 'MATHEMATIQUES' });
    COURS.push({ eleve: 'Martial', jour: j, debut: '08:00', matiere: 'FRANCAIS' });
  }
  const DEVOIRS = [
    { eleve: 'Augustin', pour: '2026-09-07', matiere: 'FRANCAIS', contenu: 'lundi', fait: false },
    { eleve: 'Augustin', pour: '2026-09-08', matiere: 'MATHS', contenu: 'mardi', fait: false },
    { eleve: 'Augustin', pour: '2026-09-09', matiere: 'SVT', contenu: 'mercredi', fait: false },
    { eleve: 'Augustin', pour: '2026-09-10', matiere: 'ANGLAIS', contenu: 'jeudi', fait: false },
    { eleve: 'Martial', pour: '2026-09-07', matiere: 'PHYSIQUE', contenu: 'lundi', fait: false },
  ];

  /* Samedi, Augustin est là : lundi + mardi + mercredi, pas jeudi. */
  let r = pertinence.devoirsDuMoment({
    devoirs: DEVOIRS, cours: COURS, presents: ['Rémi', 'Amandine', 'Augustin'], aujourdhui: '2026-09-05',
  });
  let siens = r.devoirs.filter((d) => d.eleve === 'Augustin').map((d) => d.contenu);
  /* ⚠️ On ne COUPE plus : le mur montre tout ce qui vient, sinon il annonce
     « tout est fait » à un enfant qui a du travail plus loin (vécu le 04/09).
     La règle des jours d'école sert désormais à MARQUER ce qui est proche,
     donc à hiérarchiser — pas à faire disparaître. */
  const proches = r.devoirs.filter((d) => d.eleve === 'Augustin' && d.proche).map((d) => d.contenu);
  t.dire(proches.join(',') === 'lundi,mardi,mercredi',
    'samedi → lundi, mardi et mercredi marqués proches', 'demandé mot pour mot par Rémi : ' + JSON.stringify(proches));
  t.dire(!proches.includes('jeudi') && siens.includes('jeudi'), 'jeudi est montré mais PAS marqué proche',
    'le masquer ferait mentir le compteur, ne pas le hiérarchiser noierait l’urgent');
  t.dire(r.details.Augustin.creux === true, 'le samedi est reconnu comme un creux');
  t.dire(!r.devoirs.some((d) => d.eleve === 'Martial'),
    'Martial absent ce week-end → aucun de ses devoirs', 'règle 1 : seulement qui est à la maison');

  /* Le même samedi, si Martial est là aussi, ses devoirs reviennent. */
  r = pertinence.devoirsDuMoment({
    devoirs: DEVOIRS, cours: COURS, presents: ['Martial', 'Augustin'], aujourdhui: '2026-09-05',
  });
  t.dire(r.devoirs.some((d) => d.eleve === 'Martial'), 'Martial présent → ses devoirs reviennent');

  /* 🐞 LE DIMANCHE — trouvé par la simulation sur les vraies données, pas par
     la relecture. Le premier jet ne regardait que « demain est-il un jour
     d'école » : le dimanche, demain EST lundi, donc il ne montrait que lundi.
     Or le dimanche est le dernier moment où Augustin peut travailler chez nous
     avant de repartir — c'est LE jour où lundi, mardi et mercredi comptent. */
  r = pertinence.devoirsDuMoment({
    devoirs: DEVOIRS, cours: COURS, presents: ['Augustin'], aujourdhui: '2026-09-06',
  });
  siens = r.devoirs.filter((d) => d.eleve === 'Augustin').map((d) => d.contenu);
  t.dire(r.devoirs.filter((d) => d.eleve === 'Augustin' && d.proche).map((d) => d.contenu).join(',') === 'lundi,mardi,mercredi',
    'DIMANCHE → lundi, mardi et mercredi marqués proches', 'dernier jour chez nous : ' + JSON.stringify(siens));
  t.dire(r.details.Augustin.creux === true, 'le dimanche est un creux',
    'pas d’école aujourd’hui, même si demain il y en a');

  /* Vendredi soir : école aujourd'hui, mais pas demain — on peut s'avancer. */
  r = pertinence.devoirsDuMoment({
    devoirs: DEVOIRS, cours: COURS, presents: ['Augustin'], aujourdhui: '2026-09-11',
  });
  t.dire(r.details.Augustin.creux === true, 'vendredi soir est un creux',
    'école aujourd’hui, mais le week-end s’ouvre');

  /* Un soir de semaine : on ne prépare que le lendemain. */
  r = pertinence.devoirsDuMoment({
    devoirs: DEVOIRS, cours: COURS, presents: ['Augustin'], aujourdhui: '2026-09-07',
  });
  siens = r.devoirs.filter((d) => d.eleve === 'Augustin').map((d) => d.contenu);
  t.dire(r.devoirs.filter((d) => d.eleve === 'Augustin' && d.proche).map((d) => d.contenu).join(',') === 'mardi',
    'lundi soir → seul mardi est marqué proche', JSON.stringify(siens));
  t.dire(siens.length > 1, 'mais la suite reste visible et comptée',
    'un compteur qui oublie ce qui vient annonce « tout est fait » à tort');
  t.dire(r.details.Augustin.creux === false, 'un lundi n’est pas un creux');

  /* 🔑 LE JOUR MÊME N'EST PAS SUR LE MUR — demande de Rémi devant l'écran le
     04/09 : « je vois pour Augustin ceux du jour, du vendredi, mais ça on s'en
     fout ; ce qui m'intéresse c'est lundi, mardi, mercredi qui suivent ». Il a
     raison : un devoir « pour lundi » a été rendu en cours lundi matin, le voir
     lundi soir sur le mur de la cuisine ne sert à rien et pousse dehors ce qui
     reste à faire. Le mur regarde DEVANT. */
  t.dire(!r.devoirs.some((d) => d.contenu === 'lundi'),
    'le mur ne montre PAS le devoir du jour même',
    'il a été rendu le matin — la place va à ce qui vient');
  /* On coche le devoir de DEMAIN, pas celui du jour : celui du jour ne figure
     plus sur le mur, le test ne prouverait plus rien. */
  const faits = pertinence.devoirsDuMoment({
    devoirs: DEVOIRS.map((d) => (d.pour === '2026-09-08' ? { ...d, fait: true } : d)),
    cours: COURS, presents: ['Augustin'], aujourdhui: '2026-09-07',
  });
  /* ⚠️ Un devoir coché dans l'application de l'établissement reste DANS la
     liste, avec son drapeau : c'est l'affichage qui choisit de le barrer (app)
     ou de le masquer (mur). Le serveur ne décide pas de l'affichage. */
  t.dire(faits.devoirs.some((d) => d.contenu === 'mardi' && d.fait === true),
    'un devoir coché dans Pronote/EcoleDirecte reste présent, marqué fait',
    'l’affichage tranche : barré dans l’app, masqué sur le mur');
  t.dire(faits.restants === faits.devoirs.filter((d) => !d.fait).length,
    '« restants » compte les non faits', 'c’est ce qu’affiche une pastille');
  t.dire(faits.faits >= 1, '« faits » les compte séparément',
    'le mur peut dire « 2 faits » sans voler une ligne à ce qui reste');

  /* Le passé ne remonte jamais. */
  r = pertinence.devoirsDuMoment({ devoirs: DEVOIRS, cours: COURS, presents: ['Augustin'], aujourdhui: '2026-09-14' });
  t.dire(r.devoirs.length === 0, 'les échéances passées ne remontent pas');

  /* Présence inconnue : on montre tout le monde plutôt que rien — un écran
     vide ferait croire à une panne. */
  r = pertinence.devoirsDuMoment({ devoirs: DEVOIRS, cours: COURS, presents: null, aujourdhui: '2026-09-05' });
  t.dire(r.devoirs.some((d) => d.eleve === 'Martial') && r.devoirs.some((d) => d.eleve === 'Augustin'),
    'présence inconnue → on n’exclut personne', 'mieux vaut trop que du vide inexpliqué');

  /* Vacances : aucun cours devant, donc le repli sur les jours de semaine
     s'applique au-delà de l'horizon connu — mais dans l'horizon connu, un jour
     sans cours n'est pas un jour d'école. */
  t.dire(pertinence.estJourEcole('2026-09-06', new Set(['2026-09-07']), '2026-09-11') === false,
    'un dimanche dans l’horizon connu n’est pas un jour d’école');
  t.dire(pertinence.estJourEcole('2026-12-15', new Set(['2026-09-07']), '2026-09-11') === true,
    'au-delà de l’horizon lu, un lundi est supposé travaillé', 'supposer l’inverse ferait disparaître des devoirs');

  /* ── Le RENDU de la section devoirs, exécuté hors navigateur ──────────
     Les captures d'écran sont interdites sur ce poste depuis la quarantaine
     (§ 2 sexies), et c'est justement le rendu qui cache les défauts que l'API
     ne montre jamais — la leçon est écrite noir sur blanc depuis le 14/08.
     On extrait donc les fonctions de rendu de bento.html et on les exécute
     dans un contexte isolé, sur des données choisies pour leurs pièges. */
  t.titre('Rendu de la section devoirs (bento.html)');
  const vm = require('vm');
  const pageBento = require('fs').readFileSync(path.join(__dirname, '..', '..', 'public', 'bento.html'), 'utf8');
  /* 🐞 La version naïve coupait au premier « }; » rencontré — donc au milieu de
     `par.get(d.eleve) || {reste:0, total:0};`, ce qui rendait un extrait
     tronqué et une série entière « Unexpected end of input ». On cherche le
     « }; » EN DÉBUT DE LIGNE, qui est la convention de fermeture du fichier.
     ⚠️ Corriger l'extracteur, jamais le code produit : façonner le code pour
     plaire à un test, c'est le test qui gouverne au lieu de vérifier. */
  const bout = (nom, finBout) => {
    const k = pageBento.indexOf(nom);
    if (k < 0) throw new Error('bento.html : ' + nom + ' introuvable');
    const marque = finBout === '};' ? '\n};' : finBout;
    const fin = pageBento.indexOf(marque, k);
    if (fin < 0) throw new Error('bento.html : fin de ' + nom + ' introuvable');
    return pageBento.slice(k, fin + marque.length);
  };
  const NL = '\n';
  const code = [
    bout('const esc=', NL), bout('const dueLabel=', NL),
    bout('const coulEleve=', NL), bout('const LIENS=', NL),
    bout('const texteDevoir=', '};'), bout('const ligneDevoir=', '};'),
    bout('const resumeDevoirs=', '};'),
  ].join(NL);

  const FAUX = [
    { eleve: 'Martial', pour: '2026-09-07', matiere: 'FRANCAIS', fait: false, pourAujourdhui: false,
      contenu: 'Répondre au questionnaire : https://docs.google.com/forms/d/e/1FAIpQLSehZK6uX/viewform?usp=header' },
    { eleve: 'Augustin', pour: '2026-09-08', matiere: 'Matière non désignée', fait: true, pourAujourdhui: false,
      contenu: 'Apporter une attestation d’assurance.' },
    { eleve: 'Enora', pour: '2026-09-09', matiere: 'SVT', fait: false, pourAujourdhui: false,
      contenu: 'Faire la page de présentation du cahier sur une feuille blanche, à l’ordinateur (voir modèle), ajouter trois illustrations selon les grands thèmes de l’année.' },
  ];
  const ctx = { S: { ecole: {
    eleves: [{ prenom: 'Martial', couleur: '#4fd1c5' }, { prenom: 'Augustin', couleur: '#f4845f' }, { prenom: 'Enora', couleur: '#ff7ab8' }],
    aujourdhui: { devoirs: FAUX } }, plannings: { personnes: [] } }, console };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  /* 🔑 LA TUILE NE PORTE PLUS UNE LISTE, mais un résumé d'UNE ligne.
     Rémi, le 04/09 : « retirer les devoirs du jour réduit le nombre de lignes,
     mais dans tous les cas Martial ou Enora qui arrivera il y en aura plus…
     peut-être prévoir un onglet, et dans À faire un résumé du nombre de choses
     à faire par enfant ». Il a raison : une liste grandit avec la famille, un
     résumé non. C'est le même arbitrage qu'au 14/08, quand les gros boutons de
     planning sont devenus des pastilles — sur un mur, ce qui coûte c'est la
     hauteur. Le détail vit dans le panneau « Devoirs des enfants ». */
  const resume = vm.runInContext('resumeDevoirs()', ctx);
  t.dire((resume.match(/class="pill dv resume"/g) || []).length === 1,
    'la tuile ne coûte qu’UNE ligne', 'quel que soit le nombre d’enfants');
  t.dire(/>M</.test(resume) && />A</.test(resume) && />E</.test(resume),
    'chaque enfant a sa pastille et son compte');
  t.dire(/style="background:#4fd1c5"/.test(resume) && /style="background:#f4845f"/.test(resume),
    'chaque enfant garde SA couleur', 'prise en base, pas fabriquée par le front');
  t.dire(/openTile\('devoirs'\)/.test(resume), 'le résumé ouvre le panneau dédié');
  t.dire(!/undefined|NaN|\[object/.test(resume), 'ni undefined, ni NaN dans le HTML');

  /* Un enfant dont TOUT est coché garde sa place, avec un ✓ : c'est justement
     le moment où l'on veut le voir. S'il disparaissait, « et Martial ? »
     resterait sans réponse et l'absence se lirait comme une panne — c'est
     exactement ce que Rémi a vécu le 04/09. */
  ctx.S.ecole.aujourdhui.devoirs = [
    { eleve: 'Martial', pour: '2026-09-07', matiere: 'FR', contenu: 'fini', fait: true },
    { eleve: 'Augustin', pour: '2026-09-07', matiere: 'MA', contenu: 'reste', fait: false },
  ];
  const mixte = vm.runInContext('resumeDevoirs()', ctx);
  t.dire(/>M</.test(mixte) && mixte.includes('✓'),
    'un enfant dont tout est fait reste visible, avec un ✓');
  t.dire(/>1 à faire</.test(mixte), 'le total ne compte QUE ce qui reste',
    'annoncer « 2 devoirs » dont un coché serait un mensonge lu de loin');

  /* Le panneau, lui, garde tout : la hauteur y est abondante et le texte
     complet a de la valeur (« voir le corpus en pièce jointe »). */
  const panneau = vm.runInContext('ligneDevoir(S.ecole.aujourdhui.devoirs[0], false)', ctx);
  t.dire(!/…$/.test(panneau.replace(/<[^>]+>/g, '')), 'le panneau ne tronque pas');

  ctx.S.ecole.aujourdhui.devoirs = [];
  t.dire(vm.runInContext('resumeDevoirs()', ctx) === '',
    'rien du tout quand il n’y a rien', 'un titre de section vide ferait croire à une panne');
  /* ═══════════════════════════════════════════════════════════════════════
     Le jeton EcoleDirecte se renouvelle tout seul.
     🐞 Le 04/09, Martial a disparu de l'écran pendant une nuit : le serveur
     tourne en continu, `assurerConnexion()` ne reconnectait que si le drapeau
     `connecte` était faux, et EcoleDirecte fait expirer le jeton au bout de
     quelques heures. Toutes les lectures répondaient 520 jusqu'au prochain
     redémarrage — et l'écran affichait « aucun devoir », c'est-à-dire un
     mensonge plutôt qu'une panne. */
  t.titre('EcoleDirecte — renouvellement du jeton expiré');
  {
    const { ClientED } = require(path.join(__dirname, '..', '..', 'ecole', 'ecoledirecte'));
    const c = new ClientED({ identifiant: 'x', motdepasse: 'y', fichierEtat: path.join(__dirname, 'zz-essai-etat.json') });
    let appels = 0, connexions = 0;
    c.connecte = true;                       // session déjà ouverte, comme après une nuit
    c.connexion = async () => { connexions++; c.connecte = true; };
    c.appel = async () => {
      appels++;
      if (appels === 1) { const e = new Error('jeton expiré'); e.code = 520; throw e; }
      return { data: [{ ok: true }] };
    };
    const r = await c.lire('/peu/importe', {});
    t.dire(connexions === 1, 'un 520 déclenche UNE reconnexion',
      connexions + ' reconnexion(s) — cn/cv sont conservés, donc aucun QCM');
    t.dire(appels === 2 && r.data.length === 1, 'la lecture est rejouée et réussit');

    /* Un seul nouvel essai : si la reconnexion ne suffit pas, c'est le mot de
       passe ou le compte — insister épuiserait les tentatives côté serveur. */
    let boucle = 0;
    c.appel = async () => { boucle++; const e = new Error('encore'); e.code = 520; throw e; };
    let leve = null;
    try { await c.lire('/x', {}); } catch (e) { leve = e; }
    t.dire(leve !== null && boucle === 2, 'on n’insiste pas au-delà d’un essai',
      boucle + ' appel(s) — au-delà, on ferait bloquer le compte');
    try { fs.unlinkSync(path.join(__dirname, 'zz-essai-etat.json')); } catch (_) { /* jamais créé */ }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     🔒 Le filtre d'identité de l'app — un choix de confidentialité (§ 2 vicies),
     donc appliqué CÔTÉ SERVEUR : du code de navigateur se contourne. */
  t.titre('Devoirs par personne (app)');
  {
    const DEV = [
      { eleve: 'Martial', pour: '2026-09-07', matiere: 'FR', contenu: 'a', fait: false },
      { eleve: 'Augustin', pour: '2026-09-07', matiere: 'MA', contenu: 'b', fait: false },
      { eleve: 'Augustin', pour: '2026-09-08', matiere: 'SVT', contenu: 'c', fait: true },
      { eleve: 'Martial', pour: '2026-08-01', matiere: 'FR', contenu: 'passé', fait: false },
    ];
    const ELEVES = [{ prenom: 'Martial' }, { prenom: 'Augustin' }];
    const de = (personne, role) => pertinence.devoirsDe({
      devoirs: DEV, eleves: ELEVES, personne, role, aujourdhui: '2026-09-04' });

    const m = de('Martial', 'enfant');
    t.dire(m.devoirs.length === 1 && m.devoirs[0].eleve === 'Martial',
      'un enfant ne voit QUE ses devoirs', 'ceux des autres ne sortent pas du serveur');
    t.dire(m.personnel === true, 'le serveur dit que la vue est personnelle',
      'l’app s’en sert pour masquer une pastille qui n’apprendrait rien');
    t.dire(!m.devoirs.some((d) => d.pour < '2026-09-04'), 'une échéance passée sort d’elle-même');

    const p = de('Rémi', 'parent');
    t.dire(p.devoirs.length === 3 && p.personnel === false,
      'un parent voit les devoirs de tous les enfants');
    t.dire(Object.keys(p.parEleve).length === 2, 'et ils sont regroupés par enfant');

    /* 🔑 Enora est une enfant même si son compte scolaire n'est pas branché :
       se fier à « figure-t-elle parmi les élèves ? » lui aurait montré les
       devoirs de Martial et d'Augustin. C'est le RÔLE qui décide. */
    const e2 = de('Enora', 'enfant');
    t.dire(e2.devoirs.length === 0 && e2.personnel === true,
      'un enfant sans compte scolaire ne voit RIEN, pas tout',
      'le rôle décide, jamais la présence dans la liste des élèves');

    /* Le mur n'a pas de jeton : `qui()` rend « Écran », donc aucun filtre. */
    t.dire(de('Écran', null).devoirs.length === 3, 'sans jeton (l’écran mural), aucun filtre');

    /* ⚠️ L'app garde le jour même, contrairement au mur : elle sert à SUIVRE,
       et un enfant peut vouloir vérifier le matin ce qui est dû dans la journée. */
    const auj = pertinence.devoirsDe({ devoirs: DEV, eleves: ELEVES, personne: 'Rémi',
      role: 'parent', aujourdhui: '2026-09-07' });
    t.dire(auj.devoirs.some((d) => d.pourAujourdhui),
      'l’app garde le devoir du jour', 'le mur l’exclut, l’app le montre — deux besoins opposés');
  }

  t.titre('Branchement réel des pages (script entier, DOM factice)');
  const UN = { eleve: 'Martial', id: '1', pour: '2026-09-07', matiere: 'FRANCAIS',
    contenu: 'un exposé à préparer', interrogation: false, fait: false, source: 'ecoledirecte' };
  const CHARGE = {
    eleves: [{ prenom: 'Martial', couleur: '#4fd1c5' }],
    devoirs: [UN], cours: [], notes: [], messages: [], modules: {}, soucis: [],
    aujourdhui: { presents: null, restants: 1, faits: 0, horizon: {},
      devoirs: [Object.assign({}, UN, { pourAujourdhui: false })] },
    mien: { devoirs: [UN], parEleve: { Martial: [UN] }, restants: 1, faits: 0, personnel: true },
  };
  const DONNEES = { courses: [], todos: [], postits: [], menu: [], plats: [], agenda: [],
    plannings: { exemple: false, personnes: [] }, meteo: null, saint: '', news: [],
    feries: [], anniversaires: { aujourdhui: [], prochains: [] }, personnes: [],
    rayons: [], reglages: {} };

  const pages = [['bento.html', 'todoBody', 'écran mural'], ['app/index.html', 'ecran', 'app famille']];
  for (const [chemin, cible, quoi] of pages) {
    let r = null;
    try { r = await executerPage(chemin, cible, DONNEES, CHARGE); }
    catch (err) { t.dire(false, quoi + ' — le script s’exécute', err.message); continue; }
    t.dire(r.erreurs.length === 0, quoi + ' — le script s’exécute sans erreur',
      r.erreurs.join(' | ') || 'aucune');
    if (chemin === 'bento.html') {
      /* Sur le mur la tuile ne porte QUE le résumé : c'est le nom de l'enfant
         et son compte qui doivent arriver, pas le texte du devoir. */
      t.dire(/Martial/.test(r.html) && /openTile\('devoirs'\)/.test(r.html),
        quoi + ' — le résumé arrive VRAIMENT à l’écran',
        'le contrôle qui manquait le 03/09 : la fonction marchait, le branchement non');
      /* Et le détail est bien dans le panneau, atteignable depuis ce résumé. */
      let corps = '';
      try { corps = r.dedans("body('devoirs')"); } catch (e) { corps = 'ERREUR ' + e.message; }
      t.dire(/exposé à préparer/.test(corps), quoi + ' — le panneau dédié montre le devoir entier');
    } else {
      t.dire(/exposé à préparer/.test(r.html), quoi + ' — le devoir arrive VRAIMENT à l’écran',
        'le contrôle qui manquait le 03/09 : la fonction marchait, le branchement non');
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     L'accueil de l'app n'est PAS le même selon qui regarde.
     Rémi, connecté avec le compte de Martial (04/09) : « dans À faire y'a rien,
     l'agenda met le mien, les infos de mes enfants avec les cours d'Enora ET
     Martial ». L'accueil était écrit pour un parent qui surveille le foyer,
     alors qu'un enfant vient y chercher SA journée. */
  t.titre('Accueil de l’app : enfant ≠ parent');
  {
    /* ⚠️ Les clés sont capitalisées dans l'app ('Lun'…) : une clé en minuscules
       donne une semaine vide et un test qui échoue pour une raison de banc. */
    const SEMAINE = {};
    const jr = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'][(new Date().getDay() + 6) % 7];
    SEMAINE[jr] = [{ h: '08:00', fin: '09:00', quoi: 'Maths', ou: 'S17' }];
    const base = (qui, role) => ({
      __onglet: 'jour',
      moi: { nom: qui, role, couleur: '#4fd1c5' },
      personnes: [{ nom: 'Martial', role: 'enfant' }, { nom: 'Rémi', role: 'parent' }],
      courses: [], postits: [], menu: [], plats: [], agenda: [], news: [], feries: [],
      todos: [{ id: 't1', tache: 'ranger sa chambre', done: false, due: null, who: 'Enora' }],
      plannings: { exemple: false, personnes: [
        { nom: 'Martial', couleur: '#4fd1c5', semaine: SEMAINE },
        { nom: 'Enora', couleur: '#ff7ab8', semaine: SEMAINE }] },
      meteo: null, saint: '', anniversaires: { aujourdhui: [], prochains: [] },
      rayons: [], reglages: {},
    });

    const vu = async (qui, role) => (await executerPage('app/index.html', 'ecran', base(qui, role), CHARGE)).html;
    const chezLenfant = await vu('Martial', 'enfant');
    const chezLeParent = await vu('Rémi', 'parent');

    t.dire(/Ma journée/.test(chezLenfant) && /Maths/.test(chezLenfant),
      'un enfant voit SES cours du jour en tête', 'c’est ce qu’il vient chercher');
    t.dire(!/Ma journée/.test(chezLeParent),
      'un parent ne voit pas « Ma journée »', 'il n’a pas d’emploi du temps');
    t.dire(/Les enfants/.test(chezLeParent) && /Martial/.test(chezLeParent),
      'un parent voit la journée de TOUS les enfants');
    t.dire(/Les autres/.test(chezLenfant) && !/>Martial</.test(chezLenfant.split('Les autres')[1] || ''),
      'un enfant ne se retrouve pas dans « les autres »',
      'se lire deux fois est le signe d’un écran qui ne sait pas qui le regarde');
    t.dire(/Agenda de la famille/.test(chezLenfant),
      'l’agenda est nommé pour ce qu’il est',
      'sinon Martial y cherche son emploi du temps — c’est ce qui s’est passé');
    /* Une tâche assignée à Enora n'a rien à faire chez Martial ; une tâche sans
       destinataire concerne le foyer et reste affichée à tout le monde. */
    t.dire(!/ranger sa chambre/.test(chezLenfant),
      'un enfant ne voit pas les tâches assignées à un autre');
    t.dire(/ranger sa chambre/.test(chezLeParent), 'un parent voit toutes les tâches du jour');
  }

  return t;
};