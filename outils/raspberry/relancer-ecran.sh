#!/bin/bash
# Relance l'écran mural depuis le bureau du Raspberry.
#
# Posé en raccourci sur le bureau : quand on est sorti du kiosque pour bricoler,
# la dalle est tactile mais il n'y a ni clavier ni souris — il faut pouvoir
# revenir au bento d'un seul doigt, sans terminal.
#
# On passe d'ABORD par le service local, parce que lui seul sait annuler le
# minuteur de retour automatique : sans ça, on relancerait le kiosque et le
# minuteur le relancerait une seconde fois dix minutes plus tard, ce qui
# ferait clignoter l'écran sans que personne comprenne pourquoi.
# S'il ne répond pas, on lance le script directement — un raccourci qui dépend
# d'un service pour fonctionner est un raccourci qui lâche le jour où ça compte.
set -u

if curl -fs -m 3 http://127.0.0.1:8099/relancer >/dev/null 2>&1; then
  exit 0
fi

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-wayland-0}"
pkill -f '[k]iosque.sh' 2>/dev/null
pid=$(pgrep -o -x chromium 2>/dev/null) && [ -n "$pid" ] && kill "$pid" 2>/dev/null
sleep 2
setsid "$HOME/maison/outils/raspberry/kiosque.sh" >>"$HOME/kiosque.log" 2>&1 </dev/null &
