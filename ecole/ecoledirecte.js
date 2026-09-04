'use strict';
/* Client EcoleDirecte — API privée, non officielle.
 *
 * ── Ce qu'il faut savoir avant de toucher à ce fichier ────────────────────
 * Cette API n'est pas publiée par l'éditeur. Le protocole reproduit ici est
 * celui de `ecoledirecte_api` (bibliothèque Python de hacf-fr, maintenue et en
 * service), relu endpoint par endpoint. Il peut changer sans préavis.
 * Trois conséquences assumées :
 *   1. `VERSION_API` est le point de rupture le plus probable (code 517).
 *      Elle est SURCHARGEABLE sans toucher au code — voir plus bas.
 *   2. L'en-tête `user-agent` doit rester STABLE : le serveur lie le jeton à
 *      lui, et le changer invalide la session en cours.
 *   3. Rien n'est écrit chez EcoleDirecte. Ce client est en LECTURE SEULE —
 *      même règle que Notion au § 2 ter, et pour la même raison : on ne prend
 *      pas le risque d'abîmer une source dont on ne maîtrise pas le contrat.
 *
 * ── Double authentification ───────────────────────────────────────────────
 * Depuis mars 2024, la première connexion d'un nouvel appareil impose un QCM
 * (code 250). Le client NE DEVINE JAMAIS la réponse : il lève `QcmRequis` en
 * portant la question et les propositions, et c'est un humain qui tranche
 * (`node outils/ecole.js qcm`). Une fois le QCM passé, le serveur rend un
 * couple `cn`/`cv` qui vaut « cet appareil est connu » : on le garde, et les
 * connexions suivantes n'ont plus de QCM. C'est ce qui rend le service
 * utilisable sans présence humaine.
 */
const fs = require('fs');
const path = require('path');
const { encoderED, deBase64, enBase64, anneeScolaire, jour, dansNJours } = require('./commun');

const API = 'https://api.ecoledirecte.com/v3';

/* ⚠️ Le seul numéro qui casse tout quand l'éditeur bouge. Surchargeable par
   `ED_VERSION` dans `.env` pour pouvoir réparer sans relivrer de code : le
   serveur répond alors 517 et le message d'erreur dit quoi faire. */
const VERSION_API = process.env.ED_VERSION || '4.101.1';

const OK = 200, SANS_DONNEES = 210, QCM = 250, IDENTIFIANTS = 505, VERSION_INVALIDE = 517, JETON = 520;

/* En-têtes constants. Copiés du client de référence : l'API refuse ce qui ne
   ressemble pas à son site web. Ce n'est pas de l'élégance, c'est la condition
   pour que ça réponde. */
const ENTETES = {
  accept: 'application/json, text/plain, */*',
  'accept-language': 'fr-FR,fr;q=0.9',
  'content-type': 'application/x-www-form-urlencoded',
  origin: 'https://www.ecoledirecte.com',
  referer: 'https://www.ecoledirecte.com/',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-site',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3',
};

class ErreurED extends Error {
  constructor(message, details = {}) { super(message); this.name = 'ErreurED'; Object.assign(this, details); }
}
/* Erreur ATTENDUE, pas un incident : elle veut dire « un humain doit répondre
   à une question ». Elle porte tout ce qu'il faut pour la poser. */
class QcmRequis extends ErreurED {
  constructor(question, propositions) {
    super('QCM de sécurité à renseigner : ' + question);
    this.name = 'QcmRequis'; this.question = question; this.propositions = propositions;
  }
}

class ClientED {
  constructor({ identifiant, motdepasse, fichierEtat } = {}) {
    this.identifiant = identifiant;
    this.motdepasse = motdepasse;
    this.fichierEtat = fichierEtat || path.join(__dirname, 'etat.json');
    this.cookies = new Map();
    this.jeton = null;
    this.connecte = false;
    this.etat = this.lireEtat();
  }

  /* ── État persistant ────────────────────────────────────────────────────
     `qcm` : question → réponses possibles. Tant qu'il en reste plusieurs, on
     ne peut pas répondre — c'est à l'humain de réduire à une seule.
     `cn`/`cv` : la preuve que cet appareil est connu. C'est un SECRET
     d'appareil : le fichier est hors dépôt (voir .gitignore). */
  lireEtat() {
    try { return JSON.parse(fs.readFileSync(this.fichierEtat, 'utf8')); }
    catch { return { qcm: {}, cn: null, cv: null }; }
  }
  ecrireEtat() {
    fs.writeFileSync(this.fichierEtat, JSON.stringify(this.etat, null, 2), 'utf8');
  }

  /* ── Transport ──────────────────────────────────────────────────────────
     Node n'a pas de bocal à cookies : on tient le nôtre. Il n'y en a que deux
     ou trois, et une dépendance de plus pour ça serait payer cher. */
  entetes(extra = {}) {
    const h = { ...ENTETES, ...extra };
    if (this.cookies.size) h.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    if (this.jeton) h['x-token'] = this.jeton;
    if (this.jeton2fa) h['2FA-Token'] = this.jeton2fa;
    return h;
  }
  memoriserReponse(res) {
    for (const brut of (res.headers.getSetCookie ? res.headers.getSetCookie() : [])) {
      const [paire] = brut.split(';');
      const i = paire.indexOf('=');
      if (i > 0) this.cookies.set(paire.slice(0, i).trim(), paire.slice(i + 1).trim());
    }
    /* Le serveur renvoie un jeton FRAIS à presque chaque réponse. Ne pas le
       reprendre, c'est se faire jeter en 520 au bout de quelques appels. */
    const neuf = res.headers.get('x-token');
    if (neuf) this.jeton = neuf;

    /* 🐞 Le QCM a son PROPRE jeton, rendu par le login dans l'en-tête
       `2FA-Token`. Sans lui, `doubleauth.awp` répond 520 alors que le jeton
       principal est parfaitement valide — on cherche alors une session expirée
       là où il manque simplement un second en-tête. */
    const fa = res.headers.get('2FA-Token');
    if (fa) this.jeton2fa = fa;
  }

  async appel(chemin, { params = {}, corps = null, entetes = {}, toleresQcm = false } = {}) {
    const url = new URL(API + chemin);
    url.searchParams.set('v', VERSION_API);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    let res;
    try {
      res = await fetch(url, {
        method: corps === null ? 'GET' : 'POST',
        headers: this.entetes(entetes),
        body: corps,
        signal: AbortSignal.timeout(30000),
      });
    } catch (e) {
      throw new ErreurED(`EcoleDirecte injoignable (${chemin}) : ${e.message}`, { chemin });
    }
    this.memoriserReponse(res);

    let json;
    try { json = await res.json(); }
    catch { throw new ErreurED(`Réponse illisible d'EcoleDirecte (${chemin}, HTTP ${res.status})`, { chemin, http: res.status }); }

    /* 🐞 Le jeton n'arrive PAS toujours dans l'en-tête `x-token` : à la première
       étape du QCM, il n'est que dans le corps JSON. Ne lire que l'en-tête, et
       l'appel suivant part sans authentification — le serveur répond alors 520
       (« jeton invalide »), message qui envoie chercher une expiration de
       session là où il n'y en a pas. On prend les deux, le corps en dernier. */
    if (json && typeof json.token === 'string' && json.token) this.jeton = json.token;

    const code = json.code;
    if (code === OK || code === SANS_DONNEES) return json;
    if (code === QCM && toleresQcm) return json;
    if (code === QCM) throw new QcmRequis('', []);
    if (code === IDENTIFIANTS) throw new ErreurED('Identifiant ou mot de passe refusé par EcoleDirecte (code 505).', { code });
    if (code === JETON) throw new ErreurED('Jeton EcoleDirecte invalide ou expiré (code 520) — il faut se reconnecter.', { code });
    if (code === VERSION_INVALIDE) {
      throw new ErreurED(
        `EcoleDirecte refuse la version d'API ${VERSION_API} (code 517). C'est la panne attendue quand l'éditeur `
        + `met à jour son site : relever la valeur de « v= » dans les requêtes de www.ecoledirecte.com et la poser `
        + `dans ED_VERSION du .env. Aucun code à modifier.`, { code });
    }
    throw new ErreurED(`EcoleDirecte a répondu ${code} : ${json.message || 'sans message'} (${chemin})`, { code, chemin });
  }

  /* ── Connexion ─────────────────────────────────────────────────────────── */
  async gtk() {
    this.cookies.delete('GTK');
    const url = new URL(API + '/login.awp');
    url.searchParams.set('v', VERSION_API);
    url.searchParams.set('gtk', '1');
    const res = await fetch(url, { headers: this.entetes(), signal: AbortSignal.timeout(30000) });
    this.memoriserReponse(res);
    const gtk = this.cookies.get('GTK');
    if (!gtk) throw new ErreurED("EcoleDirecte n'a pas délivré de cookie GTK — l'API a probablement changé.");
    return gtk;
  }

  chargeIdentifiants(fa = null) {
    const base = `"identifiant":"${encoderED(this.identifiant)}","motdepasse":"${encoderED(this.motdepasse)}","isRelogin":false`;
    if (!fa) return `data={${base}}`;
    return `data={${base},"cn":"${fa.cn}","cv":"${fa.cv}","uuid":"","fa":[{"cn":"${fa.cn}","cv":"${fa.cv}"}]}`;
  }

  async connexion() {
    if (!this.identifiant || !this.motdepasse) {
      throw new ErreurED('Identifiants EcoleDirecte absents : renseigne ED_IDENTIFIANT et ED_MOTDEPASSE dans le .env.');
    }
    this.cookies.clear();
    this.jeton = null;

    const gtk = await this.gtk();
    let rep = await this.appel('/login.awp', {
      corps: this.chargeIdentifiants(),
      entetes: { 'x-gtk': gtk },
      toleresQcm: true,
    });

    /* Chemin nominal : appareil déjà connu, ou établissement sans QCM. */
    if (rep.code === OK) return this.retenirProfil(rep);

    if (rep.code === QCM) {
      /* Appareil déjà validé une fois : on rejoue cn/cv, sans redemander. */
      if (this.etat.cn && this.etat.cv) {
        const gtk2 = await this.gtk();
        rep = await this.appel('/login.awp', {
          corps: this.chargeIdentifiants(this.etat),
          entetes: { 'x-gtk': gtk2 },
          toleresQcm: true,
        });
        if (rep.code === OK) return this.retenirProfil(rep);
        /* cn/cv périmés : on repart sur un QCM plutôt que d'échouer en boucle. */
        this.etat.cn = this.etat.cv = null;
        this.ecrireEtat();
      }
      await this.passerQcm();
      const gtk3 = await this.gtk();
      rep = await this.appel('/login.awp', { corps: this.chargeIdentifiants(this.etat), entetes: { 'x-gtk': gtk3 } });
      return this.retenirProfil(rep);
    }
    throw new ErreurED(`Connexion EcoleDirecte inattendue (code ${rep.code}).`, { code: rep.code });
  }

  /* Récupère la question, et ne répond QUE si une seule réponse est retenue.
     Sinon on enregistre les propositions et on rend la main : la machine
     propose, l'humain décide — comme partout ailleurs dans ce projet. */
  async passerQcm() {
    const rep = await this.appel('/connexion/doubleauth.awp', { params: { verbe: 'get' }, corps: 'data={}' });
    const question = deBase64(rep.data && rep.data.question);
    const propositions = (rep.data && rep.data.propositions || []).map(deBase64);

    const connues = this.etat.qcm[question];
    if (!connues || connues.length !== 1) {
      this.etat.qcm[question] = connues && connues.length ? connues : propositions;
      this.ecrireEtat();
      throw new QcmRequis(question, propositions);
    }

    const rep2 = await this.appel('/connexion/doubleauth.awp', {
      params: { verbe: 'post' },
      corps: `data={"choix":"${enBase64(connues[0])}"}`,
    });
    if (!rep2.data || !rep2.data.cn || !rep2.data.cv) {
      /* Mauvaise réponse enregistrée : on la remet en question plutôt que de
         la rejouer indéfiniment — c'est ce qui épuise les essais côté serveur. */
      this.etat.qcm[question] = propositions;
      this.ecrireEtat();
      throw new QcmRequis(question, propositions);
    }
    this.etat.cn = rep2.data.cn;
    this.etat.cv = rep2.data.cv;
    this.ecrireEtat();
  }

  /* Un compte peut être un élève (typeCompte « E ») ou une famille, qui porte
     alors plusieurs enfants. On aplatit les deux formes en une seule liste :
     le reste du projet n'a pas à savoir comment le compte est organisé. */
  retenirProfil(rep) {
    this.connecte = true;
    this.profil = rep.data;
    const comptes = (rep.data && rep.data.accounts) || [];
    this.eleves = [];
    for (const c of comptes) {
      if (c.typeCompte === 'E') {
        this.eleves.push({
          id: String(c.id), idLogin: c.idLogin, prenom: c.prenom, nom: c.nom,
          etablissement: c.nomEtablissement,
          classe: ((c.profile || {}).classe || {}).libelle || '',
          via: 'eleve',
        });
      } else {
        for (const e of ((c.profile || {}).eleves) || []) {
          this.eleves.push({
            id: String(e.id), idLogin: c.idLogin, prenom: e.prenom, nom: e.nom,
            etablissement: e.nomEtablissement || c.nomEtablissement,
            classe: ((e.classe || {}).libelle) || '',
            via: 'famille', familleId: String(c.id),
          });
        }
      }
    }
    this.famille = comptes.find((c) => c.typeCompte !== 'E');
    return this.eleves;
  }

  async assurerConnexion() { if (!this.connecte) await this.connexion(); }

  /* 🐞 LE défaut qui a fait disparaître Martial de l'écran pendant une nuit.
     `assurerConnexion()` ne reconnecte que si `connecte` est faux. Or le serveur
     tourne en continu : une fois la session ouverte, le drapeau reste vrai
     pour toujours — et quand EcoleDirecte fait expirer le jeton (au bout de
     quelques heures), TOUTES les lectures répondent 520 jusqu'au prochain
     redémarrage. Le module remontait bien un souci, mais l'écran, lui,
     affichait simplement « aucun devoir » : un mensonge, pas une panne.

     ⚠️ Le renouvellement vit ICI et nulle part ailleurs. Le poser dans les
     six méthodes de lecture, c'est cinq occasions de l'oublier à la sixième —
     et c'est déjà ce qui a coûté au projet les rayons de courses dupliqués
     (§ 2 octies) et la table des pictogrammes (§ 2 septdecies).
     Un SEUL nouvel essai : si la reconnexion échoue elle aussi, c'est que le
     mot de passe a changé ou que le compte est bloqué — insister ferait
     épuiser les tentatives côté serveur. */
  async lire(chemin, options) {
    await this.assurerConnexion();
    try {
      return await this.appel(chemin, options);
    } catch (e) {
      if (e.code !== JETON) throw e;
      this.connecte = false; this.jeton = null; this.cookies.clear();
      await this.connexion();          // cn/cv sont conservés ⇒ pas de QCM
      return this.appel(chemin, options);
    }
  }


  /* ── Lectures ──────────────────────────────────────────────────────────── */
  async emploiDuTemps(eleveId, du, au) {
    const rep = await this.lire(`/E/${eleveId}/emploidutemps.awp`, {
      params: { verbe: 'get' },
      corps: `data={"dateDebut":"${du}","dateFin":"${au}","avecTrous":false}`,
    });
    return rep.data || [];
  }

  async devoirs(eleveId) {
    const rep = await this.lire(`/Eleves/${eleveId}/cahierdetexte.awp`, { params: { verbe: 'get' }, corps: 'data={}' });
    return rep.data || {};
  }
  async devoirsDuJour(eleveId, date) {
    const rep = await this.lire(`/Eleves/${eleveId}/cahierdetexte/${date}.awp`, { params: { verbe: 'get' }, corps: 'data={}' });
    return rep.data || {};
  }

  async notes(eleveId, annee = anneeScolaire()) {
    const rep = await this.lire(`/eleves/${eleveId}/notes.awp`, {
      params: { verbe: 'get' },
      corps: `data={"anneeScolaire":"${annee}"}`,
    });
    return rep.data || {};
  }

  async vieScolaire(eleveId) {
    const rep = await this.lire(`/eleves/${eleveId}/viescolaire.awp`, { params: { verbe: 'get' }, corps: 'data={}' });
    return rep.data || {};
  }

  async messages({ eleveId = null, familleId = null, annee = anneeScolaire(), nombre = 50 } = {}) {
    const chemin = eleveId ? `/eleves/${eleveId}/messages.awp` : `/familles/${familleId}/messages.awp`;
    const rep = await this.lire(chemin, {
      params: {
        verbe: 'get', force: 'false', typeRecuperation: 'received', idClasseur: '0',
        orderBy: 'date', order: 'desc', query: '', onlyRead: '', page: '0',
        itemsPerPage: String(nombre), getAll: '0',
      },
      corps: `data={"anneeMessages":"${annee}"}`,
    });
    return rep.data || {};
  }
}

module.exports = { ClientED, ErreurED, QcmRequis, VERSION_API, jour, dansNJours, anneeScolaire };
