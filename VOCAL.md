# 🗣️ Parler à la maison

Trois façons d'utiliser la même chose. Toutes appellent **une seule route** :

```
POST /api/vocal   { "texte": "ajoute du lait aux courses" }
   → { "reponse": "C'est noté, lait est sur la liste.", "action": "ajouter_course", "fait": true }
```

C'est volontaire : le jour où un vrai micro sera branché sur le Mac mini, il appellera
exactement cette route. Rien de ce qui suit ne sera à refaire, seulement à brancher.

---

## 1. Tout de suite, sans rien installer — `/vocal.html`

Ouvre **`http://localhost:8090/vocal.html`** *sur la machine qui fait tourner le serveur*.

- Bouton **Parler** : appuie, parle, la maison répond à voix haute.
- Bouton **Mode « Jarvis »** : le micro reste ouvert et seule une phrase commençant par
  *« Jarvis… »* est transmise. Tout le reste de ce qui se dit dans la pièce est ignoré et
  ne quitte jamais la machine.
- Des phrases d'exemple cliquables, qui marchent même sans micro.

### 🔑 Si le micro « ne marche pas » : le remède qui a fonctionné ici

Symptôme : le journal technique de la page répète **`micro erreur : no-speech`** et n'affiche
**aucune ligne « transcription »**. Le micro s'ouvre, Chrome n'entend rien, et rien n'indique
pourquoi — les autorisations Windows sont bonnes, le périphérique est actif.

👉 **Passe un appel test dans Teams (ou une autre visio), raccroche, reviens sur la page.**

Ouvrir puis relâcher le micro depuis une visio **réinitialise l'entrée audio de Windows**.
Tant que personne ne l'a réellement activée, Chrome capture un flux muet **sans lever la
moindre erreur**. C'est contre-intuitif, ça ne se voit dans aucun réglage — et c'est ce qui a
débloqué la première mise en service.

Si ça ne suffit pas, dans l'ordre : touche de coupure micro du clavier (souvent F4, avec une
diode) · *Paramètres → Son → Entrée* (bon périphérique par défaut ? volume à 0 ?) ·
*Confidentialité → Microphone → applications de bureau* · une visio restée ouverte.

Le bouton **🎙️ Tester le micro** tranche en dix secondes : si la barre de niveau bouge quand
tu parles, le son entre ; sinon, il n'entre pas.

⚠️ **Deux limites de navigateur, pas du projet :**

| | |
|---|---|
| **Micro = contexte sécurisé** | HTTPS **ou localhost**. Depuis la tablette murale en `http://192.168.x.x`, le micro est bloqué. Depuis la machine elle-même, il fonctionne sans certificat. |
| **Transcription = Chrome / Edge** | Safari n'implémente pas la reconnaissance vocale. La lecture à voix haute, elle, marche partout. |

👉 Conséquence heureuse pour la suite : **écran branché sur le Mac mini = `localhost` = micro
autorisé sans certificat.** C'est le montage le plus simple pour un assistant mural.

---

## 2. Depuis l'iPhone — Raccourci Siri

À créer **sur le téléphone** (je ne peux pas le faire à distance). Cinq minutes.

1. Ouvre **Raccourcis** → **+** (nouveau raccourci).
2. Ajoute l'action **« Dicter le texte »**. Dans ses options, langue = **Français**.
3. Ajoute **« Obtenir le contenu de l'URL »** :
   - **URL** : `http://192.168.10.111:8090/api/vocal`
   - Déplie **Afficher plus** :
     - **Méthode** : `POST`
     - **Corps de la requête** : `JSON`
     - Ajoute un champ — Clé `texte`, type **Texte**, valeur = **Texte dicté** (la variable
       de l'étape 2).
     - Ajoute un second champ — Clé `who`, type **Texte**, valeur `Rémi` *(dit au système
       qui parle : les tâches et les post-it seront signés)*.
4. Ajoute **« Obtenir la valeur du dictionnaire »** → clé `reponse`.
5. Ajoute **« Énoncer le texte »** → la valeur de l'étape 4.
6. Renomme le raccourci **« Jarvis »**.

Ensuite : *« Dis Siri, Jarvis »* → il demande quoi faire, tu parles, il répond.

**À la première utilisation**, iOS demande l'autorisation d'accéder au **réseau local** :
accepter, sinon la requête échoue en silence.

⚠️ **L'adresse IP change avec le réseau Wi-Fi** (c'est arrivé trois fois sur ce projet :
`10.31.95.95` → `192.168.10.108` → `192.168.10.111`). Le raccourci cassera le jour où elle
changera. Deux remèdes : une **réservation DHCP** sur la box, ou attendre le Mac mini et
Tailscale, qui donne un nom stable. L'adresse du moment s'affiche au démarrage du serveur
et dans `GET /api/health`.

---

## 3. Le montage réel : dalle 21,5" + Raspberry en cuisine, Mac mini serveur

Matériel commandé : **écran tactile 21,5" piloté par un Raspberry**, **Mac mini** serveur sur
le même réseau. C'est un bon montage — mais il déplace le problème du micro, et il faut le
savoir avant de câbler.

### ⚠️ Le micro du navigateur ne s'ouvrira PAS sur le Raspberry

Le Chromium du Raspberry affichera `http://<mac-mini>:8090/bento.html` : une origine **HTTP
distante**, donc **pas de contexte sécurisé**, donc **pas de micro**. Ce n'est pas contournable
par un réglage — c'est une règle du navigateur.

Trois issues, de la meilleure à la plus expédiente :

| # | Solution | Ce que ça demande | Ce que ça donne |
|---|---|---|---|
| **1** | **Le son ne passe pas par le navigateur.** Un petit service sur le Raspberry écoute le micro, détecte le mot d'éveil, et appelle `/api/vocal`. Le navigateur ne fait qu'**afficher**. | Porcupine + capture audio sur le Pi | 🥇 **La bonne réponse.** Aucun HTTPS nécessaire, mot d'éveil détecté **hors ligne**, et l'écran reste un simple afficheur. |
| **2** | **Mandataire local sur le Pi** : `socat`/nginx écoute `localhost:8090` et renvoie vers le Mac. Le navigateur croit être sur `localhost` → contexte sécurisé. | 1 ligne de configuration | Débloque le micro **sans certificat**. Utile pour essayer avant de monter la solution 1. |
| **3** | **HTTPS via Tailscale** sur le Mac (`tailscale cert`) | Tailscale sur les deux machines | Débloque le micro **et** Face ID **et** le push iOS. À faire de toute façon pour l'accès hors maison. |

### Répartition recommandée des rôles

```
  ┌── Raspberry (cuisine) ─────────┐        ┌── Mac mini (serveur) ──────────┐
  │  Chromium en kiosque → bento   │        │  server.js + maison.db          │
  │  Micro + haut-parleur          │        │  whisper.cpp  (voix → texte)    │
  │  Porcupine : mot d'éveil       │──audio→│  /api/vocal   (compréhension)   │
  │    (100 % local, rien ne sort  │←texte──│  say / Piper  (texte → voix)    │
  │     tant qu'on n'a pas parlé)  │        │  Home Assistant → HomeKit       │
  └────────────────────────────────┘        └─────────────────────────────────┘
```

**Pourquoi couper là** : le Raspberry est excellent pour le mot d'éveil (Porcupine est fait
pour ça, quelques % de CPU) mais poussif pour transcrire du français ; le Mac mini transcrit
en une fraction de seconde. Chacun fait ce qu'il sait faire, et le mot d'éveil reste **local**
— rien ne quitte la cuisine tant que « Jarvis » n'a pas été prononcé.

### Deux réglages à ne pas oublier

- **Adresse du kiosque : un NOM, pas une IP.** L'adresse de ce serveur a déjà changé trois
  fois (`10.31.95.95` → `192.168.10.108` → `.111`), et chaque fois elle casserait le favori de
  l'écran. Utiliser `http://<nom-du-mac>.local:8090/bento.html` — macOS publie son nom
  nativement (Bonjour), le Raspberry le résout avec `avahi-daemon`. Le serveur affiche cette
  adresse à son démarrage et l'expose dans `GET /api/health` (champ `nom`).
- **Orientation** : le bento est conçu et validé en **portrait 1080×1920**. Une dalle 21,5"
  est en 1920×1080 : elle devra être **montée et pivotée en portrait**
  (`display_rotate` / `xrandr --rotate`).

### Performance : le bento est déjà léger

Vérifié sur le fichier : **aucun `backdrop-filter`, aucun dégradé radial**, et une seule
animation (le bandeau d'actus) qui n'anime qu'un `transform` — donc composée par le GPU. Les
réserves notées pour la tablette 2 Go ne s'appliquent pas ici.

Le vrai poste de charge, ce sont les **photos de plats** : 22 images, **347 Ko en moyenne,
jusqu'à 1,2 Mo**, affichées en vignettes de 36 px. Le premier chargement tire ~2,5 Mo inutiles ;
ensuite elles sont en cache (`immutable`, leur nom étant l'empreinte de leur contenu).
👉 **À faire sur le Mac mini : redimensionner** (`sharp`, module natif impossible sur le PC
actuel). C'est le seul vrai gain de performance à prévoir.

### 🔍 Les tutoriels « Jarvis en Python » — ce qu'il faut en retenir (et pas)

Le tutoriel de *legeekheureux.fr* monte un assistant en une centaine de lignes :
`speechrecognition` + `pyttsx3` + **Ollama** en local, mot d'éveil `if 'jarvis' in command`.

Sur trois points, c'est **en retrait** de ce qui tourne déjà ici :

| | Le tutoriel | Ici |
|---|---|---|
| Transcription | `recognize_google` → **envoie l'audio à Google** | Chrome aujourd'hui, whisper.cpp local prévu |
| Synthèse | `pyttsx3` → voix système (**espeak** sur un Pi : très robotique) | voix système, **Piper** prévu |
| Mot d'éveil | recherche du mot dans le texte **déjà transcrit** | identique aujourd'hui, **Porcupine** prévu |
| Actions | aucune — le modèle répond, c'est tout | 8 actions réelles, liste fermée, rien de destructif |

Le premier point est le plus gênant : envoyer l'audio à Google **avant** de chercher le mot
d'éveil, c'est exactement ce que l'architecture d'ici cherche à éviter.

💡 **Ce qui vaut la peine d'être retenu : Ollama.** Faire tourner le modèle de compréhension
**en local** supprimerait la dernière dépendance au réseau — aujourd'hui seule la compréhension
sort de la maison. À essayer sur le Mac mini.
⚠️ Avec une réserve honnête : `/api/vocal` repose sur des **sorties structurées** et une **liste
fermée d'actions**, que les petits modèles locaux tiennent moins bien qu'un modèle hébergé. À
mesurer avant de basculer — le réglage `ia_modele_vocal` existe justement pour comparer.

## 4. Plus tard — un vrai « Jarvis » sur le Mac mini

Le montage complet, hors navigateur, entièrement local pour les oreilles et la voix :

| Étage | Outil | Où ça tourne |
|---|---|---|
| Mot d'éveil | **Porcupine** (« Jarvis » est un mot livré d'origine) ou **openWakeWord** | 100 % local |
| Voix → texte | **whisper.cpp** (bon en français, gratuit) | 100 % local |
| Compréhension | `POST /api/vocal` → l'API Anthropic | seule étape qui sort de la maison |
| Texte → voix | la commande **`say`** de macOS, ou **Piper** | 100 % local |

**Ce que ça donne pour la vie privée**, et c'est le point important dans une cuisine :
le micro écoute en permanence, mais la détection du mot d'éveil se fait **sur la machine**.
Rien n'est enregistré, rien n'est envoyé, tant que « Jarvis » n'a pas été prononcé. Seule
la phrase qui suit part vers l'API.

---

## La façon de parler — le style « majordome »

`/admin/ → Réglages → Voix de l'assistant → Façon de parler` : **majordome** (défaut) ou
**neutre**.

Ce qui rend JARVIS reconnaissable n'est pas la vanne, c'est le **vouvoiement**, la **litote**,
la **brièveté**, et le fait d'annoncer ce qui est fait sans jamais s'en vanter :

> — Qu'est-ce qu'on mange ce soir ?
> — **Poisson vapeur et riz, Monsieur.**
>
> — Vide la liste de courses.
> — **Je ne peux pas supprimer la liste depuis la voix ; veuillez le faire directement sur l'écran.**

Trois garde-fous, dans l'ordre :

1. **Utile d'abord.** Une phrase, deux au maximum. Une réponse orale sert à savoir quoi faire.
2. **Jamais aux dépens de quelqu'un.** Le foyer compte quatre enfants : l'**appellation
   (« Monsieur ») et l'ironie sont automatiquement désactivées** quand celui qui parle est un
   enfant — le serveur le sait par son rôle. Vérifié par test.
3. **Le trait d'esprit est rare** — au plus une réponse sur quatre, jamais sur un rappel, une
   échéance ou une urgence.

⚠️ L'article de référence décrit un assistant qui ajoute de l'humour « régulièrement » et
bascule vers le sarcasme. Ça a servi de **contre-exemple** : sur un écran qu'on interroge dix
fois par jour, c'est vite pénible. Le style est réglable, et `neutre` le neutralise entièrement.

Le style ne change **rien** aux règles de sécurité : liste fermée d'actions et aucune
destruction restent en tête de consigne, avant la personnalité.

---

## Choisir la voix — « fluide, moins robotique »

Dans `/vocal.html`, bouton **🎚️ Régler la voix** : choix de la voix, **débit**, **grave/aigu**,
bouton d'essai, et un réglage **🤵 « Jarvis »** qui prend une voix masculine française si le
système en expose une, avec un timbre plus grave et un débit posé. Le choix est mémorisé.

Mais soyons clairs sur ce qui joue vraiment : **la qualité vient du moteur, pas des réglages.**

| Où | Ce que ça donne | Coût |
|---|---|---|
| **Windows** | Voix Microsoft, franchement robotiques. Les curseurs aident un peu, pas plus. | — |
| **macOS, voix système** | Nettement meilleur. Et surtout : *Réglages → Accessibilité → Contenu énoncé → Voix système* permet de télécharger les voix **« améliorées »** et **« premium »**, qui sont d'un autre niveau. **C'est le premier geste à faire sur le Mac mini.** | gratuit |
| **Piper** (local, hors ligne) | 🥇 Synthèse neuronale, très naturelle, **licence MIT**. Voix françaises **masculines** : `fr_FR-tom-medium`, `fr_FR-gilles-low`, `fr_FR-upmc-medium`. Tourne sans réseau. | gratuit |
| **Fish Audio / ElevenLabs** | Le plus proche du timbre du film. | payant, **et chaque phrase sort de la maison** |

### 🥇 Le libre existe, et il est bon : Piper

Le dépôt [`rhasspy/piper-voices`](https://huggingface.co/rhasspy/piper-voices/tree/main/fr/fr_FR)
publie les modèles français sous **licence MIT**, dont plusieurs **voix masculines** (`tom`,
`gilles`, `upmc`) — c'est ce qui manquait, la voix française la plus connue (`siwis`) étant
féminine.

Réglages Piper qui rapprochent du timbre voulu — clair, efficace, légèrement rapide :

```
lengthScale: 0.72     noiseScale: 0.4     noiseWScale: 0.5     sentenceSilence: 0.08
```

Le projet [`novik133/jarvis`](https://github.com/novik133/jarvis) monte exactement
l'architecture recommandée ici — **whisper.cpp + Piper, hors ligne** — ce qui confirme qu'elle
tient debout.

### ⚠️ Ce que la voix clonée implique vraiment

Le modèle Fish Audio « Jarvis | Iron Man » partagé par Rémi est une **voix clonée**, en
**anglais uniquement** (`en`), publiée par un particulier. Trois conséquences :

1. **Elle ne parle pas français.** Pour l'usage visé, elle est hors sujet en l'état.
2. **Le texte sort de la maison** à chaque phrase. Ça contredit frontalement le principe tenu
   partout ici — le mot d'éveil est cherché en local précisément pour que rien ne parte tant
   que « Jarvis » n'a pas été prononcé. Envoyer ensuite chaque réponse à un service tiers pour
   un timbre, c'est un vrai arbitrage.
3. **Aucune licence n'est affichée** sur la fiche. Cloner la voix d'un comédien pour un usage
   privé est une chose, la republier en est une autre.

### 🔍 handy.computer — bon produit, mais il ne fait pas de voix

Vérifié : **Handy fait de la TRANSCRIPTION, pas de la synthèse.** On appuie sur un raccourci, on
parle, le texte est collé dans le champ actif. Il ne propose **aucune voix** — pour « la voix de
Jarvis », il ne répond pas à la question.

Deux autres limites pour ce projet : il est **x64 uniquement** (donc pas de Raspberry Pi), et il
colle le texte dans le champ actif au lieu d'appeler une API — il faudrait quand même passer par
`/api/vocal`.

Ce qu'il apporte quand même : il **confirme l'architecture** retenue ici — MIT, gratuit, 100 %
local (« your voice stays on your computer »), whisper.cpp. Et il révèle **Parakeet V3**, un
moteur optimisé CPU avec détection automatique de langue, à regarder à côté de whisper sur le
Mac mini. Comme dictée générale sur le Mac, c'est un bon outil ; comme brique de l'assistant
mural, non.

👉 **Recommandation : Piper avec `fr_FR-tom-medium`.** Gratuit, local, masculin, licence claire.
Les voix premium de macOS sont le repli immédiat, sans rien installer. Un service en ligne ne
se justifie que si le timbre exact compte plus que le fait de garder les phrases à la maison —
et c'est à Rémi de trancher, pas au code.

⚠️ Une limite qu'Apple impose : **le mot d'éveil de Siri ne se change pas.** Le raccourci peut
s'appeler « Jarvis », il faudra quand même dire *« Dis Siri, Jarvis »*. Le vrai « Jarvis » sans
Apple, c'est la voie du § 3 ci-dessus.

---

## Piloter la maison (HomeKit, Netatmo, musique)

**Oui, la même route peut agir sur la maison** — c'est déjà ce qu'elle fait pour les courses
et le menu. Il manque seulement un exécutant côté domotique, et c'est le rôle du Mac mini.

Trois voies, de la plus simple à la plus complète :

| Voie | Comment | Ce que ça couvre |
|---|---|---|
| **Raccourcis macOS** | `shortcuts run "Allumer le salon"` depuis Node | Tout ce que l'app Maison d'Apple sait faire. Le plus simple, zéro serveur en plus. |
| **Home Assistant** | HA sur le Mac mini, appelé par son API REST | HomeKit **+ Netatmo + AirPlay** d'un coup — déjà prévu aux items 4 et 5 de la feuille de route |
| **Homebridge** | Expose à HomeKit ce qui n'y est pas | Utile seulement pour un appareil récalcitrant |

**La forme du code est déjà connue** : on ajoutera un dossier `maison/` bâti exactement comme
`donnees/` — une interface unique, une implémentation par cible, choisie selon la plateforme.
Sur Windows elle ne fait rien et le dit ; sur macOS elle appelle Raccourcis ou Home Assistant.
Le module `vocal/` n'aura qu'une action de plus dans sa liste fermée.

⚠️ **Pas construit aujourd'hui, et volontairement** : ce code ne peut pas être essayé sur ce PC
— il n'y a ni HomeKit ni macOS. Écrire un adaptateur qu'on ne peut pas exécuter, c'est écrire
des bugs qu'on ne verra qu'au pire moment. Ça se fera le jour où la machine sera là, en une
fois, et testable.

---

## Ce que l'assistant sait faire

| Il fait | Il ne fait pas |
|---|---|
| Ajouter aux courses, cocher un article pris | ❌ **Rien supprimer, rien vider** |
| Ajouter une tâche (pour qui, pour quand) | ❌ Modifier les membres ou les réglages |
| Laisser un post-it | ❌ Enchaîner plusieurs actions d'un coup |
| Fixer le plat d'un midi ou d'un soir | |
| Prévenir la famille (notification) | |
| Répondre : menu, courses, tâches, agenda, planning des enfants, météo | |

**Aucune destruction par la voix, et c'est délibéré.** Une reconnaissance vocale se trompe,
et ce projet a déjà payé deux fois le prix d'une opération de masse lancée trop vite
(la liste de courses vidée, une journée de planning recopiée en double). Cocher un article
se défait d'un doigt ; effacer, non.

**Le modèle n'écrit jamais en base.** Il renvoie une action structurée choisie dans une liste
fermée ; c'est le serveur qui l'exécute après vérification. Un prénom inconnu, une date mal
formée, un jour introuvable : l'action est refusée, pas devinée.

---

## Régler et essayer

```bash
node outils/tester-vocal.js --regles                       # aiguillage local, sans réseau
node outils/tester-vocal.js --lot --sec                    # comprend tout, n'écrit RIEN
node outils/tester-vocal.js --serveur "quel temps il fait ?"   # vrai trajet, écho sur l'écran
```

### Vitesse — mesuré, pas supposé

| | Latence | Régularité |
|---|---|---|
| Tournures courantes (« ajoute … aux courses », « laisse un mot : … ») | **0 ms** | aucune variation — aucun appel réseau |
| `claude-opus-5` | 2,5 – 7,1 s | irrégulière |
| `claude-haiku-4-5` | **1,6 – 2,6 s** | constante |
| Première question après une pause | ~8,5 s | quel que soit le modèle (mise en route de la connexion) |

👉 **Pour la voix, `claude-haiku-4-5` est le meilleur choix**, et pas seulement pour la
vitesse : la régularité compte autant — un délai qui varie du simple au triple donne
l'impression d'une panne. À l'usage il énonce même mieux les nombres (« de huit heures à
midi » plutôt que « 8h-12h »), ce qui se dit mieux à voix haute.

Le réglage est **séparé de celui des recettes** (`/admin/ → Réglages → Modèle IA vocal`) :
une fiche de recette se lit posément, une réponse orale doit arriver tout de suite. Vide =
on reprend le modèle des recettes. Changement pris en compte **sans redémarrer**.

⚠️ **Tous les modèles n'acceptent pas le paramètre `effort`** — Haiku 4.5 le refuse avec un
400. Le code le saute pour les familles concernées et rejoue sans lui si l'API s'en plaint :
changer de modèle dans les réglages ne peut donc rien casser.
- L'échange s'affiche sur l'écran mural dans le bandeau de notification — qui **réveille
  l'écran de veille**, ce qui est exactement le comportement voulu quand on parle à la
  cuisine. Il n'est **pas** conservé dans l'historique des notifications : sinon chaque
  « ajoute du lait » polluerait l'onglet Notifications de toute la famille.
