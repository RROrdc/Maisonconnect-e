# -*- coding: utf-8 -*-
"""Pont Pronote — une commande entre, du JSON sort.

    python ecole/pronote/pont.py eleves
    python ecole/pronote/pont.py edt <jours>
    python ecole/pronote/pont.py devoirs <jours>
    python ecole/pronote/pont.py notes

-- Pourquoi un pont, et pas une bibliotheque JS ---------------------------
Le protocole Pronote (AES/RSA, session negociee) n'est pas reecrivable a la
main : il faut une bibliotheque. Les deux candidates sont `pronotepy` (Python,
MIT) et `Pawnote` (JS, GPL-3.0). La GPL est virale : la lier dans server.js
obligerait a publier tout le projet sous GPL le jour d'une distribution, ce qui
heurte la piste commerciale du CLAUDE.md § 5 quater. On paie donc un
aller-retour de processus pour rester en MIT. C'est le prix de la liberte.

-- Le piege du jeton, verifie en vrai -------------------------------------
Pronote REND UN NOUVEAU JETON A CHAQUE CONNEXION. Si on ne reecrit pas le
fichier d'identifiants apres chaque login, la connexion SUIVANTE echoue et il
faut regenerer un QR code. C'est exactement le meme piege que le `x-token`
d'EcoleDirecte. On reecrit donc les identifiants immediatement, avant meme de
lire quoi que ce soit -- si la lecture plante, le jeton reste valide.

-- Lecture seule -----------------------------------------------------------
Rien n'est ecrit chez Pronote.
"""
import datetime
import json
import os
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IDENTIFIANTS = os.path.join(BASE, 'pronote-identifiants.json')

# Le compte parent peut porter des enfants d'un ANCIEN etablissement : celui de
# Martial est reste rattache au college qu'il a quitte pour le lycee. Les
# afficher ferait apparaitre un emploi du temps perime a cote du vrai.
# Filtre pose en reglage plutot qu'en dur : aucun foyer code en dur (§ 5 quater).
ENFANTS_RETENUS = os.environ.get('PRONOTE_ENFANTS', 'Augustin')


def sortir(charge):
    sys.stdout.write(json.dumps(charge, ensure_ascii=False, default=str))
    sys.stdout.flush()


def echouer(message, detail=''):
    sortir({'ok': False, 'erreur': message, 'detail': str(detail)[:400]})
    sys.exit(1)


try:
    import pronotepy
except ImportError as ex:
    echouer("pronotepy n'est pas installe pour cet interpreteur Python.", ex)


def connexion():
    if not os.path.exists(IDENTIFIANTS):
        echouer("Aucun identifiant Pronote : il faut d'abord echanger un QR code "
                "(node outils/pronote.js qr <image.png> <pin>).")
    ident = json.load(open(IDENTIFIANTS, encoding='utf-8'))
    try:
        client = pronotepy.ParentClient.token_login(**ident)
    except KeyError as ex:
        # Observe en vrai le 03/09 : KeyError 'dataSec' dans le constructeur.
        # L'authentification passe, mais le serveur ne rend pas le profil ->
        # la session a ete invalidee cote Pronote. Le message doit le dire, sinon
        # on cherche un bug de code la ou il faut simplement un nouveau QR.
        echouer("Session Pronote invalidee (le serveur ne rend plus le profil : %s). "
                "Il faut regenerer un QR code depuis l'espace web." % ex, ex)
    except Exception as ex:
        echouer("Connexion Pronote refusee. Le jeton est probablement perime : "
                "il faut regenerer un QR code depuis l'espace web.", ex)
    if not client.logged_in:
        echouer("Connexion Pronote refusee (jeton invalide).")
    # AVANT toute lecture : voir l'avertissement en tete de fichier.
    json.dump(client.export_credentials(), open(IDENTIFIANTS, 'w', encoding='utf-8'),
              ensure_ascii=False, indent=2)
    return client


def enfants_utiles(client):
    voulus = [n.strip().lower() for n in ENFANTS_RETENUS.split(',') if n.strip()]
    retenus = []
    for enfant in client.children:
        nom = (enfant.name or '')
        if not voulus or any(v in nom.lower() for v in voulus):
            retenus.append(enfant)
    return retenus


def prenom_de(enfant):
    """Pronote rend « ROMMELARD Augustin » : le reste du projet raisonne en
    prenoms (planning, taches, courses, presence...). On prend donc le dernier
    mot, en conservant le nom complet a part."""
    morceaux = (enfant.name or '').split()
    return morceaux[-1] if morceaux else (enfant.name or '')


def echanger_qr(chemin_json, pin):
    """Echange le QR code contre des identifiants permanents.

    ⚠️ Le QR est a USAGE UNIQUE et expire en 10 minutes. Cet echange est donc
    le SEUL endroit du projet qui a le droit de le consommer, et il ecrit
    immediatement dans le fichier d'identifiants definitif. Des scripts
    d'essai eparpilles qui se connectent chacun de leur cote finissent par
    invalider la session -- c'est exactement ce qui est arrive le 03/09.
    """
    import uuid as uuidlib
    qr = json.load(open(chemin_json, encoding='utf-8'))
    identifiant_appareil = str(uuidlib.uuid4())
    erreurs = []
    for nom, classe in (('parent', pronotepy.ParentClient), ('eleve', pronotepy.Client)):
        try:
            client = classe.qrcode_login(qr, pin, identifiant_appareil)
        except Exception as ex:
            erreurs.append('%s : %s' % (nom, ex))
            continue
        ident = client.export_credentials()
        json.dump(ident, open(IDENTIFIANTS, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
        return sortir({'ok': True, 'compte': nom,
                       'titulaire': getattr(client.info, 'name', ''),
                       'enfants': [{'prenom': prenom_de(e), 'nom': e.name, 'classe': e.class_name or ''}
                                   for e in getattr(client, 'children', []) or []],
                       'retenus': [prenom_de(e) for e in enfants_utiles(client)]})
    echouer("Echange du QR code refuse. Il est peut-etre expire (10 min) ou deja "
            "utilise : en generer un nouveau depuis l'espace web.", ' | '.join(erreurs))


def main():
    commande = sys.argv[1] if len(sys.argv) > 1 else 'eleves'
    if commande == 'qr':
        if len(sys.argv) < 4:
            echouer('Usage : pont.py qr <fichier-qr.json> <pin>')
        return echanger_qr(sys.argv[2], sys.argv[3])

    jours = int(sys.argv[2]) if len(sys.argv) > 2 else 7
    client = connexion()
    retenus = enfants_utiles(client)

    if commande == 'eleves':
        return sortir({'ok': True, 'eleves': [
            {'prenom': prenom_de(e), 'nom': e.name, 'classe': e.class_name or '',
             'etablissement': getattr(client, 'nom_etablissement', '') or '', 'source': 'pronote'}
            for e in retenus]})

    debut = datetime.date.today()
    fin = debut + datetime.timedelta(days=jours)

    if commande == 'edt':
        cours = []
        for enfant in retenus:
            client.set_child(enfant)
            for lecon in client.lessons(debut, fin):
                cours.append({
                    'eleve': prenom_de(enfant),
                    'jour': lecon.start.strftime('%Y-%m-%d'),
                    'debut': lecon.start.strftime('%H:%M'),
                    'fin': lecon.end.strftime('%H:%M'),
                    'jourFin': lecon.end.strftime('%Y-%m-%d'),
                    'matiere': lecon.subject.name if lecon.subject else '',
                    'libelle': lecon.subject.name if lecon.subject else '',
                    'prof': lecon.teacher_name or '',
                    'salle': lecon.classroom or '',
                    'annule': bool(lecon.canceled),
                    'dispense': bool(getattr(lecon, 'exempted', False)),
                    'type': getattr(lecon, 'status', '') or '',
                    'source': 'pronote',
                })
        cours.sort(key=lambda c: (c['jour'], c['debut']))
        return sortir({'ok': True, 'cours': cours})

    if commande == 'devoirs':
        devoirs = []
        for enfant in retenus:
            client.set_child(enfant)
            for travail in client.homework(debut, fin):
                devoirs.append({
                    'eleve': prenom_de(enfant),
                    'id': str(getattr(travail, 'id', '') or ''),
                    'pour': travail.date.strftime('%Y-%m-%d'),
                    # « Matiere non designee » est ce que rend Pronote pour un mot
                    # de la vie scolaire (assurance, photo). C'est une vraie
                    # information, pas une anomalie : on la garde telle quelle.
                    'matiere': travail.subject.name if travail.subject else '',
                    'contenu': (travail.description or '').strip(),
                    'interrogation': False,
                    'fait': bool(travail.done),
                    'source': 'pronote',
                })
        devoirs.sort(key=lambda d: (d['pour'], d['matiere']))
        return sortir({'ok': True, 'devoirs': devoirs})

    if commande == 'tout':
        # Une SEULE connexion pour tout lire. Chaque lancement de ce pont coute
        # ~2 s (demarrage de Python + negociation de session) : appeler trois
        # fois pour l'emploi du temps, les devoirs et les notes en couterait
        # six de plus, sur un ecran mural qui se rafraichit tout seul.
        charge = {'ok': True, 'eleves': [], 'cours': [], 'devoirs': [], 'notes': []}
        for enfant in retenus:
            client.set_child(enfant)
            prenom = prenom_de(enfant)
            charge['eleves'].append({
                'prenom': prenom, 'nom': enfant.name, 'classe': enfant.class_name or '',
                'etablissement': getattr(client, 'nom_etablissement', '') or '', 'source': 'pronote',
            })
            for lecon in client.lessons(debut, fin):
                charge['cours'].append({
                    'eleve': prenom,
                    'jour': lecon.start.strftime('%Y-%m-%d'),
                    'debut': lecon.start.strftime('%H:%M'),
                    'fin': lecon.end.strftime('%H:%M'),
                    'jourFin': lecon.end.strftime('%Y-%m-%d'),
                    'matiere': lecon.subject.name if lecon.subject else '',
                    'libelle': lecon.subject.name if lecon.subject else '',
                    'prof': lecon.teacher_name or '',
                    'salle': lecon.classroom or '',
                    'annule': bool(lecon.canceled),
                    'dispense': bool(getattr(lecon, 'exempted', False)),
                    'type': getattr(lecon, 'status', '') or '',
                    'source': 'pronote',
                })
            for travail in client.homework(debut, fin):
                charge['devoirs'].append({
                    'eleve': prenom,
                    'id': str(getattr(travail, 'id', '') or ''),
                    'pour': travail.date.strftime('%Y-%m-%d'),
                    'matiere': travail.subject.name if travail.subject else '',
                    'contenu': (travail.description or '').strip(),
                    'interrogation': False,
                    'fait': bool(travail.done),
                    'source': 'pronote',
                })
            try:
                periode = client.current_period
                for note in periode.grades:
                    charge['notes'].append({
                        'eleve': prenom,
                        'date': note.date.strftime('%Y-%m-%d') if note.date else '',
                        'matiere': note.subject.name if note.subject else '',
                        'devoir': note.comment or '',
                        'valeur': note.grade, 'sur': note.out_of,
                        'coefficient': note.coefficient, 'moyenneClasse': note.average,
                        'significative': str(note.grade) not in ('Abs', 'NonNote', 'Disp', 'NonRendu'),
                        'periode': periode.name, 'source': 'pronote',
                    })
            except Exception:
                # Une periode absente n'est pas une panne : en debut d'annee il
                # n'y a rien. On ne fait pas echouer TOUT le reste pour ca.
                pass
        charge['cours'].sort(key=lambda c: (c['jour'], c['debut']))
        charge['devoirs'].sort(key=lambda d: (d['pour'], d['matiere']))
        # Le college d'Augustin ferme l'onglet messagerie aux parents : on le DIT,
        # sinon un ecran vide passe pour une panne (cf CLAUDE.md § 2 tervicies).
        charge['modules'] = {'cours': True, 'devoirs': True, 'notes': True, 'messages': False}
        return sortir(charge)

    if commande == 'notes':
        notes = []
        for enfant in retenus:
            client.set_child(enfant)
            try:
                periode = client.current_period
            except Exception:
                continue
            for note in periode.grades:
                notes.append({
                    'eleve': prenom_de(enfant),
                    'date': note.date.strftime('%Y-%m-%d') if note.date else '',
                    'matiere': note.subject.name if note.subject else '',
                    'devoir': note.comment or '',
                    'valeur': note.grade,
                    'sur': note.out_of,
                    'coefficient': note.coefficient,
                    'moyenneClasse': note.average,
                    'significative': str(note.grade) not in ('Abs', 'NonNote', 'Disp', 'NonRendu'),
                    'periode': periode.name,
                    'source': 'pronote',
                })
        return sortir({'ok': True, 'notes': notes})

    echouer('Commande inconnue : %s' % commande)


if __name__ == '__main__':
    try:
        main()
    except SystemExit:
        raise
    except Exception as ex:  # noqa: BLE001 - le pont ne doit JAMAIS crasher en texte brut
        # Node attend du JSON sur stdout : une trace Python le ferait echouer
        # sur « reponse illisible », message qui n'aide personne.
        echouer('Erreur inattendue du pont Pronote : %s' % type(ex).__name__, ex)
