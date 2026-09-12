# 🌍 Accès depuis l'extérieur — Cloudflare Tunnel

> Objectif : ouvrir l'app familiale depuis n'importe où, **sans ouvrir un seul
> port** sur la box, et avec une vraie porte d'entrée devant.
>
> Préparé le 12/09/2026. `cloudflared` est **déjà installé** sur le Mac
> (`~/bin/cloudflared`). Il ne reste que ce qui demande ton compte.

---

## 0. 🔴 À LIRE AVANT DE TOUCHER AU DNS

Cloudflare Tunnel exige que **toute la zone** du domaine soit gérée par
Cloudflare — on ne peut pas y déléguer un seul sous-domaine (c'est réservé aux
offres Entreprise). Si le domaine porte déjà des mails ou un site, la bascule
des serveurs de noms les fait **migrer en même temps** que l'écran de la
cuisine. Ce n'est pas anodin : une erreur sur le `MX` ou le `SPF` se paie en
courrier perdu, silencieusement.

Trois pièges reviennent presque toujours, quel que soit l'hébergeur de départ :

1. **Le SPF déclaré en type `SPF`.** Ce type est obsolète et **Cloudflare ne le
   propose pas** : il doit être recréé en **TXT**. Oublié, les mails sortants
   partent en spam — surtout avec un `-all`, qui est strict.
2. **Le proxy (nuage orange) est actif par défaut.** Un site servi par Vercel,
   Netlify, Super.so ou GitHub Pages gère son propre certificat : proxifié, il
   rend une erreur SSL. La racine et `www` doivent rester en **DNS only**.
3. **Les enregistrements `SRV` sont souvent sautés** par l'import automatique.
   À vérifier un par un.

> 📄 Pour **cette** maison, la liste exacte à contrôler après import — les 23
> entrées relevées, avec le statut de proxy attendu pour chacune — est sur le
> Mac : `~/zone-cloudflare-checklist.md`. Elle n'est pas dans le dépôt : la
> zone d'un foyer n'a rien à faire dans le code (§ 5 quater).

### Deux chemins, à trancher

**🥇 Un domaine dédié à la maison** (par exemple un `.fr` à quelques euros par
an, ou un domaine que tu as déjà et qui ne sert à rien). La zone est vide, donc
**il n'y a rien à casser**. `rommelard.fr` n'est pas touché. C'est ce que je
recommande : le gain de simplicité est sans commune mesure avec le coût.

**Sinon, `rommelard.fr`**, avec ces précautions non négociables :
1. **Exporter la zone depuis OVH AVANT tout** (espace client → Zone DNS →
   *Exporter la zone*). C'est le filet : sans lui, on répare de mémoire.
2. Après l'import par Cloudflare, **comparer ligne à ligne** avec l'export —
   surtout `MX`, `SPF`, `_dmarc`, `autodiscover`, les clés DKIM.
3. Mettre la racine et `www` en **DNS only (nuage GRIS)**. Proxifiés, Vercel et
   Super.so cassent.
4. Prévoir la bascule **un moment où recevoir du courrier n'est pas critique** :
   la propagation des NS prend de quelques minutes à 24 h.

---

## 1. Chez Cloudflare (gratuit)

Le plan **Free** suffit entièrement : Tunnel sans limite, et **Access jusqu'à
50 utilisateurs**. Aucune carte bancaire.

1. Créer un compte sur `dash.cloudflare.com`.
2. **Add a site** → le domaine retenu → plan **Free**.
3. Cloudflare lit la zone existante et propose les enregistrements. **Vérifie-les
   contre l'export OVH**, corrige ce qui manque, puis continue.
4. Cloudflare affiche **deux serveurs de noms** (du type `xxx.ns.cloudflare.com`).

## 2. Chez OVH

Espace client → **Noms de domaine** → le domaine → onglet **Serveurs DNS** →
*Modifier les serveurs DNS* → remplacer par les deux de Cloudflare.

⚠️ C'est le seul changement à faire chez OVH. **Ne supprime rien** dans la zone
OVH : elle reste en réserve tant que la bascule n'est pas confirmée.

## 3. Créer le tunnel — sur le Mac

```bash
~/bin/cloudflared tunnel login          # ouvre le navigateur, choisis la zone
~/bin/cloudflared tunnel create maison  # note l'UUID affiché
~/bin/cloudflared tunnel route dns maison maison.<ton-domaine>
```

Puis le fichier `~/.cloudflared/config.yml` :

```yaml
tunnel: REMPLACER-PAR-L-UUID
credentials-file: /Users/remi/.cloudflared/REMPLACER-PAR-L-UUID.json

ingress:
  # L'app, l'écran et le back-office sont servis par le même serveur.
  - hostname: maison.<ton-domaine>
    service: http://127.0.0.1:8090
  # Tout le reste est refusé : sans cette ligne, le tunnel ne démarre pas.
  - service: http_status:404
```

Essai à la main, avant d'en faire un service :

```bash
~/bin/cloudflared tunnel run maison
```

## 4. 🔒 La porte : Cloudflare Access

**C'est cette étape qui rend l'exposition acceptable**, et elle n'est pas
optionnelle. Sans elle, l'adresse est publique et ne tient que sur des codes à
quatre chiffres.

Tableau de bord **Zero Trust** → **Access → Applications** → *Add an
application* → **Self-hosted** :

- **Application domain** : `maison.<ton-domaine>`
- **Policy** : *Allow* → **Emails** → les adresses de la famille, une par
  personne.
- Méthode : **One-time PIN** (un code reçu par mail). Aucun compte à créer pour
  les enfants.

Résultat : avant même d'atteindre le serveur, Cloudflare demande qui vous êtes.
Le code de l'app devient un second verrou, plus le seul.

⚠️ **Une exception à prévoir** : l'écran mural de la cuisine passe par le réseau
local (`http://maison.local:8090`), donc il n'est pas concerné. S'il devait un
jour passer par le tunnel, il faudrait un *service token* — un écran ne peut pas
lire un mail pour récupérer un code.

## 5. Le lancer au démarrage

```bash
cp outils/mac/fr.maison.cloudflared.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/fr.maison.cloudflared.plist
```

> **LaunchAgent et non Daemon**, contrairement au serveur : le tunnel a besoin
> des identifiants rangés dans `~/.cloudflared`, qui appartiennent à la session.
> Conséquence à connaître : il démarre à l'ouverture de session, donc après un
> redémarrage il attend le déverrouillage — exactement la limite déjà posée par
> FileVault pour le reste (§ 2 tricies).

## 6. Vérifier

```bash
# le tunnel est-il vu par Cloudflare ?
~/bin/cloudflared tunnel list

# la porte Access répond-elle AVANT le serveur ?
curl -sI https://maison.<ton-domaine>/app/ | head -3
#   attendu : une redirection vers Cloudflare Access, PAS la page.
#   Si l'app s'affiche directement, la politique Access n'est pas active
#   — et l'adresse est alors ouverte à tous.
```

Puis, depuis un téléphone **en 4G** : ouvrir `https://maison.<ton-domaine>/app/`,
recevoir le code par mail, entrer. Ensuite « Sur l'écran d'accueil ».

## 7. Revenir en arrière

Rien n'est irréversible :

```bash
launchctl unload ~/Library/LaunchAgents/fr.maison.cloudflared.plist
~/bin/cloudflared tunnel delete maison
```

Et chez OVH, remettre `ns19.ovh.net` / `dns19.ovh.net` comme serveurs de noms.

---

## Ce qui reste vrai quoi qu'il arrive

- **Aucun port n'est ouvert sur la box.** Le tunnel est une connexion *sortante*
  du Mac vers Cloudflare. Ton IP publique n'est jamais exposée.
- **Tailscale reste en place** et continue de fonctionner
  (`https://maison.taild51b64.ts.net`). Les deux peuvent coexister : l'un pour
  la famille sans rien installer, l'autre pour toi, sans intermédiaire.
- ⚠️ **Cloudflare déchiffre le trafic au passage** — c'est la contrepartie du
  service. Pour un agenda familial c'est un arbitrage à faire les yeux ouverts,
  là où Tailscale ne laisse rien lire à personne.
