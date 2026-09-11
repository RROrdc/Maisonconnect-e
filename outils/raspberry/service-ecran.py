#!/usr/bin/env python3
"""Petit service local du Raspberry : reprendre la main sur l'écran mural.

POURQUOI IL EXISTE
  La dalle n'a NI CLAVIER NI SOURIS. Chromium tourne en `--kiosk`, donc il n'y a
  ni barre d'adresse, ni onglets, ni bouton de fermeture. Le raccourci
  Ctrl+Alt+Q existe mais ne sert à rien sans clavier : pour bricoler le Pi, il
  fallait ouvrir une session SSH depuis un autre poste.

  Le bento tourne DANS le navigateur DU PI. Une page servie par le Mac peut donc
  joindre `http://127.0.0.1:8099` — c'est le Pi lui-même. Un bouton dans le rail
  suffit alors à rendre la main.

CE QU'IL N'EST PAS
  Il n'écoute que sur la boucle locale : seul un programme qui tourne déjà sur
  le Pi peut l'appeler. Et la liste d'actions est FERMÉE (même règle que la
  musique et le vocal, § 2 septies) — il n'exécute que ce qu'il connaît.

LE FILET
  « Quitter » ne quitte pas pour toujours : au bout de RETOUR_MIN minutes, le
  kiosque revient tout seul. Sans ça, un doigt malheureux laisserait l'écran
  mural sur un bureau Raspberry jusqu'à ce que quelqu'un aille chercher un
  clavier — exactement le problème qu'on cherche à supprimer.
"""

import json
import os
import signal
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = int(os.environ.get('ECRAN_SERVICE_PORT', '8099'))
KIOSQUE = os.path.expanduser('~/maison/outils/raspberry/kiosque.sh')
RETOUR_MIN = int(os.environ.get('ECRAN_RETOUR_MIN', '10'))

_minuteur = None


def _pids(motif):
    """Les PID dont la ligne de commande contient `motif`.

    On passe par `pgrep -f` mais SANS le mot tel quel : le motif « [k]iosque »
    ne correspond pas à sa propre ligne de commande. C'est le piège qui a déjà
    coûté deux diagnostics dans ce projet — `pkill -f chromium` lancé depuis SSH
    tue sa propre session, et l'on croit que la commande n'a rien fait.
    """
    motif = '[' + motif[0] + ']' + motif[1:]
    r = subprocess.run(['pgrep', '-f', motif], capture_output=True, text=True)
    return [int(x) for x in r.stdout.split()]


def _arreter():
    for pid in _pids('kiosque.sh'):
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    time.sleep(1)
    # Chromium en dernier : sinon la boucle du script le relance aussitôt.
    r = subprocess.run(['pgrep', '-o', '-x', 'chromium'], capture_output=True, text=True)
    if r.stdout.strip():
        try:
            os.kill(int(r.stdout.strip()), signal.SIGTERM)
        except (ProcessLookupError, ValueError):
            pass


def _demarrer():
    env = dict(os.environ)
    env.setdefault('XDG_RUNTIME_DIR', '/run/user/%d' % os.getuid())
    env.setdefault('WAYLAND_DISPLAY', 'wayland-0')
    subprocess.Popen(['setsid', KIOSQUE], env=env,
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                     stdin=subprocess.DEVNULL)


def _programmer_retour():
    global _minuteur
    if _minuteur:
        _minuteur.cancel()
    _minuteur = threading.Timer(RETOUR_MIN * 60, _demarrer)
    _minuteur.daemon = True
    _minuteur.start()


class Poignee(BaseHTTPRequestHandler):
    def _repondre(self, charge, code=200):
        corps = json.dumps(charge).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        # La page vient du Mac : sans cet en-tête, le navigateur refuse de LIRE
        # la réponse (l'action partirait quand même, mais le bouton ne saurait
        # pas s'il a réussi — et un bouton dont on ignore l'effet ne se réappuie
        # jamais avec confiance).
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(corps)))
        self.end_headers()
        self.wfile.write(corps)

    def do_GET(self):
        chemin = self.path.split('?')[0]
        if chemin == '/etat':
            return self._repondre({'ok': True, 'kiosque': bool(_pids('kiosque.sh')),
                                   'retourMin': RETOUR_MIN})
        if chemin == '/quitter':
            _arreter()
            _programmer_retour()
            return self._repondre({'ok': True, 'retourMin': RETOUR_MIN})
        if chemin == '/relancer':
            if _minuteur:
                _minuteur.cancel()
            _arreter()
            time.sleep(1)
            _demarrer()
            return self._repondre({'ok': True})
        self._repondre({'ok': False, 'raison': 'action inconnue'}, 404)

    def log_message(self, *_):
        """Silencieux : ce service tourne en permanence, et un journal qui grossit
        sans que personne ne le lise finit par remplir la carte SD."""


if __name__ == '__main__':
    # 127.0.0.1 et rien d'autre : personne sur le Wi-Fi ne doit pouvoir éteindre
    # l'écran de la cuisine.
    HTTPServer(('127.0.0.1', PORT), Poignee).serve_forever()
