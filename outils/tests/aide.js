/* Outils communs aux tests.

   Pourquoi ces tests vivent DANS le projet : ils ont été écrits pendant la
   reconstruction du 19/08 et ils sont ce qui a permis d'affirmer que le serveur
   refait se comportait comme l'ancien. Les laisser dans un dossier temporaire,
   c'était les perdre au prochain redémarrage — la même erreur que d'avoir
   sauvegardé la base sans sauvegarder le code.

   Deux règles tenues partout ici :
   1. **On teste sur les VRAIES données**, faute de base de test — donc tout ce
      qui est créé porte le préfixe `ZZ-essai` et est retiré à la fin. Aucune
      opération de MASSE n'est jamais essayée (le projet a déjà payé une liste de
      courses vidée et une journée de planning dupliquée).
   2. **Jamais de `curl`** : sous Git Bash il abîme les accents dans le corps
      JSON, ce qui a déjà fait croire à un bug d'encodage inexistant. */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const PORT = Number(process.env.PORT) || 8090;
const BASE = `http://localhost:${PORT}`;
const MARQUE = 'ZZ-essai';

function compteur() {
  const etat = { ok: 0, ko: 0, muet: false };
  etat.dire = (bon, quoi, detail = '') => {
    bon ? etat.ok++ : etat.ko++;
    if (!etat.muet) console.log(`${bon ? '  ok ' : '  ✗✗ '} ${quoi}${detail ? ' — ' + detail : ''}`);
    return bon;
  };
  etat.titre = (t) => { if (!etat.muet) console.log(`\n=== ${t} ===`); };
  etat.info = (t) => { if (!etat.muet) console.log(`     ${t}`); };
  return etat;
}

async function api(chemin, methode = 'GET', corps, entetes = {}) {
  const r = await fetch(BASE + chemin, {
    method: methode,
    headers: { 'content-type': 'application/json', ...entetes },
    body: corps ? JSON.stringify(corps) : undefined,
  });
  return { statut: r.status, j: await r.json().catch(() => ({})) };
}

/* Session d'administration. Tant que personne n'a de code, l'amorçage laisse
   entrer sans code — c'est documenté et volontaire. */
async function session(personne = 'Rémi') {
  const r = await api('/api/session', 'POST', { personne, code: '' });
  if (r.statut !== 200 || !r.j.jeton) throw new Error(`Session refusée pour ${personne}.`);
  const entetes = { 'x-session': r.j.jeton };
  return {
    entetes, moi: r.j.moi,
    api: (chemin, methode, corps) => api(chemin, methode, corps, entetes),
    fermer: () => api('/api/session', 'DELETE', null, entetes),
  };
}

/* Le serveur est-il là ? Un test qui échoue parce que rien n'écoute est un test
   qui ment sur la cause. */
async function serveurPret() {
  try {
    const r = await api('/api/health');
    return r.statut === 200 && r.j.ok;
  } catch (_) { return false; }
}

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
const ymd = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/* Écoute le flux temps réel pendant un test. Renvoie de quoi lire ce qui est
   arrivé, et surtout de quoi refermer proprement — une connexion SSE oubliée
   empêche le processus de se terminer. */
async function ecouterFlux() {
  const ctrl = new AbortController();
  const recus = [];
  const flux = await fetch(BASE + '/api/flux', { signal: ctrl.signal });
  const lecteur = flux.body.getReader();
  (async () => {
    const dec = new TextDecoder();
    let tampon = '';
    try {
      while (true) {
        const { done, value } = await lecteur.read();
        if (done) break;
        tampon += dec.decode(value);
        for (const bloc of tampon.split('\n\n')) {
          const ev = /event: (\w+)/.exec(bloc), da = /data: (.+)/.exec(bloc);
          if (ev && da) { try { recus.push({ type: ev[1], data: JSON.parse(da[1]) }); } catch (_) {} }
        }
        tampon = tampon.slice(tampon.lastIndexOf('\n\n') + 2);
      }
    } catch (_) { /* abandon volontaire */ }
  })();
  await attendre(300);
  return { recus, fermer: () => ctrl.abort() };
}

module.exports = { BASE, PORT, MARQUE, api, session, serveurPret, compteur, attendre, ymd, ecouterFlux };
