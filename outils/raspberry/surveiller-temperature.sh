#!/bin/bash
# ══════════════════════════════════════════════════════════════════════════
#  Surveiller la température du Raspberry — pour savoir QUAND le ventilateur
#  sert vraiment.
#
#  POURQUOI : le 13/09, Rémi voulait que le ventilateur « ne tourne que quand
#  on en a besoin ». Avec un ventilateur à DEUX FILS branché sur 5 V et GND,
#  c'est de l'alimentation directe : rien n'est pilotable par logiciel, et
#  l'alimenter depuis une broche GPIO l'endommagerait (16 mA garantis contre
#  100 à 200 demandés).
#
#  Alors on retourne la question : plutôt que de piloter à l'aveugle, on MESURE.
#  Le Pi tenait 38 °C sous Chromium, pour un seuil de bridage à 80. Si ça ne
#  monte jamais, le ventilateur est inutile et le silence est gratuit. Si ça
#  monte, l'écran le DIT — et là seulement il y a une décision à prendre.
#
#  Le message part sur l'écran mural par /api/notif : une alerte qui n'existe
#  que dans un journal n'existe pour personne (§ 2 nonies).
# ══════════════════════════════════════════════════════════════════════════
set -u

SERVEUR="${SERVEUR:-http://maison.local:8090}"
INTERVALLE="${INTERVALLE:-120}"        # secondes entre deux mesures
SEUIL_TIEDE="${SEUIL_TIEDE:-70}"       # on prévient : le ventilateur devient utile
SEUIL_CHAUD="${SEUIL_CHAUD:-78}"       # on insiste : le bridage est à 80
SILENCE="${SILENCE:-3600}"             # une alerte par heure au maximum

MARQUE="/tmp/surveiller-temperature-derniere-alerte"

temperature() {
  local t; t="$(cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null)"
  [ -n "$t" ] && echo $(( t / 1000 )) || echo 0
}

# Une alerte répétée toutes les deux minutes serait vite ignorée — et c'est le
# meilleur moyen de rendre TOUTES les notifications invisibles.
peut_alerter() {
  [ -f "$MARQUE" ] || return 0
  local age=$(( $(date +%s) - $(stat -c %Y "$MARQUE" 2>/dev/null || echo 0) ))
  [ "$age" -gt "$SILENCE" ]
}

alerter() {
  peut_alerter || return 0
  touch "$MARQUE"
  # --max-time : si le serveur ne répond pas, on ne bloque pas la surveillance.
  curl -s --max-time 8 -X POST "$SERVEUR/api/notif" \
    -H 'content-type: application/json' \
    --data "$(printf '{"titre":%s,"texte":%s,"de":"Écran"}' "$1" "$2")" >/dev/null 2>&1
  logger -t surveiller-temperature "alerte envoyée : $1"
}

# Le fichier de trace est choisi UNE FOIS : tenter /var/log à chaque mesure
# remplissait le journal système d'un « Permission denied » toutes les deux
# minutes — une erreur bénigne qui noie les vraies.
TRACE=/var/log/temperature-pi.log
( : >> "$TRACE" ) 2>/dev/null || TRACE=/tmp/temperature-pi.log

logger -t surveiller-temperature "démarré — mesure toutes les ${INTERVALLE}s, trace dans $TRACE"

while true; do
  t="$(temperature)"
  if [ "$t" -ge "$SEUIL_CHAUD" ]; then
    alerter '"🔥 L’écran chauffe"' \
      "\"$t °C — le bridage commence à 80. Branche le ventilateur (broches 4 et 6).\""
  elif [ "$t" -ge "$SEUIL_TIEDE" ]; then
    alerter '"🌡️ L’écran est tiède"' \
      "\"$t °C. Rien de grave, mais le ventilateur commencerait à servir.\""
  fi
  # Trace locale : c'est elle qui permettra de dire, dans quelques jours, si le
  # ventilateur a jamais eu une raison d'être.
  echo "$(date '+%F %T') $t" >> "$TRACE"
  sleep "$INTERVALLE"
done
