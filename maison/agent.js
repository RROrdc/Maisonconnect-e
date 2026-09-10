'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   Agent musique — le pont entre le serveur et Music.app.

   POURQUOI IL EXISTE, parce que ce n'est pas évident :
   piloter une application relève de l'« Automatisation » au sens de macOS, et
   cette autorisation se demande par une fenêtre. Un **LaunchDaemon** tourne hors
   de toute session graphique : macOS ne peut donc demander l'autorisation à
   personne, et refuse — sans erreur lisible, `osascript` sort simplement vide.
   Vérifié le 06/09 : le serveur voyait Music « ouvert » et échouait sur chaque
   lecture d'état.

   Un **LaunchAgent**, lui, vit dans la session de Rémi. La fenêtre s'y affiche
   une fois, il répond, et l'autorisation est retenue pour toujours.

   ⚠️ On ne déplace donc PAS le serveur en Agent : il doit démarrer sans session
   (§ 5 du guide). C'est seulement la partie qui a besoin de la session qui y
   passe — quelques dizaines de lignes, sur 127.0.0.1 uniquement.

   🔒 `127.0.0.1` et rien d'autre : cet agent n'a aucune authentification, et il
   n'en a pas besoin tant qu'il n'écoute que la machine elle-même. L'exposer sur
   le réseau donnerait le contrôle de la musique à quiconque passe sur le Wi-Fi.
   ═══════════════════════════════════════════════════════════════════════════ */

const http = require('http');
/* ⚠️ L'agent appelle les versions DIRECTES : les enveloppes publiques se
   replient sur l'agent, donc il s'appellerait lui-même en boucle. */
const musique = require('./musique');
const temperature = require('./temperature');

const PORT = Number(process.env.MUSIQUE_AGENT_PORT) || 8091;

const repondre = (res, code, corps) => {
  const t = JSON.stringify(corps);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(t) });
  res.end(t);
};

const serveur = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/etat') {
    return musique.etatDirect()
      .then((e) => repondre(res, 200, e))
      .catch((e) => repondre(res, 500, { erreur: e.message }));
  }

  /* La recherche passe aussi par l'agent : `search library playlist 1` est de
     l'automatisation comme le reste, donc refusée au démon. */
  if (req.method === 'GET' && req.url.startsWith('/chercher')) {
    const q = new URL(req.url, 'http://x').searchParams.get('q') || '';
    return musique.chercherDirect(q)
      .then((r) => repondre(res, 200, r))
      .catch((e) => repondre(res, 500, { resultats: [], raison: e.message }));
  }

  if (req.method === 'POST' && req.url === '/commande') {
    let brut = '';
    /* Une borne sur le corps : sans elle, une requête interminable retiendrait
       la mémoire de l'agent indéfiniment. 4 Ko suffisent très largement pour
       `{"commande":"suivant"}`. */
    req.on('data', (c) => { brut += c; if (brut.length > 4096) req.destroy(); });
    req.on('end', () => {
      let d;
      try { d = JSON.parse(brut || '{}'); } catch { return repondre(res, 400, { erreur: 'JSON invalide' }); }
      const { commande, ...options } = d;
      musique.commanderDirect(String(commande || ''), options)
        .then((r) => repondre(res, 200, r))
        .catch((e) => repondre(res, 400, { erreur: e.message }));
    });
    return;
  }

  if (req.method === 'GET' && req.url.startsWith('/temperature')) {
    /* Le nom du raccourci vient du serveur, pas de l'agent : c'est le serveur
       qui connaît les réglages. L'agent n'est qu'un bras dans la session. */
    const nom = new URL(req.url, 'http://x').searchParams.get('nom') || '';
    return temperature.etatDirect(nom)
      .then((e) => repondre(res, 200, e))
      .catch((e) => repondre(res, 500, { erreur: e.message }));
  }

  repondre(res, 404, { erreur: 'inconnu' });
});

serveur.listen(PORT, '127.0.0.1', () => {
  console.log(`agent musique à l'écoute sur 127.0.0.1:${PORT}`);
});
