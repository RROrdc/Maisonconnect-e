# 📺 Installer l'écran mural — Raspberry Pi + dalle tactile 21,5"

> Le Pi **n'héberge rien**. Il ouvre `http://maison.local:8090/bento.html` en plein écran, et c'est tout.
> Le serveur est sur le Mac mini → faire `INSTALL-MAC.md` **d'abord**. Un Pi sans serveur n'a rien à afficher.
> Compte ~45 min, dont deux passages obligés par un redémarrage.

---

## 1. Système

**Raspberry Pi OS (64-bit) with desktop**, Bookworm ou plus récent. La version *Lite* ne convient pas : il faut un environnement graphique pour Chromium.

Dans **Raspberry Pi Imager**, avant d'écrire la carte, ouvre les réglages (⚙) :
- nom d'hôte : `ecran-cuisine`
- **activer SSH** — c'est par là que je piloterai le Pi depuis le Mac
- Wi-Fi et pays
- utilisateur et mot de passe

Au premier démarrage :

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

- [ ] Pi OS 64-bit **with desktop**, SSH activé
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
