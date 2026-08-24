# 🏠 Écran Maison — installation sur le PC

Web app qui affiche ton tableau familial (menu, courses, à faire, post-it) **en direct depuis Notion**, sur la tablette de la cuisine. Elle tourne sur ton **PC** maintenant, et sera **portable telle quelle sur le Mac** plus tard.

## Ce que ça fait
- Sert le bel écran à tuiles.
- Lit **et écrit** tes bases Notion « 🏠 Maison » : coche/ajoute depuis l'écran → ça part dans Notion → visible sur les téléphones. **Synchronisé dans tous les sens.**
- Rafraîchit tout seul toutes les 30 s (les ajouts des autres apparaissent).
- Température / Musique : emplacements réservés (branchés plus tard, via le Mac / Home Assistant / AirPlay).

## Prérequis
- **Node.js 18+** (https://nodejs.org).

## Étapes (une fois)
1. **Créer une intégration Notion** : https://www.notion.so/my-integrations → *New integration* (interne) → copie le **Internal Integration Secret** (commence par `secret_` ou `ntn_`).
2. **Partager les bases avec l'intégration** : dans Notion, ouvre la page **🏠 Maison** → menu `•••` → *Connexions / Connect to* → choisis ton intégration. (Ça donne accès aux bases enfants : À faire, Courses, Post-it, Menu, Plats.)
3. Dans le dossier `maison-app` : copie `.env.example` en **`.env`** et colle ton token dans `NOTION_TOKEN`. Les identifiants des bases sont déjà remplis.
4. Installer et lancer :
   ```
   npm install
   npm start
   ```
5. Le terminal affiche l'adresse. Sur le PC : http://localhost:8080 . Depuis la **tablette** (même Wi-Fi) : `http://IP-DU-PC:8080` (trouve l'IP avec `ipconfig`).

## Tablette en mode kiosque
- **iPad** : ouvre l'URL dans Safari → *Partager* → *Sur l'écran d'accueil* ; puis *Accès guidé* (Réglages → Accessibilité) pour verrouiller l'écran.
- **Android** : appli *Fully Kiosk Browser* (gratuite) → mettre l'URL, plein écran, empêcher la veille.

## Garder le serveur allumé
- Laisse le PC allumé. Pour un lancement automatique au démarrage, utiliser **pm2** (`npm i -g pm2 && pm2 start server.js && pm2 save && pm2 startup`) ou une tâche planifiée Windows.

## (Optionnel) Agenda perso
- Récupère l'URL d'abonnement **.ics** de ton agenda iCloud « Rémi/Amandine » (Calendrier → partager → calendrier public / lien) et colle-la dans `CAL_ICS_URL` du `.env`. Redémarre. (Sinon la tuile Agenda reste vide.)

---

## 🤖 Mission à coller dans Claude Code (sur le PC, dans le dossier maison-app)

```
Tu travailles en autonomie sur mon PC Windows, dans le dossier courant (maison-app), qui contient déjà server.js, public/index.html, package.json et .env.example.

Objectif : faire tourner cette web app "Écran Maison" en local, connectée à mes bases Notion.

1. Vérifie Node.js (>=18). Installe-le via winget si absent (winget install OpenJS.NodeJS.LTS).
2. Fais `npm install`.
3. Ouvre .env.example, crée .env à partir de lui. Demande-moi mon token d'intégration Notion (NOTION_TOKEN) et attends que je te le donne (ne l'invente pas). Les DB_* sont déjà remplis. Laisse CAL_ICS_URL vide pour l'instant.
4. Lance `npm start`, puis teste http://localhost:8080/api/health et http://localhost:8080/api/data. Si /api/data renvoie une erreur Notion (ex. "Could not find database" ou "unauthorized"), c'est que je n'ai pas encore partagé la page Maison avec l'intégration : dis-le-moi clairement et guide-moi.
5. Corrige tout souci runtime (noms de propriétés, versions), jusqu'à ce que la page http://localhost:8080 affiche mes vraies données et que je puisse ajouter/cocher depuis l'écran (vérifie que ça écrit bien dans Notion).
6. Donne-moi l'adresse à ouvrir sur la tablette (http://IP-DU-PC:8080) et configure un lancement automatique au démarrage (pm2 ou tâche planifiée).

Ne fais rien de destructif hors de ce dossier.
```
