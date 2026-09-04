#!/usr/bin/env bash
# =============================================================================
#  Écran Maison — kiosque Chromium sur le Raspberry Pi.
#
#  Le Pi n'héberge RIEN : il affiche http://<mac>.local:8090/bento.html.
#  Ce script tient dans le dépôt plutôt que sur la carte SD, pour qu'il survive
#  à une carte morte — et pour qu'on sache pourquoi chaque option est là.
#
#  Réglages : outils/raspberry/kiosque.conf (créé au premier lancement).
# =============================================================================
set -uo pipefail

ICI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONF="$ICI/kiosque.conf"

# --- Réglages locaux à CETTE machine, donc hors du dépôt ---------------------
# Le nom du Mac change d'une maison à l'autre : le coder en dur ici, ce serait
# refaire l'erreur du § 5 quater (rien de spécifique au foyer dans le code).
if [ ! -f "$CONF" ]; then
  cat > "$CONF" <<'EOF'
# Adresse de l'écran mural. Un NOM, jamais une IP : l'adresse du serveur a déjà
# changé trois fois dans ce projet, et un favori d'écran mural qui casse à
# chaque changement de réseau, personne ne le répare.
URL="http://maison.local:8090/bento.html"

# Combien de temps attendre le serveur avant d'abandonner (secondes).
# Le Pi démarre plus vite que le Mac : sans cette attente, Chromium s'ouvrirait
# sur une page d'erreur et y resterait.
ATTENTE_MAX=180
EOF
  echo "Créé : $CONF — vérifie l'URL avant de continuer."
fi
# shellcheck source=/dev/null
. "$CONF"

SANTE="${URL%/*}/api/health"

# --- Chromium : le binaire n'a pas le même nom selon la version de Pi OS -----
CHROME=""
for c in chromium-browser chromium /usr/bin/chromium-browser /usr/bin/chromium; do
  command -v "$c" >/dev/null 2>&1 && CHROME="$c" && break
done
[ -z "$CHROME" ] && { echo "[X] Chromium introuvable (sudo apt install chromium-browser)"; exit 1; }

# --- Attendre que le serveur réponde ----------------------------------------
echo "Attente du serveur : $SANTE"
debut=$(date +%s)
until curl -sf -m 3 "$SANTE" >/dev/null 2>&1; do
  if [ $(( $(date +%s) - debut )) -ge "$ATTENTE_MAX" ]; then
    echo "[!] Serveur muet après ${ATTENTE_MAX}s — on ouvre quand même."
    echo "    (Chromium retentera tout seul : la page se recharge à l'échec.)"
    break
  fi
  sleep 2
done

# --- Effacer la bulle « Chromium ne s'est pas fermé correctement » -----------
# Après une coupure de courant, elle s'affiche par-dessus l'écran mural et il
# faut aller cliquer dessus avec un doigt. Sur un mur, c'est rédhibitoire.
PROFIL="$HOME/.config/chromium/Default/Preferences"
if [ -f "$PROFIL" ]; then
  sed -i 's/"exit_type":"Crashed"/"exit_type":"Normal"/; s/"exited_cleanly":false/"exited_cleanly":true/' "$PROFIL" 2>/dev/null || true
fi

# --- Boucle : si Chromium meurt, il repart -----------------------------------
while true; do
  "$CHROME" \
    --kiosk \
    --noerrdialogs \
    --disable-infobars \
    --disable-session-crashed-bubble \
    --disable-features=Translate,TranslateUI \
    --no-first-run \
    --check-for-update-interval=31536000 \
    --disable-pinch \
    --overscroll-history-navigation=0 \
    --autoplay-policy=no-user-gesture-required \
    "$URL"
  echo "[!] Chromium s'est arrêté — relance dans 5 s."
  sleep 5
done
