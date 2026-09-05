# 📺 Installer l'écran mural — Raspberry Pi + dalle tactile 21,5"

> Le Pi **n'héberge rien**. Il ouvre `http://maison.local:8090/bento.html` en plein écran, et c'est tout.
> Le serveur est sur le Mac mini → faire `INSTALL-MAC.md` **d'abord**. Un Pi sans serveur n'a rien à afficher.
> Compte ~45 min, dont deux passages obligés par un redémarrage.

---

## 0. Le matériel — trois pièges avant même d’allumer

Le Pi de la maison est un **Raspberry Pi 4 Model B**.

🔴 **Le câble n’est PAS un câble HDMI ordinaire.** Le Pi 4 a deux ports
**micro-HDMI**. Il faut un cordon **micro-HDMI → HDMI**, ou un adaptateur. C’est
l’oubli le plus courant, et il arrête le montage net. Branche sur le port
**HDMI0**, celui le plus proche de l’alimentation : c’est lui qui sort l’image
au démarrage.

🔴 **L’alimentation doit être une vraie 5 V / 3 A USB-C**, de préférence
l’officielle. Sous-alimenté, le Pi ne s’éteint pas : il *bride* son processeur
et redémarre au hasard. Sur un écran mural, ça se présente comme « l’écran
rame le soir » ou « il a redémarré tout seul cette nuit » — le pire symptôme à
diagnostiquer, parce qu’il ne ressemble pas à un problème électrique. Un
éclair 🗲 en haut de l’écran, ou `vcgencmd get_throttled` qui ne rend pas
`0x0`, confirment le diagnostic.

⚠️ **Prévoir un boîtier avec dissipateur, idéalement ventilé.** Chromium
affichant une page 24 h/24 chauffe un Pi 4, et au-delà de 80 °C il se bride
aussi — même symptôme que ci-dessus, autre cause. `vcgencmd measure_temp`
pendant que le bento tourne dit tout de suite si c’est confortable.

💡 **2 Go de RAM suffisent** largement : le bento est une page légère, sans
flou d’arrière-plan ni dégradé radial (vérifié au § 2 octies).

---

## 1. Système

### 🔴 D'où graver la carte : PAS depuis le PC du travail

Écrire une image sur une carte SD, c'est de l'**accès disque brut**, et sous Windows ça
exige l'**élévation administrateur** — quel que soit l'outil. Imager, Rufus, Etcher,
Win32 Disk Imager : tous butent sur la même barrière. Ce n'est pas une limite des
logiciels, c'est une règle du système. Il n'existe donc pas de version « portable » qui
contournerait ça : elle n'irait pas plus loin.

👉 **Grave la carte depuis le Mac mini** — c'est ta machine, tu y as le mot de passe admin,
et Imager existe pour macOS.

💡 **L'ordre tombe juste tout seul** : le Pi ne sert à rien tant que le Mac ne sert pas la
page — il n'affiche que `bento.html`, servi par le Mac. Monter le Mac d'abord
(`INSTALL-MAC.md`), puis graver la carte depuis le Mac, c'est la séquence naturelle, pas un
contournement.

### 🔴 La SEULE chose à télécharger, c'est l'Imager

**Raspberry Pi Imager** (gratuit, macOS/Windows/Linux) — une cinquantaine de méga-octets,
sur [raspberrypi.com/software](https://www.raspberrypi.com/software/).

**Le système, lui, ne se télécharge pas séparément** : tu le choisis dans une liste À
L'INTÉRIEUR d'Imager, qui va le chercher et l'écrit dans la foulée. Il faut donc être
connecté pendant l'écriture, et compter une dizaine de minutes selon la ligne.

C'est aussi ce qui fait tout l'intérêt de l'outil : il **préconfigure** la carte. Sans ça,
il faut brancher un clavier et un écran sur le Pi pour le premier démarrage — et saisir un
mot de passe Wi-Fi sur une dalle tactile n'est pas une partie de plaisir.

Trois choix, dans cet ordre : **l'appareil** (Raspberry Pi 4), **le système**, **la carte**.

**Système à prendre : `Raspberry Pi OS (64-bit)`** — l'entrée recommandée, en haut de liste,
décrite comme *« with Raspberry Pi Desktop »*.
- ❌ **Pas *Lite*** : il n'y a pas d'environnement graphique, donc pas de Chromium, donc pas de kiosque.
- ❌ **Pas *Full*** : elle embarque LibreOffice et compagnie. Sur une machine qui n'affiche qu'une page web, c'est de la place et des mises à jour pour rien.

<details>
<summary>Si tu tiens à récupérer le fichier image toi-même</summary>

C'est possible — `.img.xz` depuis
[raspberrypi.com/software/operating-systems](https://www.raspberrypi.com/software/operating-systems/),
puis dans Imager : **« Use custom »** en bas de la liste des systèmes.
**La personnalisation fonctionne quand même** : c'est elle qui compte, pas la provenance du
fichier. Utile seulement si la connexion est mauvaise, ou pour réinstaller plusieurs fois
sans retélécharger.
</details>

### La carte SD — le seul choix qui se paiera plus tard

⚠️ **Cet écran tourne 24 h/24.** Une carte SD écrit des journaux en continu, et c'est la pièce qui lâchera en premier — c'est le mode de panne classique d'un Pi en kiosque. Trois façons de s'en prémunir, par ordre d'effort :
- **16 Go minimum, et une carte de marque en classe A2** (SanDisk Extreme, Samsung Pro Endurance). Une carte à trois euros tiendra quelques mois.
- 💡 **Rien n'est stocké sur le Pi** : ni base, ni photos, ni réglages. Tout vit sur le Mac. Une carte morte ne fait donc perdre **aucune donnée** — juste une demi-heure de réinstallation. C'est ce qui rend le risque acceptable.
- Si tu veux ne plus y penser : **démarrer depuis une clé ou un SSD USB** plutôt que la carte. Les Pi 4 et 5 le font nativement.

### ⚙️ L'étape qui change tout : la personnalisation

Imager propose « **Personnaliser les réglages de l'OS** » **avant** d'écrire (c'était un menu caché dans les anciennes versions ; c'est maintenant une étape du parcours, en six écrans). Ne la saute pas.

| Écran | À mettre |
|---|---|
| **Nom d'hôte** | `ecran-cuisine` — c'est ainsi qu'on le joindra : `ecran-cuisine.local` |
| **Localisation** | choisis **Paris** : le fuseau, le clavier **AZERTY** et le domaine radio Wi-Fi en découlent |
| **Utilisateur** | ton identifiant et ton mot de passe (l'utilisateur `pi` par défaut n'existe plus) |
| **Wi-Fi** | SSID + mot de passe **du réseau de la MAISON** — le Pi se connectera seul au premier démarrage |
| **Accès distant** | **active SSH** — c'est par là que le Pi se pilote depuis le Mac, sans clavier ni écran |
| **Raspberry Pi Connect** | facultatif, et inutile ici : le Pi et le Mac sont sur le même réseau |

🔴 **Le piège quand on grave depuis une autre machine** : la carte est configurée AU MOMENT
DE L'ÉCRITURE, pas au démarrage. Le Wi-Fi à saisir est donc celui de la **maison**, pas celui
de l'ordinateur qui grave. Se tromper là, c'est un Pi qui ne rejoint jamais le réseau — et il
faut alors ressortir le clavier et l'écran, c'est-à-dire exactement ce qu'on voulait éviter.

Un récapitulatif confirme « SSH activé » avant d'écrire quoi que ce soit : c'est le moment de vérifier.

⚠️ **Le premier démarrage prend 2 à 3 minutes**, avec parfois un redémarrage automatique : le Pi applique la configuration et étend le système de fichiers. **Ce n'est pas un plantage** — laisse-le finir avant de t'inquiéter.

### Une fois démarré

```bash
sudo apt update && sudo apt full-upgrade -y
sudo apt install -y chromium-browser unclutter curl avahi-daemon
```

`avahi-daemon` est ce qui permet au Pi de résoudre **`maison.local`**. Vérifie tout de suite — c'est le prérequis de tout le reste :

```bash
curl -s http://maison.local:8090/api/health
# {"ok":true,"source":"sqlite",...}
```

<details>
<summary>Si ça ne répond pas</summary>

1. `ping maison.local` — si le nom ne résout pas : `sudo systemctl enable --now avahi-daemon`
2. Toujours rien ? Certaines box isolent les clients Wi-Fi entre eux, et le mDNS ne traverse pas certains répéteurs. Teste avec l'IP : `curl http://192.168.x.x:8090/api/health`
3. Si l'IP marche mais pas le nom : mets l'IP dans `kiosque.conf` **en attendant**, et règle le mDNS après — mais reviens au nom, l'IP finira par changer.
</details>

### Réglages `raspi-config`

```bash
sudo raspi-config
```

- **System Options → Boot / Auto Login → Desktop Autologin** — sans ça, l'écran mural attend qu'on tape un mot de passe.
- **Display Options → Screen Blanking → No** — sinon l'écran noircit au bout de 10 min. La mise en veille du bento (25 min, réglable dans `/admin/`) doit rester **la seule** à décider.

---

## 2. 🔄 Pivoter l'écran en portrait

La dalle est en 1920×1080 ; le bento est validé en **portrait 1080×1920**. Il faut donc la monter tournée.

### La méthode robuste : rotation au niveau du noyau

Elle s'applique à la console **et** à la session graphique, quel que soit le compositeur — et Raspberry Pi OS a changé de compositeur trois fois (LXDE/X11 → wayfire → labwc).

```bash
sudo nano /boot/firmware/cmdline.txt
```

Ajoute **sur la même ligne** (le fichier n'a qu'une ligne, ne jamais en créer une seconde) :

```
video=HDMI-A-1:1080x1920@60,rotate=90
```

Puis `sudo reboot`.

- `rotate=90` ou `rotate=270` selon le sens du support mural — essaie, ça se retourne en 30 s.
- Sur un Pi 5, la sortie utilisée peut être `HDMI-A-2`. `ls /sys/class/drm/` te donne les noms réels.
- ⚠️ `display_rotate=` dans `config.txt` est **obsolète** depuis le passage à KMS. On le trouve encore dans beaucoup de tutoriels : il ne fera rien.

<details>
<summary>Alternative : depuis le bureau</summary>

Menu → Préférences → **Screen Configuration**, clic droit sur l'écran → Orientation. Plus simple, mais le réglage vit dans la session : il se perd si tu changes de compositeur.
</details>

### 🔴 Le piège : le tactile ne tourne PAS avec l'image

C'est le défaut classique de toute installation en portrait — on tourne l'écran, et les doigts atterrissent à 90° de l'endroit visé. Avec la rotation noyau ci-dessus, le tactile suit généralement. **Si ce n'est pas le cas**, ne cherche pas : c'est connu.

<details>
<summary>Corriger le tactile (X11)</summary>

```bash
xinput list                                   # repérer le nom du périphérique tactile
xinput set-prop "NOM_DU_TACTILE" "Coordinate Transformation Matrix" 0 1 0 -1 0 1 0 0 1
```
La matrice ci-dessus correspond à une rotation de 90°. Pour 270° : `0 -1 1  1 0 0  0 0 1`.
Rendre permanent : ajouter la commande dans `~/.config/autostart/` (un second `.desktop`).
</details>

<details>
<summary>Corriger le tactile (Wayland / labwc)</summary>

Dans `~/.config/labwc/rc.xml`, associer le périphérique à la sortie :
```xml
<libinput><device category="touch"><mapToOutput>HDMI-A-1</mapToOutput></device></libinput>
```
</details>

---

## 3. Le kiosque

Le script est **dans le dépôt** — pas tapé à la main sur la carte SD. Une carte SD meurt ; le dépôt, non.

```bash
cd ~ && git clone https://github.com/RROrdc/Maisonconnect-e maison
# (dépôt privé : `gh auth login`, ou simple copie du dossier depuis le Mac par scp)
chmod +x ~/maison/outils/raspberry/kiosque.sh
```

Premier lancement — il crée son fichier de réglages puis s'arrête pour que tu le relises :

```bash
~/maison/outils/raspberry/kiosque.sh
nano ~/maison/outils/raspberry/kiosque.conf     # vérifier URL="http://maison.local:8090/bento.html"
```

Puis le démarrage automatique :

```bash
mkdir -p ~/.config/autostart
cp ~/maison/outils/raspberry/maison-kiosque.desktop ~/.config/autostart/
sed -i "s|/home/pi/|$HOME/|" ~/.config/autostart/maison-kiosque.desktop
sudo reboot
```

**Ce que tu dois voir** : le Pi démarre, aucun bureau n'apparaît, l'écran mural s'affiche en plein écran, en portrait.

### Ce que le script fait, et pourquoi

| | Pourquoi c'est là |
|---|---|
| **Attend `/api/health`** avant d'ouvrir Chromium | Le Pi démarre plus vite que le Mac. Sans ça, après une coupure de courant, l'écran reste bloqué sur une page d'erreur — et personne ne va la recharger. |
| **Efface `exit_type: Crashed`** | Sinon la bulle « Chromium ne s'est pas fermé correctement » s'affiche par-dessus l'écran mural. Sur un mur, ça reste des jours. |
| **Relance Chromium s'il meurt** | Un écran mural doit se réparer tout seul. |
| **Une URL avec un NOM, pas une IP** | L'adresse a déjà changé trois fois dans ce projet. |

---

## 4. Performance : rien à alléger, une seule chose à faire

Vérifié au § 2 octies : le bento n'utilise **aucun `backdrop-filter`**, **aucun dégradé radial**, et sa seule animation (le bandeau d'actus) n'anime qu'un `transform` — composé par le GPU. **Aucun « mode léger » à écrire.**

Le seul vrai poste de charge est ailleurs : **8,5 Mo de photos de plats affichées en vignettes de 36 px**. Le premier chargement tire tout pour rien ; ensuite le cache `immutable` fait son travail (leur nom *est* l'empreinte de leur contenu).

👉 Le redimensionnement se fait **sur le Mac**, pas ici (§ 8 du guide Mac).

---

## 5. 🎙️ Jarvis — pourquoi le micro ne s'ouvrira pas, et quoi faire

Chromium affichera `http://maison.local:8090` : une origine **HTTP distante**, donc **pas de contexte sécurisé**, donc **pas de micro**. Ce n'est pas un réglage à trouver, c'est une règle du navigateur — et c'est pour ça que le bouton micro du bento **se cache tout seul** quand il ne peut pas fonctionner. Un bouton mort sur un mur de cuisine est pire que pas de bouton.

Trois issues, par ordre de qualité :

### 🥇 1. Le son ne passe pas par le navigateur

Un service sur le Pi écoute le micro, détecte le mot d'éveil (**Porcupine**, local, quelques % de CPU) et appelle `/api/vocal` sur le Mac. Le navigateur ne fait qu'**afficher**. Aucun HTTPS nécessaire, et **rien ne quitte la cuisine tant que « Jarvis » n'a pas été prononcé** — le principe tenu partout dans ce projet.

Répartition : le Pi fait le mot d'éveil et la capture (il est fait pour ça, mais poussif pour transcrire du français) ; le Mac fait whisper, la compréhension et la voix.

### 2. Mandataire local — pour essayer ce soir

Le navigateur se croit sur `localhost`, donc en contexte sécurisé, et ouvre le micro **sans certificat** :

```bash
sudo apt install -y socat
socat TCP-LISTEN:8090,fork,reuseaddr TCP:maison.local:8090 &
# puis dans kiosque.conf :  URL="http://localhost:8090/bento.html"
```

Une ligne, réversible. C'est la bonne façon de vérifier que la chaîne micro → transcription → réponse fonctionne, **avant** de monter la solution 1.

### 3. HTTPS via Tailscale

À faire de toute façon pour les iPhone (§ 7 du guide Mac). Installe Tailscale sur le Pi aussi et pointe `kiosque.conf` sur l'URL `https://…ts.net`.

⚠️ Rappel de la 5ᵉ vague : **le bento n'affiche rien tant que le mot d'éveil n'a pas été reconnu.** Ce qui est écarté n'est ni affiché, ni envoyé, ni conservé — sinon « ça fait surveillance », et ça en serait.

---

## ✅ Récapitulatif

- [ ] Carte SD de marque, **A2, 16 Go minimum** (elle écrit 24 h/24)
- [ ] Pi OS 64-bit **with desktop**, SSH activé, personnalisation Imager remplie
- [ ] `curl http://maison.local:8090/api/health` répond **depuis le Pi**
- [ ] Autologin bureau, **Screen Blanking = No**
- [ ] Écran pivoté en portrait, **et le tactile tombe juste**
- [ ] Dépôt cloné, `kiosque.conf` relu
- [ ] `.desktop` en place, **vérifié par un vrai `sudo reboot`**
- [ ] L'écran survit à une **coupure de courant** (le vrai test : débranche)
- [ ] Réservation DHCP pour le Pi sur la box

---

## 🔧 Dépannage

| Symptôme | Cause la plus probable |
|---|---|
| Page d'erreur au démarrage | Le Mac n'était pas prêt. Augmente `ATTENTE_MAX` dans `kiosque.conf`. |
| `maison.local` inconnu | `sudo systemctl enable --now avahi-daemon`, ou isolation des clients sur la box. |
| Écran noir au bout de 10 min | `raspi-config` → Screen Blanking → **No**. |
| Les doigts cliquent à côté | Le tactile n'a pas suivi la rotation → § 2. |
| Bandeau « ne s'est pas fermé correctement » | Le script l'efface au lancement ; s'il revient, c'est que le kiosque n'est pas lancé par le script. |
| L'écran affiche une vieille version | Ne devrait plus arriver : les pages **et les scripts** sont en `no-cache` depuis le 19/08. Chaque page affiche son numéro de `VERSION` — compare-le avec le Mac. |
| Le bouton micro n'apparaît pas | Normal en HTTP distant → § 5. |
