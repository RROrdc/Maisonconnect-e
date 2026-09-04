#!/usr/bin/env bash
# =============================================================================
#  Écran Maison — SAUVEGARDE COMPLÈTE (base + code) — macOS et Linux
#
#  Portage fidèle de sauvegarder-tout.cmd, qui ne tourne que sous Windows.
#  Même raison d'être : la nuit du 18 au 19/08/2026, SentinelOne a mis en
#  quarantaine 13 fichiers .js du projet. La BASE était sauvegardée, le CODE
#  ne l'était pas. Une nuit de travail est partie avec.
#
#  Deux différences volontaires avec outils/sauvegarder.js, reprises telles
#  quelles du script Windows :
#   1. l'archive part HORS du dossier projet — un nettoyage du dossier ne la
#      trouve pas ;
#   2. c'est un script SHELL et non du Node : il reste lisible et exécutable
#      même si le reste du projet disparaît.
#
#  ⚠️ L'archive contient .env (clé Anthropic, token Notion) et maison.db
#     (données de la famille). Elle NE SE PARTAGE PAS.
#
#  Usage :  ./outils/sauvegarder-tout.sh
#  Coffre : $MAISON_COFFRE, ou ~/maison-coffre par défaut.
# =============================================================================
set -uo pipefail

RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COFFRE="${MAISON_COFFRE:-$HOME/maison-coffre}"
A_GARDER=20
STAMP="$(date +%Y%m%d-%H%M%S)"

# --- Node -------------------------------------------------------------------
# Un travail lancé par launchd ou cron hérite d'un PATH minimal : `node` n'y est
# pas. On le cherche donc explicitement plutôt que d'échouer une fois par jour
# en silence — exactement le genre de panne qu'on ne découvre qu'au besoin.
NODE="${MAISON_NODE:-}"
if [ -z "$NODE" ]; then
  for c in "$(command -v node 2>/dev/null)" /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do
    [ -n "$c" ] && [ -x "$c" ] && NODE="$c" && break
  done
fi
if [ -z "$NODE" ]; then
  echo "[X] Node introuvable. Renseigne MAISON_NODE=/chemin/vers/node."
  exit 1
fi

mkdir -p "$COFFRE"

echo
echo "=== 1/2  Base de données ==="
# VACUUM INTO : cohérent même serveur allumé. Une copie brute pendant une
# écriture WAL donnerait une base tronquée, invisible jusqu'au jour du besoin.
if ! "$NODE" "$RACINE/outils/sauvegarder.js"; then
  echo "[!] Sauvegarde de la base en échec — on archive quand même le code."
fi

echo
echo "=== 2/2  Code + base, hors du dossier projet ==="
ARCHIVE="$COFFRE/maison-$STAMP.tar.gz"
# .git est volontairement INCLUS : c'est l'historique complet, et c'est ce qui
# permet de repartir de zéro sans dépendre de GitHub.
if tar -czf "$ARCHIVE" -C "$RACINE" \
       --exclude='./node_modules' \
       --exclude='./sauvegardes' \
       --exclude='*.tar.gz' \
       --exclude='*.zip' \
       . 2>/dev/null; then
  echo "    $ARCHIVE  ($(du -h "$ARCHIVE" | cut -f1))"
else
  echo "[X] Archivage en échec."
  exit 1
fi

# --- On ne garde que les $A_GARDER dernières archives ------------------------
ls -1t "$COFFRE"/maison-*.tar.gz 2>/dev/null | tail -n "+$((A_GARDER + 1))" | while read -r f; do
  rm -f "$f"
  echo "    retirée : $(basename "$f")"
done

echo
echo "Terminé."
echo
echo "  RAPPEL : ceci reste sur le MÊME disque. Pour être vraiment à l'abri,"
echo "  copie de temps en temps $COFFRE sur une clé USB ou un disque perso."
echo
