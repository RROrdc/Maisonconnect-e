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
    const manquants = [...new Set(vises)].filter((id) => !html.includes(`id="${id}"`));
    t.dire(!manquants.length, `${rel} — identifiants visés existants`,
      manquants.length ? 'ORPHELINS : ' + manquants.join(', ') : `${new Set(vises).size} vérifiés`);

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
