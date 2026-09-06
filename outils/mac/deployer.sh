#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
#  Écran Maison — déploiement automatique depuis GitHub
#
#  On pousse depuis n'importe quel poste, le Mac mini se met à jour tout seul.
#
#  Pourquoi TIRER plutôt que recevoir un webhook : un webhook exigerait une
#  adresse joignable depuis Internet, donc une ouverture vers l'extérieur pour
#  une maison. Tirer ne demande rien : le Mac interroge GitHub, jamais
#  l'inverse. C'est le même raisonnement que « pas de cloud obligatoire ».
#
#  Trois garde-fous, dans cet ordre d'importance :
#    1. On SAUVEGARDE la base avant de toucher au code. Le déploiement ne
#       touche pas aux données, mais une version fautive, si.
#    2. On refuse de déployer ce qui ne passe pas les contrôles HORS LIGNE
#       (`calculs` et `pages`) : syntaxe des scripts, identifiants visés mais
#       absents, accolades CSS, en-têtes de cache. C'est exactement la classe
#       de défaut qui blanchit l'écran mural — et l'écran, personne ne le
#       recharge à la main.
#    3. Si le serveur ne répond plus après la mise à jour, on REVIENT à la
#       version précédente et on relance. Mieux vaut une version d'hier qui
#       marche qu'une version du jour qui laisse le mur vide.
#
#  Les séries qui ont besoin du serveur (`api`, `vocal`, `ecole`…) ne sont
#  volontairement PAS jouées ici : elles écrivent dans les vraies données de la
#  famille. Elles se lancent à la main, comme aujourd'hui.
# ═══════════════════════════════════════════════════════════════════════════
set -u

PROJET="${PROJET:-$HOME/maison}"
BRANCHE="${BRANCHE:-main}"
PORT="$(grep -E '^PORT=' "$PROJET/.env" 2>/dev/null | cut -d= -f2)"
PORT="${PORT:-8090}"
NODE="${NODE:-/usr/local/bin/node}"
NPM="${NPM:-/usr/local/bin/npm}"
JOURNAL="$PROJET/deploiement.log"

dire() { echo "$(date '+%Y-%m-%d %H:%M:%S')  $*" >> "$JOURNAL"; }

cd "$PROJET" 2>/dev/null || { dire "✗ dossier introuvable : $PROJET"; exit 1; }

# Deux façons d'arriver ici, et c'est délibéré :
#   • sans argument  → le service toutes les 2 min : on TIRE depuis GitHub ;
#   • --recu <sha>   → un `git push` direct vers le Mac vient d'atterrir, le code
#                      est déjà en place, il ne reste qu'à vérifier et relancer.
# Le second chemin existe parce que la clé de déploiement GitHub demande une
# manipulation humaine : sans lui, « je pousse et ça s'installe » aurait attendu.
RECU=0
if [ "${1:-}" = "--recu" ]; then RECU=1; ICI="${2:-$(git rev-parse HEAD~1 2>/dev/null)}"; fi

# ── Y a-t-il quelque chose de nouveau ? ────────────────────────────────────
if [ "$RECU" -eq 0 ]; then
  if ! git fetch --quiet origin "$BRANCHE" 2>/dev/null; then
    # Tant que la clé de déploiement n'est pas déposée sur GitHub, cet échec se
    # répète toutes les deux minutes. On ne le consigne qu'UNE FOIS PAR HEURE :
    # un journal qui répète 720 fois la même ligne par jour noie les vrais
    # messages, et c'est alors le journal entier qu'on cesse de lire.
    MARQUE="$PROJET/.deploiement-fetch-ko"
    MAINTENANT=$(date +%s)
    DERNIER=$(cat "$MARQUE" 2>/dev/null || echo 0)
    if [ $((MAINTENANT - DERNIER)) -ge 3600 ]; then
      echo "$MAINTENANT" > "$MARQUE"
      dire "✗ git fetch impossible — la clé de déploiement n'est pas (encore) acceptée par GitHub."
      dire "   Le push direct vers le Mac continue de fonctionner en attendant."
    fi
    exit 1
  fi
  rm -f "$PROJET/.deploiement-fetch-ko" 2>/dev/null
  ICI="$(git rev-parse HEAD)"
  LA="$(git rev-parse "origin/$BRANCHE")"
  [ "$ICI" = "$LA" ] && exit 0        # rien à faire : le cas normal, silencieux
  dire "── nouveau sur origin/$BRANCHE : ${ICI:0:7} → ${LA:0:7}"
  git log --oneline "$ICI..$LA" | sed 's/^/     /' >> "$JOURNAL"
else
  dire "── reçu par push : ${ICI:0:7} → $(git rev-parse --short HEAD)"
fi

# ── 1. Sauvegarde de la base AVANT de bouger quoi que ce soit ──────────────
# `VACUUM INTO` produit une copie cohérente même serveur allumé — c'est ce qui
# permet de sauvegarder sans arrêter la maison.
COFFRE="$HOME/maison-coffre"
mkdir -p "$COFFRE"
INSTANT="$COFFRE/avant-deploiement-$(date '+%Y%m%d-%H%M%S').db"
"$NODE" -e "
const {DatabaseSync} = require('node:sqlite');
new DatabaseSync('$PROJET/maison.db', {readOnly:true}).exec(\"VACUUM INTO '$INSTANT'\");
" 2>>"$JOURNAL" && dire "   base sauvegardée : $(basename "$INSTANT")"
# On garde les dix dernières : au-delà, c'est la sauvegarde quotidienne qui prend le relais.
ls -1t "$COFFRE"/avant-deploiement-*.db 2>/dev/null | tail -n +11 | xargs -I{} rm -f {} 2>/dev/null

# ── 2. Mise à jour du code (seulement si on TIRE) ──────────────────────────
if [ "$RECU" -eq 0 ]; then
# 🐞 Un fichier NON SUIVI qui porte le même nom qu'un fichier apporté par la mise
# à jour fait échouer `git pull` (« untracked working tree files would be
# overwritten »), et le déploiement reste bloqué pour toujours sans que personne
# le voie. Le cas s'est présenté le jour même de l'installation : deux scripts
# copiés à la main sur le Mac avant d'être publiés.
# On les met DE CÔTÉ plutôt que de les supprimer — on ne détruit rien sans trace.
git diff --name-only HEAD "origin/$BRANCHE" 2>/dev/null | while read -r f; do
  [ -e "$f" ] || continue
  git ls-files --error-unmatch "$f" >/dev/null 2>&1 && continue
  mv "$f" "$f.avant-deploiement" && dire "   fichier local mis de côté : $f → $f.avant-deploiement"
done

if ! git pull --ff-only --quiet origin "$BRANCHE" 2>>"$JOURNAL"; then
  dire "✗ git pull refusé — le dépôt local a divergé. Intervention humaine requise."
  exit 1
fi

# Les dépendances ne se reconstruisent que si le verrou a bougé : `npm ci`
# efface et refait tout node_modules, c'est trop long pour le faire à chaque fois.
if ! git diff --quiet "$ICI" HEAD -- package-lock.json package.json; then
  dire "   package-lock.json a changé → npm ci"
  "$NPM" ci --silent >>"$JOURNAL" 2>&1 || { dire "✗ npm ci a échoué"; }
fi
fi

# ── 3. Contrôles hors ligne : on ne déploie pas ce qui ne passe pas ────────
if ! "$NODE" outils/tester-tout.js calculs pages >>"$JOURNAL" 2>&1; then
  dire "✗ les contrôles hors ligne échouent — RETOUR à ${ICI:0:7}"
  git reset --hard --quiet "$ICI"
  "$NPM" ci --silent >>"$JOURNAL" 2>&1
  exit 1
fi
dire "   contrôles hors ligne : OK"

# ── 4. Relance, puis on vérifie que le serveur répond VRAIMENT ─────────────
# 🔑 Aucun privilège n'est demandé, et c'est voulu. Le service tourne sous le
# compte de Rémi (`UserName` dans le plist) avec `KeepAlive` : il suffit d'ARRÊTER
# le processus, launchd le relance de lui-même dans les dix secondes. Passer par
# `sudo launchctl kickstart` aurait exigé une règle sudoers sans mot de passe
# pour un script automatique — hors de proportion avec ce qu'il a à faire.
relancer() { pkill -f "node $PROJET/server.js" 2>/dev/null || pkill -f 'node server.js' 2>/dev/null; }
relancer
VIVANT=0
for _ in $(seq 1 20); do
  sleep 1
  curl -sf -m 2 "http://localhost:$PORT/api/health" >/dev/null 2>&1 && { VIVANT=1; break; }
done

if [ "$VIVANT" -eq 1 ]; then
  dire "✅ déployé : $(git log -1 --format='%h %s')"
else
  dire "✗ le serveur ne répond plus après la mise à jour — RETOUR à ${ICI:0:7}"
  git reset --hard --quiet "$ICI"
  "$NPM" ci --silent >>"$JOURNAL" 2>&1
  relancer
  exit 1
fi

# Le journal ne doit pas grossir indéfiniment sur une machine qui tourne des mois.
tail -n 2000 "$JOURNAL" > "$JOURNAL.tmp" 2>/dev/null && mv "$JOURNAL.tmp" "$JOURNAL"
