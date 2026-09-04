# 🖥️ Installer Écran Maison sur le Mac mini

> Le Mac mini devient **le serveur** : il héberge le code, la base, l'API et le temps réel.
> Le Raspberry ne fait qu'**afficher** — voir `INSTALL-RASPBERRY.md`.
> Compte prévu : ~1 h, dont beaucoup d'attente. Rien n'est irréversible : le PC continue de tourner tant que tu n'as pas éteint son serveur.

---

## 0. Ce qu'il faut avoir sous la main

Trois choses **ne sont pas dans le dépôt GitHub**, volontairement (§ 2 sexdecies). Il faut les apporter du PC :

| Fichier | Pourquoi il n'est pas sur GitHub | Sans lui |
|---|---|---|
| `.env` | clé Anthropic + token Notion **en clair** | pas d'IA, pas de vocal |
| `maison.db` | **la seule copie** des données du foyer | écran vide |
| `public/plats/` | 8,5 Mo de photos récupérées sur des sites de cuisine | vignettes manquantes (régénérables) |

👉 **Prépare une clé USB** avec ces trois éléments, ou fais tourner `sauvegarder-tout.cmd` sur le PC et emporte la dernière archive de `C:\temp\maison-coffre\` : elle contient tout, `.git` compris.

---

## 1. Préparer le Mac — 5 minutes qui évitent des heures

### 1.1 Donner un nom court au Mac

L'écran mural pointera sur un **nom**, jamais une IP : elle a déjà changé trois fois dans ce projet.

```bash
sudo scutil --set LocalHostName maison
sudo scutil --set ComputerName "Maison"
```

⚠️ **Pas d'accent, pas d'espace, pas d'apostrophe.** Le nom par défaut (`Mac-mini-de-Rémi`) donnerait un `.local` bancal. Après ça, le Mac répond sur **`maison.local`**.

Vérifie : `ping maison.local` depuis un autre appareil du réseau.

### 1.2 Empêcher le Mac de dormir

Un serveur qui dort, c'est un écran mural qui affiche « impossible de joindre le serveur » à 7 h du matin.

```bash
sudo pmset -a sleep 0            # jamais de veille système
sudo pmset -a disksleep 0        # ni des disques
sudo pmset -a autorestart 1      # redémarre tout seul après une coupure de courant
sudo pmset -a womp 1             # se réveille sur le réseau
pmset -g                         # vérifier
```

L'écran du Mac peut s'éteindre, ça n'a aucune importance — c'est `displaysleep` et il n'affecte pas le serveur.

### 1.3 Réseau

- **Ethernet** si possible : c'est lui le serveur.
- **Réservation DHCP** sur la box pour le Mac (et pour le Pi). Même avec `maison.local`, une IP stable sauve la mise le jour où le mDNS boude.
- **Aucune redirection de port, pas de DMZ, pas d'UPnP.** L'accès hors maison passe par Tailscale (§ 8), qui n'ouvre rien.

---

## 2. Node

Il faut **Node ≥ 22.5** : c'est la version qui embarque `node:sqlite`, et c'est ce choix qui a rendu tout le projet possible sans compiler le moindre module natif.

Le plus simple : le paquet officiel **LTS** sur [nodejs.org](https://nodejs.org). Ou, si tu prends Homebrew (utile plus tard pour Piper et ffmpeg) :

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install node
```

Vérifie — les deux lignes comptent :

```bash
node -v                                    # doit afficher v22.5 ou plus
node -e "require('node:sqlite'); console.log('sqlite intégré : OK')"
which node                                 # note ce chemin, il servira au § 6
```

---

## 3. Récupérer le projet

**Chemin recommandé : copier le dossier depuis le PC.** Il apporte le code, `.env`, `maison.db`, les photos **et** l'historique Git d'un coup.

```bash
mkdir -p ~/maison
# depuis la clé USB (adapter le nom du volume)
rsync -av --exclude node_modules /Volumes/CLE/maison/ ~/maison/
cd ~/maison
```

<details>
<summary>Variante : cloner depuis GitHub</summary>

```bash
brew install gh && gh auth login
gh repo clone RROrdc/Maisonconnect-e ~/maison
cd ~/maison
# puis copier À LA MAIN depuis la clé : .env, maison.db, public/plats/
```
Le dépôt est privé, il faut donc une authentification. Cette variante a un mérite : elle **prouve** que le dépôt est complet.
</details>

### ⚠️ Si `git status` annonce que tous les fichiers sont modifiés

C'est un artefact Windows (fins de ligne CRLF), pas une vraie modification :

```bash
git config core.autocrlf input
git rm --cached -r . >/dev/null && git reset --hard
git status          # doit être propre
```

---

## 4. Dépendances, réglages, premier démarrage

```bash
cd ~/maison
npm ci                       # reconstruit node_modules à l'identique
```

### Relire le `.env` — trois points, deux pièges

```bash
nano .env
```

| Clé | Valeur | Pourquoi |
|---|---|---|
| `SOURCE` | `sqlite` | Notion n'est plus qu'une archive figée |
| `DB_FICHIER` | **vide** | 🔴 un chemin `C:/temp/...` ferait créer une base **VIDE, sans message d'erreur** |
| `PORT` | `8090` | le conflit avec `whatsapp-bridge` était propre au PC, mais autant garder la même adresse partout |
| `ANTHROPIC_API_KEY` | **à régénérer** | 🔴 la clé actuelle a été collée en clair dans une conversation — [console.anthropic.com](https://console.anthropic.com) |

Tout le reste (agenda, météo, actus, veille, modèle d'IA, voix) vit **en base** depuis le 19/08 et se règle dans `/admin/ → Réglages`, sans toucher à un fichier ni redémarrer.

### Démarrer

```bash
npm start
```

Au démarrage, le serveur **affiche ses adresses**. Tu dois voir apparaître `http://maison.local:8090`.

macOS demandera *« Voulez-vous autoriser node à accepter les connexions entrantes ? »* → **Autoriser**. Sans ça, le Pi et les iPhone ne verront rien alors que tout marche en local.

### Les trois vérifications qui comptent

```bash
curl -s localhost:8090/api/health          # {"ok":true,"source":"sqlite",...}
```

1. Ouvre **`http://maison.local:8090/bento.html`** dans Safari → l'écran mural, identique au PC.
2. Ouvre **`http://maison.local:8090/admin/`** → le back-office (code : celui de Rémi).
3. Depuis un iPhone du réseau : **`http://maison.local:8090/app/`** → l'app famille, **déjà enrôlée** (le jeton est dans le téléphone, la base l'a suivi).

```bash
npm test          # 249 vérifications, ~8 s — le vrai feu vert
```

> 🔴 **Tant que `npm test` n'est pas vert, ne passe pas à la suite.** C'est le seul contrôle qui couvre le portage lui-même : chemins, accents, base, temps réel.

### Éteindre le serveur du PC

Une fois l'écran vérifié sur le Mac, **arrête le serveur du PC**. Deux serveurs sur deux bases divergentes, c'est une famille qui coche une course qui réapparaît le lendemain.

---

## 5. Démarrage automatique au boot

Le fichier est dans le dépôt : `outils/mac/fr.maison.serveur.plist`. C'est un **LaunchDaemon**, pas un LaunchAgent — un Agent ne démarre qu'à l'ouverture de session, et un Mac mini qui redémarre seul après une coupure n'ouvre jamais de session.

```bash
cd ~/maison
sed -e "s|__NODE__|$(command -v node)|" \
    -e "s|__CHEMIN__|$HOME/maison|" \
    -e "s|__UTILISATEUR__|$(whoami)|" \
    outils/mac/fr.maison.serveur.plist > /tmp/fr.maison.serveur.plist

sudo cp /tmp/fr.maison.serveur.plist /Library/LaunchDaemons/
sudo chown root:wheel /Library/LaunchDaemons/fr.maison.serveur.plist
sudo launchctl load -w /Library/LaunchDaemons/fr.maison.serveur.plist
```

**Le seul test qui vaut** : `sudo reboot`, attendre, puis depuis un autre appareil `curl http://maison.local:8090/api/health`. Un démarrage automatique qu'on n'a pas éprouvé par un vrai redémarrage n'est pas installé, il est espéré.

Journal en cas de souci : `tail -f ~/maison/serveur.log`

---

## 6. Sauvegardes — la règle rouge du projet

`sauvegarder-tout.cmd` ne tourne que sous Windows. Son équivalent est dans le dépôt : `outils/sauvegarder-tout.sh`.

```bash
chmod +x ~/maison/outils/sauvegarder-tout.sh
~/maison/outils/sauvegarder-tout.sh
ls -lh ~/maison-coffre/            # l'archive doit être là
```

Puis la quotidienne, à 12:30 comme sous Windows :

```bash
sed -e "s|__CHEMIN__|$HOME/maison|" \
    -e "s|__UTILISATEUR__|$(whoami)|" \
    -e "s|__MAISON__|$HOME|" \
    outils/mac/fr.maison.sauvegarde.plist > /tmp/fr.maison.sauvegarde.plist
sudo cp /tmp/fr.maison.sauvegarde.plist /Library/LaunchDaemons/
sudo chown root:wheel /Library/LaunchDaemons/fr.maison.sauvegarde.plist
sudo launchctl load -w /Library/LaunchDaemons/fr.maison.sauvegarde.plist
sudo launchctl start fr.maison.sauvegarde     # déclencher tout de suite pour vérifier
```

💡 `launchd` **rattrape** un rendez-vous manqué au réveil de la machine, là où `cron` l'oublie purement et simplement.

⚠️ Le coffre est sur le **même disque**. Copie-le de temps en temps sur un disque externe. L'archive contient `.env` et `maison.db` : **elle ne se partage pas**, et pas sur le OneDrive de l'entreprise (§ 5 quater, n° 4).

---

## 7. Tailscale — et les trois blocages qui tombent ensemble

Depuis le § 2 ter, trois demandes attendaient le même prérequis : **le HTTPS**. Tailscale le fournit, gratuitement, sans ouvrir un seul port.

```bash
brew install --cask tailscale     # ou l'app depuis le Mac App Store
sudo tailscale up                 # ouvre le navigateur pour se connecter
tailscale status                  # note le nom : maison.<ton-tailnet>.ts.net
```

Dans la [console Tailscale](https://login.tailscale.com/admin/dns) → **DNS** → active **HTTPS Certificates**. Puis :

```bash
sudo tailscale serve --bg 8090
tailscale serve status            # https://maison.<tailnet>.ts.net → localhost:8090
```

🔴 **`tailscale serve`, jamais `tailscale funnel`.** `serve` publie sur ton réseau privé uniquement ; `funnel` publierait sur l'Internet public — les agendas et emplois du temps des enfants n'ont rien à y faire.

### Ce que ça débloque, concrètement

Installe Tailscale sur chaque iPhone (leurs appareils sous ton compte, le plan perso gratuit suffit), puis ouvre `https://maison.<tailnet>.ts.net/app/` et **Partager → Sur l'écran d'accueil**.

| Avant, en HTTP | Maintenant |
|---|---|
| App sur le Wi-Fi maison | **partout**, sans rien ouvrir |
| Repli hors ligne bricolé en `localStorage` | vrai cache service worker |
| Code PIN | **Face ID** (la colonne `passkey` attend en base depuis le § 2 ter) |
| Notification seulement si l'app est ouverte | **push iOS téléphone verrouillé** (table `abonnements_push`, créée, vide, prête) |

Le code s'active tout seul : l'enregistrement du service worker est conditionné à `location.protocol === 'https:'`.

---

## 8. À faire ensemble, une fois le Mac debout

Ces deux points ne sont **volontairement pas** dans ce guide : il n'y a ni macOS ni HomeKit sur le PC, et le projet a une règle — *un adaptateur qu'on ne peut pas exécuter, ce sont des bugs qu'on découvre au pire moment.*

- **Redimensionner les photos de plats.** 8,5 Mo pour 36 vignettes de 36 px : c'est le seul vrai gain de performance identifié pour le Pi. `sharp` devient installable (tu es admin sur ton Mac) — l'outil reste à écrire, et à écrire **là où on peut le lancer**.
- **Netatmo, AirPlay, HomeKit** (items 4, 5 et 9 de la feuille de route). Home Assistant couvre les trois d'un coup ; la forme du code est déjà connue — un dossier `maison/` bâti comme `donnees/`, et **une action de plus** dans la liste fermée de `vocal/`.
- **Le Roomba Plus 515 Combo** (reçu le 04/09/2026) — voir le § 9 ci-dessous : le chemin est tranché, il ne reste qu'à l'exécuter sur place.
- **Le lave-linge Samsung** (SmartThings) — **à ne pas commencer avant novembre 2026**, voir § 9 également.

---

## 9. Roomba et SmartThings — ce qui est possible, et ce qui ne l'est pas

Deux appareils sont arrivés dans la maison après l'écriture de ce guide. Les deux ont été
étudiés le 04/09/2026 **avant** d'écrire une ligne de code, et le résultat n'est pas celui
qu'on espérait. Autant le savoir ici plutôt que le découvrir un dimanche.

### 🤖 Roomba Plus 515 Combo + AutoWash Dock — cloud uniquement

⚠️ **Ne pas confondre avec les « séries 500 » d'iRobot des années 2000** (sans Wi-Fi) : le 515
appartient au renumérotage de 2025 (105, 205, 405, 505, 515, 575…).

| | 515 Combo |
|---|---|
| Matter | ❌ **vérifié dans l'app iRobot par Rémi : absent** |
| Apple Home / HomeKit | ❌ |
| SmartThings | ❌ |
| Connexion **locale** (intégration `roomba` de HA) | ❌ — la série x05 ne l'expose plus |
| Alexa · Google · **Raccourcis Siri** | ✅ |

🔑 **Le « Siri » annoncé par iRobot n'est PAS HomeKit** : ce sont des **Raccourcis Siri** exposés
par l'app iRobot Home. C'est une distinction qui change tout — et, heureusement, c'est aussi la
voie la plus simple ici.

**⇒ Le chemin retenu : `shortcuts run` depuis Node**, c'est-à-dire exactement l'option 1 déjà
documentée dans `VOCAL.md` § « Piloter la maison ». Rien de nouveau à concevoir : un dossier
`maison/` bâti comme `donnees/`, une action de plus dans la liste fermée de `vocal/`.

**À faire sur place, dans cet ordre :**
1. Dans l'app iRobot Home sur l'iPhone : créer les Raccourcis Siri voulus (« Passer l'aspirateur »,
   « Aspirateur cuisine »…). Ils se synchronisent sur le Mac par iCloud.
2. Sur le Mac : `shortcuts list` doit les montrer. Puis `shortcuts run "Passer l'aspirateur"`.
3. Si et seulement si ça répond : écrire `maison/macos.js` et brancher l'action vocale.

⚠️ **Ce qu'on n'aura PAS, et il faut le dire à la famille plutôt que de le laisser découvrir :**
- **Aucune notification du robot sur le mur** (bac plein, robot bloqué, brosse à changer). Ces
  événements demandent un accès local ou une API d'écoute — il n'y en a pas. C'était pourtant
  l'usage le plus intéressant pour un écran de cuisine.
- **Le bouton sera mort quand Internet tombe.** Ce serait la **première fonction du projet à
  dépendre du cloud d'un fabricant**, alors que tout le reste est local exprès (« l'écran doit
  fonctionner quand Internet tombe »). Ce n'est pas rédhibitoire pour lancer un aspirateur, mais
  c'est une exception à assumer, pas à subir.

💡 **Piste de secours, à essayer mais pas à planifier** : l'intégration HACS
`a-mavrides/roomba_v4` (« Roomba Cloud Integration ») pourrait donner plus. Mais 9 étoiles,
38 commits, un seul auteur, et **aucune mention de la gamme x05** dans sa documentation — donc
le 515 n'est pas un cas connu. Ça vaut dix minutes d'essai une fois HA installé ; ça ne vaut pas
qu'on planifie une fonction dessus. Et même si ça marche, le cloud reste dans la boucle.

### 🧺 Lave-linge Samsung (SmartThings) — bonne idée, mauvais moment

Techniquement c'est le meilleur candidat de la maison : Samsung expose ses lave-linge dans
SmartThings avec la capacité `washerOperatingState` (état **et** heure de fin), Home Assistant a
une intégration SmartThings **officielle** (pas un bricolage communautaire), et
« linge terminé → notification sur l'écran » est exactement la forme de `/api/notif`, qui existe
déjà et sait réveiller la veille.

🔴 **Mais Samsung met fin à l'accès gratuit à l'API SmartThings en octobre 2026**, avec un
« Personal Plan » annoncé à 4,99 €/mois pour les particuliers. Les quotas exacts n'ont pas été
publiés, et **on ne sait pas encore** si l'intégration officielle de Home Assistant — qui passe
par OAuth en tant qu'application enregistrée — tombe sous ce plan ou non.

⚠️ **Un piège concret déjà signalé** (issue `home-assistant/core#146959`) : depuis HA 2025.6, les
entités du lave-linge deviennent *indisponibles* peu après l'extinction de l'appareil. Or **une
machine s'éteint en fin de cycle** — c'est-à-dire pile à l'instant qu'on veut détecter. À
vérifier en une lessive avant d'écrire quoi que ce soit.

**⇒ Décision : ne rien construire côté SmartThings avant que novembre 2026 soit là.** Écrire un
adaptateur pour une API dont on ignore le prix et les quotas, c'est du travail à refaire. En
revanche, **brancher l'intégration tant qu'elle est gratuite et regarder une lessive complète**
coûte cinq minutes et tranchera la question.

### 💡 Ce qu'il faut retenir des deux

**Le mur est déjà prêt.** `POST /api/notif` est un simple appel HTTP : n'importe quoi capable
d'envoyer une requête peut afficher « Le linge est terminé » sur l'écran et réveiller la veille.
Le projet n'a donc pas à choisir sa source de domotique aujourd'hui — il a seulement besoin que
cette source sache parler HTTP. C'est ce qui permet d'attendre sans rien bloquer.

---

## ✅ Récapitulatif — coche au fur et à mesure

- [ ] `maison.local` répond depuis un autre appareil
- [ ] Le Mac ne dort plus, redémarre seul après coupure
- [ ] `node -v` ≥ 22.5 et `node:sqlite` se charge
- [ ] `.env` relu : `DB_FICHIER` **vide**, clé Anthropic **régénérée**
- [ ] `npm ci` puis `npm start` — le bento s'affiche
- [ ] `npm test` → **332/332**
- [ ] Serveur du PC **éteint**
- [ ] LaunchDaemon installé et **vérifié par un vrai `sudo reboot`**
- [ ] Sauvegarde manuelle OK, quotidienne installée et déclenchée une fois
- [ ] Tailscale : `serve` (jamais `funnel`), un iPhone testé en HTTPS
- [ ] Roomba : `shortcuts run "…"` répond depuis le Mac (§ 9) — sinon, ne pas écrire l’adaptateur
- [ ] SmartThings : une lessive complète observée dans HA **avant** octobre 2026 (§ 9)

---

## 🔧 Dépannage

| Symptôme | Cause la plus probable |
|---|---|
| L'écran est **vide** mais l'API répond | `DB_FICHIER` pointe ailleurs → une base neuve a été créée. Le laisser **vide**. |
| `maison.local` marche sur le Mac, pas ailleurs | Pare-feu macOS (autoriser `node`), ou **isolation des clients** sur le Wi-Fi de la box. |
| Tous les fichiers « modifiés » dans git | Fins de ligne Windows → § 3. |
| Le daemon ne démarre pas | Chemin de `node` erroné dans le plist. `tail -f ~/maison/serveur.log`, puis `which node`. |
| L'app iPhone redemande le prénom | `maison.db` n'a pas été copié : le jeton du téléphone ne correspond à aucun appareil. |
| Erreur 401 dans `/admin/` | Normal après 12 h — les sessions expirent. Se reconnecter, ou `node outils/admin.js`. |
