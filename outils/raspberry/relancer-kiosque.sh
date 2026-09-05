#!/usr/bin/env bash
export XDG_RUNTIME_DIR=/run/user/$(id -u) WAYLAND_DISPLAY=wayland-0
pkill -x kiosque.sh 2>/dev/null
pkill -x chromium 2>/dev/null
sleep 3
pkill -9 -x chromium 2>/dev/null
sleep 1
setsid nohup "$HOME/maison/outils/raspberry/kiosque.sh" > "$HOME/kiosque.log" 2>&1 < /dev/null &
disown
