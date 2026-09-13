#!/bin/bash
# ══════════════════════════════════════════════════════════════════════════
#  Chien de garde du Wi-Fi — l'écran mural doit se rattraper tout seul.
#
#  POURQUOI : le 11/09, le Pi a disparu du réseau en pleine journée. Il
#  affichait probablement encore sa dernière page, mais il n'était plus
#  joignable et ne recevait plus rien — et personne ne peut le voir depuis
#  l'autre bout de la maison. Un écran mural qui perd le Wi-Fi et attend qu'on
#  vienne le débrancher n'est pas un écran mural.
#
#  CE QU'IL FAIT, par paliers — du plus doux au plus brutal :
#    1. il attend (une coupure de quelques secondes se répare seule) ;
#    2. il redemande une adresse à NetworkManager (le cas le plus fréquent :
#       l'association Wi-Fi tient, le bail DHCP est mort) ;
#    3. il coupe et rallume la radio ;
#    4. en tout dernier recours, il redémarre.
#
#  GARDE-FOUS, parce qu'un chien de garde mal réglé est pire que pas de chien :
#    • on ne redémarre JAMAIS avant AVANT_REBOOT minutes d'absence réelle ;
#    • pas plus d'un redémarrage par heure — sinon une panne de box mettrait le
#      Pi en boucle de redémarrage et on ne pourrait plus rien y faire ;
#    • la cible du test est la PASSERELLE, pas un site Internet : on veut
#      réparer le Wi-Fi, pas se réveiller parce qu'Internet est tombé.
# ══════════════════════════════════════════════════════════════════════════
set -u

INTERVALLE="${INTERVALLE:-30}"          # secondes entre deux contrôles
AVANT_REASSOCIATION="${AVANT_REASSOCIATION:-2}"    # échecs avant de se raccrocher
AVANT_RENOUVELLEMENT="${AVANT_RENOUVELLEMENT:-4}"  # échecs avant de redemander une IP
AVANT_RADIO="${AVANT_RADIO:-8}"         # échecs avant de couper/rallumer la radio
AVANT_REBOOT="${AVANT_REBOOT:-40}"      # échecs avant de redémarrer (~20 min)
MARQUE_REBOOT="/tmp/veille-reseau-dernier-reboot"

journal() { logger -t veille-reseau "$*"; echo "$(date '+%F %T') $*"; }

# 🔑 Ce que la panne du 12/09 a révélé : le signal AU MOMENT de la perte. Sans
# lui, on cherche une cause logicielle à un problème de portée — on a perdu une
# matinée là-dessus. Mesuré à −74 dBm, l'instabilité commençant vers −70.
signal() {
  local s; s="$(iw dev "$(iface)" link 2>/dev/null | awk '/signal:/{print $2" dBm"}')"
  [ -n "$s" ] && echo "$s" || echo "signal inconnu"
}

cible() {
  # La passerelle par défaut. Recalculée à chaque fois : elle change avec le
  # réseau, et une adresse codée en dur serait fausse au premier déménagement.
  ip route | awk '/^default/{print $3; exit}'
}

joignable() {
  local g; g="$(cible)"
  [ -n "$g" ] || return 1
  ping -c1 -W2 "$g" >/dev/null 2>&1
}

iface() { ip route | awk '/^default/{print $5; exit}'; }

reboot_autorise() {
  [ -f "$MARQUE_REBOOT" ] || return 0
  local age=$(( $(date +%s) - $(stat -c %Y "$MARQUE_REBOOT" 2>/dev/null || echo 0) ))
  [ "$age" -gt 3600 ]
}

echecs=0
journal "démarré — contrôle toutes les ${INTERVALLE}s"

while true; do
  if joignable; then
    if [ "$echecs" -gt 0 ]; then journal "réseau revenu après $echecs échec(s)"; fi
    echecs=0
  else
    echecs=$((echecs + 1))
    [ "$echecs" -eq 1 ] && journal "passerelle injoignable (1) — $(signal)"
    [ "$echecs" -ne 1 ] && journal "passerelle injoignable ($echecs)"

    # 🔴 LE DÉFAUT DU 12/09 : chaque action n'était tentée QU'UNE FOIS, avec un
    # `-eq`. Après le palier des quatre minutes, plus rien ne se passait jusqu'à
    # la vingtième — seize minutes où le chien de garde comptait sans agir.
    # C'est exactement la durée de la coupure observée ce jour-là.
    # Les actions douces sont donc REJOUÉES tant que le réseau manque : une
    # réassociation qui échoue à la deuxième minute peut réussir à la sixième,
    # la borne ayant eu le temps de revenir.
    if [ "$echecs" -ge "$AVANT_REASSOCIATION" ] \
       && [ $(( (echecs - AVANT_REASSOCIATION) % 4 )) -eq 0 ] \
       && [ "$echecs" -lt "$AVANT_RADIO" ]; then
      journal "on se raccroche au réseau"
      # `connection up` réassocie SANS couper la radio : c'est le geste le plus
      # doux qui répare le cas le plus fréquent — l'association perdue alors que
      # la borne est là.
      nmcli --wait 15 connection up "$(nmcli -t -f NAME,TYPE connection show --active \
        | awk -F: '/wifi/{print $1; exit}')" >/dev/null 2>&1 \
        || nmcli device reapply "$(iface)" >/dev/null 2>&1

    elif [ "$echecs" -eq "$AVANT_RENOUVELLEMENT" ]; then
      journal "on redemande une adresse"
      nmcli device reapply "$(iface)" >/dev/null 2>&1 \
        || nmcli networking off >/dev/null 2>&1 && sleep 2 && nmcli networking on >/dev/null 2>&1

    elif [ "$echecs" -ge "$AVANT_RADIO" ] && [ "$echecs" -lt "$AVANT_REBOOT" ] \
         && [ $(( (echecs - AVANT_RADIO) % 8 )) -eq 0 ]; then
      journal "on coupe et rallume la radio Wi-Fi ($(signal))"
      nmcli radio wifi off >/dev/null 2>&1; sleep 5; nmcli radio wifi on >/dev/null 2>&1

    elif [ "$echecs" -ge "$AVANT_REBOOT" ]; then
      if reboot_autorise; then
        journal "toujours rien après $echecs contrôles — redémarrage"
        touch "$MARQUE_REBOOT"
        sync; systemctl reboot
      else
        # On le DIT plutôt que de se taire : sinon on cherche pourquoi le chien
        # de garde « ne fait rien », alors qu'il se retient exprès.
        journal "redémarrage retenu : un autre a déjà eu lieu dans l'heure"
        echecs="$AVANT_RADIO"   # on repart sur des tentatives douces
      fi
    fi
  fi
  sleep "$INTERVALLE"
done
