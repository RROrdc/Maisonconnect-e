/* Contrôles sur les pages servies.

   Ils ne remplacent PAS un coup d'œil à l'écran — la leçon du 14/08 tient
   toujours : les défauts de mise en page sont invisibles depuis l'API et depuis
   les contrôles de syntaxe. Mais ils attrapent ce qui rendrait une page muette,
   ce qui est arrivé deux fois :
   - une erreur de syntaxe dans un script embarqué ;
   - un `$('#bouton').onclick` visant un élément retiré du HTML, qui fait planter
     tout le script à partir de cette ligne.
   Et ils vérifient les en-têtes de cache, dont le mauvais réglage a coûté une
   heure de débogage sur une version qui n'était plus celle du disque. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const A = require('./aide');

const PUBLIC = path.join(__dirname, '..', '..', 'public');
/* `index.html` (l'ancienne mise en page paysage) a été supprimé le 19/08 :
   le bento est l'écran mural depuis le 18/08, et garder une page non maintenue
   revient à laisser un piège — on finit par la corriger par erreur. */
const PAGES = ['bento.html', 'vocal.html',
  path.join('app', 'index.html'), path.join('admin', 'index.html')];

module.exports = async function (muet) {
  const t = A.compteur(); t.muet = muet;

  /* 🐞 ANGLE MORT trouve le 11/09 : ces controles ne lisaient que les scripts
     EMBARQUES dans les pages. `clavier.js` et `voix.js` sont des fichiers a
     part — une erreur de syntaxe y passait donc inapercue, et le clavier a
     disparu de l'ecran mural sans un mot. Un fichier servi est un fichier a
     verifier, qu'il soit dans la page ou a cote. */
  t.titre('Scripts servis a part');
  for (const f of ['clavier.js', 'voix.js']) {
    const chemin = path.join(PUBLIC, f);
    if (!fs.existsSync(chemin)) { t.dire(false, `${f} introuvable`); continue; }
    let bon = true, souci = '';
    try { new vm.Script(fs.readFileSync(chemin, 'utf8')); }
    catch (e) { bon = false; souci = e.message; }
    t.dire(bon, `${f} — syntaxe`, souci || 'valide');
  }

  t.titre('Scripts embarqués et identifiants');
  for (const rel of PAGES) {
    const chemin = path.join(PUBLIC, rel);
    if (!fs.existsSync(chemin)) { t.dire(false, `${rel} introuvable`); continue; }
    const html = fs.readFileSync(chemin, 'utf8');

    const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
    let bon = true, souci = '';
    scripts.forEach((code, i) => {
      try { new vm.Script(code); }
      catch (e) { bon = false; souci = `script #${i + 1} : ${e.message}`; }
    });
    t.dire(bon, `${rel} — syntaxe des scripts`, souci || `${scripts.length} script(s)`);

    /* 🔴 Les VARIABLES inventées, trouvé le 13/09 : en ajoutant Face ID j'ai
       écrit `ONGLET` alors que la variable s'appelle `ECRAN`. Une variable
       inexistante tue le script à partir de cette ligne, et l'app ne s'ouvre
       plus — exactement comme un `$('#absent')`, que ce banc attrapait déjà.
       La convention du projet met les états globaux en MAJUSCULES : on peut donc
       repérer ceux qui sont lus sans avoir jamais été déclarés.

       ⚠️ On analyse le CODE seul. Sans retirer commentaires et chaînes, le
       contrôle remontait « AVANT », « POUR », « HTTPS »… lus dans les
       commentaires — soixante faux positifs, donc un test qu'on aurait
       désactivé le lendemain.
       ⚠️ Et la liste blanche ne contient que des globales du langage ou du
       navigateur : y ajouter un nom du projet reviendrait à désamorcer le
       contrôle pour se débarrasser d'un échec. */
    const CONNUES = new Set(['JSON', 'Math', 'Date', 'URL', 'URLSearchParams', 'Notification',
      'PublicKeyCredential', 'PushManager', 'Intl', 'Promise', 'Object', 'Array', 'String',
      'Number', 'Boolean', 'Set', 'Map', 'RegExp', 'Error', 'TextEncoder', 'TextDecoder',
      'Event', 'KeyboardEvent', 'CustomEvent', 'Audio', 'Image', 'FormData', 'Blob', 'File',
      'FileReader', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'AbortController',
      'Uint8Array', 'ArrayBuffer', 'DataView', 'BigInt', 'Symbol', 'Proxy', 'Reflect',
      'GET', 'POST', 'PATCH', 'DELETE', 'PUT', 'OPTIONS', 'HEAD', 'NaN', 'Infinity']);

    const BLOC = String.fromCharCode(47, 42);      // ouverture de commentaire
    const FINB = String.fromCharCode(42, 47);      // fermeture
    const LIGNE = String.fromCharCode(47, 47);     // commentaire de ligne
    const BT = String.fromCharCode(96);            // accent grave
    const AP = String.fromCharCode(39);            // apostrophe
    const GU = String.fromCharCode(34);            // guillemet

    /* Construites par `new RegExp` : écrites en littéral, elles contiendraient
       les délimiteurs de commentaire eux-mêmes, que le lecteur de code
       interprète avant nous. */
    const ech = (s) => s.replace(/./g, (c) => '\\' + c);
    const sansCommentairesNiChaines = (code) => code
      .replace(new RegExp(ech(BLOC) + '[\\s\\S]*?' + ech(FINB), 'g'), ' ')
      .replace(new RegExp('(^|[^:])' + ech(LIGNE) + '[^\\n]*', 'g'), '$1 ')
      .replace(new RegExp(BT + '(?:\\\\[\\s\\S]|[^' + BT + '\\\\])*' + BT, 'g'), BT + BT)
      .replace(new RegExp(AP + '(?:\\\\.|[^' + AP + '\\\\\\n])*' + AP, 'g'), AP + AP)
      .replace(new RegExp(GU + '(?:\\\\.|[^' + GU + '\\\\\\n])*' + GU, 'g'), GU + GU);

    const tout = sansCommentairesNiChaines(scripts.join('\n'));
    /* 🔑 Les DÉCLARATIONS se cherchent dans le code BRUT, les USAGES dans le
       code nettoyé. Les gabarits de /admin/ s'imbriquent : le nettoyage y perd
       des lignes entières, et ICONE_NIVEAU — pourtant déclaré — était signalé
       comme inventé. Rater une déclaration ne coûte au pire qu'un bug non vu ;
       en inventer une fabrique un échec qu'on finirait par désactiver. */
    const brut = scripts.join(String.fromCharCode(10));
    const declarees = new Set();
    for (const m of brut.matchAll(/\b(?:let|const|var|function|class)\s+([A-Z][A-Z_0-9]+)\b/g))
      declarees.add(m[1]);
    /* Déclarées autrement — paramètre, destructuration, propriété, affectation.
       On ne refait pas un analyseur : le but est d'attraper une faute de frappe.
       🔑 `=(?!=)` et non `=` : sans cette précision, `ONGLET===` comptait comme
       une affectation, le nom se déclarait donc LUI-MÊME, et le contrôle ne
       pouvait plus rien trouver. Vérifié en réintroduisant le vrai bug. */
    for (const m of brut.matchAll(/([A-Z][A-Z_0-9]+)\s*(?:=(?!=)|[:,)])/g)) declarees.add(m[1]);

    /* On ne retient que les usages SYNTAXIQUES : le nom doit être suivi, sans
       espace, d'un caractère de code. Ainsi `ONGLET===` est signalé, mais pas
       « HTTP sur le réseau » ni « à la JARVIS » — du texte français qu'un
       gabarit imbriqué a laissé passer. Le nettoyage des chaînes ne suffit pas
       ici : les gabarits de /admin/ s'imbriquent, et aucune expression
       régulière ne les découpe vraiment. Plutôt qu'un test bruyant qu'on
       finirait par désactiver, on vise moins large et on ne se trompe pas. */
    const inventees = new Set();
    for (const m of tout.matchAll(/\b([A-Z][A-Z_0-9]{2,})(?=[.[(=!&|?;,)\]])/g)) {
      if (!declarees.has(m[1]) && !CONNUES.has(m[1])) inventees.add(m[1]);
    }
    t.dire(!inventees.size, `${rel} — aucune variable inventée`,
      inventees.size ? [...inventees].join(', ') : 'toutes déclarées');

    /* Un gestionnaire posé sur un élément absent lève une exception et tue le
       reste du script, silencieusement pour l'utilisateur. */
    const vises = [...html.matchAll(/\$\('#([\w-]+)'\)/g)].map((m) => m[1]);
    /* Les champs de la carte Réglages n'existent pas en toutes lettres : ils
       sont FABRIQUÉS depuis `REGLAGES_CONNUS` (`id="r_${cle}"`). On ne relâche
       pas le contrôle pour autant — on vérifie que la clé visée est bien dans
       cette liste. Une faute de frappe y serait donc toujours attrapée. */
    const fabriques = new Set();
    if (/id="r_\$\{cle\}"/.test(html)) {
      for (const m of html.matchAll(/\[\s*'([a-z0-9_]+)'\s*,\s*'/gi)) fabriques.add('r_' + m[1]);
    }
    const manquants = [...new Set(vises)]
      .filter((id) => !html.includes(`id="${id}"`) && !fabriques.has(id));
    t.dire(!manquants.length, `${rel} — identifiants visés existants`,
      manquants.length ? 'ORPHELINS : ' + manquants.join(', ') : `${new Set(vises).size} vérifiés`);

    /* 🐞 Trouvé le 16/09, et par Rémi, pas par un test : « dans voix c'est
       vide ». J'avais écrit `api(url, 'GET')` dans /admin/ — où `api()` prend
       la MÉTHODE en premier. `fetch(undefined, { method: '/api/...' })` échoue,
       la liste reste vide, et RIEN ne le signale : les identifiants existent,
       la syntaxe est valide, le `catch` avale l'erreur. Le bouton « Chercher
       les téléphones » était cassé pareil depuis deux heures sans qu'on le voie.

       🔴 Et la CAUSE est là : les trois pages n'ont pas la même signature.
          bento.html      api(url, methode, corps)
          app/index.html  api(url, methode, corps)
          admin/index.html  api(METHODE, url, corps)   ← l'inverse
       Passer de l'une à l'autre en gardant l'habitude de la précédente est un
       piège qui ne prévient pas. ⚠️ Dette assumée : unifier les trois toucherait
       une soixantaine d'appels pour aucun gain visible ; on vérifie donc que
       chaque page respecte SA convention, lue dans sa propre définition. */
    const sign = html.match(/(?:async\s+)?function\s+api\s*\(\s*(\w+)/);
    if (sign) {
      const methodeDabord = /^(methode|method)$/i.test(sign[1]);
      const VERBES = /^(GET|POST|PUT|PATCH|DELETE)$/;
      const premiers = [...html.matchAll(/\bapi\s*\(\s*(['"`])([^'"`\n]*?)\1/g)].map((m) => m[2]);
      const fautifs = premiers.filter((x) => methodeDabord
        ? x.startsWith('/')          // une URL là où on attend un verbe
        : VERBES.test(x));           // un verbe là où on attend une URL
      t.dire(!fautifs.length,
        `${rel} — api() appelé dans l'ordre de SA signature (${sign[1]} d'abord)`,
        fautifs.length ? 'INVERSÉS : ' + [...new Set(fautifs)].join(', ')
          : `${premiers.length} appel(s) vérifié(s)`);
    }

    /* 🐞 Trouvé le 10/09 : le catalogue de recettes s'affichait, et aucun bouton
       ne s'ouvrait. `JSON.stringify` rend des guillemets DOUBLES ; posés dans un
       `onclick="…"`, ils referment l'attribut et le gestionnaire devient inerte
       — sans erreur de syntaxe, sans rien dans la console, donc invisible pour
       les deux contrôles ci-dessus. On cherche la CONSTRUCTION fautive dans le
       source ; `arg()` est le seul chemin correct. */
    const nus = [...html.matchAll(/on\w+="[^"]*'\s*\+\s*JSON\.stringify\(/g)]
      .filter((m) => !html.slice(m.index, m.index + 220).includes('&quot;'));
    t.dire(!nus.length, `${rel} — arguments d'attribut échappés`,
      nus.length ? `${nus.length} JSON.stringify non échappé(s) dans un attribut — passe par arg()`
                 : 'aucun JSON.stringify nu dans un attribut');

    /* 🐞 Le 11/09 : `.horsligne{display:flex}` empechait `el.hidden = true` de
       cacher quoi que ce soit — le `display:none` de l'attribut `hidden` vient
       de la feuille par defaut du navigateur, la specificite la plus faible qui
       soit. Le bandeau « Ecran deconnecte » est reste affiche en permanence.
       Toute classe qui pose un `display` ET qui est masquee par `hidden` doit
       donc declarer son propre `[hidden]`. */
    const masques = [...html.matchAll(/<[^>]+class="([\w-]+)"[^>]*\shidden[\s>]/g)].map((m) => m[1]);
    const sansRegle = [...new Set(masques)].filter((c) =>
      new RegExp('[.#]' + c + '[^{]*{[^}]*display:').test(html) && !html.includes('.' + c + '[hidden]'));
    t.dire(!sansRegle.length, `${rel} — les elements masques par [hidden] peuvent l'etre`,
      sansRegle.length ? 'display: sans regle [hidden] → ' + sansRegle.join(', ')
                       : `${new Set(masques).size} verifie(s)`);

    const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');
    const ouv = (styles.match(/\{/g) || []).length, fer = (styles.match(/\}/g) || []).length;
    t.dire(ouv === fer, `${rel} — accolades CSS équilibrées`, `${ouv}/${fer}`);
    /* 🔴 Les VARIABLES CSS inventées, trouvé le 13/09 : en fondant la
       navigation de semaine dans la carte du menu, j'ai écrit
       `var(--bord)` — qui n'existe pas ici, la variable s'appelle `--line`.
       Une variable CSS absente ne lève AUCUNE erreur : la propriété est
       simplement ignorée, et la bordure ne s'affiche jamais. C'est le frère
       exact de la variable JS inventée, mais côté style — donc invisible pour
       tous les contrôles précédents, et visible seulement à l'œil.
       ⚠️ On ne tient compte que des variables définies dans LA MÊME page : ce
       projet n'a pas de feuille commune, chaque page porte sa palette.
       ⚠️ Et on cherche les définitions dans TOUT le HTML, pas seulement dans
       les blocs <style> : plusieurs sont posées en attribut \n       depuis le script — les chercher ailleurs fabriquait quatre faux
       positifs, donc un test qu'on aurait désactivé. */
    const definies = new Set();
    for (const m of html.matchAll(/(--[a-z0-9-]+)\s*:/gi)) definies.add(m[1]);
    const cssInventees = new Set();
    /* Un var(--x, repli) porte sa propre valeur de secours : il fonctionne
       meme si la variable manque. Le signaler serait reprocher une precaution.
       D ou le ) exige juste apres le nom. */
    for (const m of html.matchAll(/var\(\s*(--[a-z0-9-]+)\s*\)/gi)) {
      if (!definies.has(m[1])) cssInventees.add(m[1]);
    }
    t.dire(!cssInventees.size, `${rel} — aucune variable CSS inventée`,
      cssInventees.size ? [...cssInventees].join(', ') : definies.size + ' définies');


    /* 🐞 Angle mort trouvé le 06/09 en éprouvant le déploiement automatique : le
       contrôle ci-dessus n'extrait que les blocs COMPLETS. Un `<style>` jamais
       refermé lui échappait donc entièrement — et c'est exactement ce qu'une
       coupure d'édition produit. Le navigateur, lui, avale tout le reste de la
       page comme du CSS : l'écran devient blanc. On compte donc les balises. */
    for (const [nom, ouvr, ferm] of [['style', /<style[^>]*>/gi, /<\/style>/gi],
                                     ['script', /<script[\s>]/gi, /<\/script>/gi]]) {
      const a = (html.match(ouvr) || []).length, b = (html.match(ferm) || []).length;
      t.dire(a === b, `${rel} — chaque <${nom}> est refermé`, `${a} ouverts / ${b} fermés`);
    }
  }

  if (!(await A.serveurPret())) {
    t.dire(false, 'serveur injoignable — contrôles HTTP sautés');
    return t;
  }

  /* 🔴 LES ANTISLASHS MANGÉS — le piège d'outillage le plus coûteux du projet,
     payé cinq fois (§ 2 quatervicies bis). Un correctif écrit dans un heredoc
     perd ses antislashs : `/\s+/` devient `/s+/`, qui est une regex PARFAITEMENT
     VALIDE — donc invisible pour le contrôle de syntaxe, pour le navigateur et
     pour la relecture.
     Trouvé en production le 17/09 dans `rappels.js` : chaque rappel de devoirs
     remplaçait les « s » du texte par des espaces (« Faire les exercices » →
     « Faire le exercice »).
     Le contrôle ne cherche QUE la résidu exacte — une regex dont le corps
     ENTIER est une lettre de classe avec son quantificateur. Assez serré pour
     n'avoir aucun faux positif, assez large pour attraper le cas réel : une
     recherche littérale de « un ou plusieurs s » n'existe pas. */
  t.titre('Antislashs mangés par un heredoc');
  const CLASSES = ['s', 'd', 'w', 'S', 'D', 'W', 'b', 'B', 'n', 'r', 't'];
  /* Une regex littérale n'est JAMAIS précédée d'une lettre ni d'un chiffre —
     elle suit `(`, `,`, `=`, un espace. Sans cette précaution, l'URL d'un
     formulaire Google (« forms/d/e/1FA… ») remontait comme une regex abîmée. */
  const residu = new RegExp('(^|[^A-Za-z0-9_)\\]/:])/(' + CLASSES.join('|') + ')[+*?]?/[gimsuy]*', 'g');
  const racineProjet = path.join(__dirname, '..', '..');
  const aExaminer = [];
  (function balayer(dossier, profondeur) {
    for (const nom of fs.readdirSync(dossier)) {
      if (nom === 'node_modules' || nom === '.git' || nom === 'sauvegardes' || nom === 'plats') continue;
      const p = path.join(dossier, nom);
      const st = fs.statSync(p);
      if (st.isDirectory()) { if (profondeur < 2) balayer(p, profondeur + 1); continue; }
      if (/\.(js|html)$/.test(nom)) aExaminer.push(p);
    }
  }(racineProjet, 0));
  const abimes = [];
  for (const p of aExaminer) {
    let dansBloc = false;
    fs.readFileSync(p, 'utf8').split('\n').forEach((l, i) => {
      /* Un commentaire peut légitimement PARLER du piège — celui juste au-dessus
         le fait. Les blocs du projet n'ont pas d'astérisque en continuation :
         il faut donc suivre l'ouverture et la fermeture, pas deviner ligne à
         ligne. */
      const ouvre = l.lastIndexOf('/*'), ferme = l.lastIndexOf('*/');
      const etait = dansBloc;
      if (!dansBloc && ouvre >= 0 && ferme < ouvre) dansBloc = true;
      else if (dansBloc && ferme > (ouvre < 0 ? -1 : ouvre)) dansBloc = false;
      if (etait) return;
      if (/^\s*(\/\/|\*)/.test(l)) return;
      for (const m of l.matchAll(residu)) {
        abimes.push(`${path.relative(racineProjet, p)}:${i + 1} ${m[0].trim()}`);
      }
    });
  }
  t.dire(abimes.length === 0, 'aucune regex n’a perdu son antislash',
    abimes.length ? abimes.join(' · ') : `${aExaminer.length} fichiers examinés`);

  /* ── Une notification passe-t-elle bien par la PORTE UNIQUE ? ──────────────
     Né du 20/09 : Rémi n'avait pas reçu le rappel « poisson » du vendredi 8 h.
     Le rappel existait en base et s'affichait sur le mur — mais sur les NEUF
     endroits qui créaient une notification, un seul poussait vers les
     téléphones. Les huit autres appelaient `ajouterNotif` directement.
     Ce contrôle interdit le retour du défaut : hors de la couche données (qui
     l'implémente) et de `annoncer` (qui l'enrobe), personne n'a le droit
     d'appeler `ajouterNotif`. Il ne se contourne pas en ajoutant un `pousser()`
     à côté — c'est la porte qu'on vérifie, pas l'intention. */
  t.titre('Notifications : une seule porte de sortie');
  const DROIT = ['donnees/sqlite.js', 'donnees/notion.js', 'donnees/index.js'];
  const fautifs = [];
  for (const p of aExaminer) {
    const rel = path.relative(racineProjet, p).replace(/\\/g, '/');
    if (DROIT.includes(rel) || rel.startsWith('outils/')) continue;
    const lignes = fs.readFileSync(p, 'utf8').split('\n');
    lignes.forEach((l, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(l)) return;              // un commentaire peut en parler
      if (!/\bajouterNotif\s*\(/.test(l)) return;
      /* Le repli explicite du vocal est nommé : il est assigné, pas appelé. */
      if (/typeof annoncer|const poser\s*=/.test(l)) return;
      /* L'INTÉRIEUR de `annoncer` est la seule exception, et on l'exempte par sa
         position et non par son nom de fichier : exempter `server.js` en entier
         rendrait le contrôle aveugle là où il y a le plus de routes. Déplacer cet
         appel hors de `annoncer`, ou en ajouter un second ailleurs, est détecté. */
      const dans = lignes.slice(Math.max(0, i - 3), i).some((x) => /^function annoncer\s*\(/.test(x));
      if (dans) return;
      fautifs.push(`${rel}:${i + 1}`);
    });
  }
  t.dire(fautifs.length === 0,
    'aucun appel direct à ajouterNotif hors de la couche données',
    fautifs.length ? fautifs.join(' · ') : 'tout passe par annoncer()');

  /* Et le garde-fou côté construction : un `creerRappels` sans `annoncer`
     redonnerait des rappels muets. Il doit REFUSER, pas se replier. */
  let refuse = false;
  try { require(path.join(racineProjet, 'rappels.js')).creerRappels({ donnees: {}, config: () => '' }); }
  catch (e) { refuse = /annoncer/.test(e.message); }
  t.dire(refuse, 'creerRappels refuse de démarrer sans `annoncer`');

  /* ── Ce qui arrive VRAIMENT à l'écran ─────────────────────────────────────
     Deux retours du 20/09 se jouaient dans la page, pas dans l'API : « la
     suppression de post-it est assez longue » et « on voudrait sélectionner la
     recette ET ajouter un complément ». Aucun test d'API ne les aurait vus. */
  t.titre('Suppression instantanée et accompagnement (rendu)');
  const MENU_T = [{ id: 'm1', jour: 'Lundi', date: '2026-09-21', soir: 'Gnocchi',
    soirGarniture: 'jambon', midi: 'Salade', midiGarniture: '', soirCouverts: 4 }];
  const D = { courses: [], todos: [], postits: [{ id: 'p1', message: 'ZZ mot d’essai', who: 'Rémi' }],
    menu: MENU_T, plats: [], dishes: [], agenda: [],
    plannings: { exemple: false, personnes: [] }, meteo: null, saint: '', news: [],
    feries: [], anniversaires: { aujourdhui: [], prochains: [] }, personnes: [],
    rayons: [], reglages: {} };
  const VIDE = { eleves: [], devoirs: [], cours: [], notes: [], messages: [], modules: {},
    soucis: [], aujourdhui: { presents: null, restants: 0, faits: 0, horizon: {}, devoirs: [] },
    mien: { devoirs: [], parEleve: {}, restants: 0, faits: 0 } };

  let bg = null;
  try { bg = await A.executerPage('bento.html', 'postBody', D, VIDE); }
  catch (err) { t.dire(false, 'écran mural — le script s’exécute', err.message); }
  if (bg) {
    t.dire(/ZZ mot d’essai/.test(bg.html), 'le post-it est bien à l’écran au départ');
    /* 🔑 On lance `doDel` SANS l'attendre : l'invariant est que la ligne part
       AVANT l'aller-retour réseau. Si le retrait local disparaissait, ce contrôle
       tomberait — et l'attente de 300 ms reviendrait sans que personne le voie. */
    bg.dedans("doDel('postit','p1')");
    t.dire(bg.dedans('S.postits.length') === 0,
      '🔑 la liste locale a déjà perdu la ligne, avant toute réponse du serveur');
    t.dire(!/ZZ mot d’essai/.test(bg.dedans("document.getElementById('postBody').innerHTML")),
      'et l’écran est déjà redessiné sans elle');
  }

  let bm = null;
  try { bm = await A.executerPage('bento.html', 'menuBody', D, VIDE); }
  catch (err) { t.dire(false, 'écran mural — menu', err.message); }
  if (bm) {
    t.dire(/Gnocchi/.test(bm.html) && /jambon/.test(bm.html),
      '🔑 le plat ET son accompagnement arrivent à la tuile', 'le plat seul serait incomplet');
    /* Sur la MÊME ligne : une ligne de plus par jour coûterait sept lignes à une
       mise en page validée. On vérifie donc qu'aucune ligne n'a été ajoutée. */
    t.dire((bm.html.match(/class="repas/g) || []).length === 7,
      'toujours sept lignes — l’accompagnement n’en ajoute aucune');
    /* Et le champ de saisie existe, sinon on ne peut rien y mettre. */
    let panneau = '';
    try { panneau = bm.dedans("body('menu')"); } catch (e) { panneau = 'ERREUR ' + e.message; }
    t.dire(/Garniture/.test(panneau) && /accompagnement/i.test(panneau),
      'le panneau Menu offre le champ', /ERREUR/.test(panneau) ? panneau : 'présent');
    /* 🔑 Et il est sur la ligne du PLAT, pas avec l'entrée et le dessert.
       Rémi, en voyant le premier jet : « pas terrible proche de plat, et entrée
       dessert sinon c'est pas logique ». Un accompagnement est une précision sur
       le plat, pas un élément de repas de plus — le placer ailleurs oblige à
       faire le lien soi-même. Le HTML suit l'ordre d'affichage. */
    const iAcc = panneau.indexOf('+ accompagnement'), iSuite = panneau.indexOf('xrow');
    t.dire(iAcc >= 0 && iSuite >= 0 && iAcc < iSuite,
      '🔑 l’accompagnement est collé au plat, avant la ligne entrée/dessert',
      `accompagnement à ${iAcc}, ligne suivante à ${iSuite}`);
    /* 🔑 Plus de case vide : rien de saisi ⇒ on PROPOSE, on n'encombre pas.
       C'était « le champ mort sur dessert et entrée » signalé le 20/09 : deux
       cases par repas décidé, jusqu'à vingt-huit sur la semaine. */
    t.dire(!/placeholder="entrée…"/.test(panneau) && /\+ entrée ou dessert/.test(panneau),
      '🔑 aucune case vide entrée/dessert — un bouton à la place');
  }

  /* Et dès qu'il y a quelque chose à montrer, le champ revient de lui-même. */
  let bd = null;
  const AVEC = JSON.parse(JSON.stringify(D));
  AVEC.menu[0].soirDessert = 'compote';
  try { bd = await A.executerPage('bento.html', 'menuBody', AVEC, VIDE); }
  catch (err) { t.dire(false, 'écran mural — menu garni', err.message); }
  if (bd) {
    let p2 = '';
    try { p2 = bd.dedans("body('menu')"); } catch (e) { p2 = 'ERREUR ' + e.message; }
    t.dire(/placeholder="dessert…"/.test(p2) && /value="compote"/.test(p2),
      'un dessert saisi rouvre le champ tout seul');
    /* Et la bonne liste : proposer 125 plats pour choisir une compote n'aide
       personne — demandé par Rémi le même jour. */
    t.dire(/list="platsDessert"/.test(p2) && /list="platsEntree"/.test(p2),
      '🔑 chaque champ propose SA catégorie, pas toute la bibliothèque');
  }

  /* ── Le kiosque prend-il la nouvelle version ? ─────────────────────────────
     Écrit APRÈS avoir failli refaire le défaut du 03/09 : `versionChangee()`
     existait et n'était appelée nulle part. La fonction marchait, le
     branchement non — et rien ne l'aurait signalé, puisqu'un écran qui ne se
     recharge pas ressemble à un écran normal. */
  t.titre('Rechargement après déploiement');
  let bv = null;
  try { bv = await A.executerPage('bento.html', 'postBody', Object.assign({}, D, { version: 'aaa' }), VIDE); }
  catch (err) { t.dire(false, 'écran mural — version', err.message); }
  if (bv) {
    t.dire(bv.dedans('versionVue') === 'aaa',
      'la version du premier chargement est mémorisée', String(bv.dedans('versionVue')));
    /* Même version : surtout ne rien faire — sinon l'écran boucle. */
    let recharge = 0;
    bv.dedans('location.reload = () => { globalThis.__rechargé = (globalThis.__rechargé||0)+1; }');
    bv.dedans("S.version='aaa'; versionChangee();");
    recharge = bv.dedans('globalThis.__rechargé||0');
    t.dire(recharge === 0, 'version inchangée ⇒ aucun rechargement');
    /* Version différente : on recharge. */
    bv.dedans("S.version='bbb'; openK=null; versionChangee();");
    recharge = bv.dedans('globalThis.__rechargé||0');
    t.dire(recharge === 1, '🔑 nouvelle version ⇒ l’écran se recharge tout seul');
    /* Mais jamais au milieu d'un geste. */
    bv.dedans("versionVue='bbb'; S.version='ccc'; openK='course'; versionChangee();");
    t.dire(bv.dedans('globalThis.__rechargé||0') === 1,
      'panneau ouvert ⇒ on attend — perdre une saisie serait pire');
  }

  t.titre('Pages servies et en-têtes de cache');
  /* La racine doit mener au bento : `public/index.html` n'existe plus, et sans
     redirection on tomberait sur un 404 en tapant simplement l'adresse. */
  const racine = await fetch(A.BASE + '/', { redirect: 'manual' });
  t.dire(racine.status === 302 && (racine.headers.get('location') || '').includes('bento'),
    '/ redirige vers l’écran mural', `${racine.status} → ${racine.headers.get('location')}`);

  for (const [chemin, cacheAttendu] of [
    ['/bento.html', 'no-cache'], ['/vocal.html', 'no-cache'], ['/admin/', 'no-cache'],
    ['/app/', 'no-cache'], ['/voix.js', 'no-cache'], ['/app/sw.js', 'no-cache'],
  ]) {
    const r = await fetch(A.BASE + chemin);
    const cc = r.headers.get('cache-control') || '';
    t.dire(r.status === 200 && cc.includes(cacheAttendu), `${chemin}`, `${r.status} · ${cc}`);
  }

  /* Les photos de plats sont nommées par l'empreinte de leur contenu : un cache
     long est sans risque, et il évite au Raspberry de retélécharger 8 Mo. */
  const data = await (await fetch(A.BASE + '/api/data')).json();
  const photo = (data.plats || []).map((p) => p.photo).filter(Boolean)[0];
  if (photo) {
    const r = await fetch(A.BASE + photo);
    const cc = r.headers.get('cache-control') || '';
    t.dire(r.status === 200 && cc.includes('immutable'), 'photo de plat mise en cache longtemps', cc);
  }

  return t;
};
