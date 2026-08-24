# 🏠 Écran Maison — mémoire projet (handoff Claude Code)

> Dépose ce fichier dans `C:\temp\maison` (à côté de `server.js`). Claude Code le lit automatiquement : il contient le contexte, la tâche du moment et la feuille de route pour reprendre et faire évoluer le projet.

## 1. Contexte & vision
- **Qui** : Rémi (DSI). Foyer : Rémi, Amandine, Enora, Martial (à l'année) + 2 garçons 1 week-end sur 2.
- **But** : un **écran mural tactile** dans la cuisine (RDC) — une **tablette autonome** en mode kiosque — qui affiche un tableau de bord familial : **menu de la semaine, courses, à faire (assigné + échéance), post-it, agenda perso**, et plus tard **température (Netatmo)** et **musique (AirPlay)**.
- **Architecture** : une **web app** = front (tuiles) + petit serveur qui parle à **Notion**. Hébergée sur le **PC** maintenant (`C:\temp\maison`), **portable telle quelle sur un Mac mini** ensuite (le Mac deviendra le hub : Home Assistant/Netatmo, AirPlay musique, notifications iMessage, MCP iMessage/iCloud).
- **Données = base SQLite `maison.db`** (source de vérité **depuis le 18/08/2026**, voir § 2 ter). ~~Notion~~ n'est plus qu'une **archive figée** : on n'y écrit plus. La famille écrit depuis l'**app iPhone** (`/app/`) et depuis l'écran mural, les deux synchronisés en temps réel. La tablette est un simple **navigateur en kiosque** sur `http://IP-DU-SERVEUR:8090/bento.html`.
- **Règle absolue** : cet écran est **familial** → **agenda PERSO uniquement** (Rémi/Amandine + Garçons). **Ne JAMAIS afficher l'agenda pro Outlook.**
- **Séparation** : ce projet est distinct du **« Second Cerveau »** perso/pro de Rémi (privé). Ne pas mélanger les deux.

## 2. État actuel (déjà fait)
> ⚠️ **Cette section décrit l'historique jusqu'au 18/08/2026.** Depuis, les données sont passées de Notion à SQLite et une app iPhone est apparue : **lire le § 2 ter en priorité**, il fait foi sur l'architecture actuelle. Ce qui suit reste utile pour comprendre comment on en est arrivé là (et les pièges déjà payés).

- `server.js` — Express ; sert `public/` ; endpoints : `GET /api/data` (lecture Notion + agenda ICS optionnel), `POST/PATCH /api/todo`, `/api/course`, `/api/postit`, `PATCH /api/menu/:id`, `GET /api/health`.
- `public/index.html` — écran à tuiles ; `fetch('/api/data')` au chargement ; les actions écrivent via l'API ; rafraîchi toutes les 30 s ; écran de veille à 25 min.
- `.env` — créé (PORT=8090, DB_* remplis, `NOTION_TOKEN` renseigné). Intégration Notion = **« maison »** (`3bb3afd4-c0de-81ba-8ea2-0027172045ed`), **token validé** (l'API répond).
- `npm install` fait (92 paquets). Serveur **démarré et validé** : `/api/health` → `{"ok":true,"token":true}`, page servie en HTTP 200 sur `localhost` **et** sur l'IP LAN (accès tablette OK).
- **Correctif appliqué** dans `server.js` : le SDK Notion embarque `node-fetch`, qui casse sur Node 20+ avec `ERR_STREAM_PREMATURE_CLOSE` sur les réponses gzip. On injecte désormais le **fetch natif** (`new Client({ auth, fetch })`). Ne pas revenir en arrière.
- `/api/data` renvoie aussi un **message court et actionnable** au lieu de l'erreur brute Notion.
- **Correctif Menu** dans `server.js` : `PATCH /api/menu/:id` n'écrivait que `Soir (libre)`, alors que la **lecture donne la priorité à la relation `Soir (plat)`** ⇒ changer le plat d'un jour déjà rempli par relation semblait ne rien faire. Désormais l'API écrit les **deux** propriétés : plat connu → relation posée + libre vidé ; plat inconnu → libre posé + relation vidée. Idem pour Midi.
- ✅ **Partage Notion fait**, les 5 bases répondent (8 plats, 7 jours de menu, 6 courses, 4 tâches, 2 post-it). Les IDs du `.env` sont donc **confirmés bons**.
- ✅ **Écritures testées de bout en bout** (ajout course/tâche/post-it, coche/décoche, changement de menu plat connu + plat libre, restauration) : tout écrit correctement dans Notion et se relit à l'écran. Lignes de test archivées.
- ❔ Non vérifié : le **rendu visuel** de l'écran dans un navigateur (extension Chrome non connectée). L'API et le HTML sont servis correctement, JS syntaxiquement validé, mais personne n'a encore regardé la page.
- ❔ Non vérifié : `CAL_ICS_URL` vide ⇒ tuile Agenda vide (normal). Tuiles Température et Musique = maquettes statiques, non branchées.

### Correctifs & ajouts du 13/08/2026 (2e série, retours de Rémi)
- 🐞 **« Impossible de cocher »** : c'était un bug d'affichage, pas d'écriture. `toggleCourse`/`toggleTodo` appelaient `load()`, qui redessine les **tuiles du fond** mais **pas le panneau ouvert** (HTML figé au moment du `openTile`). La coche partait bien dans Notion, l'écran ne bougeait pas. Corrigé par `refresh()` = `load()` + `drawSheet(openK)` si un panneau est ouvert. `openK` mémorise le panneau courant.
- ➕ **Suppression** : `DELETE /api/:kind/:id` (todo|course|postit|plat) → `archived:true` (corbeille Notion, **restaurable**). UI : bouton ✕ en **2 touchers** (✕ → « Supprimer ? », auto-annulé après 4 s) pour éviter les accidents tactiles.
- ➕ **`POST /api/course/vider`** : archive d'un coup tous les articles cochés (bouton « 🧹 Retirer les N article(s) pris »).
- ➕ **Menu Midi ET Soir** éditables (avant : Soir seulement).
- ➕ **Plat écrit librement → ajouté à la Bibliothèque de plats** et relié en relation ⇒ réutilisable les semaines suivantes.
- ➕ **Options « Pas de cuisine »** (Restaurant, Sortie, Livraison, Restes du frigo, Chacun pour soi) : envoyées avec `special:true` ⇒ texte libre, **jamais** ajoutées à la bibliothèque.
### Ajouts du 13/08/2026 (3e série)
- 📅 **Agenda branché** : `CAL_ICS_URL` = calendrier iCloud publié de Rémi. `readAgenda()` réécrit : fenêtre **−45 j / +180 j** (au lieu de la semaine courante), **récurrences dépliées** (`rrule.between` + `exdate` + `recurrences`), champs `fin` / `lieu` / `journee` ajoutés. 108 événements remontés.
  - ⚠️ Limite connue : les occurrences récurrentes reprennent l'**heure locale de l'occurrence d'origine** (contournement du décalage UTC de `rrule` dans node-ical). Correct pour « même heure chaque semaine » ; un événement récurrent qui changerait d'heure au passage à l'heure d'hiver serait décalé.
- 📅 **Vues Jour / Semaine / Mois navigables** (‹ › + « Aujourd'hui »), clic sur un jour du mois → vue Jour. Les événements sur **plusieurs jours** s'affichent sur chaque jour couvert (`joursDe`, DTEND exclusif géré pour les journées entières).
- 🎒 **Plannings Enora / Martial** : bande cliquable sous l'agenda (aperçu du jour) → panneau semaine complète. **Source = base Notion « 🎒 Planning enfants »** (`DB_PLANNING`, créée sous la page 🏠 Maison, 17 créneaux d'exemple) pour rester consultable/modifiable depuis les téléphones. Propriétés : `Activité` (title), `Personne`, `Jour`, `Début`, `Fin`, `Lieu`, `Type`, `Actif` (décocher = masquer sans supprimer, pratique pour les vacances).
  - `planning.json` ne sert plus que de **secours** si `DB_PLANNING` est vide. `PLANNING_EXEMPLE=1` affiche le bandeau « données d'exemple » → passer à `0` à la rentrée.
  - Couleurs par personne codées dans `COULEURS` (server.js), ordre d'affichage = ordre de cet objet.
- 🌙 **Bouton « Veille »** dans l'en-tête (mise en veille manuelle, sans attendre les 25 min).

### Ajouts du 13/08/2026 (4e série — refonte visuelle)
- 🎨 **`public/index.html` entièrement réécrit** : palette plus contrastée, dégradés + ombres douces, coins arrondis, tailles tactiles augmentées (cases à cocher 21 → 27/30 px, listes 15 → 16,5 px, boutons ≥ 36 px).
- 📐 **Grille repensée** pour régler « les tuiles sont trop petites » : la tuile Température ne mange plus une rangée entière (elle est passée en **bandeau bas** avec la Musique) ⇒ **Courses** et **À faire** occupent chacune une vraie rangée et affichent toute la liste.
- 🎒 La bande plannings a été **remplacée par 2 boutons** « Enora » / « Martial » sous l'agenda (avec le prochain créneau du jour en sous-titre) → s'ouvrent en grand dans le panneau.
- 🌤️ **Météo** dans l'en-tête à côté de la date : **Open-Meteo** (Roubaix, gratuit, sans compte ni clé), cache 15 min, dernière valeur conservée si le réseau tombe.
- 📅 **Fête du jour** sous la date, depuis `saints.json` (**local, aucun réseau**). Si le nom correspond à un membre de la famille → « 🎉 Bonne fête … ». Liste d'usage courant, corrigeable librement.
- 📰 **Bandeau actus défilant** (RSS franceinfo par défaut, `NEWS_RSS_URL` — plusieurs flux possibles séparés par des virgules, vide = masqué). Cache 15 min, entités HTML décodées, défilement CSS continu (contenu dupliqué + `translateX(-50%)`).
- 🌙 **Écran de veille transformé en widgets** : grande horloge, date, fête du jour, météo, puis 3 cartes — **événements du jour**, **repas du soir** (+ compteurs courses/tâches), **dernier post-it** — et le bandeau actus.

### Ajouts du 14/08/2026
- ✅ **Premier retour visuel de Rémi : l'écran s'affiche et fonctionne.**
- 🌐 **L'IP change vraiment** (`10.31.95.95` → `192.168.10.108`, changement de réseau Wi-Fi). Le serveur affiche désormais ses adresses au démarrage et les expose dans `GET /api/health` → `adresses[]`.
- 🌗 **Thème clair / sombre** : toutes les couleurs sont passées en variables CSS ; `:root` = sombre (défaut), `:root[data-theme="light"]` = clair. Bascule par un **bouton rond dans l'en-tête dont la couleur annonce la destination** (rond clair ☀ quand on est en sombre, rond sombre ☾ quand on est en clair). Choix mémorisé en `localStorage`, appliqué par un script inline dans `<head>` pour éviter le flash au chargement.
  - Variable **`--onac`** = couleur du texte posé sur un aplat d'accent (sombre en thème sombre, blanc en thème clair). Exception : `.pbtn .av` (initiale sur pastel) garde un sombre fixe, lisible dans les deux thèmes.
  - Les accents sont **assombris** en thème clair (ex. `--course` #3ddc97 → #0d9464) pour rester lisibles sur blanc ; blocs rouges (confirmation de suppression, bandeau d'erreur) éclaircis via une surcharge dédiée.
  - ⚠️ **Règle à tenir** : ne plus jamais écrire de couleur en dur hors des deux blocs `:root`. Un script de contrôle existe dans le scratchpad (`verif2.js`) : il vérifie la syntaxe des scripts, l'équilibre des accolades CSS, l'absence de couleurs figées et les variables sans équivalent clair.

### Corrections issues de la 1re capture d'écran (14/08/2026)
Première fois qu'on voit réellement l'écran. Deux bugs invisibles depuis l'API :
- 🐞 **Rangées de la grille** : la rangée `agenda/post` était en hauteur **`auto`** ⇒ elle se servait la première et **étranglait** Menu, Courses et À faire (menu coupé au milieu de « Mer », **1 seule course visible sur 4**). Corrigé : les 3 rangées de contenu sont en **`minmax(0,…fr)`** et se partagent la hauteur. **C'était la vraie cause du « les briques sont trop petites »**, pas la taille des polices.
- 🐞 **Éléments terminés affichés en premier** : sur une tuile à hauteur limitée, on voyait les lignes barrées et pas ce qui restait à faire. Corrigé par `triFait()` / `triTodos()` — non fait d'abord, puis échéance croissante. Appliqué aussi dans les panneaux agrandis.
- 🎨 Carte Température : le `—` isolé faisait « cassé » → remplacé par un libellé explicite « à brancher sur le Mac ».

⚠️ **Leçon de méthode** : ces deux défauts étaient **indétectables** par les vérifications d'API et de syntaxe. Réclamer une capture d'écran **beaucoup plus tôt**.

### Corrections issues de la 2e capture (14/08/2026)
- 🎒 **Plannings enfants → pastilles rondes dans l'en-tête de l'agenda** (`.pmini`, initiale sur fond pastel, détail du jour en infobulle). Les gros boutons sous la tuile consommaient toute la hauteur utile : la bande des jours était rognée et les événements du jour **n'apparaissaient plus du tout**.
- 🍽️ **Menu sur 2 colonnes** (idée de Rémi) : `#menuBody` en grille `grid-auto-flow:column` sur 4 rangées ⇒ Lun→Jeu à gauche, Ven→Dim à droite, les 7 jours tiennent sans défilement. Repasse en **1 colonne en portrait** (la hauteur y est abondante).
- Rangée agenda portée à `1.4fr` (l'agenda et le post-it étaient encore tronqués), bandeau bas resserré, agenda jusqu'à 5 événements du jour.
- ✅ **Mise en page paysage validée par Rémi (« parfait ») le 14/08/2026.** Ne pas y toucher sans raison ; toute nouvelle tuile devra être insérée sans casser cet équilibre de rangées.

**Réglages restants (signalés, non traités) :** bloc météo un peu isolé dans l'en-tête ; icône 🍽️ rendue comme un carré sous Windows (les autres emoji passent) → remplacer les icônes d'en-tête par des SVG maison si ça persiste sur la dalle finale.

### Piste visuelle « bento » — prototype du 17-18/08/2026 (en attente de l'avis de Rémi)
Déclencheur : Rémi a envoyé le **Blackview NEST 10** (store.blackview.hk) — « c'est ce genre de tablette que je recherche, les visuels de la solution me plaisent ; il manque le lien avec le smartphone et la gestion de la maison (musique, Netatmo), mais y'a l'idée ».

**Le matériel (fiche produit)** : 10,1" · **800 × 1280 (donc nativement portrait)** · IPS 350 nits · **Android 11** · RK3326S A35 · **2 Go de RAM** · 32 Go · Wi-Fi 6 · **alimenté en permanence, sans batterie** · support mural et bureau avec **rotation 90°** · ~85 £.
- ⚠️ **10" ≠ écran mural** : la cible actée reste la **dalle 20-24" portrait** (confirmé par Rémi le 17/08). Le NEST 10 sert d'**inspiration visuelle**, pas de cible de calibrage.
- ⚠️ **2 Go de RAM / GPU Mali-G31** : si un jour on vise ce type de tablette, surveiller les trois effets coûteux — `backdrop-filter:blur()`, les grands `radial-gradient` de fond, et l'**animation continue du bandeau actus**. Prévoir un mode « léger ».
- ⚠️ Kiosque sur Android 11 : nécessite une app type Fully Kiosk Browser ou l'épinglage d'écran, et de court-circuiter leur launcher maison (iFrameo).

**Livré : `public/bento.html`** — page **séparée**, `index.html` intact (sa mise en page paysage est validée « parfait », on ne la perd pas tant que le bento n'a pas gagné). Mêmes données, mêmes écritures : comparable à l'usage.
- Fond clair uni, **cartes blanches sans bordure** (le contraste vient de l'ombre), disposition en **mosaïque** de tailles inégales, lignes de liste en **pilules pastel** teintées par module, **rail d'icônes à gauche**.
- Ajouts par rapport à index.html : **salutation contextuelle** selon l'heure, **horloge analogique**, **météo horaire + 2 jours suivants**, **mini-calendrier du mois** avec pastilles, **pictogramme par plat**, carte **Maison** (Netatmo + AirPlay) mise en avant comme différenciateur.
- **Icônes en SVG maison** (sprite `<symbol>` en tête de fichier) au lieu des emoji : règle le carré du 🍽️ sous Windows et donne un rendu identique partout. Emoji conservés seulement pour la météo et les plats.
- Thème clair par défaut (`localStorage` : clé **`theme-bento`**, distincte de `theme` pour ne pas interférer avec index.html), thème sombre complet, veille en mur de widgets + bandeau actus.
- **Pictogramme des plats déduit du NOM** (table `PICTOS`) : palliatif assumé. La vraie solution reste un champ `Emoji` ou `Photo` dans la Bibliothèque de plats (§ 5 bis).

**Extension additive de `server.js`** : `readMeteo()` renvoie en plus `heures[]` (5 points, un sur deux) et `jours[]` (2 jours suivants). `forecast_days` 1 → 3, ajout de `hourly`. **Les champs existants sont inchangés** → `index.html` n'est pas affecté.

**Défauts trouvés au rendu et corrigés** (aucun n'était détectable par l'API ni par les contrôles de syntaxe) :
- `aspect-ratio:1` sur les cases du mini-mois → 6 rangées de carrés mangeaient toute la carte et « Aujourd'hui » passait sous le pli. Cases à **hauteur fixe**.
- En portrait, **agenda sur 2 colonnes** (mini-mois à gauche, événements à droite) : empilé, il coûtait le double de hauteur pour la même information.
- En portrait, **menu sur 2 colonnes** (Lun→Jeu / Ven→Dim) sinon il s'arrêtait à mercredi.
- `<span>` de liste sans `display:block` → « Enora08:00 Collège » collé sur une ligne.
- `text-transform:capitalize` sur les dates → « Vendredi 14 Août · Fête Du Jour ». Remplacé par `::first-letter`.
- `MOIS[i].slice(0,4)+'.'` → « août. » : pas de point quand le mois fait ≤ 4 lettres (`moisCourt()`).
- Texte des pilules : passage à la ligne au lieu de la troncature (une tâche illisible ne sert à rien sur un mur).
- Veille : le bloc de widgets tombait tout en bas → centré, et le bandeau actus remis.

**Non tranché / à faire quand Rémi aura donné son avis** : si le bento gagne, fusionner (bento devient le thème clair, l'actuel le thème nuit) et supprimer la duplication de logique entre les deux fichiers. **En paysage le menu défile (6 jours sur 7)** : assumé, le paysage n'est qu'un mode de prévisualisation sur le PC.

### Leçons
- ✅ **On peut voir le rendu SANS l'extension Chrome** (elle n'a jamais réussi à se connecter). Chrome en ligne de commande, aucun droit admin :
  `"C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --disable-gpu --hide-scrollbars --virtual-time-budget=9000 --window-size=1080,1920 --screenshot="<chemin ABSOLU>.png" --user-data-dir="<dossier NEUF>" http://localhost:8090/bento.html`
  - Le chemin de `--screenshot` doit être **absolu** (sinon « Accès refusé ») et `--user-data-dir` doit être **différent à chaque appel**, sinon Chrome se bloque sur le verrou de profil.
  - `--window-size=1080,1920` simule la dalle portrait, `1600,1000` le PC. **C'est le seul moyen d'attraper les bugs de mise en page** — ils sont invisibles depuis l'API et depuis les contrôles de syntaxe.
  - Pour photographier un panneau ou la veille : générer une copie temporaire dans `public/` avec un `<script>` qui appelle `openTile(...)` / `showSaver()`, puis **la supprimer**.
- ✅ **Corrigé le 18/08** : `dotenv` lisait le `.env` du **répertoire courant**, donc lancé d'ailleurs le serveur ignorait le token et `PORT=8090`, tentait le 8080 (pris par whatsapp-bridge) et mourait sur `EADDRINUSE`. Le `.env` est maintenant lu depuis le **dossier du projet** (`path.join(__dirname, '.env')`) — le piège est supprimé, pas contourné.
- ⚠️ **Capture d'écran + temps réel** : une connexion SSE ouverte empêche Chrome sans écran de considérer la page comme terminée — la capture ne part jamais et le rendu échoue sur « Abnormal renderer termination ». Pour photographier une page, en faire une copie temporaire avec `brancherFlux();` neutralisé (et le service worker retiré), puis la supprimer.
- ⚠️ **Chrome sans écran impose une largeur minimale de ~512 px** : `--window-size=390,844` donne bien une image de 390 px de large, mais la page est mise en page en **512 px** et l'image est recadrée — ce qui ressemble à un débordement horizontal alors qu'il n'y en a pas. Capturer les vues téléphone en **512 px de large** et ne pas conclure trop vite à un bug de largeur : mesurer `innerWidth` dans la page avant de « corriger ».
- ⚠️ **Leçon** : ne **jamais** tester une opération destructive de masse (`/api/course/vider`) sur les vraies données. Mon test a archivé Café/Pâtes/Lessive (que la famille avait cochés) ; restaurés via `archived:false`. Idem, restaurer un champ « (libre) » avec un PATCH sans `special:true` le convertit en plat et **pollue la bibliothèque**.

### 🖥️ Cible finale (confirmé par Rémi le 13/08/2026)
- Hébergement définitif : **Mac mini** (local), une fois reçu. Le PC Windows n'est qu'une étape.
- Écran : **dalle tactile 20 à 24 pouces en mode PORTRAIT** (pas paysage). L'affichage doit s'y adapter et rester **très lisible** (lecture debout, à 1–2 m).
- ✅ Déjà fait : `@media (orientation:portrait)` dans `index.html` — passage en **une seule colonne** (`header / menu / agenda / course / todo / post / strip / news`), toutes les tailles augmentées (horloge 76 px, listes 19 px, cases 32 px, boutons ≥ 44 px), panneau agrandi quasi plein écran, widgets de veille empilés. Une 2e règle `max-width:860px` resserre le tout pour une tablette portrait étroite.
- ⚠️ **Non vérifié sur écran réel** : à retester quand la dalle sera là — surtout le nombre de lignes visibles dans Courses / À faire et la vue Mois de l'agenda (7 colonnes sur une largeur réduite).

### Contraintes poste (PC de Rémi) — important
- **Rémi n'est PAS admin** de ce poste : **aucune installation** (MSI/winget échoue sur l'UAC), **aucune règle de pare-feu** créable. Tout doit être **portable**.
- **Node est portable**, deux copies disponibles :
  - `C:\temp\asap\asap3-poc-local\node-v24.17.0-win-x64\node.exe` → **celui-ci est autorisé en entrant par le pare-feu (profil Public)** ⇒ **obligatoire pour que la tablette accède à l'écran**.
  - `%LOCALAPPDATA%\nodejs\node.exe` (v24.19.0, dézippé) → entrant **bloqué** par une règle existante ⇒ localhost seulement. Sert aussi de `npm`.
- **Port 8080 déjà pris** par `whatsapp-bridge.exe` ⇒ le projet tourne sur **8090**.
- Réseau Wi-Fi en **DHCP** et profil **Public** — ⚠️ **l'IP du PC change vraiment** : `10.31.95.95` (réseau `WIFI-RABOT 5`) le 13/08, puis `192.168.10.108` (réseau `Freepro-ZTRTJI 2`) le 14/08. Ne jamais coder une IP en dur ni la promettre à Rémi comme définitive.
  - ✅ Depuis le 14/08, le serveur **affiche ses adresses au démarrage** et les expose dans `GET /api/health` (`adresses[]`) — plus besoin de `ipconfig`. Le profil réseau doit rester **Public** pour que la règle de pare-feu du Node de `C:\temp\asap` s'applique.
- Lancement : `demarrer-maison.cmd` (choisit le bon Node automatiquement).

## 2 ter. 🏗️ BASCULE HORS NOTION + APP FAMILLE (18/08/2026) — changement de nature du projet
Décision de Rémi : « le bento me plaît ; maintenant un système **sans Notion**, avec **une app installée sur chaque iPhone** de la famille, même principe bento mais **un seul thème par écran** sur le téléphone, **synchronisé instantanément** avec l'écran mural. Base de données, serveur… Le Mac mini sera le serveur à son arrivée. »
Trois arbitrages pris avec lui : **bascule nette** (Notion gelé en archive) · **accès hors maison via Tailscale** · **appareil enrôlé une fois, on ne redemande plus jamais** (biométrie iPhone plus tard si besoin).

### Architecture
```
        ┌──────────── PC aujourd'hui → Mac mini demain ────────────┐
Écran   │  server.js                                                │
mural ──┤    ├── donnees/     ← couche unique, échangeable          │
        │    ├── API REST     ← lectures + écritures                │
iPhones │    ├── /api/flux    ← SSE : pousse tout changement        │
(PWA) ──┤    └── maison.db    ← SQLite, un seul fichier à sauver    │
        └───────────────────────────────────────────────────────────┘
```

### `donnees/` — la couche qui rend tout le reste possible
`donnees/index.js` choisit l'implémentation selon `SOURCE` dans `.env` : `sqlite` (défaut) ou `notion`.
**Le serveur et le front ignorent complètement d'où viennent les données.** C'est ce qui a permis de remplacer Notion sans toucher à une seule ligne de `bento.html`, et ce qui permettra Postgres si le projet devient un produit (§ 5 quater).
- `donnees/sqlite.js` — la cible. `donnees/notion.js` — l'historique, code extrait de `server.js`. `donnees/commun.js` — constantes partagées. `donnees/schema.sql` — le schéma.
- Interface : `tout()`, `ajouterCourse/cocherCourse`, `ajouterTache/cocherTache`, `ajouterPostit`, `definirMenu`, `supprimer`, `viderCoursesPrises`, `enrolerAppareil/appareil`, `lirePersonnes`.
- ⚠️ **Tout est `await`é côté serveur** : Notion est asynchrone, SQLite synchrone. Attendre une valeur non-promesse est sans effet, l'interface reste unique.

### 💡 Le choix technique déterminant : `node:sqlite`
**SQLite est INTÉGRÉ à Node depuis la 22.5** (`require('node:sqlite')`). Vérifié sur le Node portable de Rémi (v24.17) : fonctionne, WAL compris.
Conséquence : **aucun module natif à compiler, aucune installation, aucun droit admin** — ce qui aurait bloqué `better-sqlite3` et rendu Postgres impossible sur ce poste. Et `maison.db` se copie tel quel du PC vers le Mac mini.
Conventions du schéma : `supprime_le` = **suppression douce** (on reproduit la corbeille Notion, qui nous a déjà sauvés) · `maj_le` pour la synchro · `origine_notion` UNIQUE pour rendre l'import **rejouable**.

### Migration — faite, rejouable, sans risque
`node outils/migrer-notion-vers-sqlite.js` (simulation) puis `--vraiment`.
**Notion est ouvert en LECTURE SEULE** : rien n'y est écrit ni archivé. Rejouer met à jour au lieu de dupliquer (vérifié : deux passages, aucun doublon).
Importé le 18/08 : 8 plats, 7 courses, 2 post-it, 7 jours de menu, 17 créneaux de planning, 6 personnes.
- ⚠️ **0 tâche importée** : la base « À faire » de Notion était **vide** au moment de la bascule — les 4 tâches présentes le 14/08 ont été archivées entre-temps (pas de mon fait). Elles sont dans la corbeille Notion. **Si Rémi les restaure, il suffit de relancer la migration.**

### Temps réel — `GET /api/flux` (SSE)
Une écriture aboutit → le serveur diffuse `event: maj` à tous les abonnés (écran + téléphones), qui rechargent (rafale groupée en un seul rechargement).
SSE plutôt que WebSocket : natif au navigateur, **reconnexion automatique**, aucune dépendance.
**Mesuré : ~30 ms** entre l'écriture depuis un téléphone et la réception sur l'écran mural. L'événement porte aussi **qui** a agi.
- Le rafraîchissement périodique passe de 30 s à **5 min** : il ne sert plus qu'à la météo, aux actus et à l'agenda, et de filet si le flux meurt.
- ⚠️ **`readAgenda()` est désormais en cache 10 min.** Avant, chaque `/api/data` retéléchargeait tout le calendrier iCloud ; avec le temps réel, une simple coche aurait déclenché N téléchargements.

### `public/app/` — l'app famille (PWA)
Un écran par thème + **barre d'onglets** (Courses · Menu · À faire · Agenda · Post-it), même langage visuel que le bento. Pastille de compteur sur Courses et À faire.
- **Enrôlement une seule fois** : au 1er lancement on choisit son prénom → jeton tiré au sort, gardé sur l'appareil, envoyé en en-tête `x-jeton`. Table `appareils` (colonne `passkey` réservée pour Face ID plus tard).
- `manifest.webmanifest` + `sw.js` + icônes PNG. **Icônes générées par `outils/faire-icones.js`** : dessin en pixels + encodage PNG avec `zlib`. Aucune dépendance graphique, aucun CDN — iOS exige un PNG pour `apple-touch-icon`.
- **Repli hors ligne en `localStorage`** (indépendant du service worker, voir le blocage HTTPS ci-dessous) : la liste de courses reste lisible dans les rayons sans réseau.
- Les personnes viennent de la **base** (`lirePersonnes`), plus de la constante `FAMILY` codée en dur — premier morceau du § 5 quater réellement fait.

### ⚠️ Deux blocages réels, à connaître avant de promettre quoi que ce soit
1. **Tailscale ne peut pas être installé sur le PC de Rémi** : l'installeur Windows exige les droits admin, et il n'existe pas de version portable. ⇒ **L'accès hors maison attend le Mac mini.** En attendant, l'app fonctionne sur le Wi-Fi de la maison.
2. **Le service worker ne s'enregistrera PAS sur iPhone en HTTP** : un service worker exige un *contexte sécurisé* (HTTPS, ou localhost). Sur `http://IP:8090` il est ignoré.
   - Ce qui marche quand même en HTTP : **« Sur l'écran d'accueil »**, l'icône, le plein écran sans barres Safari, et le repli hors ligne en `localStorage`.
   - Ce qui attend HTTPS : le cache hors ligne du service worker et, plus tard, les **notifications push**.
   - Solution propre : **Tailscale fournit un vrai certificat HTTPS** sur un nom `*.ts.net`. Les deux blocages se lèvent donc ensemble, avec le Mac mini.

### État après cette étape
- `SOURCE=sqlite` dans `.env`, serveur relancé, **l'écran mural est visuellement identique** — c'était le but.
- ✅ Vérifié : lecture, écriture, suppression douce, migration rejouable, diffusion SSE, UTF-8 (trois chemins différents : migration, écriture directe, écriture HTTP).
- 🐞 Faux positif à ne pas refaire : un test `curl` sous Git Bash abîme les accents dans le corps JSON. **Ce n'est pas un bug produit** — tester les accents depuis Node, pas depuis curl.

## 2 quater. 🛠️ BACK-OFFICE + APP FAMILLE REFONDUE (18/08/2026, 2e session)
Décision de Rémi : **le bento gagne pour l'écran mural** (`index.html` n'est plus la référence). Il demande en plus un **vrai back-office** (emploi du temps détaillé type collège, gestion des plats, gestion des membres avec mot de passe / mail / téléphone), une **app iPhone** avec menu latéral et authentification biométrique, et des **notifications qui apparaissent sur chaque écran**.

### ⚠️ Ce qui a été dit franchement à Rémi (et qui reste vrai)
Trois demandes touchent la même barrière technique — **le HTTPS**, impossible sur ce PC sans droits admin :
1. **Face ID / Touch ID** = WebAuthn, qui exige un *contexte sécurisé*. En HTTP, l'API n'existe simplement pas dans Safari. ⇒ Livré : **code PIN par personne** (scrypt + sel, jamais en clair) + appareil enrôlé une fois. La colonne `passkey` attend déjà en base.
2. **Push iOS hors application** (téléphone verrouillé) = exige HTTPS + PWA installée + VAPID. ⇒ Livré : **notification poussée en direct par SSE**, qui s'affiche sur l'écran mural et sur les téléphones **ouverts**. C'est littéralement la demande « un push qui fait apparaître sur chaque écran », moins le téléphone en veille. Table `abonnements_push` créée, vide, prête.
3. **Accès hors maison** : inchangé, attend Tailscale.
⇒ **Les trois se débloquent ensemble le jour du Mac mini.** Rien ne sera à refaire, seulement à brancher.

### Schéma — migration idempotente (`donnees/migrations.js`)
`schema.sql` sait créer une base neuve, pas faire évoluer une base existante. Nouveau fichier qui lit `PRAGMA table_info` et **n'ajoute que ce qui manque** : rejouable à l'infini, aucun numéro de version, et une base venue d'une autre machine se met à niveau au premier démarrage.
- `personnes` + `role`, `email`, `telephone`, `code_hash`/`code_sel`, `admin`, `naissance`, `etablissement`, `classe`, `notif`.
- `planning` + `categorie` (cours|activite|garde|autre), `prof`, `salle`, `quinzaine` (**semaine A/B des collèges**), `couleur`, `valide_du`/`valide_au`, `supprime_le`.
- `plats` + `ingredients` (prépare « courses déduites du menu »).
- Tables neuves : `notifications`, `abonnements_push`, `sessions`.
- ⚠️ **SQLite refuse un DEFAULT non constant dans ALTER TABLE ADD COLUMN** (`datetime('now')` rejeté) : toutes les colonnes ajoutées sont nullables ou à défaut constant.
- 🐞 Bug trouvé **par le test, pas par la relecture** : `notifications` n'avait pas `maj_le`, que la corbeille commune écrit sur toutes les tables ⇒ `no such column: maj_le` à la suppression. Convention retenue : **toute table de contenu porte `supprime_le` ET `maj_le`**.

### API
- `POST/GET/DELETE /api/session` (connexion par code, session 12 h) ; en-tête **`x-session`** (distinct du `x-jeton` des appareils).
- `/api/admin/*` : membres, planning, plats (+ **fusion de doublons**), réglages, appareils, état. **Barrière posée en `app.use` au-dessus de toutes les routes admin** — une route ajoutée plus bas ne peut pas l'oublier.
- `/api/notif` : écrit en base **puis** diffuse. Séparer les deux permet à un téléphone éteint de rattraper l'historique.
- Le flux SSE porte maintenant **deux** événements : `maj` (rechargez) et `notif` (affichez tel quel, sans rechargement).
- ⚠️ **Piège d'ordre des routes Express** : `DELETE /api/:kind/:id` est déclarée tôt et capte `/api/notif/:id`. Corrigé en ajoutant `notif` à la table de correspondance de `supprimer()` plutôt qu'en empilant une route fantôme qui n'aurait jamais été atteinte.
- Un membre **sans code peut entrer** : c'est l'amorçage, et c'est déjà le niveau d'ouverture de l'app sur le LAN. Le tableau de bord affiche un avertissement tant qu'il en reste.

### `public/admin/` — le portail
Six écrans : tableau de bord, **emploi du temps** (grille 7 jours, créneaux cliquables, cours en violet / activités en vert, badge A|B, **copie d'une journée vers une autre**), **repas** (emoji, catégorie, ingrédients, fusion de doublons), **famille** (rôle, contact, code, admin, appareils enrôlés révocables), **notifications** (envoi + historique), **réglages**.
- Renommer une personne **propage le nouveau nom** dans planning, tâches, courses, post-it, appareils, sessions et notifications — les tables référencent le prénom (héritage de Notion), sans ça on orphelinait ses données.
- `outils/admin.js` amorce le premier compte en ligne de commande (poule et œuf) et sert de secours si plus personne ne connaît le code.

### `public/app/` — l'app famille refondue
Réécrite au langage du bento, **menu latéral** : Aujourd'hui · Menu de la semaine · Courses · À faire · Agenda · Post-it · Notifications · Réglages. Pastilles de compteur, bouton `+` contextuel, feuilles de saisie (rayon, échéance, destinataire), suppression en deux touchers, thème clair/sombre, verrou optionnel au code.
- **Les clés de `localStorage` ont été conservées à l'identique** (`maison-jeton`, `maison-personne`, `maison-theme`, `maison-onglet`, `maison-cache`) : un iPhone déjà enrôlé ne doit pas être déconnecté par une mise à jour.
- L'app peut **envoyer** une notification à la famille (« Prévenir la famille »).
- Le service worker n'est tenté **que si `location.protocol === 'https:'`** : en HTTP il échouait silencieusement à chaque lancement.

### Emploi du temps en GRILLE HORAIRE (retour de Rémi, capture d'un emploi du temps de lycée à l'appui)
Rémi : « je veux un truc dans ce style, avec les activités en plus » puis, pour l'app, « **des blocs par jour, pas des listes de cours** ». Les cartes empilées du premier jet sont abandonnées.
- **L'axe vertical est le temps réel**, pas une suite de cases. Conséquence directe : une plage « colles jusqu'à 18 h 15 » s'étire d'elle-même sur quatre créneaux, sans fusion de cellules à la main, et les trous entre les cours se voient.
- **Back-office** : grille semaine (jours en colonnes), samedi/dimanche affichés **seulement s'ils servent**, clic sur un bloc pour éditer, **clic dans le vide pour créer à l'heure pointée** (arrondie au quart d'heure), légende des matières, défilement horizontal sous 780 px.
- **App** : un jour à la fois (pastilles de jours), mêmes blocs proportionnels. Une grille de semaine sur un téléphone impose un défilement horizontal, et on édite mal ce qu'on doit d'abord aller chercher.
- **Couleurs** : dérivées du **nom** de la matière (donc stables), avec **résolution des collisions** — le simple hachage donnait la même teinte à Chimie, DS et Accompagnement, ce qui ruine l'intérêt de la couleur. Palette de 16 teintes ; une couleur choisie à la main l'emporte.
- **Activités** ≠ cours : fond pâle + liseré de la même teinte, distinguables d'un coup d'œil sans être reléguées.
- **Chevauchements** gérés (partage de largeur) : deux créneaux à la même heure se masquaient l'un l'autre — défaut invisible tant qu'on n'a pas saisi de vraies données.

### Les enfants éditent LEUR emploi du temps (demande de Rémi)
`GET/POST /api/planning/mien` et `DELETE /api/planning/mien/:id`, écran « Mon emploi du temps » dans l'app.
- 🔒 **La personne est imposée par le jeton de l'appareil, jamais lue dans le corps de la requête.** Vérifié : envoyer `personne:'Martial'` depuis le téléphone d'Enora crée le créneau chez **Enora** ; modifier un créneau qui n'est pas le sien → **403** ; sans appareil enrôlé → **401**.
- ⚠️ Chemin en 3 segments (et 4 pour la suppression) **exprès** : `DELETE /api/:kind/:id` est déclarée plus haut et aurait capté `/api/mon-planning/:id`. Deuxième fois que ce piège se présente.

### La grille aussi sur l'écran mural + fin de la mention Notion
Rémi : « ça s'affiche comme attendu dans le back-office, **par contre pas dans le bento** » et « il y a encore écrit *données d'exemple… planning enfants Notion*, à retirer si tout est en BDD ».
- `vuePlanning()` dans `bento.html` : même grille horaire (jour courant surligné, légende des matières, activités en fond pâle).
- Le repère « données d'exemple » vit maintenant dans la table `reglages` (clé `planning_exemple`) et se décoche depuis **/admin/ → Réglages**, sans éditer le `.env` ni relancer. `.env` et base ont été mis à `0`.

### Courses depuis le menu — PROPOSITION, jamais automatique
Rémi : « la possibilité d'ajouter des ingrédients dans la liste de courses ? mais **faut pas que ça s'ajoute automatiquement**, j'ai peut-être l'ingrédient dans les placards ». C'est la bonne contrainte, et elle définit la fonction.
- `GET /api/course/suggestions` — **ne crée rien**. Renvoie les ingrédients des plats de la semaine, dédoublonnés (comparaison sans casse ni accents), chacun avec les plats d'où il vient, et un drapeau `deja` pour ce qui est déjà sur la liste. Renvoie aussi `sansIngredients` : les plats du menu dont la recette n'est pas renseignée — sinon on croit la fonction cassée alors qu'il manque juste la saisie.
- `POST /api/course/lot` — ajout groupé : **une** écriture, donc **une** diffusion temps réel, au lieu de quinze rafraîchissements en cascade sur l'écran mural.
- UI (app et bento) : liste à cocher, **rien de coché d'avance**, ce qui est déjà sur la liste affiché barré plutôt que masqué.
- ⚠️ Routes déclarées **avant** `/api/course/:id` : « suggestions » et « lot » ne sont pas des identifiants. Troisième occurrence du piège d'ordre des routes Express sur ce projet.
- Ingrédients de départ renseignés pour les 8 plats d'origine (propositions, modifiables dans /admin/ → Repas). Les plats saisis librement depuis le menu (« croque monsieur », « tomates mozza ») n'en ont pas : c'est normal.

### 🐞 Vérification du 18/08 : « un plat écrit à la main rejoint-il la bibliothèque ? »
**Oui, ça marchait déjà** (`definirMenu` → `platId()` crée le plat si absent ; `special:true` ne crée rien ; ressaisie avec une autre casse ne duplique pas). Confirmé aussi par l'usage réel de Rémi, qui a fait apparaître trois plats dans la bibliothèque en saisissant ses menus.
- ⚠️ **Je suis retombé dans le piège déjà écrit dans ce fichier** : en remettant un jour de menu dans son état d'origine avec un PATCH sans `special:true`, j'ai converti le texte libre « pates carbo » en plat de bibliothèque. Réparé. **Restaurer un champ « (libre) » impose `special:true`.**

## 2 quinquies. 🍽️ RECETTES, PHOTOS DE PLATS ET MODE CUISINE (18/08/2026, 3e session)
Demande de Rémi : « comment faire pour que les ingrédients s'ajoutent instantanément dans une recette connue ? l'IA retrouve la recette ? une capture d'écran ? connecter à Marmiton ? » puis « ça permet de récupérer les vraies photos des plats et donc de faire un design plus sympa dans bento en miniature ». Enfin : ses appareils (**Ninja Woodfire, Ninja Slushi, Magimix**) doivent servir.

### 💡 La découverte qui change la solution : pas besoin de scraper, ni d'IA, pour le cas courant
Les sites de cuisine publient leur recette en **`schema.org/Recipe` (JSON-LD)** dans le HTML — Google l'impose pour les résultats enrichis. On lit donc les ingrédients, les étapes, les portions, la durée et la photo **proprement, gratuitement, sans clé et sans rien inventer**. Aucun sélecteur CSS à maintenir, aucune API non officielle qui casse à la prochaine refonte.
- ✅ Vérifié en vrai : **750g** et **CuisineAZ** répondent bien. **Marmiton publie le JSON-LD mais son hébergeur d'images refuse le téléchargement (503)**, y compris avec un `Referer`.
- ⚠️ Toutes les pages d'un même site ne l'ont pas : plusieurs vieilles recettes 750g n'ont pas de JSON-LD. Le message d'erreur le dit et renvoie vers l'IA ou la saisie manuelle.
- ⚠️ **Une page introuvable renvoie quand même une image** : l'illustration générique du site. Les stocker donnerait des vignettes identiques et fausses sur tout le menu ⇒ filtre `estPlaceholder()` (`default`, `placeholder`, `no-image`…).

### `recettes/` — trois sources derrière une interface unique
Même principe que `donnees/` : le serveur ignore laquelle a répondu, et si l'une tombe les autres continuent.
| fichier | rôle |
|---|---|
| `recettes/lien.js` | JSON-LD `schema.org/Recipe` + `og:image`. **`confiance: 'sure'`** |
| `recettes/ia.js` | API Anthropic : depuis un nom de plat, ou depuis une photo (vision). **`confiance: 'estimee'`** |
| `recettes/images.js` | téléchargement et rangement **en local** des photos |
| `recettes/commun.js` | nettoyage — c'est lui qui fait la qualité du résultat |
| `recettes/index.js` | orchestration + `sources()` (ce qui est disponible ici et maintenant) |

⚠️ **Aucune de ces fonctions n'écrit en base.** Elles renvoient une PROPOSITION que l'humain valide — même règle que les courses depuis le menu, posée par Rémi.

### Photos : téléchargées une fois, servies en local (règle « sans CDN »)
Pointer l'URL distante aurait été plus court et **faux** : l'écran mural doit garder ses vignettes quand Internet tombe. On télécharge dans `public/plats/`, nommé par **empreinte SHA-1 du contenu** (deux plats qui partagent une image ne la stockent qu'une fois, re-télécharger ne duplique pas). `nettoyerImages()` retire les orphelines.
- ⚠️ **`Referer` obligatoire** : les hébergeurs d'images refusent en 503/403 une requête qui n'annonce pas la page d'origine (anti-hotlink).
- ⚠️ Pas de redimensionnement : il faudrait `sharp`, module natif impossible à installer sans droits admin. **À faire sur le Mac mini** — 9 photos pèsent déjà 3 Mo.

### IA — `claude-opus-5`, et ce que la référence a corrigé
- **Modèle par défaut `claude-opus-5`**, surchargeable par `IA_MODELE` dans `.env`. J'avais d'abord annoncé Haiku 4.5 de mémoire ; à ce volume (quelques appels par semaine) **la facture reste de quelques centimes par mois dans les deux cas**, donc le choix appartient à Rémi, pas au code.
- **Structured outputs** (`output_config.format` + schéma JSON) : le modèle est contraint au schéma, plus de texte libre à parser. `additionalProperties:false` et `required` complet sont obligatoires.
- **La pensée adaptative est active par défaut sur Opus 5** (contrairement à 4.8) et compte dans `max_tokens` ⇒ `max_tokens: 8000` avec `effort: 'low'`.
- **`stop_reason: 'refusal'` testé AVANT de lire le contenu** — sinon on plante sur un tableau vide.
- `fallbacks: 'default'` (beta) demandé, avec **repli automatique sur l'appel simple** si la beta n'est pas ouverte sur la clé : une fiche de recette ne doit pas dépendre d'un drapeau beta.
- 🔑 `ANTHROPIC_API_KEY` dans `.env`. **Elle a été collée en clair dans une conversation** : à régénérer sur console.anthropic.com si ce transcript est conservé ou partagé.

### Les appareils du foyer changent les recettes
Réglage **`equipements`** (back-office → Réglages), transmis à l'IA. Résultat vérifié : « Préchauffer le **Ninja Woodfire** en mode four extérieur à 190 °C (option fumoir avec des granulés de hêtre) », « Préparer la pâte brisée au **Magimix** », « Râper le fromage au **Magimix** ». Le champ `appareils` remonte aussi pour afficher un repère. La consigne dit explicitement de **ne pas forcer** leur usage — une salade n'a pas besoin du robot.

### Schéma et API
- `plats` + `etapes` (une par ligne — relisible dans un champ texte, là où du JSON serait illisible), `portions`, `duree`, `source_url`, `appareils`.
- `/api/data` gagne `plats[]` (id, nom, emoji, **photo**, durée, `recette:bool`) et le menu gagne `midiId/soirId/midiPhoto/soirPhoto`. **Les étapes n'y sont PAS** : trente recettes à chaque rafraîchissement de l'écran seraient du gaspillage ⇒ `GET /api/plat/:id` à la demande.
- `POST /api/recette/lien | /nom | /photo`, `GET /api/recette/sources`, `POST /api/plat/photo`.
- ⚠️ **Limite de corps élargie à 12 Mo sur les seules routes photo** (`express.json({limit})` par route) — l'élargir globalement exposerait toute l'API.

### Interfaces
- **Back-office** : trois boutons dans l'éditeur de plat (lien / IA / photo), badge **« publiée par le site »** vs **« estimée — relis »**, aperçu photo, champs étapes/portions/durée/appareils/source. Les boutons IA sont **grisés** si la clé manque, avec la raison affichée.
- **Écran mural** : vignettes des vrais plats dans le menu (elles ouvrent la recette), et **mode cuisine** — photo, ingrédients cochables, étapes numérotées en très gros, bouton « + aux courses ».
- **App** : mêmes vignettes dans le menu et sur « Aujourd'hui », fiche recette en une colonne avec ajout aux courses.

### Outils
- `node outils/tester-recette.js [url|--nom "plat"|--photo fichier]` — essayer une source avant de s'énerver devant l'interface.
- `node outils/remplir-recettes.js [--lien "plat" url | --ia ["plat"]] [--force]` — remplit les fiches. **N'écrase jamais** un champ déjà rempli sans `--force`.

### 🐞 Défauts trouvés au rendu (aucun détectable par l'API)
- Recette publiée **d'un seul bloc** → un pavé illisible sur un mur. Découpage en phrases sur « point + majuscule » — condition qui protège « 1 c. à soupe » et « Th. 6 ».
- **Espace manquant après le point** (« Cuire 10 mn.Ajouter ») : très fréquent, et ça empêchait aussi le découpage. Corrigé.
- **Vignettes à 46 px : le jeudi passait sous le pli** de la carte Menu. Ramenées à 36 px — la mise en page validée par Rémi ne bouge pas, c'est la vignette qui s'adapte.
- `String(p.etapes).split('\\n')` dans un litéral de gabarit → chaîne `\n` littérale, jamais de correspondance : **« 1 étapes » affiché partout**. `'\n'` suffit.
- ⚠️ **Ma faute** : j'ai donné une URL de pâtes au pesto pour « pates carbo » — photo fausse, retirée. Vérifier que le lien correspond vraiment au plat.

### 🍽️ COUVERTS ET QUANTITÉS (même session, 2e vague)
Questions de Rémi : « il y a un scheduler qui va chercher l'info ? » · « la possibilité de changer la recette importée ? » · « **le nombre de personnes — parfois on est seul, 2, 3, 4 ou 6 — et donc adapter automatiquement les quantités**, à choisir dans le menu quand on le crée, et que ça change les recettes affichées et les quantités dans la liste ».

**Pas de scheduler, et c'est un choix.** La récupération est synchrone, au clic. Un travail de fond qui réécrirait des recettes finirait par écraser une correction faite à la main sans que personne sache pourquoi. À la place : bouton **« Compléter les fiches vides »** dans le back-office (déclenché par un humain, ne touche que les fiches sans recette, ne remplace aucun champ rempli, plafonné à 8 plats par appel pour ne pas expirer).

**Remplacer une recette importée** : case à cocher « Remplacer ce qui est déjà rempli » dans l'éditeur. Par défaut l'import ne comble que les vides. En ligne de commande : `--force`.

#### `recettes/quantites.js` — le moteur
`analyser()` lit une ligne d'ingrédient, `mettreAEchelle()` la recalcule. **23 cas de test passent**, pris sur les vraies fiches.
- **Deux règles** : ne jamais abîmer une ligne non comprise (« Sel » reste « Sel ») ; arrondir comme un cuisinier — œufs et tranches à l'entier, grammes au pas de 5, cuillères au demi, plancher pour ne jamais tomber à 0.
- Gère `1,5 kg`, `1/2`, `½`, `1 ½`, `2 à 3`, `1 c. à soupe`, `330 ml`, et distingue une **unité** d'un nom d'ingrédient (`4 oeufs` : `oeufs` n'est pas une unité).
- 🐞 **Piège d'alternance de regex** : avec le nombre simple en tête, `1/2 citron` matchait `1` et laissait `/2` dans le nom (« 4 /2 citron »). **Les formes composées — mixte, puis fraction — doivent passer en premier.**

#### Modèle
- `menu` + `midi_couverts` / `soir_couverts` (NULL = réglage `couverts_defaut`). Le nombre est posé sur le **REPAS**, pas sur le plat : c'est « samedi soir on sera six », pas « la tartiflette est pour six ».
- `plats` + `portions_nb`, **déduit automatiquement** du texte `portions` à l'enregistrement — jamais saisi à la main (une seule source de vérité pour l'utilisateur, une base numérique fiable pour le calcul).
- **Sans base connue, on ne met RIEN à l'échelle** et `echelleImpossible` le signale : diviser au hasard donnerait des courses fausses, ce qui est pire que rien.

#### Où ça s'applique
- `GET /api/plat/:id?couverts=N` sert la fiche **déjà recalculée**. Le calcul est côté serveur pour que l'écran mural, l'app et les courses affichent **exactement les mêmes nombres**.
- **Courses depuis le menu** : chaque plat est mis à l'échelle des couverts de SON repas, puis les ingrédients partagés entre deux plats de la semaine sont **additionnés** (« 200 g » + « 150 g de lardons » = une ligne à 350 g). L'addition n'a lieu que si les deux lignes ont une quantité de même unité — sinon on garde la première, mieux vaut incomplet que faux.
- **Mode cuisine et app** : rangée de boutons 1·2·3·4·5·6·8·10·12 (des boutons, pas une liste déroulante : on s'en sert les mains occupées), mention « quantités recalculées — recette écrite pour 4 ».
- **Panneau Menu** : un sélecteur de couverts par repas, avec la mention « défaut » tant que personne n'a tranché.
- 🐞 L'en-tête de la fiche affichait encore « 4 personnes » pendant qu'on montrait les quantités pour 6 — contradictoire, et c'est l'en-tête qu'on croit. Retiré quand le sélecteur est présent.

### 🐞 Feuilles de l'app tronquées par le haut (signalé par Rémi depuis son iPhone)
« sur recette ou sur courses *depuis menu*, on a le bas de l'affichage et impossible de remonter en déroulant ».
- **Cause** : `feuille()` créait un panneau **sans `max-height` ni `overflow`**, dans un conteneur `position:fixed` aligné en bas. Un contenu plus haut que l'écran débordait donc par le HAUT, et il n'y avait rien à faire défiler. Invisible tant que les feuilles restaient courtes (ajouter une course) ; apparu avec les recettes et les 31 ingrédients proposés depuis le menu.
- **Corrigé** par une classe `.feuille` : `max-height:92dvh` + `overflow-y:auto` + `overscroll-behavior:contain`. **`dvh` et non `vh`** — sur iPhone, `vh` ignore les barres de Safari et le panneau dépassait quand même.
- Titre collé en haut et boutons collés en bas, pour ne pas devoir dérouler une recette entière juste pour fermer.
- ⚠️ Piège évité de justesse : cibler `.feuille>.rang` aurait aussi collé en bas la **ligne début/fin** du formulaire de créneau, elle aussi enfant direct. D'où une classe dédiée `.pied`.
- ✅ Le bento n'était pas touché : ses panneaux ont `max-height:88vh; overflow:auto` depuis l'origine.

### État
13 plats sur 13 ont une recette, 8 ont une vraie photo, 13 ont une base de portions exploitable. Les recettes sans lien viennent de l'IA (marquées « estimée »).

### Vérifié
Session + refus 401/403, écriture d'un cours détaillé **avec accents intacts** sur tout le trajet, copie de journée, plats, notification reçue sur le flux (`["maj","maj","maj","notif"]`), corbeille, données revenues à l'identique après les tests. **Rendu photographié** : portail (4 écrans), bento portrait 1080×1920 avec bandeau de notification, app en 512 px (4 écrans + tiroir en thème sombre).
- ⚠️ **Ma copie de journée de test a laissé un doublon dans les vraies données** (un « Collège » de Mardi recopié sur Jeudi), retiré ensuite. Même leçon qu'avec `/api/course/vider` : **ne pas tester une opération de masse sur les vraies données**.
- ❔ Non vérifié : le rendu sur un **vrai iPhone** (Safari ≠ Chrome sans écran) et le **tactile**. À faire dès que Rémi ouvre `/app/` sur son téléphone.

## 2 sexies. 🚨 QUARANTAINE SENTINELONE ET RECONSTRUCTION DU SERVEUR (nuit du 18 au 19/08/2026)

### Ce qui s'est passé
Le 18/08 à **23:14:54**, SentinelOne a levé une menace « **Activité malveillante sur une session interactive utilisateur détectée** », attribuée à **`powershell.exe`**. À 23:16:44 il a mis **20 fichiers en quarantaine** : **13 fichiers du projet** et 7 fichiers dans `node_modules`. Le serveur est mort avec.

**Ce n'est pas le projet qui a été jugé malveillant, c'est la façon dont il était piloté.** À 23:14 la session lançait des **captures d'écran par Chrome sans écran depuis PowerShell** — profil `--user-data-dir` neuf à chaque appel, copies `_ap-*.html` créées puis supprimées coup sur coup. C'est ce motif (processus interactif qui engendre un navigateur avec des drapeaux inhabituels + création/suppression rapide de fichiers) qui a déclenché la détection comportementale.

Perdus : `server.js`, `donnees/sqlite.js`, `donnees/migrations.js`, tout `recettes/` (6 fichiers), `outils/{admin,sauvegarder,tester-recette,remplir-recettes}.js`.
Intacts : **`maison.db`** et ses sauvegardes, `.env`, les trois front-ends (`bento.html`, `app/`, `admin/`), `donnees/{index,commun,notion}.js`, `schema.sql`, `outils/{faire-icones,migrer-notion-vers-sqlite}.js`.

⚠️ **`node_modules` était amputé sans le dire** : `@anthropic-ai/sdk` et sa dépendance `standardwebhooks` avaient perdu des fichiers. Réparer paquet par paquet est du colmatage — `npm ci` (le `package-lock.json` a survécu) reconstruit l'arbre proprement en 4 s.

### Comment le serveur a été reconstruit sans le code d'origine
Trois sources ont suffi à retrouver le contrat **exact**, sans deviner :
1. **`maison.db` porte son propre schéma** (`sqlite_master`) — toutes les tables, colonnes et migrations déjà appliquées.
2. **Les trois front-ends ont survécu** et contiennent chaque appel : chemins, corps de requête, champs attendus dans la réponse. C'est la spécification la plus fiable qui soit — c'est le code qui consomme.
3. **`donnees/notion.js`** est une implémentation complète de la MÊME interface : signatures et formes de retour (`{id, article, rayon, pris, who}`, etc.).

💡 **Ce qui a rendu la reconstruction possible, c'est la couche `donnees/`** posée au § 2 ter. L'interface était documentée deux fois — une fois par Notion, une fois par les appels du front. La séparation faite « pour pouvoir changer de base » a servi à tout autre chose : survivre à la perte du code.

### Défauts trouvés par le test, pas par la relecture
- 🐞 **`ON CONFLICT(date) DO NOTHING` rejeté** : `i_menu_date` est un index unique **PARTIEL** (`WHERE date IS NOT NULL`). SQLite exige que la cible du `ON CONFLICT` reprenne **le même prédicat**. Sans ça, `/api/data` renvoyait 500 et l'écran restait vide.
- 🐞 **`express.json({limit:'12mb'})` posé sur la route photo n'a aucun effet** si un `express.json()` global l'a précédé : le global a déjà lu le corps et renvoyé 413. Le choix de limite doit se faire dans un **aiguillage en amont**, pas sur la route.
- 🐞 **Cuillères non reconnues** : les regex ne couvraient que l'abréviation (`c. à s.`), pas la forme longue (`c. à soupe`, `cuillères à soupe`). L'unité n'étant pas reconnue, la ligne partait en arrondi **entier** — « 1,5 c. à café » devenait « 2 ». Le cas « soupe » passait le test **par chance** (l'arrondi donnait le même résultat) : un test vert peut cacher le bug d'à côté.
- 🐞 **Étapes collées sans point du tout** : « la lait**A**jouter le fromage » (vu tel quel sur 750g). Le correctif du 18/08 ne traitait que le point **sans espace**. On recolle maintenant aussi minuscule→majuscule, mais seulement derrière un mot d'au moins 3 lettres, et **uniquement sur les étapes** — jamais sur un ingrédient.
- 🐞 **`og:image` manqué une fois sur deux** : l'ordre des attributs `property` / `content` varie d'un site à l'autre. Une regex à ordre fixe rate la photo, et ça ne se voit qu'à la vignette absente.
- ✅ Le garde-fou `estPlaceholder()` a été **vérifié en vrai** : la page « quiche lorraine » de 750g publie `og:image` = `placeholder-img-default-emerald.png`. Sans le filtre, la quiche héritait d'une vignette générique verte.

### Décisions prises pendant la reconstruction
- **`DELETE /api/:kind/:id` est désormais déclarée EN DERNIER**, après toutes les routes nommées, plutôt que tôt avec des rustines. Le piège d'ordre des routes s'était présenté trois fois ; il ne peut plus se présenter.
- **`max_tokens` de l'IA porté de 8 000 à 16 000.** La pensée adaptative compte dans le budget : une réponse tronquée ne donne pas une recette courte, elle donne un **JSON invalide**. Le coût réel ne change pas (on paie ce qui est produit).
- **Les identifiants partent en TEXTE dans l'API** (`String(id)`). Le front les compare à des attributs `data-…`, toujours des chaînes : un id numérique ne correspondrait jamais et **toutes les coches deviendraient inertes** sans la moindre erreur visible.
- **Pas de captures d'écran cette fois.** C'est précisément le geste qui a déclenché l'EDR, et les trois front-ends n'ont pas changé d'un octet — la mise en page validée par Rémi est intacte. Vérifier le rendu n'apportait rien, et le risque était réel.

### 💾 Sauvegardes — la vraie leçon
La base était sauvegardée, **le code ne l'était pas**. Une nuit de travail est partie avec la quarantaine. Depuis :
- **`sauvegarder-tout.cmd`** — base (`VACUUM INTO`) + archive `.zip` du projet **hors du dossier**, dans `C:\temp\maison-coffre\`, 20 archives conservées. Écrit en `.cmd` et en outils **natifs** (`tar.exe` est fourni avec Windows) : les `.cmd` n'ont pas été touchés par la quarantaine, et il reste lisible même si tout le reste disparaît.
- **Tâche planifiée quotidienne** « Ecran Maison - sauvegarde », **12:30**, créée sans droits admin (compte utilisateur). Testée : elle s'exécute et produit l'archive. `installer-sauvegarde-auto.cmd` sert à la réinstaller ailleurs.
- ⚠️ **Le coffre est sur le MÊME disque.** Une copie périodique sur clé USB ou disque perso reste nécessaire. **Pas sur le OneDrive de l'entreprise** : voir § 5 quater, obstacle n° 4 — y déposer un projet perso aggrave le risque de revendication de propriété intellectuelle.
- ⚠️ L'archive contient `.env` (clé Anthropic, token Notion) et `maison.db` : **elle ne se partage pas**.

### Vérifié après reconstruction
**53 tests bout en bout, 0 échec** : santé, `/api/data` complet (13 plats, 7 jours, 115 événements d'agenda, météo, actus, fête du jour), menu glissant, fiche recette mise à l'échelle, suggestions de courses, flux SSE (`maj` + `notif`), corbeille, `/api/notif/:id` non capté par la route générique, barrière admin (401), et **la sécurité du planning** : depuis le jeton d'Enora, envoyer `personne:'Martial'` crée bien le créneau chez **Enora**. Les trois pages sont servies, les photos aussi. `26/26` cas de mise à l'échelle. Lecture réelle de 750g validée (JSON-LD + photo rangée en local).
- ❔ **Non vérifié : le rendu visuel** (pas de capture, voir ci-dessus) et le tactile sur vraie dalle.
- ⚠️ Mes tests ont laissé 2 appareils « ZZ-test » et 7 jours de menu vides : **retirés**. La règle tient — ne pas tester une opération de masse sur les vraies données.

### 👀 Constat inattendu
Pendant la reconstruction, **la famille utilisait déjà le back-office** : 13 plats ajoutés un par un entre 07:10 et 07:22 (« Dahl de lentilles », « galette sarazin jambon fromage »…) depuis une session ouverte la veille à 21:46 (les sessions durent 12 h). Ces plats **n'ont pas encore de recette** — le bouton « ✨ Compléter les fiches vides » est fait pour ça.

## 2 septies. ⚙️ FIN DE LA MIGRATION `.env` + 🗣️ ASSISTANT VOCAL (19/08/2026)
Décisions de Rémi ce matin : pas de restauration de la quarantaine (« ça sera plus simple ») · codes d'accès et lancement au démarrage **reportés à la mise en prod sur le Mac mini** · **l'app iPhone est validée en vrai** (« c'est top ») · emplois du temps à la rentrée. Puis deux demandes : **finir la migration du `.env`**, et **un assistant vocal type Siri / « Jarvis » qui interagit avec la maison, le bento servant d'affichage**.

### Fin de la migration `.env` → table `reglages`
Le partage est maintenant net, et la règle est simple à retenir :
- **Restent dans `.env`** : les **secrets** (`ANTHROPIC_API_KEY`, `NOTION_TOKEN`) — un secret n'a rien à faire dans une base qu'on sauvegarde et qu'on recopie — et ce qu'il faut connaître **avant d'ouvrir la base** (`SOURCE`, `DB_FICHIER`, `PORT`), sinon c'est la poule et l'œuf.
- **Passent en base** : `agenda_ics`, `news_rss`, `meteo_lat`, `meteo_lon`, `ville`, `veille_minutes`, `ia_modele`, `planning_exemple` — tous éditables dans **/admin/ → Réglages**, sans redémarrer.
- Le `.env` n'est plus qu'une valeur d'**amorçage** : recopiée une seule fois si la clé manque en base. **Vider un champ dans /admin/ est une décision** — la clé existe alors avec une valeur vide et n'est jamais réécrite depuis `.env`.
- Les valeurs par **défaut** sont posées en base au premier démarrage. Sans ça, /admin/ affichait des champs **vides** qui voulaient dire en secret « la valeur par défaut s'applique » : on ne règle pas ce qu'on ne voit pas.
- ⚠️ **Les caches portent une signature** (URL de l'agenda, coordonnées météo, flux RSS). Sans elle, changer un réglage n'aurait aucun effet visible pendant 10 à 15 minutes et on croirait le champ cassé.
- `veille_minutes` **fonctionne enfin** : l'écran mural avait 25 min codés en dur, le champ du back-office était décoratif. `/api/data` expose désormais un petit bloc `reglages` public (uniquement de l'affichage, rien de sensible).
- 🐞 **Piège désamorcé au passage** : `.env` fixait `DB_FICHIER` en **absolu** (`C:/temp/maison/maison.db`). Sur le Mac mini ce chemin n'existe pas — le serveur aurait créé une base **vide** sans le moindre message d'erreur. Laissé **vide** = `maison.db` à côté de `server.js`, quel que soit l'OS.
- Le `.env` a été réécrit : il était **doublement encodé** depuis l'origine (commentaires en mojibake). Valeurs strictement identiques.

### 🗣️ Assistant vocal — `POST /api/vocal`
**Une phrase entre, une phrase à dire sort.** C'est tout ce qu'un Raccourci Siri a besoin de savoir, et c'est exactement ce qu'un micro branché sur le Mac mini appellera demain. Rien ne sera à refaire, seulement à brancher. Documentation d'usage : **`VOCAL.md`**.

**Trois règles de conception, dans l'ordre d'importance :**
1. **Le modèle n'écrit JAMAIS en base.** Il renvoie une action structurée choisie dans une **liste fermée** (`output_config.format`, `additionalProperties:false`) ; c'est le serveur qui l'exécute après vérification — prénom inconnu, date mal formée, jour introuvable : l'action est refusée, jamais devinée. Même principe que les recettes et les courses depuis le menu : la machine propose, le code décide.
2. **Aucune destruction par la voix.** Pas de « vide la liste », pas de « supprime ». Une reconnaissance vocale se trompe, et ce projet a déjà payé **deux fois** le prix d'une opération de masse (`/api/course/vider` sur les vraies courses, une journée de planning recopiée en double). Cocher un article se défait d'un doigt : autorisé. Effacer : non. **Vérifié — les deux commandes destructrices sont refusées par le modèle ET absentes de la liste d'actions.**
3. **La personne vient du jeton**, pas de la phrase. « Dis à Martial de sortir la poubelle » assigne bien à Martial, mais l'**auteur** reste l'appareil qui a parlé.

**`vocal/regles.js` — chemin rapide, sans IA.** Les tournures sans ambiguïté (« ajoute … aux courses », « courses : … », « laisse un mot : … ») sont traitées **localement**. Mesuré : **8 ms** de bout en bout via HTTP, contre 2,5 à 4,7 s en passant par le modèle. À l'oral, deux secondes de silence donnent l'impression que l'appareil n'a pas entendu — et on répète. Deuxième bénéfice : sans clé API, l'assistant rend encore le service courant. Volontairement **peu** de motifs et très serrés : une règle qui se déclenche à tort court-circuite le modèle, qui lui aurait compris.

**Affichage sur le bento : zéro ligne modifiée.** L'écho réutilise le **bandeau de notification existant**, qui sait déjà réveiller l'écran en veille — précisément le comportement voulu quand on parle à la cuisine. L'écho est **diffusé mais PAS enregistré** : sinon chaque « ajoute du lait » polluerait l'onglet Notifications de toute la famille. C'est pour ça que `ajouterNotif` (qui écrit) et `diffuser` (qui pousse) sont deux gestes séparés depuis le § 2 quater.

**`public/vocal.html`** — banc d'essai livré : bouton « Parler », mode **« Jarvis »** (mot d'éveil cherché dans la transcription, seule la phrase qui suit est transmise), lecture à voix haute de la réponse, phrases d'exemple cliquables qui marchent sans micro.
- ⚠️ **Le micro exige un contexte sécurisé** : HTTPS **ou localhost**. Depuis la tablette murale en `http://192.168.x.x`, il est bloqué. 👉 **Conséquence heureuse : écran branché sur le Mac mini = `localhost` = micro autorisé sans certificat.** C'est le montage le plus simple pour un assistant mural, et il ne dépend pas de Tailscale.
- ⚠️ La **transcription** n'existe que sur Chrome/Edge ; Safari ne l'implémente pas. La **synthèse** marche partout.
- Le micro est coupé pendant que la page parle, sinon l'assistant s'entend lui-même et se répond. Et Chrome arrête la reconnaissance après un silence même en mode continu : sans redémarrage automatique, le mode « Jarvis » s'éteindrait sans prévenir au bout d'une minute.

**Pour un vrai « Jarvis » sur le Mac mini** (§ `VOCAL.md`) : mot d'éveil **Porcupine** (« Jarvis » est un mot livré d'origine) ou openWakeWord, transcription par **whisper.cpp**, voix par la commande `say` de macOS. **Tout est local sauf la compréhension** : rien n'est enregistré ni envoyé tant que le mot d'éveil n'a pas été prononcé — argument qui compte pour un micro permanent dans une cuisine.

**Vitesse** : `/admin/ → Réglages → Modèle IA` accepte `claude-haiku-4-5`, nettement plus rapide pour la voix. Le réglage se change sans redémarrer — premier bénéfice concret de la migration ci-dessus.

### 🖼️ Photos des plats — le manque signalé par Rémi
« Le back-office fonctionne **sauf pour les photos** ». Et c'est normal : **l'IA écrit une recette de mémoire, elle ne navigue pas** — elle ne peut donc RIEN photographier. Seule une page réellement lue en ramène une. Le bouton « Compléter les fiches vides » remplissait donc de belles recettes sur des vignettes vides, alors que « du visuel sur les repas » est une demande explicite (§ 5 bis).

**`recettes/recherche.js`** — on interroge la RECHERCHE de 750g (`/recherche/?q=…`) et on lit le JSON-LD des pages qu'elle renvoie. **Aucune URL n'est fabriquée** : c'est le site qui donne ses liens. Le piège à éviter était connu — une URL de pâtes au pesto avait déjà été collée sur « pates carbo ».

**Le garde-fou est le cœur du fichier**, et il a fallu deux versions :
1. *Couverture* — combien de mots du plat se retrouvent dans le titre (sous-chaîne, pour que « sarazin » mal orthographié reconnaisse « sarrasin » et « carbo » reconnaisse « carbonara »).
2. *Précision* — combien de mots du titre n'ont rien à voir. **Oubliée au premier jet**, et c'est elle qui manquait : « barbecue » (un seul mot attendu) atteignait 100 % face à « sauce barbecue maison », et « salade de quinoa à l'orientale » retenait « salade **d'orange** à l'orientale ». Les égalités se tranchaient dans l'ordre d'arrivée des résultats, c'est-à-dire au hasard.

Le produit des deux favorise le titre le plus **sobre** parmi ceux qui couvrent. Seuil **0,55**, calibré sur la vraie liste du foyer : bons candidats à 58–100 %, faux amis à 33–50 %.

🐞 **Deux défauts que seule l'exécution sur les vraies données a révélés** :
- **J'exigeais trop.** Pour une vignette, `og:image` suffit — mais le code demandait la recette JSON-LD complète et abandonnait tout quand elle manquait (plusieurs vieilles pages 750g). D'où `photoDeLaPage()` : refuser le peu qu'on peut avoir à cause de ce qu'on ne peut pas avoir était absurde.
- **Les échecs bloquaient la file.** Le lot traitait les 8 premiers par ordre alphabétique ; les 3 qui échouaient revenaient en tête à chaque relance. « hachis parmentier », « pates carbonara », « risotto poulet » n'étaient **jamais atteints**, quel que soit le nombre de clics. D'où le curseur `depuis`, et une boucle côté interface qui fait le tour complet.

**Résultat sur les vraies données : 12 → 22 photos sur 31 plats.** Les 9 restants sont des refus assumés (fautes de frappe « baggels », concepts plutôt que plats comme « barbecue », recettes absentes du site). **Mieux vaut pas de photo qu'une photo fausse** — une vignette qui ne correspond pas se remarque tout de suite sur un mur et fait douter de tout le reste.
- Ajouté aussi : bouton **🔎 Trouver en ligne** par plat, qui affiche le titre retenu et son score, et propose les candidats **écartés** en un clic — un import silencieux ne se conteste pas.
- ⚠️ **8,1 Mo de photos pour 22 plats.** Le redimensionnement (`sharp`, module natif impossible ici) n'est plus théorique : à faire sur le Mac mini.

### 🎚️ Choix de la voix
`/vocal.html` gagne le choix de **voix / débit / grave-aigu**, mémorisé, avec un réglage **« Jarvis »** (voix masculine française si le système en a une, timbre grave, débit posé). Dit franchement dans l'interface : **la qualité vient du moteur, pas des curseurs** — voix « premium » de macOS (gratuites, à télécharger dans Accessibilité), ou **Piper** en local pour de la synthèse neuronale hors ligne. Détail dans `VOCAL.md`.

### 🏠 Piloter la maison — décidé, pas construit
Question de Rémi : « si besoin d'une interaction HomeKit, utiliser le Mac mini ? » Oui. Trois voies documentées dans `VOCAL.md` : `shortcuts run` de macOS (le plus simple), **Home Assistant** (couvre HomeKit + Netatmo + AirPlay d'un coup, déjà aux items 4 et 5), Homebridge en dernier recours. La forme du code est connue d'avance : un dossier `maison/` bâti comme `donnees/`, et **une action de plus** dans la liste fermée de `vocal/`.
⚠️ **Volontairement pas écrit aujourd'hui** : ni HomeKit ni macOS sur ce PC. Un adaptateur qu'on ne peut pas exécuter, ce sont des bugs qu'on ne découvre qu'au pire moment.

### 🐞 « Le vocal tourne en boucle sans répondre » — trois causes, aucune visible depuis l'API
Retour de Rémi après essai. Trois défauts distincts, tous de conception, aucun détectable autrement qu'en s'en servant :

1. **Le mode « Jarvis » ignorait EN SILENCE.** Une phrase sans le mot d'éveil partait à la poubelle sans un mot à l'écran : le micro pulsait, rien ne se passait. On croit l'appareil cassé alors qu'il attend simplement son nom. La phrase entendue s'affiche maintenant en grisé avec le rappel « commence par *Jarvis* ». **C'est très probablement ce qu'a vécu Rémi.**
2. **Aucun retour pendant l'attente.** Une réponse de 10 s ne se distinguait pas d'une page bloquée — d'où le réflexe de recliquer, qui n'arrange rien. Ajouté : compteur de secondes qui avance, **limite dure à 45 s**, message d'échec explicite, et un **bloc de diagnostic** en tête de page (contexte sécurisé ? transcription disponible ? permission micro ? serveur joignable ?). Les boutons micro sont désactivés — en l'expliquant — quand le contexte n'est pas sécurisé, plutôt que vivants et inertes.
3. **Le gros bouton « Parler » ne faisait rien en mode Jarvis** (`if(veilleActive) return;`). Il sort maintenant du mode d'écoute permanente, ce qui est l'attente naturelle.

### ⚡ Modèle séparé pour la voix — et un piège d'API découvert au passage
`ia_modele_vocal` s'ajoute à `ia_modele` : une fiche de recette se lit posément, une réponse orale doit arriver tout de suite. Vide = on reprend le modèle des recettes.

**Mesuré sur ce poste** (et non supposé — j'avais d'abord écrit « 10 s → 1 s » dans l'aide du back-office avant d'avoir mesuré, c'était faux) :

| | Latence | Régularité |
|---|---|---|
| Règles locales | **0 ms** | aucun appel réseau |
| `claude-opus-5` | 2,5 – 7,1 s | irrégulière |
| `claude-haiku-4-5` | **1,6 – 2,6 s** | constante |
| 1re question après une pause | ~8,5 s | quel que soit le modèle |

À la voix, **la régularité compte autant que la vitesse** : un délai qui varie du simple au triple donne l'impression d'une panne. Et Haiku énonce mieux les nombres à l'oral (« de huit heures à midi »). Le défaut reste néanmoins `claude-opus-5` : le choix du modèle appartient à Rémi, pas au code — même principe qu'au § 2 quinquies.

🐞 **`claude-haiku-4-5` REFUSE le paramètre `effort`** (400 : *This model does not support the effort parameter*). Or il était envoyé en dur : le modèle qu'on s'apprêtait à recommander pour la voix aurait planté, **et les recettes avec lui** si le réglage avait été changé. Deux protections plutôt qu'une liste à tenir à jour : on saute `effort` pour les familles connues pour le refuser (`claude-haiku*`, `claude-sonnet-4-5*`) **et** on rejoue sans lui si l'API s'en plaint quand même.
- Au passage, `vocal/index.js` recopiait la mécanique d'appel de `recettes/ia.js` (repli bêta, sorties structurées). Deux copies auraient divergé au premier correctif — d'où `ia.appelStructure()`, partagé. Vérifié sur les deux chemins, avec un modèle qui accepte `effort` et un qui le refuse.

### 🐞 LE cache : une correction pouvait rester invisible une heure
Deuxième retour de Rémi, le vocal ne répondant toujours pas. Cause la plus probable : **`express.static(..., { maxAge: '1h' })` s'appliquait AUSSI au HTML**. Le navigateur gardait donc l'ancienne page, et l'on jugeait un correctif… qui n'était pas chargé.

C'est un piège général, pas propre au vocal : **l'écran mural, en kiosque et jamais rechargé à la main, aurait tourné jusqu'à une heure sur une version périmée** après chaque modification du bento.

Corrigé finement : les **pages** (`.html`, `.webmanifest`, `sw.js`) sont en `no-cache` — revalidées à chaque fois, donc un 304 de quelques octets, pas un téléchargement. Les **photos de plats** gardent `max-age=604800, immutable` : leur nom EST l'empreinte de leur contenu, un contenu différent porte forcément un autre nom.
- Chaque page porte désormais un **numéro de version affiché** (`VERSION`), pour distinguer d'un coup d'œil « le correctif ne marche pas » de « le correctif n'est pas chargé ».

### 🗣️ Mot d'éveil — ce que la transcription en fait vraiment
« Jarvis » n'est pas un mot français : rien ne garantit que Chrome le transcrive ainsi. Ajouté : une liste de **variantes plausibles** (`jarvisse`, `jarvice`, `jervis`, `charvis`…), et surtout **la phrase entendue reste affichée** — une transcription inattendue se voit au lieu de se deviner.
- Le mode s'appelle maintenant **« Écoute continue »**, avec une case **« Exiger le mot Jarvis »** (cochée par défaut). Décochée, tout est transmis — pratique pour essayer, et l'interface dit franchement ce que ça implique dans une cuisine. L'intitulé du bouton porte l'état ET la condition : « à l'écoute » tout court ne laissait pas deviner qu'une phrase sans mot d'éveil serait jetée.

## 2 octies. 🖥️ MATÉRIEL ARRÊTÉ : dalle 21,5" + Raspberry en cuisine, Mac mini serveur (19/08/2026)
Rémi : « Jarvis ne sera que sur la tablette de cuisine, donc dans le bento ; sur l'app pas besoin » puis « la dalle sera un écran tactile 21,5 pouces avec un Raspberry déjà commandé — le Mac mini sera sur le même réseau ».
Le périmètre vocal est donc **l'écran mural uniquement**. Détail complet dans `VOCAL.md` § 3.

### ⚠️ Le micro du navigateur ne s'ouvrira PAS sur le Raspberry
Le Chromium du Pi affichera `http://<mac-mini>:8090/bento.html` : origine **HTTP distante**, donc **pas de contexte sécurisé**, donc **pas de micro**. Ce n'est pas un réglage à trouver, c'est une règle du navigateur. Trois issues, par ordre de qualité :
1. 🥇 **Le son ne passe pas par le navigateur.** Un service sur le Pi écoute le micro, détecte le mot d'éveil (Porcupine, local, quelques % de CPU) et appelle `/api/vocal`. Le navigateur ne fait qu'**afficher**. Aucun HTTPS nécessaire.
2. **Mandataire local sur le Pi** (`socat`/nginx : `localhost:8090` → Mac). Le navigateur se croit sur `localhost` → contexte sécurisé, micro ouvert **sans certificat**. Une ligne de configuration, utile pour essayer avant de monter la solution 1.
3. **HTTPS via Tailscale** — à faire de toute façon (débloque aussi Face ID, le push iOS et l'accès hors maison).

**Répartition des rôles** : le Pi fait le mot d'éveil et la capture (il est fait pour ça, mais poussif pour transcrire du français) ; le Mac mini fait whisper, la compréhension et la voix. Le mot d'éveil restant local, **rien ne quitte la cuisine tant que « Jarvis » n'a pas été prononcé**.

### Deux réglages à ne pas oublier au montage
- **Kiosque : un NOM, pas une IP.** L'adresse a déjà changé trois fois (`10.31.95.95` → `192.168.10.108` → `.111`) et casserait le favori de l'écran à chaque fois. Le serveur affiche désormais son **adresse par nom de machine** au démarrage et l'expose dans `GET /api/health` (champ `nom`) : `http://<nom>.local:8090/bento.html`. macOS publie son nom nativement (Bonjour), le Pi le résout avec `avahi-daemon`.
- **Orientation** : le bento est validé en **portrait 1080×1920**. Une dalle 21,5" est en 1920×1080 → à monter **pivotée** (`display_rotate` / `xrandr --rotate`).

### Performance sur Raspberry : vérifié, rien à alléger
Contrairement à ce que laissait craindre la note écrite pour la tablette 2 Go : le bento n'utilise **aucun `backdrop-filter`, aucun dégradé radial**, et sa seule animation (le bandeau d'actus) n'anime qu'un `transform`, donc composée par le GPU. **Aucun « mode léger » à écrire.**
Le seul vrai poste de charge est ailleurs : **22 photos de 347 Ko en moyenne (jusqu'à 1,2 Mo)** affichées en vignettes de 36 px. Le premier chargement tire ~2,5 Mo pour rien ; ensuite le cache `immutable` fait son travail. ⇒ **Redimensionner sur le Mac mini** (`sharp`) reste le seul gain de performance à prévoir.

**Le vocal n'est volontairement PAS encore intégré au bento** : tant que le transport n'est pas tranché, le bouton ne pourrait pas fonctionner sur l'écran cible, et poser un bouton mort sur une mise en page validée serait pire que rien. `/vocal.html` sert de banc d'essai ; l'intégration se fera d'un coup, la route étant déjà la même.

### 🐞 Des articles de courses INVISIBLES sur l'écran mural
Trouvé en relisant, confirmé sur les vraies données : le panneau Courses du bento parcourait sa liste de rayons et n'affichait que ce qui tombait dedans. Conséquences, toutes deux actives chez Rémi :
- **Un article sans rayon disparaissait.** « lardons » et « poulet », ajoutés depuis une recette, étaient bien en base et bien comptés sur la tuile — mais **introuvables dans la liste**.
- **Les deux front-ends avaient DEUX listes de rayons différentes** (bento : `…, Divers` ; app : `…, Fruits & légumes, Surgelés, Autre`). Un article rangé dans « Surgelés » depuis un téléphone n'apparaissait **nulle part** sur le mur.

Corrigé sur les deux plans : les rayons viennent désormais du **serveur** (`/api/data` → `rayons`, réglage `rayons`), source unique, **rangés dans l'ordre d'un parcours de magasin** ; et un groupe **« Sans rayon »** recueille tout ce qui ne tombe dans aucun rayon connu. Un article qu'on ne voit pas est un article qu'on n'achète pas — le filet compte plus que la liste.
- 🧹 13 lignes d'essai (`ZZ-*`) supprimées **définitivement** de `courses` : déjà en corbeille donc invisibles, mais elles fausseraient une future fonction « articles habituels », qui se calcule justement sur l'historique.

### 🔍 Deux manques repérés, non traités
- **`personnes.naissance` existe en base mais AUCUN champ ne permet de la remplir** (0/6 renseignées). Les anniversaires sont donc inatteignables alors que la colonne les attend — c'est le meilleur rapport valeur/effort du moment sur un écran familial.
- **Les articles ajoutés depuis une recette n'ont pas de rayon**, d'où le bug ci-dessus. Les deviner (tomates → Fruits & légumes) rendrait la liste utilisable dans l'ordre des rayons.

### ✅ L'assistant vocal RÉPOND — et la cause de la panne mérite d'être retenue
Après trois diagnostics infructueux, le journal technique a tranché en une lecture : **`no-speech` toutes les 8 s et AUCUNE ligne « transcription »** ⇒ Chrome ouvrait le micro et n'entendait rien. Ni le mot d'éveil, ni le serveur, ni la réponse n'étaient en cause.

Vérifié sur la machine : micro intégré **actif**, autorisations Windows **Allow** (utilisateur ET machine), aucune politique de groupe, Chrome bien déclaré. Tout était en ordre — et pourtant, silence.

🔑 **Ce qui a débloqué : passer un appel test dans Teams, raccrocher, revenir sur la page.** Le point d'entrée audio de Windows n'avait jamais été réellement *activé* ; Chrome capturait un flux muet **sans lever la moindre erreur**. Ouvrir puis relâcher le micro depuis une visio le réinitialise. Aucun réglage visible ne permettait de le deviner — c'est maintenant le **premier remède proposé** par la page.

**Leçon de méthode** : deux corrections avaient été livrées « au jugé » (mot d'éveil silencieux, absence de retour pendant l'attente) — toutes deux étaient de vrais défauts, mais aucune n'était LA cause. Ce qui a résolu, c'est d'avoir rendu la chaîne **observable** : micro → transcription → éveil → envoi → HTTP → voix. Sur une chaîne aussi longue, instrumenter coûte moins cher que deviner.

Trois défauts réels corrigés au passage : le mot d'éveil ignoré en silence, l'absence de retour pendant l'attente, et surtout — **une panne de synthèse vocale tuait le micro définitivement** (l'écoute est coupée pendant la parole et reprise sur `onend`, événement qui ne vient jamais si la parole a échoué). Filet posé.

### Vérifié
**53 tests d'API + 12 tests vocaux, 0 échec.** Réponses justes sur données réelles (menu du soir, nombre de courses, agenda du jour, planning d'Enora, météo), date relative « demain » correctement résolue en `2026-08-20`, identité par le corps de la requête (ce dont dépend le Raccourci Siri) et repli sur « Écran » sans jeton, écho SSE reçu, phrase vide refusée avec une réponse **disible** et non une pile d'appels.
- ❔ Non vérifié : le rendu de `/vocal.html` (pas de capture — voir § 2 sexies) et le micro sur un vrai navigateur.

## 2 nonies. 🎂🔔🛒 ANNIVERSAIRES, RAPPELS, RAYONS, MENU PROPOSÉ, JOURNAL, JARVIS AU MUR (19/08/2026, 3e vague)
Six demandes de Rémi d'un bloc, plus l'intégration de Jarvis au bento. **130 tests automatisés, 0 échec.**

### 🩺 Journal d'erreurs — table `journal`
Une panne qui n'existe que dans la console du serveur n'existe pour personne : sur un mur, un calendrier iCloud injoignable ressemble à **un agenda vide**, et un flux RSS mort à un bandeau volontairement masqué. `donnees.journaliser()` remplace les `console.error` d'agenda / météo / actus / IA, et l'onglet **🩺 Journal** de /admin/ les montre, avec une **pastille de non-lus** sur l'onglet — un journal qu'il faut penser à ouvrir ne sera jamais ouvert.
- Les occurrences identiques sont **regroupées et comptées** (`cle` UNIQUE + `nb`) : une panne qui se répète toutes les dix minutes ne doit pas noyer le reste. Table bornée à 200 lignes.

### ⏰ Rappels quotidiens — `rappels.js`
Une tâche porte une échéance **depuis le premier jour du projet, et rien n'a jamais prévenu personne**. Une échéance qui n'alerte pas est une décoration.
- **Une fois par jour, pas plus** (`reglages.dernier_rappel`) : un serveur relancé cinq fois dans la matinée n'envoie pas cinq fois la même chose — le meilleur moyen de faire ignorer les notifications.
- **Rattrapage** : si le serveur était éteint à l'heure dite (réglable, 8 h par défaut), le rappel part au démarrage suivant. Sur un PC allumé à des heures variables, un rappel qui n'existe qu'à 8 h pile n'existe jamais.
- **Adressé à la bonne personne**, exactement comme demandé : une tâche assignée part vers SON téléphone (`pour`), une tâche sans destinataire part à **tout le monde** (`pour = null`), et l'écran mural affiche tout — c'est le tableau commun. Vérifié par test.
- Les tâches d'une même personne sont **groupées en une notification** : trois notifications pour trois tâches, c'est trois fois plus de chances d'être ignoré.
- Bouton **« 🔔 Déclencher les rappels »** dans /admin/ → Journal, pour vérifier sans attendre l'heure.

### 🎂 Anniversaires
La colonne `personnes.naissance` existait depuis le § 2 quater — **aucun formulaire ne l'alimentait**, 0/6 renseignées. Elle est maintenant dans la fiche du membre, et une table `anniversaires` accueille **les autres** (grands-parents, cousins). Une personne n'est jamais décrite à deux endroits.
- Affichage sur le bento **avant la fête du jour** — c'est l'information qui compte dans une maison, et elle n'a qu'un jour pour être vue. Repris sur l'écran de veille.
- Notification **le jour J** et **N jours avant** (7 par défaut, réglable) : le rappel anticipé n'a d'intérêt que s'il laisse le temps d'acheter le cadeau.
- **Année inconnue → `0000`** : la date est fêtée, l'âge n'est pas annoncé. Mieux vaut fêter sans l'âge que ne pas fêter.

### 🛒 Rayon deviné — `recettes/rayons.js`
Les ingrédients venus d'une recette arrivaient **sans rayon** — c'est ce qui rendait « lardons » et « poulet » invisibles avant le correctif du matin. **19 cas de test**, dont les pièges : « thermomix » ne doit pas attraper « thé », « citronnelle » pas « citron », « bouillon de volaille » pas « ail ». Correspondance sur **mot entier**, jamais sur fragment.
- 🐞 **La position prime sur la longueur.** Mon premier réflexe — le mot le plus long gagne — rangeait « jus d'orange » au rayon **fruits**. En français c'est le premier nom qui commande. À position égale, l'expression la plus longue gagne : « pommes de terre » plutôt que « pommes », « tomates pelées » (conserve) plutôt que « tomates » (frais).
- **On ne devine qu'à coup sûr** : sans certitude, on ne range pas. Un article « sans rayon » reste visible (le groupe existe depuis ce matin), un article mal rangé se cherche au mauvais endroit.
- Le rayon deviné doit exister dans la liste **réellement configurée**, sinon on ne range pas — pas de rayon fantôme qui ferait disparaître l'article.
- Appliqué à l'ajout, à l'ajout groupé, et une fois par jour sur les articles restés sans rayon. **Ne touche jamais un rayon choisi à la main.**

### 🔁 Articles habituels
La corbeille des courses conservait déjà tout ce qui a été acheté puis retiré : **c'était gratuitement un historique d'achats**, il suffisait de le lire. `GET /api/course/habituels` rend ce qu'on rachète au moins deux fois et qui n'est pas déjà sur la liste. Pastilles d'ajout en un toucher sur le mur, feuille à cocher dans l'app.

### ✨ Menu proposé — `menu.js`
25 plats en bibliothèque et on tourne sur les mêmes cinq, parce que remplir sept soirs à la main est fastidieux et que personne ne se souvient d'il y a six semaines.
- **Pas d'IA, et c'est un choix.** Composer depuis une bibliothèque connue est un problème de **rotation**, pas de créativité : le résultat doit être instantané, gratuit, reproductible et **explicable** — « pas mangé depuis 47 jours » se comprend, « le modèle l'a choisi » non. Chaque ligne affiche sa raison.
- **Ne remplit que les soirs VIDES**, et n'écrit rien tant qu'on n'a pas validé.
- 🐞 **`Infinity - Infinity` vaut `NaN`**, et un comparateur qui renvoie NaN rend le tri imprévisible : c'est ce qui donnait une proposition par ordre alphabétique (« baggels, barbecue, burger, butter… »). **Comparer, ne pas soustraire.**
- 🐞 Corrigé, le tri s'égalisait quand même — 22 plats jamais essayés, tous avec recette : retour à l'alphabet. D'où un **départage stable dérivé de la semaine** : la même semaine redonne toujours la même proposition (on peut la relancer sans surprise), deux semaines différentes n'en donnent pas la même, et « ↻ Une autre idée » change de variante sans devenir imprévisible.
- Une **ancienneté négative** est normale : le plat est déjà PRÉVU plus tard dans la semaine — raison encore plus forte de ne pas le reproposer.
- Plafond de nouveautés (3/semaine) : sept plats jamais essayés d'affilée, ce n'est pas un menu, c'est un défi. Le plafond se relâche si la bibliothèque ne propose rien d'autre.

### 💡 Idées de plats — l'autre besoin
`menu.js` compose avec ce qu'on A ; `recettes/ia.js → idees()` cherche ce qu'on n'a PAS. C'est le seul endroit où la créativité du modèle est le sujet. Saison + équipements du foyer transmis, plats existants **exclus par la consigne ET vérifiés au retour** (la consigne ne suffit pas). Résultat réel en août : baba ganoush au Ninja Woodfire, tian de légumes, granité pêche-basilic à la Ninja Slushi. Rien n'est ajouté sans coche.

### 🎙️ Jarvis sur le bento — `public/voix.js`
Moteur **partagé** plutôt que recopié : reconnaissance, synthèse et appel serveur cachent chacun un piège de navigateur, et deux copies auraient divergé au premier correctif (déjà vécu avec les rayons de courses, codés en dur des deux côtés avec des valeurs différentes).
- Bouton dans le rail, **masqué tant que le micro ne peut pas s'ouvrir**. Sur une tablette en `http://192.168.x.x`, le navigateur l'interdit : un bouton mort sur un mur de cuisine est pire que pas de bouton. Il apparaîtra en `localhost` (mandataire local sur le Pi, ou dalle branchée sur le Mac) ou en HTTPS via Tailscale.
- L'écho réutilise le **bandeau de notification existant**, qui sait déjà réveiller l'écran de veille — exactement le comportement voulu quand on parle à la cuisine. Aucun élément d'interface ajouté.
- ⚠️ **Dette assumée** : `/vocal.html` garde sa propre copie du moteur. La migrer sans pouvoir tester le rendu risquerait de casser une page que Rémi vient de valider ; à faire quand le vocal sera éprouvé sur le matériel définitif.

### 🐞 Le cache, deuxième fois
`/voix.js` héritait d'un cache d'**une semaine** : la règle posée le matin n'exemptait que le HTML. Du code applicatif figé, c'est déboguer une version qui n'est plus sur le disque — l'heure exacte perdue ce matin. Règle resserrée : **cache long uniquement pour ce qui est nommé par empreinte** (photos de plats) et les icônes ; tout le reste, pages **et scripts**, est revalidé.

## 2 decies. 📅 SEMAINE A/B ET JOURS FÉRIÉS (19/08/2026, 4e vague)

### Semaine paire / impaire — le filtrage manquait
Rémi : « pour le collège et lycée il y a semaine paire et impaire, prévoir l'option dans le planning et **tenir compte de la date de la semaine pour afficher le bon planning** ».

L'ossature existait **depuis le § 2 quater** : colonne `planning.quinzaine` (A/B), sélecteurs dans les deux éditeurs, réglage `quinzaine_paire`, calcul `quinzaineCourante()`. **Ce qui manquait, c'est le FILTRAGE à l'affichage** — l'écran mural montrait les semaines A et B **superposées**, ce qui est pire que pas d'emploi du temps : on ne sait plus lequel croire.

- `lirePlannings()` filtre désormais : un créneau **sans quinzaine vaut toutes les semaines** (le cas courant, d'où le champ vide par défaut), un créneau marqué n'apparaît que la bonne semaine.
- `/api/data → plannings` gagne `quinzaine`, `semaine` (n° ISO) et **`alterne`** : le repère A/B ne s'affiche que si des créneaux sont réellement marqués — sinon il n'apprendrait rien.
- **L'ÉDITION voit tout.** Back-office et « Mon emploi du temps » listent les deux semaines : on ne corrige pas ce qu'on ne voit pas. Dans l'app, les créneaux de l'autre semaine sont **estompés et expliqués**, pas masqués.
- **Libellés** : les établissements disent tantôt « A/B », tantôt « paire/impaire ». On affiche **les deux** — « Semaine A (impaire) » — parce que « A » seul ne dit pas laquelle c'est, et que se tromper de semaine, c'est envoyer un enfant avec le mauvais cartable.
- **11 tests**, dont la bascule du réglage `quinzaine_paire` : l'affichage suit, et le back-office continue de tout lister.

### Jours fériés — calculés, jamais téléchargés
Onze dates par an, dont trois dérivées de Pâques (algorithme de Meeus/Jones/Butcher, sans table ni boucle). Aller les chercher sur une API ajouterait une dépendance réseau, un cache et une panne possible, pour une information qui n'a pas changé depuis 1959 — et l'écran doit fonctionner quand Internet tombe.
- **19 tests**, dont **Pâques vérifié sur 8 années de référence** (2000, 2024→2028, 2030, 2038) : c'est le seul moyen de valider un tel algorithme.
- Affichés : en-tête et veille du bento, vues **jour / semaine / mois** de l'agenda, et agenda de l'app — où un férié **sans rendez-vous garde sa ligne**, puisque c'est l'information du jour.
- L'Alsace-Moselle a deux fériés de plus (Vendredi saint, 26 décembre) : **volontairement omis** plutôt qu'affichés à tort — sans objet à Roubaix.

### Vérifié
**160 tests automatisés, 0 échec** : 53 API · 12 vocal · 20 rappels/anniversaires · 11 quinzaine · 19 fériés · 19 rayons · 26 quantités.

## 2 undecies. 🔇 « ÇA FAIT SURVEILLANCE » + réglages voix au back-office (19/08/2026, 5e vague)

### 🔴 Une faute de conception, signalée par Rémi
« Quand je clique sur le bouton, il y a un menu en haut sur le bento ; **ça devrait apparaître que quand je dis Jarvis** — les autres discussions apparaissent sans intérêt, ça fait surveillance. »

**Il a raison, et c'était bien une faute.** Le gestionnaire `entendu` du bento affichait TOUTE phrase entendue, **transcriptions provisoires comprises** : autrement dit, chaque conversation de cuisine s'affichait sur le mur. Ça ressemblait à de la surveillance **parce que c'en était** — et ça contredisait le principe que j'avais moi-même écrit dans `VOCAL.md` : *rien ne sort avant que « Jarvis » soit prononcé.*

Corrigé : **le bento n'affiche RIEN tant que le mot d'éveil n'a pas été reconnu.** Ce qui est écarté n'est ni affiché, ni envoyé, ni conservé — le mot d'éveil est cherché sur l'appareil.
⚠️ Leçon : le principe était écrit, la mise en œuvre ne le respectait pas. Un principe de confidentialité ne vaut que si on relit le code à sa lumière — l'écrire ne suffit pas.

### 🎚️ Le paramétrage part au back-office
« Dans le back-office il n'y a pas de choix de la voix, c'est que dans vocal. »
Exact, et c'était mal rangé : **l'écran mural n'a aucune interface de configuration et ne doit pas en avoir** — on ne règle pas un objet posé sur un mur.
- Nouveaux réglages : `voix_nom`, `voix_debit`, `voix_ton`, `voix_eveil`, `voix_exiger_eveil`. Exposés dans `/api/data → reglages.voix`, appliqués par le bento **et** par le banc d'essai.
- **Deux cartes dans /admin/ → Réglages** : « Voix de l'assistant » (liste des voix, débit, tonalité, mot d'éveil, exiger l'éveil, essai, préréglage « Jarvis ») et « Tester le microphone » (liste des entrées + niveau en direct + le remède Teams, prouvé sur cette machine).
- ⚠️ **On enregistre le NOM de la voix, pas son identifiant.** La liste dépend de la machine qui parle : Windows, macOS et le Raspberry n'ont pas les mêmes. L'écran mural cherche le même nom, puis retombe sur la meilleure voix française — un identifiant choisi sur le PC serait introuvable ailleurs. L'interface le dit franchement.
- Le **mot d'éveil est configurable**. Pour « jarvis » on connaît les approximations que produit la transcription et on les accepte ; pour un autre mot on n'en sait rien, donc **mot exact seulement** — inventer des variantes déclencherait à tort.

### ♻️ Dette de duplication payée
`/vocal.html` a été **réécrit par-dessus `voix.js`** : il perd tout son paramétrage (parti au back-office) et redevient ce qu'il aurait dû rester — **un banc d'essai qui montre**, avec ses deux journaux et son diagnostic. Le moteur n'existe plus qu'en un seul exemplaire, partagé avec le bento.
- Un contrôle automatique a été ajouté au passage : **chercher les `$('#id')` dont l'élément n'existe plus**. Retirer un bouton en laissant son gestionnaire fait planter tout le script — c'est exactement ce que j'avais commencé à faire.

### Vérifié
**160 tests, 0 échec**, plus l'aller-retour d'écriture des réglages de voix (enregistrés, relus par `/api/data`, remis en état).

## 2 duodecies. 🧪 LES TESTS ENTRENT DANS LE PROJET (19/08/2026, fin de journée)
Les 150 vérifications écrites pendant la reconstruction vivaient dans un **dossier temporaire de session** : elles auraient disparu au prochain redémarrage. C'est exactement l'erreur du 18/08 — la base était sauvegardée, le code non.

`node outils/tester-tout.js` (ou `npm test`) — **150 vérifications en ~8 s**, six séries :

| Série | Couvre |
|---|---|
| `calculs` | fériés (Pâques sur 8 années de référence), rayons devinés, quantités — **sans serveur** |
| `pages` | syntaxe des scripts embarqués, **identifiants visés mais absents**, accolades CSS, en-têtes de cache |
| `api` | lecture complète, écritures, temps réel, corbeille, barrière admin, sécurité du planning |
| `vocal` | identité, écho SSE, chemin rapide, refus |
| `rappels` | anniversaires, échéances adressées, rangement automatique |
| `quinzaine` | filtrage A/B, bascule du réglage, l'édition voit tout |

Deux garde-fous portés par les tests eux-mêmes :
- Tout ce qui est créé porte le préfixe **`ZZ-essai`** et est retiré à la fin. **Aucune opération de MASSE n'est jamais tentée** — le projet a déjà payé une liste de courses vidée et une journée de planning dupliquée.
- Le contrôle **« identifiant visé mais absent du HTML »** est né d'une vraie frayeur : en déplaçant les réglages de voix vers /admin/, j'ai retiré des boutons en laissant leurs gestionnaires. Un `$('#absent').onclick` lève une exception et **tue tout le script à partir de cette ligne**, sans rien afficher.
- 🐞 Défaut de mes propres tests, corrigé : un jeton d'appareil horodaté créait **une ligne d'essai par exécution** dans la liste des appareils enrôlés (la révocation marque, elle n'efface pas). Jeton fixe → une seule ligne, réutilisée.

⚠️ Ils s'exécutent sur les **vraies données**, faute de base de test. `sauvegarder-tout.cmd` d'abord si le moindre doute.

### 👀 La famille s'en sert vraiment
Relevé en fin de journée, sans que je l'aie demandé : **4 anniversaires saisis** (Augustin, Clovis, papi Pascal, et « mami gateau » **sans année** — le cas prévu fonctionne), **les 4 dates du foyer renseignées**, **6 plats ajoutés** dont plusieurs venus des idées IA (Bo bun, gaspacho, fajitas), et **la semaine du 24 août remplie via « Proposer les soirs vides »**. Les fonctions livrées le matin étaient utilisées l'après-midi.

## 2 terdecies. 👦 GARDE ALTERNÉE — le calendrier fait foi (19/08/2026, 6e vague)

### 💡 La découverte qui a défini la solution
Rémi a donné oralement le rythme des week-ends et des vacances, puis a ajouté : « normalement tout est indiqué dans le calendrier iCloud ». **C'était vrai, et ça change tout** : son agenda contient déjà des marqueurs posés à la main, réguliers et exploitables :

| Marqueur | Ce qu'il dit | Occurrences relevées |
|---|---|---|
| `Les enfants` | week-end de présence d'Augustin et Clovis | 16, **tous les 14 jours, sans exception** |
| `Vacances enfant…` | période de vacances chez nous | Toussaint, Noël |
| `Recup garcons` | l'heure de récupération (vendredi 14h30) | 11 |

⇒ Décision de Rémi, appliquée à la lettre : **« garde-le en lecture, si on doit modifier c'est dans le calendrier »**. Le module ne WRITE jamais dans l'agenda, et le back-office est un écran de **vérification**, pas de saisie.

### 🐞 Le piège que seules les vraies données révèlent : PAS de parité de semaine
Le premier réflexe était de calculer « un week-end sur deux » par la parité de la semaine ISO, comme pour la quinzaine A/B. **Les 16 relevés le démentent** : les week-ends tombent en semaines **paires** jusqu'en décembre 2026, puis **impaires** dès janvier 2027 (semaine 52 → semaine 1). Une règle de parité aurait donc été **fausse à partir du Nouvel An, silencieusement**.
⇒ Le repli hors calendrier est un **rythme de 14 jours depuis une date de référence**, jamais une parité.

### 🐞 Deux fratries, deux calendriers — raisonner par enfant
Premier jet : « les garçons sont là → tout le monde est là ». Il annonçait **6 couverts le week-end du 22 août**. Faux : Martial et Enora sont chez leurs parents **tout le mois d'août**, seuls les garçons viennent ce week-end-là → **4**. La logique est désormais **par personne** :
- **Augustin, Clovis** : présents uniquement si le calendrier le dit.
- **Martial, Enora** : présents **sauf** (a) vacance scolaire sans marqueur de présence, (b) week-end où les garçons ne viennent pas — ils partent le même week-end (confirmé par Rémi).

| Situation | À table |
|---|---|
| semaine | 4 |
| week-end avec les garçons | **6** |
| week-end sans les garçons | 2 |
| vacances marquées « chez nous » | 6 |
| autres moitiés de vacances | 2 |

### 🔑 Le marqueur récurrent ne vaut RIEN pendant les vacances — correction de Rémi
Le module annonçait 4 couverts le week-end du 22 août. Rémi a tranché : **« tout le mois d'août les enfants sont absents ; le 22 c'est un oubli, on a mis un week-end sur deux en récurrent dans le calendrier »**.

L'événement récurrent se déclenche donc **tout seul pendant les vacances**, alors que personne ne vient. Règle retenue : **pendant une vacance scolaire, seul un marqueur DE VACANCES fait foi** ; le marqueur de week-end est ignoré. Bénéfice secondaire, qui compte autant : Rémi n'a **pas à corriger sa récurrence à la main** plusieurs fois par an.
- ⚠️ Quand un marqueur est ignoré, **l'écran le DIT** (« marqueur *Les enfants* ignoré (récurrence) »). Sans ça, on chercherait pourquoi l'affichage contredit le calendrier, alors que c'est voulu.
- 💡 Cette correction ne pouvait venir que de Rémi : les données étaient cohérentes, seul l'usage réel révélait l'oubli. Troisième fois de la journée qu'un retour de sa part corrige un vrai défaut (courses invisibles, « ça fait surveillance », marqueur récurrent).

### 📅 Dates officielles zone B 2026-2027 — vérifiées, et elles VALIDENT Rémi
Contrôlées sur le calendrier du ministère (académie de Lille = zone B) :

| Vacances | Officiel | Enfants chez nous (Rémi) |
|---|---|---|
| Toussaint | sam 17 oct → lun 2 nov | 17 → 24 oct (1ʳᵉ moitié) |
| Noël | sam 19 déc → lun 4 janv | 26 déc → 3 janv (2ᵉ moitié) |
| Hiver | sam 20 févr → lun 8 mars | 19 → 27 févr (1ʳᵉ moitié) |
| Printemps | sam 17 avril → lun 3 mai | 16 → 24 avril (1ʳᵉ moitié) |
| Été | à partir du sam 3 juillet | à partir du 1ᵉʳ août (2ᵉ moitié) |

💡 **Rémi avait raison sur le vendredi soir** : il a donné « du 16 avril » et « du 19 février », qui sont précisément les **vendredis** précédant le début officiel du samedi. Les périodes commencent donc le vendredi (sortie des classes) et se terminent la **veille de la rentrée**, pas le lundi de reprise. Les six moitiés qu'il a données tombent toutes juste.

### 🔍 Diagnostic ajouté : quelles vacances n'ont pas encore de marqueur
Une vacance sans marqueur est comprise comme « les enfants sont chez leur autre parent ». C'est souvent juste — mais parfois c'est seulement que **la saisie n'a pas été faite**. La différence compte, alors l'onglet Présence liste les vacances à venir avec, pour chacune, si un marqueur existe dans l'agenda. Aujourd'hui seules Toussaint et Noël en ont : février, avril et l'été 2027 restent à saisir dans iCloud.

### ⚠️ Les vacances scolaires sont un RÉGLAGE, pas un calcul
Sans elles, le module annonçait « Enora et Martial sont là » en plein mois d'août. Les dates (zone B) sont éditables dans /admin/ → Réglages, **une période par ligne**, et le back-office invite explicitement à les vérifier : elles changent chaque année, et un calcul qui se tromperait sans le dire serait pire qu'un champ à relire. Seules deux dates sont sûres — la rentrée du 31/08/2026 (dans le calendrier de Rémi) et les périodes qu'il a données.

### Ce que ça donne
- **Fenêtre du calendrier portée à un an** (−45 j / +365) : les vacances de février 2027 tombaient hors des 180 jours et la présence y était invisible. On lit un an, on n'en **affiche** que six mois — une requête, deux usages, et le Raspberry ne transporte pas une année d'événements.
- **Couverts PROPOSÉS, jamais imposés** : un bouton « → 6 ? » à côté du sélecteur. Personne ne veut découvrir la veille d'un repas qu'un nombre a changé tout seul. Un choix fait à la main l'emporte toujours.
- Repère sur l'écran mural (« les enfants arrivent vendredi »).
- Onglet **👦 Présence** : aujourd'hui, les 21 prochains jours, les périodes trouvées — **avec la source de chaque réponse** (calendrier / règle / vacances scolaires). Une déduction qu'on ne peut pas relire est une déduction qu'on ne peut pas corriger.
- Prénoms et marqueurs en réglages : aucun foyer codé en dur (§ 5 quater).

### ⚠️ Écart à arbitrer par Rémi
Ce qu'il a dit et ce que dit son calendrier ne coïncident pas tout à fait :
- **Toussaint** : annoncé « du 17 au 24 octobre », calendrier `Vacances enfant maison` = **15 → 23 octobre**.
- **Noël** : annoncé « du 26 décembre au 3 janvier », calendrier `Vacances enfant` = **25 décembre → 2 janvier**.
Le calendrier fait foi (sa décision), donc **c'est lui qu'il faut corriger** si les dates annoncées sont les bonnes. Signalé, non tranché à sa place.

### Vérifié
**166 tests, 0 échec** — dont 18 sur la présence, sur les vraies données du calendrier.

## 2 quaterdecies. 🤵 LA FAÇON DE PARLER — style « majordome » (19/08/2026, 7e vague)
Demande de Rémi : « pour le son de la voix et la façon de parler je voudrais vraiment me rapprocher de Jarvis en français dans le film Iron Man », avec deux liens.

### Ce que les deux références ont apporté — dont un contre-exemple
- **Fiche Fish Audio « Jarvis | Iron Man »** : décrit le timbre visé — « masculine, distinguée et formelle », « sophistiquée », « profondeur, calme, professionnalisme », ton « courtois et mesuré ». C'est la bonne cible.
- **Article sur un assistant « Jarvis »** : personnalité dynamique, sarcasme selon le contexte, humour ajouté « régulièrement ». ⚠️ **Ça a servi de CONTRE-EXEMPLE autant que de modèle.** Sur un écran qu'on interroge dix fois par jour, l'humour systématique devient pénible, et le sarcasme n'a rien à faire dans une réponse adressée à un enfant de huit ans.

💡 **Ce qui rend JARVIS reconnaissable n'est pas la vanne** : c'est le vouvoiement, la litote, la brièveté, et le fait d'annoncer ce qui est fait sans s'en vanter. C'est ce qui a été implémenté.

### `vocal/personnalite.js`
Deux styles réglables dans /admin/ : **majordome** (défaut) et **neutre**.
- La personnalité **s'ajoute** à la consigne métier, elle ne la remplace pas : liste fermée d'actions et interdiction de détruire restent en tête.
- 🔑 **L'appellation et l'ironie sont automatiquement désactivées quand celui qui parle est un enfant** — le serveur connaît son rôle. « Monsieur » à Clovis sonnerait faux, et l'ironie envers un enfant n'a pas sa place. Vérifié par test.
- Le **chemin rapide** (0 ms, sans IA) parle la même langue que le modèle : sinon l'assistant change de voix selon la tournure employée, et ça s'entend. Les variantes sont choisies par **empreinte du texte, pas au hasard** — même demande = même phrase (tests reproductibles), demandes différentes = pas de radotage.

Résultat mesuré sur données réelles : « Poisson vapeur et riz, Monsieur. » · « Je ne peux pas supprimer la liste depuis la voix ; veuillez le faire directement sur l'écran. » · à Enora et Clovis, aucune appellation.

### 🐞 Manque trouvé en écoutant : l'assistant ignorait la garde
« On sera combien à table samedi ? » restait sans réponse, alors que le module de présence venait d'être écrit. Le contexte vocal reçoit maintenant **huit jours de présence** — assez pour répondre, sans alourdir la consigne d'une année.
Depuis : « Vous serez deux à table samedi. » · « Non, les garçons restent chez leurs autres parents ce week-end. »

### 🥇 La voix libre existe — Piper, licence MIT
Recherche demandée par Rémi. Le dépôt `rhasspy/piper-voices` publie les modèles français en **MIT**, dont plusieurs **voix masculines** (`tom`, `gilles`, `upmc`) — ce qui manquait, la voix française la plus connue (`siwis`) étant féminine. Réglages qui rapprochent du timbre : `lengthScale 0.72 · noiseScale 0.4 · noiseWScale 0.5 · sentenceSilence 0.08`. Le projet `novik133/jarvis` monte déjà whisper.cpp + Piper hors ligne — l'architecture recommandée ici tient debout.
⚠️ Le modèle Fish Audio partagé est une **voix clonée en ANGLAIS uniquement**, sans licence affichée, et impose que **chaque phrase sorte de la maison** — ce qui contredit le principe tenu partout (le mot d'éveil est local précisément pour ça). Signalé, non tranché : c'est un arbitrage de Rémi.

### 🐞 Trois défauts que seule l'ÉCOUTE a révélés
Rémi : « je veux garder sarcasme léger et humour quand même, mais **en ayant la réponse** et le style majordome ». D'où le réglage `voix_humour` (jamais | rare | **leger**) et la règle qui gouverne tout : **le fait d'abord, l'esprit après, jamais à la place**.

En comparant les trois doses sur les vraies données, trois bugs sont apparus — aucun n'était visible en relecture :
1. 🔑 **Amandine se faisait appeler « Monsieur »**, et Clovis « Madame ». L'appellation était un réglage global appliqué à tout le monde. ⇒ Nouveau réglage `voix_appellation_pour` : elle ne vaut que pour les personnes désignées, les autres sont appelés par leur prénom.
2. 🔑 **Ne PAS mentionner l'appellation ne suffit pas.** Le personnage de majordome est assez marqué pour que le modèle sorte « Monsieur » de lui-même. Il faut une **interdiction explicite** — deux tentatives ont été nécessaires pour le comprendre.
3. 🔑 **Augustin et Clovis n'existent pas dans la table `personnes`** (ils ne sont là qu'un week-end sur deux) : leur rôle « enfant » était donc introuvable, et ils étaient traités comme des adultes. On les reconnaît désormais via le réglage `garde_alternes`.
- Au passage : avec la dose « jamais », le modèle a une fois **refusé d'ajouter une tâche qu'il sait faire** — « strictement factuel » avait été lu comme « fais-en moins ». La consigne précise maintenant que la sobriété porte sur le TON, pas sur ce qu'il s'autorise.
- Le tutoiement d'un enfant est devenu un **choix assumé** plutôt qu'une règle contournée : le modèle le faisait déjà spontanément, et c'est plus naturel en français.

### 🗣️ « Comment on teste la voix ? » — un banc d'essai dans /admin/
`POST /api/admin/voix/essai` : une phrase entre, une réponse sort — **sans micro et sans rien écrire** en base. Les réglages du formulaire sont pris en compte **avant d'être enregistrés** : on essaie, puis on garde. Un bouton **« Comparer les trois doses d'esprit »** affiche les trois réponses côte à côte — c'est en comparant qu'on choisit, pas en imaginant.
⚠️ Le banc d'essai ne contourne PAS les garde-fous : l'appellation reste refusée à qui n'y a pas droit, même si le formulaire la propose.

### 👦 Augustin et Clovis deviennent membres du foyer
Demande de Rémi : « ajoute Clovis et Augustin même si absents ». Ils n'y sont qu'un week-end sur deux, mais ils **sont** du foyer : sans fiche, impossible de leur assigner une tâche, de leur faire un emploi du temps ou de leur donner un téléphone.
- ⚠️ **Leurs anniversaires étaient dans la table `anniversaires`.** Une fois membres, ils auraient été annoncés **deux fois**. La date est passée dans `personnes.naissance` et les entrées en double retirées — vérifié : plus aucun doublon. La règle du § 2 nonies tient (« une personne n'est jamais décrite à deux endroits »), encore fallait-il l'appliquer au moment de la bascule.
- **« Garçons » converti en valeur collective** (comme « Toute la famille »). Il n'était **référencé nulle part** — vérifié sur les sept tables qui portent un prénom — et depuis que les deux garçons ont leur fiche, le laisser en « personne » ferait trois enfants dans les listes là où il n'y en a que deux. Il reste utilisable pour assigner une tâche aux deux d'un coup. Réversible d'un clic.
- La voix les reconnaît désormais par leur **rôle** et non plus seulement par le réglage `garde_alternes` : aucune appellation, aucune ironie.
- Le module de présence lit des **réglages**, pas la table des membres : ajouter des fiches n'a rien changé à qui est à table. Vérifié.

### Vérifié
**184 tests, 0 échec** — dont 29 sur le vocal, personnalité comprise.
Vérifié en vrai, par personne : Rémi seul reçoit « Monsieur » ; Amandine, Enora, Martial, Clovis et Augustin sont appelés par leur prénom ou sans appellation.

## 2 quindecies. 🐞 TROIS BUGS TROUVÉS PAR L'USAGE (20/08/2026)

### 🔴 LE bug : les suppressions du calendrier n'étaient JAMAIS prises en compte
Rémi : « dans l'agenda tu indiques les enfants au 21 août, sauf que sur l'agenda iCloud ça n'y est plus… y a pas de synchro ? »

Il y avait bien une synchro. Il y avait surtout **un bug**, et il était grave.

En lisant le flux iCloud **en direct**, la suppression était bien là :
```
exdate → clé « 2026-08-21 »   valeur « 2026-08-21T22:00:00Z »   date locale 2026-08-22
```
`readAgenda()` comparait les **CLÉS** de `exdate`, qui sont des dates **UTC**. Or pour un événement « journée entière » à minuit local, la valeur tombe à 22:00Z la veille — donc la clé annonce le **21** là où l'occurrence tombe le **22**. La comparaison ne pouvait jamais aboutir : **aucune occurrence supprimée n'était exclue, depuis toujours**.

⇒ L'ensemble d'exclusion est désormais construit à partir des **VALEURS ramenées en date locale**, les clés étant conservées en plus (certains flux emploient l'autre convention).

**Effet mesuré : 206 → 189 événements.** 17 occurrences que Rémi avait supprimées réapparaissaient sur le mur.

💡 **Et ça éclaire rétrospectivement le § 2 terdecies.** La règle « pendant les vacances, ignorer le marqueur de week-end » avait été écrite pour expliquer que le 22 août s'affichait. En réalité **le calendrier de Rémi était déjà juste** : il supprime bien les week-ends tombant en vacances (juillet, août, Toussaint, Noël, février, avril — 10 occurrences). C'est mon code qui les ressuscitait. La règle est conservée comme **filet** mais devient un réglage décochable (`garde_ignorer_we_en_vacances`) : elle serait **fausse** si les enfants venaient un week-end isolé pendant des vacances.
- ✅ **Le test a fait son travail** : `presence` est tombé après la correction, parce qu'il exigeait un écart de 14 jours pile — ce qui n'était vrai que grâce au bug. L'invariant réel est un **multiple** de 14 : les suppressions créent des trous de 28 jours. Assertion corrigée, et un contrôle ajouté sur l'exclusion elle-même.
- ➕ Bouton **« ↻ Relire le calendrier »** dans /admin/ → Présence : le cache est de 10 min, inutile d'attendre après une modification. ⚠️ iCloud a **en plus** son propre délai de publication, que ce bouton ne raccourcit pas — c'est dit dans l'interface.

### 🐞 « J'ai réglé une voix masculine et j'entends une voix féminine »
`initVoix()` était appelé **juste après `load()`, sans l'attendre** — or `load()` est asynchrone. Les réglages (voix, débit, ton, mot d'éveil) n'étaient donc pas encore chargés, et l'écran retombait sur la voix française par défaut, **féminine sous Windows**. Ni la voix ni le ton n'étaient jamais appliqués.
⇒ `load().then(() => { initVoix(); appliquerReglagesVoix(); })`, et **ré-application à chaque chargement** : changer la voix dans /admin/ prend désormais effet sans recharger l'écran mural — qu'on ne recharge jamais à la main.
- 🐞 Second défaut dans le même mécanisme : Chrome charge ses voix **en différé**, et le gestionnaire `onvoiceschanged` reprenait le nom passé **à la création**, écrasant tout changement ultérieur. Le nom souhaité est maintenant mémorisé à part.

### 🔇 « La fenêtre apparaît dès qu'on clique sur le micro »
Le bouton affichait un bandeau « 🎙️ À l'écoute » à chaque appui, qui restait plusieurs dizaines de secondes. Autrement dit **l'écran annonçait qu'il écoutait** — exactement l'effet « surveillance » qu'on cherchait à éviter, deuxième fois.
⇒ **Plus aucun bandeau à l'allumage.** L'état se lit sur le bouton lui-même (allumé, pastille qui pulse) ; le bandeau ne s'ouvre **que** lorsque « Jarvis » a réellement été prononcé.

### 🔍 handy.computer — vérifié, et hors sujet pour la voix
Lien envoyé par Rémi « pour les voix à checker ». Analyse honnête :
- **Handy fait de la TRANSCRIPTION, pas de la synthèse.** Il ne propose aucune voix — c'est du *speech-to-text* : on appuie sur un raccourci, on parle, le texte est collé dans le champ actif. Pour « la voix de Jarvis », il ne répond pas à la question. **Piper reste la réponse** (§ 2 quaterdecies).
- **x64 uniquement — pas d'ARM, donc pas de Raspberry Pi.** Il ne peut pas tourner sur l'écran de cuisine.
- En revanche il **confirme l'architecture** retenue : MIT, gratuit, 100 % local (« your voice stays on your computer »), whisper.cpp + **Parakeet V3** (optimisé CPU, détection automatique de langue). Ce dernier est une piste intéressante pour le Mac mini, à côté de whisper.
- ⚠️ Il colle le texte dans le champ actif au lieu d'appeler une API : pour ce projet il faudrait quand même passer par `/api/vocal`. Utile comme dictée générale sur le Mac, pas comme brique de l'assistant mural.

### 🔍 Tutoriel « Jarvis en Python » (legeekheureux.fr) — une idée à garder, le reste en retrait
`speechrecognition` + `pyttsx3` + **Ollama**, mot d'éveil `if 'jarvis' in command`.
- ⚠️ `recognize_google` **envoie l'audio à Google** avant même de chercher le mot d'éveil : exactement ce que l'architecture d'ici évite.
- ⚠️ `pyttsx3` utilise les voix système — **espeak** sur un Raspberry, très robotique. Piper fait bien mieux.
- ⚠️ Aucune action : le modèle répond, c'est tout. Pas de liste fermée, pas de garde-fou.
- 💡 **À retenir : Ollama.** Un modèle de compréhension **local** supprimerait la dernière dépendance réseau — aujourd'hui seule la compréhension sort de la maison. À essayer sur le Mac mini, avec une réserve : `/api/vocal` repose sur des **sorties structurées** et une **liste fermée d'actions**, que les petits modèles tiennent moins bien. Le réglage `ia_modele_vocal` existe justement pour comparer.
- **Non implémenté** : ni Ollama ni macOS sur ce PC. Même règle qu'avec HomeKit — un adaptateur qu'on ne peut pas exécuter, ce sont des bugs qu'on découvre au pire moment.

### 🐞 « Il me dit que la météo n'est pas disponible… alors qu'elle est à l'écran »
Deux questions de Rémi, une seule cause : **le contexte vocal ne contenait QUE la journée en cours.**
- « quel temps fera-t-il demain ? » → *« je crains que la météo ne soit pas disponible »*, alors que la prévision s'affiche sur le bento juste à côté. Seule la ligne du jour était transmise ; ni `heures[]` ni `jours[]` ne l'étaient.
- « j'ai quoi à l'agenda demain ? » → *rien*, alors qu'il y avait « remi teletravail » et « Le touquet ». Le filtre ne gardait que `start === aujourd'hui`.

⚠️ Le pire n'est pas l'ignorance, c'est la **contradiction** : un assistant qui affirme le contraire de ce que l'écran montre détruit la confiance qu'on lui accorde.

Corrigé : le contexte porte désormais sur **huit jours** — agenda groupé par date avec « aujourd'hui / demain » nommés explicitement, prévisions et prochaines heures, emploi du temps des enfants sur **toute la semaine** (il était limité au jour même, donc « qu'est-ce qu'Enora a mercredi ? » ne marchait pas non plus). Les événements **sur plusieurs jours** apparaissent sur chaque journée couverte, DTEND exclusif géré — un déplacement du vendredi au dimanche concerne bien le samedi.

Vérifié en vrai : *« Demain, il fera entre quinze et dix-neuf degrés »* · *« Vous avez télétravail et Le Touquet »* · *« Enora a cours au collège de huit heures à midi, puis piscine »* · *« Demain soir, c'est la sortie, donc rien de prévu à la maison »*.
- ✅ Le test porte sur le **contexte lui-même**, sans appeler le modèle : rapide et déterministe. Et il a fallu le corriger une fois — il attrapait « RHODES », des vacances **passées** (l'agenda remonte 45 jours), ce qui ne prouvait rien.

### 🕐 Les heures se DISENT, elles ne s'écrivent pas
« Le Touquet à **trois de l'après-midi** » — le modèle transformait les heures en toutes lettres pour l'oral, mais sans règle, et le résultat était parfois bancal (nombre sans le mot « heures »).

Une section **DIRE LES HEURES** a été ajoutée à la consigne : format 24 heures en toutes lettres, avec des exemples et les fautes à éviter nommément. `12:00 → midi`, `00:00 → minuit`, `17:15 → dix-sept heures quinze`, une plage → « de huit heures à midi ». Interdits : « 15h », « 15:00 », et tout nombre d'heure **sans** le mot « heures ».

Résultat : *« à quinze heures »* · *« de huit heures à midi »* · *« de quatorze heures à quinze heures trente »*.
- Le test vérifie **la consigne ET une vraie réponse** — qu'aucune heure n'y soit écrite en chiffres, et qu'aucun nombre d'heure n'apparaisse sans son unité.

### 🕑 LE bug de fuseau — deux heures de décalage, et une conclusion fausse à réparer
Rémi : « télétravail à 10 h alors que ça commence à midi, et Le Touquet à 15 h alors que j'ai mis 17 h ».

Exactement **deux heures** : UTC contre Paris en été. `contexte()` lisait l'heure en **découpant la chaîne ISO** (`slice(11,16)`), qui est en UTC. Les fronts, eux, faisaient `new Date(start)` — donc leur affichage était juste depuis toujours. Seul le code qui découpait la chaîne était faux.

⇒ `readAgenda()` publie désormais `jour`, `jourFin`, `heure`, `heureFin` **déjà convertis en heure locale**, pour que personne n'ait à refaire la conversion — ni à la rater. `vocal/` et `presence/` les utilisent.

**Et ça corrige une conclusion erronée du § 2 terdecies.** J'avais écrit que le marqueur « Les enfants » ne couvrait qu'un seul jour (le samedi), et compensé avec `garde_we_apres = 1`. C'était faux : le décalage UTC faisait apparaître la fin **un jour trop tôt**. Le marqueur couvre bien **samedi ET dimanche**, exactement comme Rémi l'avait dit dès le départ (« le week-end 5 et 6 septembre »). Avec la lecture corrigée, mon `+1` ajoutait le **lundi** → remis à `0`. Il ne reste à ajouter que le vendredi, jour d'arrivée.

**Et l'écart que j'avais signalé entre ses dates et son calendrier venait de MON bug** :

| | Ce que Rémi a annoncé | Lu AVANT | Lu APRÈS |
|---|---|---|---|
| Toussaint | 17 → 24 oct | 15 → 23 ❌ | **16 → 24** ✓ |
| Noël | 26 déc → 3 janv | 25 déc → 2 janv ❌ | **26 déc → 3 janv** ✓ (au jour près) |

Le jour d'écart restant sur les débuts est la convention vendredi/samedi, déjà documentée. **Son calendrier était juste ; c'est ma lecture qui ne l'était pas.** Deuxième fois en deux jours qu'un « écart » signalé à Rémi était en réalité un bug de mon côté (après les occurrences supprimées).

Corrigé au passage, même famille : les occurrences récurrentes de journée entière sont recalées sur **minuit LOCAL** (rrule les rend à minuit UTC — le jour glisserait dans un fuseau en retard sur UTC), et leur durée se compte en **jours** et non en millisecondes — 24 h d'écart ne font pas un jour lors d'un changement d'heure.

### 🕐 Les heures se DISENT, elles ne s'écrivent pas
« Le Touquet à **trois de l'après-midi** » — le modèle mettait les heures en toutes lettres pour l'oral, mais sans règle. Section **DIRE LES HEURES** ajoutée à la consigne : format 24 heures en toutes lettres, `12:00 → midi`, `00:00 → minuit`, plages « de … à … », et les fautes nommées (« 15h », « 15:00 », nombre sans le mot « heures »). Étendu aux températures et quantités, puisque tout est lu à voix haute.
- Le test vérifie **la consigne ET une vraie réponse** : une consigne présente ne garantit pas qu'elle soit suivie.

### Vérifié
**194 tests, 0 échec.** Vérifié en vrai : *« du télétravail de midi à dix-sept heures, puis Le Touquet »*.

## 2 sexdecies. 📦 LE CODE EST SUR GITHUB (24/08/2026)
Dépôt **privé** : `https://github.com/RROrdc/Maisonconnect-e` — 61 fichiers, branche `main`.

### Ce qui n'y est PAS, et pourquoi
Le § 6 l'interdisait déjà ; le `.gitignore` le rend impossible.
- **`.env`** — clé Anthropic et token Notion **en clair**. ⚠️ Un dépôt privé se clone, se partage, se transfère : une clé exposée reste exposée, et **l'historique Git garde tout**, même après suppression du fichier. C'est pour ça qu'on ne l'y met pas *au départ* plutôt que de l'en retirer ensuite.
- **`maison.db` + `sauvegardes/`** — menus, courses, emplois du temps des enfants, dates de naissance, appareils enrôlés. La seule copie des données du foyer : elle se sauvegarde, elle ne se publie pas.
- **`public/plats/`** — 8,5 Mo de photos récupérées sur des sites de cuisine. Ce n'est pas à nous de les redistribuer, et elles se régénèrent en un clic (/admin/ → Repas).
- **`node_modules/`** — `npm ci` les reconstruit à l'identique.
- **`.claude/settings.local.json`** — spécifique à cette machine.

**Vérifié avant ET après le push**, pas seulement à l'écriture du `.gitignore` : recherche de `sk-ant-api03`, `ntn_`, et de l'URL du calendrier publié dans **tous les fichiers indexés**, puis contrôle du contenu réellement arrivé sur GitHub. Aucun secret.

### `README.md` ajouté
Ce que fait le projet, l'architecture, les trois principes tenus dans le code (la machine propose / rien ne se supprime vraiment / aucune destruction par la voix), la mise en route, les tests, les sauvegardes, ce qui est délibérément exclu du dépôt, et la feuille de route matériel. `CLAUDE.md` reste la mémoire détaillée — c'est lui qui a permis de reconstruire le serveur après la quarantaine.

### ⚠️ Rappel du § 5 quater, obstacle n° 4
Le projet est développé sur une machine dont Rémi n'est pas administrateur, sur un réseau d'entreprise. Le pousser sur un GitHub **personnel** est cohérent avec le conseil « migrer sur du matériel personnel avant tout développement à visée commerciale » — mais le développement, lui, se fait toujours sur le poste professionnel. Le point reste ouvert.

## 2 septdecies. 📅 MARQUEURS DE PRÉSENCE + 🖼️ PHOTOS DES PLATS RÉCALCITRANTS (24/08/2026)
Deux demandes de Rémi pendant l'attente du matériel (Mac mini le 28/08). Écran 21,5" et Raspberry déjà reçus, mais **rien ne se monte tant que le Mac n'est pas là** : tout tourne sur le portable, qui bouge.

### `outils/marqueurs-vacances.js` — proposer sans jamais écrire dans le calendrier
Deux périodes de garde manquaient dans iCloud (février 2027, été 2027). La règle du 19/08 tient — **le calendrier est en lecture seule** — donc l'outil produit un **fichier `.ics` à importer d'un double-clic**. Rien n'entre dans le calendrier sans un geste humain.
- 🐞 **Ma première version coupait chaque vacance en deux moitiés.** Elle proposait *juillet* 2027 alors que les enfants arrivent le **1er août**, et le *26* février au lieu du **27**. Retirée : le script ne devine plus aucune date, il les **reçoit**. Une date de garde fausse envoie un enfant au mauvais endroit — ça ne s'estime pas.
- L'outil sait dire qu'une vacance **en cours** sans marqueur est probablement volontaire (enfants absents), et non un oubli. Sans ça, l'été 2026 remontait comme un manque alors qu'il est juste.
- **Repliage RFC 5545** (75 **octets**, pas caractères — « é » en vaut deux, et on ne coupe jamais au milieu d'un caractère). node-ical est tolérant, l'importateur d'Apple ne l'est pas.
- ✅ **Vérifié par ALLER-RETOUR**, seul contrôle qui prouve quoi que ce soit ici : le `.ics` est relu **avec le moteur du serveur**, et la présence tombe bien du 19 au **27** février inclus, rien le 28. Relire le fichier à l'œil ne prouve pas le maniement de DTEND exclusif.

### Photos : 24 → 30 plats sur 38, sans jamais relâcher le garde-fou
Question de Rémi : « les 14 plats sans photo, c'est que j'ai mal orthographié, ou c'est générique — une parade ? ». **Diagnostic chiffré d'abord**, et il a contredit l'hypothèse de départ : le site trouvait souvent la bonne page, **c'est notre comparateur qui la refusait**.

| Défaut trouvé | Preuve mesurée |
|---|---|
| **Le score se calculait contre le nom fautif** | 750g renvoyait « bruschetta tomates mozzarella » en 1er résultat pour « bruchetta » — noté **0 %** |
| **La tolérance aux fautes ne marchait qu'en FIN de mot** | Elle tronquait le préfixe ; les vraies fautes sont au milieu (`bag<b>g</b>els`, `sara<b>z</b>in`) ⇒ remplacée par **Levenshtein** |
| **Les mots de moins de 4 lettres étaient jetés** | « **Bo bun** express au poulet grillé » cherchait `[express, poulet]` — tout sauf le plat |
| **Les qualificatifs comptaient comme des mots attendus** | « express », « maison », « grillé », « mariné » ne figurent dans aucun titre de recette et faisaient chuter la couverture |
| 🔑 **La ligature `œ` disparaissait** | `normalize('NFD')` décompose « é » mais **pas « œ »** : « b**œ**uf » devenait « b uf », deux fragments jetés. Conséquence vue en vrai : « Fajitas de bœuf » a accepté des **fajitas au poulet** |

**Le seuil chiffré a été remplacé par deux règles explicites** — un seuil ne s'explique pas et ne se discute pas :
1. **Même tête, des deux côtés** — le plat et le titre commencent par le même mot. Élimine risotto/rigatoni, club sandwich/bagels, papillote/barbecue.
2. **Tout couvert, ou rien en trop.** Un titre plus *précis* convient (« bruschetta tomates mozzarella » pour « bruschetta »), un titre plus *sobre* aussi (« riz cantonais » pour « riz cantonais aux crevettes »). Ce qu'on refuse, c'est le cas **mixte** : un mot attendu manque **et** un mot étranger le remplace — la signature exacte d'un autre plat (« pâtes AU PESTO » quand on cherchait « carbo »).

- 🐞 **Mon premier jet posait un seuil bas (0,42) en comptant sur lui pour trier.** Le test a immédiatement laissé entrer « pâtes carbo → pâtes au pesto », c'est-à-dire **l'erreur exacte que ce fichier existe pour empêcher**. Les règles structurelles font mieux et se disent en une phrase.
- 🐞 **« Tous les mots présents » ≠ « couverture = 1 ».** Un mot rattrapé malgré une faute rapporte sa ressemblance (0,90), jamais 1 : la couverture d'un plat mal orthographié **ne peut donc jamais atteindre 100 %**, et la règle « tout couvert » ne se déclenchait plus jamais dans le seul cas qu'elle devait servir. La couverture **pondère** (elle classe), un booléen **constate** (il décide).
- Le **mode recette est inchangé** (mots en trop pénalisés plein pot, seuil 0,55) : pour une recette les ingrédients comptent, pour une photo non. Les quatre repères de calibrage du 19/08 sont dans la suite de tests et n'ont pas bougé.
- **`outils/photos-plats.js`** : même travail que le bouton du back-office, sans serveur ni session. Simulation par défaut, `--vraiment` pour écrire, **n'écrase jamais une photo existante**.
- **Le bouton « 🔎 Trouver en ligne » cherche désormais des mots MODIFIABLES**, pré-remplis avec le nom du plat. Avant, il fallait **renommer le plat** pour chercher autrement — deux choses sans rapport. Les noms du foyer sont souvent trop détaillés pour un moteur de recettes : « Gaspacho de tomates jaunes et concombre » ne trouve rien, « gaspacho tomate » trouve à 85 %.
- Les candidats écartés affichent maintenant **pourquoi** (« pas le même plat » / « il manque un mot »). « Rien trouvé » n'oriente vers aucune action.

**Les 8 restants sont des refus assumés** : noms qui ne désignent pas un plat (« barbecue », « Soupe & tartines »), nom anglais absent du site (« butter chicken »), plat inventé (« semoule orientale protéiné »). Mesuré : un renommage débloquerait certains, mais « galette complète » ramène une **gaufre** — donc on propose, on ne renomme pas.

### Vérifié
**224 tests, 0 échec** (les 195 précédents + 29 sur les photos et les fautes d'orthographe, tous hors réseau donc rejouables). Sauvegarde faite avant écriture. 6 photos ajoutées aux vraies données, aucune écrasée.

## 3. Suite du projet
> ✅ **Tranché le 18/08/2026 : le BENTO est l'écran mural.** Tout développement va sur `bento.html`. La mise en page fine sera retravaillée **quand la tablette et le Mac mini seront là** (décision de Rémi).
> 🗑️ **`public/index.html` SUPPRIMÉ le 19/08** à la demande de Rémi (« on garde que le bento »). Il dormait depuis un mois sans être maintenu : une page qu'on ne teste plus finit par être corrigée par erreur. Il reste dans les archives du coffre (48,5 Ko) si la mise en page paysage devait resservir.
> ⚠️ C'était la page servie par défaut à la racine : **`GET /` redirige désormais vers `/bento.html`** (302), sinon taper simplement l'adresse du serveur donnait un 404. Vérifié par la série `pages`.

- **Écran reçu** → valider le **mode portrait** sur matériel réel : lignes visibles dans Courses / À faire, vue Mois sur 7 colonnes étroites, tailles tactiles.
- **Mac mini reçu** → portage (déplacer le dossier, `npm install`, `npm start` — **`maison.db` se copie avec**), puis **Tailscale + HTTPS** (débloque le hors-maison, le service worker et les notifications), puis Netatmo / AirPlay / iMessage, et le back-office (§ 5 ter).
- Indépendant du matériel : notifications serveur (ntfy) une fois l'identité en place, Raccourci Siri pour les courses (§ 5 bis-2), menu glissant par date.

Pour lancer sur le PC : double-clic sur **`demarrer-maison.cmd`** (l'adresse s'affiche au démarrage — **l'IP change avec le réseau Wi-Fi**).
Écran mural : `/bento.html` · App famille : `/app/` · **Administration : `/admin/`** · Voix : `/vocal.html` (voir `VOCAL.md`)
Sauvegarde : **`sauvegarder-tout.cmd`** (base + code, hors dossier projet ; tâche quotidienne à 12:30 déjà installée).
Premier accès au back-office : `node outils/admin.js` (liste), puis `node outils/admin.js code Rémi 1234`.
Tests : **`npm test`** (150 vérifications, ~8 s) — serveur allumé, données réelles, tout est nettoyé.

## 3 bis. Mise en route initiale — ✅ TERMINÉE (13/08/2026)
L'app est **fonctionnelle et connectée à Notion**, en lecture comme en écriture. Node portable ✅, `npm install` ✅, token ✅, partage Notion ✅, écritures validées ✅.

**Prochains pas concrets** (non faits) :
1. Ouvrir `http://10.31.95.95:8090` sur la **tablette** et valider le rendu réel + le tactile.
2. **Lancement auto sans admin** : raccourci vers `demarrer-maison.cmd` dans `shell:startup` (pas de service Windows, pas de `pm2 startup` — pas d'admin).
3. L'IP `10.31.95.95` est en **DHCP** → elle peut changer et casser le favori de la tablette. Prévoir une réservation DHCP sur la box, ou afficher l'IP courante au démarrage.
4. Attaquer la feuille de route (§5), en commençant par l'agenda perso (`CAL_ICS_URL`).

## 4. Modèle de données Notion (bases sous la page « 🏠 Maison »)
- **À faire** `DB_TODO` — `Tâche` (title), `Assigné à` (select : Rémi/Amandine/Enora/Martial/Garçons/Toute la famille), `Échéance` (date), `Statut` (status : Pas commencé/En cours/Terminé), `Priorité` (select).
- **Courses** `DB_COURSE` — `Article` (title), `Rayon` (select), `Pris` (checkbox), `Ajouté par` (select).
- **Post-it** `DB_POSTIT` — `Message` (title), `Auteur` (select), `Épinglé` (checkbox), `Date` (created_time).
- **Menu** `DB_MENU` — `Jour` (title), `Date` (date), `Midi (plat)` / `Soir (plat)` (relation → Plats), `Midi (libre)` / `Soir (libre)` (text).
- **Bibliothèque de plats** `DB_PLATS` — `Plat` (title), `Type`, `Catégorie`, `Ingrédients`.
Les IDs exacts sont dans `.env.example`.

## 5. Feuille de route (reprendre le sujet ensuite)
Par ordre suggéré :
1. **Agenda perso** : renseigner `CAL_ICS_URL` avec l'URL .ics de l'agenda iCloud « Rémi/Amandine » (et Garçons si dispo). **Jamais le pro.** Améliorer la tuile Agenda (vue semaine + jour).
2. **Liste de courses depuis le menu** : bouton qui déduit les ingrédients des plats de la semaine → ajoute dans Courses (dédoublonné).
3. **Notifications par personne** : quand le Mac est là, via **iMessage** (mapping nom → numéro). En attendant : option email ou push (ntfy/Pushover) côté serveur.
4. **Température Netatmo** : via **Home Assistant** (sur le Mac) ou l'API Netatmo ; tuile live + consignes par pièce.
5. **Musique AirPlay** : via **Home Assistant / Music Assistant** ou **AppleScript Music.app** (Mac) ; contrôle depuis la tuile (lecture, volume, choix d'enceinte).
6. **Écran de veille** : diaporama de l'album photos famille (dossier local ou URL partagée).
7. **Garde alternée** : afficher les week-ends où les garçons sont présents (calendrier « Garçons ») et adapter menus/quantités.
8. **Portage Mac** : déplacer le dossier, relancer ; ajouter Home Assistant + iMessage ; exposer en HTTP sur le LAN.
9. **Accès distant** : **Tailscale** (VPN privé) pour ouvrir l'écran hors de la maison — **jamais public**.

## 5 bis. Idées design & affichage (demandé par Rémi le 13/08/2026 — à faire APRÈS la stabilisation fonctionnelle)
Chantier « esthétique + densité d'information », à traiter d'un bloc plutôt qu'au fil de l'eau :
- **Météo** à remonter en évidence sur l'écran principal (aujourd'hui + prévision du jour/semaine). Source sans clé ni compte : **Open-Meteo** (`api.open-meteo.com`, gratuit, pas de token) pour Roubaix — à ne pas confondre avec la tuile **Température Netatmo** (intérieur, via le Mac, item 4).
- **Saint du jour** + n° de semaine, éventuellement éphéméride (lever/coucher du soleil, phase de lune).
- **Écran de veille = mur de widgets** (façon widgets iPhone) plutôt que l'écran noir + horloge actuel : heure/date en grand, météo, prochain événement d'agenda, courses restantes, tâches du jour, post-it épinglé, photo de fond. Doit rester **lisible de loin** (cuisine) et **sombre** (écran mural la nuit).
- **Du visuel sur les repas** (demandé explicitement) : ne pas se contenter du titre du plat — vignette/photo ou pictogramme par plat, code couleur par catégorie, mise en avant du repas du jour. Piste : champ `Photo` (files) ou `Emoji` dans la Bibliothèque de plats, avec repli sur un pictogramme déduit de la `Catégorie` ; images à stocker en local (contrainte « sans CDN »).
- **Refonte visuelle générale** : hiérarchie, typo, densité, tailles tactiles (les cibles actuelles font ~21–26 px, un peu justes pour des doigts).
- Contrainte à garder : tout en **local, sans CDN** (l'écran doit fonctionner même si Internet tombe — seule la météo dépend du réseau, prévoir un repli propre).

## 5 bis-2. Saisie depuis les iPhone de la famille (question de Rémi, 13/08/2026)
Objectif : ajouter aux courses depuis un iPhone sans ouvrir Notion. Trois pistes, évaluées :

1. **🥇 Raccourci Siri → API de l'app** — *faisable tout de suite, même sur le PC*. Un Raccourci partagé fait `POST /api/course` (Wi-Fi maison, ou partout via Tailscale). Aucune synchro, aucun conflit. **À faire en premier.**
2. **🥈 Rappels iCloud ↔ Notion** — le « via iCloud » demandé. Utiliser **Rappels** (listes partagées natives, cases à cocher, Siri), **pas Notes**. Nécessite le **Mac mini** : pilotage de Rappels en AppleScript/JXA, impossible depuis Windows.
   - ⚠️ Le bidirectionnel est le morceau le plus dur du projet : table de correspondance d'IDs, suppressions des deux côtés, **boucles d'écriture**, conflits. Commencer **unidirectionnel** (Rappels → Notion).
   - ❔ À vérifier : l'accès **CalDAV** aux Rappels iCloud (`caldav.icloud.com`, VTODO, mot de passe d'application) éviterait le Mac, mais Apple a changé de moteur de synchro — fiabilité inconnue, tester avant de s'engager.
3. **🥉 Notes iCloud — déconseillé.** Aucune API publique, AppleScript seulement, et surtout du **texte libre** : rayon/auteur/coché deviennent du parsing fragile.

⚠️ **Ne pas confondre MCP et synchro** : un serveur MCP Rappels/Notes sert à un **agent IA**, pas de transport de synchronisation pour l'app, qui a besoin d'un service permanent sans IA dans la boucle.

## 5 bis-3. App famille (iPhone/tablette) + notifications — réflexion du 14/08/2026
Cible visée par Rémi : l'écran web en cuisine **+ une app** sur les iPhone/tablettes, avec des onglets (Courses, Menu, À faire…), interaction complète et **notifications par personne**.

**Point de départ favorable** : `server.js` est déjà une API REST. Une app n'est qu'un **client de plus** — le gros du travail n'est pas l'affichage mais l'infrastructure ci-dessous.

### App : PWA d'abord, natif seulement si besoin
- **🥇 PWA** (l'app web actuelle rendue installable, « Sur l'écran d'accueil ») : icône, plein écran, **notifications push supportées sur iOS depuis 16.4** *à condition d'être installée sur l'écran d'accueil et d'avoir accepté la permission*. **0 €, pas de compte Apple, un seul code à maintenir.**
- **🥈 Natif (Swift)** : impose le **Programme Développeur Apple (~99 €/an)**, un Mac + Xcode, et une distribution pénible pour 5 téléphones (TestFlight = builds expirant à 90 j ; sideload gratuit = certificats à renouveler **tous les 7 jours**). À ne considérer que pour ce que la PWA ne sait pas faire : widgets sur l'écran d'accueil iOS, intégration Siri poussée, synchro en arrière-plan.

### Notifications — indépendantes du choix d'app
La logique de déclenchement (« tâche assignée à Martial, échéance aujourd'hui → prévenir Martial ») vit **côté serveur** : elle peut être construite **avant** toute app.
- **ntfy** (gratuit, auto-hébergeable sur le Mac mini) ou **Pushover** (~5 € une fois) : le serveur fait un simple `POST`. Le plus rapide à mettre en place.
- **iMessage** via le Mac mini (AppleScript) : arrive comme un SMS normal, très naturel pour la famille. Déjà à l'item 3 de la feuille de route.
- **Web Push PWA** : élégant (pas d'app tierce) mais dépend de l'installation sur l'écran d'accueil de chacun.

### ⚠️ Ce qui manque vraiment, quel que soit le client
1. **Authentification** — l'app est aujourd'hui **totalement ouverte** sur le LAN. Indispensable dès qu'on sort de la maison ou qu'on personnalise par personne. Voir § 5 ter (back-office).
2. **Identité par personne** — aujourd'hui `FAMILY` est codé en dur et « qui suis-je » se choisit dans une liste déroulante. Une app a besoin d'un vrai compte/profil par membre.
3. **Accès distant** — Tailscale (§ 5, item 9), **jamais d'exposition publique**.
4. **Stockage des abonnements push** (jeton par appareil) — nouvelle base Notion ou fichier local.

**Ordre suggéré** : notifications serveur (ntfy/iMessage) → identité + authentification → PWA installable avec onglets → natif seulement si un manque concret apparaît.

## 5 ter. Back-office — ✅ CONSTRUIT LE 18/08/2026 (voir § 2 quater)
> Le gel « en attente du Mac mini » décidé le 13/08 a été **levé par Rémi le 18/08** : il l'a demandé explicitement, avec la gestion des membres et l'emploi du temps détaillé des enfants. Le portail existe : `/admin/`.

**Fait** : authentification par code (scrypt) + sessions · membres (rôle, mail, téléphone, admin, actif, renommage propagé) · emploi du temps détaillé (matière, prof, salle, semaine A/B, copie de journée) · bibliothèque de plats (emoji, catégorie, ingrédients, fusion de doublons) · appareils enrôlés révocables · réglages en base · envoi de notifications.

**Reste à faire quand le besoin viendra** (le périmètre pressenti au 13/08, moins ce qui est déjà livré) :
- **Migrer les derniers réglages du `.env` vers la table `reglages`** : URL de l'agenda, flux RSS, `PLANNING_EXEMPLE`, coordonnées météo, délai de veille. La table et l'écran existent, seules trois clés y sont branchées ; le reste est encore lu depuis `.env` au démarrage.
- Choix des **tuiles affichées** et de leur ordre ; activation/désactivation des modules (actus, météo, musique…).
- Journal d'erreurs (ICS injoignable, RSS HS) — aujourd'hui uniquement dans la console serveur.
- **Photo de plat** : le champ `photo` existe, rien ne l'alimente. Il faudra un envoi de fichier et un stockage local — la règle « sans CDN » interdit de pointer une URL distante.
⚠️ Le back-office gère la **configuration**, pas les données du quotidien : courses, menu, tâches et post-it se saisissent sur l'écran mural et dans l'app, pas ici.

## 5 quater. Piste commerciale (réflexion de Rémi, 14/08/2026 — rien d'engagé)
Idée : produit vendable, avec back-office et serveur hébergé (le Mac mini servant de première plateforme).

**Position de Rémi (14/08/2026), en réponse aux obstacles ci-dessous :**
- **Notion n'est qu'un test.** Cible = **autonomie totale sur les données** (base propre), pour pouvoir faire évoluer le produit librement. ⇒ L'obstacle n°1 est donc **assumé et planifié**, pas subi.
- Le **Mac mini est transitoire** ; à terme, **serveur cloud** ailleurs.
- **Authentification prévue**, et volonté d'un **hébergement français** comme garantie sur les données.
- **Aujourd'hui = POC familial**, rien n'est engagé.

### 🎯 Positionnement retenu (Rémi, 14/08/2026, après étude de FamilyWall)
Analyse de FamilyWall par Rémi : **beau rendu, mais app seulement** (pas d'écran mural adaptable) et **synchro Google Calendar uniquement, pas iCloud**.
⇒ Positionnement visé : **hub familial Apple-first**, avec **deux environnements complémentaires** :
1. **Téléphone** — une app dans l'esprit FamilyWall (onglets Courses / Menu / À faire…).
2. **Mural** — l'écran tactile portrait, dont **le visuel doit être excellent** (c'est le vrai différenciateur, personne ne le fait bien).
Écosystème **iCloud / iPhone en priorité**, Google plus tard.

### ⚠️ Tension structurelle à trancher tôt : « Apple en profondeur » vs « hébergé dans le cloud »
Ces deux objectifs se contredisent partiellement. Ce qui est accessible **depuis un serveur cloud** :
- ✅ **Calendriers iCloud** — CalDAV avec mot de passe d'application, ou lien .ics publié (déjà en place). Fonctionne de partout.
- ✅ **« Se connecter avec Apple »** pour l'authentification — excellent choix pour un produit Apple-first.
- ❌ **iMessage** — impossible sans un Mac (AppleScript local uniquement).
- ❌ **Notes** — aucune API publique.
- ❔ **Rappels** — CalDAV VTODO historiquement, fiabilité actuelle à vérifier.

⇒ **Conséquence produit** : un hub « Apple en profondeur » (Rappels, iMessage, Notes) suppose **un Mac au domicile de chaque client** — modèle « box », coûteux. Une version 100 % cloud doit se limiter aux **calendriers + Sign in with Apple**. Le Mac mini de Rémi permet la version profonde **chez lui** ; il faudra choisir ce qui est promis aux clients. **Décision à prendre avant d'écrire la moindre ligne de code commercial.**

**Obstacles identifiés, par ordre de gravité :**
1. **Notion est un blocage structurel.** Données dans l'espace Notion de Rémi, token et IDs de bases en dur, noms de propriétés exacts requis. Un client devrait recréer 6 bases à l'identique → irréaliste. Commercialiser = **remplacer la couche données** par une base multi-tenant (Postgres), et donc **reconstruire** l'édition depuis mobile qu'offrait Notion gratuitement.
2. **Auto-hébergement non viable pour des clients** (connexion résidentielle, IP dynamique, pas de redondance, responsabilité d'hébergeur). Mac mini = dev/famille uniquement ; il faudrait un hébergeur UE.
3. **RGPD** : agendas, habitudes alimentaires et **plannings scolaires de mineurs**. Politique de confidentialité, base légale, hébergement UE, droit à l'effacement, registre.
4. **⚠️ Propriété intellectuelle** : le projet est développé sur une machine dont Rémi n'est pas admin, sur réseau d'entreprise. Risque de revendication employeur / clause d'exclusivité. **Migrer sur du matériel personnel avant tout développement à visée commerciale.**
5. **Marché occupé** : Skylight Calendar, Hearth Display, DAKboard, Cozi, FamilyWall. Angle différenciant possible : français/local (fête du jour, RSS, iCloud), portrait tactile, sans cloud obligatoire.

**Étapes suggérées :** (1) finir pour la famille et l'éprouver quelques semaines ; (2) **test décisif — l'installer chez un ami** : révèle tout le codé en dur (`FAMILY`, `COULEURS`, coordonnées de Roubaix, IDs Notion) ; (3) seulement ensuite, multi-tenant + hébergement + statut juridique.

**Réflexes à adopter dès maintenant (coût nul) :** ne rien coder en dur de spécifique au foyer (tout en configuration), et **isoler l'accès aux données derrière une couche unique** pour qu'échanger Notion contre Postgres ne touche qu'un fichier.

**Prochaine étape technique concrète (proposée, non faite) : extraire une couche `donnees/`.**
Aujourd'hui les appels `notion.*` sont dispersés dans tout `server.js`. Les regrouper derrière une interface neutre (`listerCourses`, `ajouterCourse`, `cocherCourse`, `supprimer`…) avec deux implémentations interchangeables (`notion.js`, puis `sqlite.js`/`postgres.js`) permet de basculer sans toucher aux routes ni au front. **À faire tant que le code est petit** — le coût double à chaque fonctionnalité ajoutée.

**⚠️ Précision sur la souveraineté des données** : « hébergé en France » ≠ « souverain ». Une région française d'un fournisseur **américain** (AWS Paris, Azure France, Google Cloud) reste soumise au **CLOUD Act**. Pour une vraie garantie : fournisseur de **droit français** — OVHcloud, Scaleway, Clever Cloud, Outscale. C'est ce point-là qui est défendable commercialement, pas la simple localisation géographique.
❔ **À vérifier avant d'en faire un argument** : l'hypothèse « aucune solution française n'existe » n'est pas établie. FamilyWall semble avoir des origines françaises (à confirmer), et l'angle « français » est un argument plus fort en B2B qu'en grand public — pour une famille, la simplicité prime. **L'angle réellement différenciant serait plutôt « pas de cloud obligatoire, les données restent chez vous ».**

## 6. Garde-fous
- 🔴 **`maison.db` est désormais la SEULE copie des données de la famille.** Avant la bascule, Notion tenait lieu de filet ; ce n'est plus le cas. **Sauvegarder avant toute opération risquée** et avant le passage au Mac mini :
  `node outils/sauvegarder.js` → copie datée dans `sauvegardes/` (via `VACUUM INTO`, donc cohérente même serveur allumé ; les 30 dernières sont conservées).
- 🔴 **LE CODE AUSSI se sauvegarde** — leçon de la quarantaine du 18/08 (§ 2 sexies) : la base était protégée, le code non, et 13 fichiers sont partis en une nuit.
  `sauvegarder-tout.cmd` → base + archive `.zip` du projet dans **`C:\temp\maison-coffre\`**, hors du dossier projet. Tâche planifiée quotidienne à 12:30 déjà installée.
  ⚠️ Même disque : copier le coffre de temps en temps sur une clé USB ou un disque **perso** (pas le OneDrive de l'entreprise, § 5 quater n° 4). L'archive contient `.env` et `maison.db` — **elle ne se partage pas**.
- ⚠️ **Ne pas relancer de captures d'écran par Chrome sans écran depuis PowerShell sur ce poste** : c'est exactement ce qui a déclenché SentinelOne. Si un contrôle visuel est indispensable, demander à Rémi de regarder l'écran — c'est plus rapide et sans risque.
- Travailler **uniquement** dans `C:\temp\maison`.
- **Ne jamais** committer/exposer le `.env` (token Notion) **ni `maison.db`** (données de la famille).
- **Ne pas** afficher l'agenda pro, ni toucher au « Second Cerveau ».
- Garder l'app **portable** (aucune dépendance spécifique Windows qui empêcherait le passage sur Mac).

## 7. Pour reprendre
1. Lis ce fichier + `SETUP.md`. **Commence par le § 2 sexies** si quelque chose semble manquer sur le disque.
2. **Sauvegarde d'abord** : `sauvegarder-tout.cmd` (base + code). C'est trente secondes, et le § 2 sexies dit pourquoi.
3. Vérifie que le serveur répond : `GET /api/health` → `{ok:true, source:"sqlite", adresses:[…]}`. Pas de `pm2` sur ce poste (pas de droits admin) — le serveur se lance par `demarrer-maison.cmd`.
4. Puis prends l'item de la feuille de route que Rémi te demande.
