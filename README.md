# 🏠 Écran Maison

Tableau de bord familial : un **écran mural tactile** dans la cuisine, une **app iPhone** pour
la famille, un **back-office** pour la configuration, et un **assistant vocal**. Tout tourne à la
maison, sur une seule machine, avec une seule base de données.

> **Pourquoi ce projet existe** : les tableaux de bord familiaux du commerce sont soit des apps
> sans écran mural, soit des écrans muraux sans intelligence — et presque tous imposent un cloud.
> Ici, les données restent à la maison.

---

## Ce que ça fait

| | |
|---|---|
| 🍽️ **Menu de la semaine** | Recettes, photos, quantités **recalculées selon le nombre de couverts**, proposition automatique des soirs vides |
| 🛒 **Courses** | Rayon deviné, ingrédients suggérés depuis le menu, articles habituels tirés de l'historique |
| ✅ **À faire** | Assignation, échéance, **rappel quotidien sur le téléphone de la bonne personne** |
| 📅 **Agenda** | Calendrier iCloud en lecture, jours fériés calculés, vues jour/semaine/mois |
| 🎒 **Emploi du temps** | Grille horaire, **semaine A/B** des collèges, chaque enfant édite le sien |
| 👦 **Garde alternée** | Présence lue dans le calendrier, couverts **proposés** en conséquence |
| 🎂 **Anniversaires** | Foyer et proches, rappel J-7 |
| 🗣️ **Assistant vocal** | Une phrase entre, une phrase à dire sort — voir [`VOCAL.md`](VOCAL.md) |
| 📌 **Post-it, météo, actus** | |

---

## Architecture

```
        ┌──────────────── un seul serveur Node ────────────────┐
Écran   │  server.js                                            │
mural ──┤    ├── donnees/     ← couche unique, échangeable      │
        │    ├── recettes/    ← lien · recherche · IA · photos  │
iPhones │    ├── vocal/       ← compréhension + personnalité    │
(PWA) ──┤    ├── presence/menu/rappels/feries                   │
        │    ├── API REST + /api/flux (SSE, ~30 ms)             │
Admin ──┤    └── maison.db    ← SQLite, un seul fichier         │
        └──────────────────────────────────────────────────────┘
```

**Trois principes tenus partout dans le code :**

1. **La machine propose, l'humain décide.** Recettes, courses depuis le menu, menu de la semaine,
   couverts : rien ne s'écrit sans validation. Un nombre choisi à la main n'est jamais écrasé.
2. **Rien ne se supprime vraiment.** Toute table de contenu porte `supprime_le` — une corbeille,
   comme celle de Notion, qui a déjà sauvé le projet plusieurs fois.
3. **Aucune destruction par la voix.** L'assistant ne peut ni vider ni supprimer. Une
   reconnaissance vocale se trompe ; cocher un article se défait d'un doigt, effacer non.

### Choix techniques notables

- **`node:sqlite`** — SQLite est intégré à Node depuis la 22.5. Aucun module natif à compiler,
  donc aucune installation et aucun droit administrateur nécessaires. `maison.db` se copie
  telle quelle d'une machine à l'autre.
- **La couche `donnees/`** isole tout accès aux données derrière une interface unique. Écrite
  pour pouvoir changer de base ; elle a surtout permis de **reconstruire le serveur** après que
  l'antivirus du poste en eut mis 13 fichiers en quarantaine.
- **SSE plutôt que WebSocket** — natif au navigateur, reconnexion automatique, zéro dépendance.
- **Aucun CDN.** Tout est local : l'écran doit fonctionner quand Internet tombe.

---

## Mise en route

```bash
npm ci                    # reconstruit node_modules à l'identique
cp .env.example .env      # puis remplir (voir ci-dessous)
npm start
```

| Écran | Adresse |
|---|---|
| Mural | `/bento.html` (ou `/`) |
| App famille | `/app/` |
| Administration | `/admin/` |
| Banc d'essai vocal | `/vocal.html` |

Premier accès au back-office (poule et œuf) :

```bash
node outils/admin.js                 # liste les membres
node outils/admin.js code Rémi 1234  # définit un code
```

### `.env` — uniquement les secrets

Tout le reste se règle dans **`/admin/ → Réglages`**, sans redémarrer.

| Clé | Rôle |
|---|---|
| `ANTHROPIC_API_KEY` | recettes par IA, assistant vocal. Sans elle, la lecture de liens fonctionne toujours |
| `SOURCE` | `sqlite` (défaut) |
| `DB_FICHIER` | **laisser vide** — un chemin absolu casse le portage vers une autre machine |
| `PORT` | 8090 |

---

## Tests

```bash
npm test          # 194 vérifications, ~8 s
npm run test-detail
node outils/tester-tout.js calculs   # une série (sans serveur)
```

| Série | Couvre |
|---|---|
| `calculs` | jours fériés (Pâques sur 8 années de référence), rayons, quantités |
| `pages` | syntaxe des scripts, identifiants visés mais absents, en-têtes de cache |
| `api` | lecture, écritures, temps réel, corbeille, barrière admin, sécurité du planning |
| `vocal` | identité, contexte, personnalité, refus |
| `rappels` | anniversaires, échéances adressées, rangement |
| `quinzaine` | filtrage semaine A/B |
| `presence` | garde alternée |

⚠️ Les tests s'exécutent sur les **vraies données**, faute de base de test. Tout ce qu'ils créent
porte le préfixe `ZZ-essai` et est retiré à la fin ; **aucune opération de masse n'est jamais
tentée**. Sauvegarder d'abord au moindre doute.

---

## Sauvegardes

```bash
sauvegarder-tout.cmd            # base (VACUUM INTO) + archive du code, HORS du dossier
node outils/sauvegarder.js      # base seule
installer-sauvegarde-auto.cmd   # tâche quotidienne (sans droits admin)
```

> La base était sauvegardée, **le code ne l'était pas** — jusqu'à ce qu'un antivirus en mette
> 13 fichiers en quarantaine en une nuit. D'où l'archive du code, écrite en `.cmd` et en outils
> natifs pour rester lisible même si tout le reste disparaît.

⚠️ L'archive contient `.env` et `maison.db` : **elle ne se partage pas**.

---

## Ce qui n'est pas dans ce dépôt

`.gitignore` exclut délibérément :

- **`.env`** — clé API et token, en clair.
- **`maison.db` et `sauvegardes/`** — menus, courses, emplois du temps des enfants, dates de
  naissance. La seule copie des données du foyer ; elle se sauvegarde, elle ne se publie pas.
- **`public/plats/`** — ~8,5 Mo de photos récupérées sur des sites de cuisine. Ce n'est pas à
  nous de les redistribuer, et elles se régénèrent en un clic depuis le back-office.
- **`node_modules/`** — `npm ci` les reconstruit à l'identique.

---

## Feuille de route

**Prêt, attend le matériel** — dalle tactile 21,5" pilotée par un Raspberry, Mac mini serveur :

- **HTTPS via Tailscale** → débloque d'un coup Face ID, le push iOS téléphone verrouillé, et
  l'accès hors maison.
- **Micro sur l'écran mural** → le son ne passera pas par le navigateur (pas de contexte
  sécurisé sur une origine HTTP distante) : mot d'éveil **Porcupine** en local sur le Pi,
  transcription **whisper.cpp** et voix **Piper** sur le Mac. Détail dans [`VOCAL.md`](VOCAL.md).
- **Domotique** — HomeKit, Netatmo, AirPlay via Home Assistant.
- **Redimensionner les photos** (`sharp`, module natif).

---

## Documentation

| Fichier | Contenu |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | **Mémoire du projet** — chaque décision, chaque bug trouvé et pourquoi. C'est le document qui a permis de reconstruire le serveur après la quarantaine. |
| [`VOCAL.md`](VOCAL.md) | Assistant vocal : usage, Raccourci Siri, architecture cible, choix de la voix |
| [`SETUP.md`](SETUP.md) | Mise en route initiale |

---

*Projet familial personnel. Pas de licence : tous droits réservés.*
